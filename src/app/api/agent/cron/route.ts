import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/mongodb";
import { findStalledAgents, transitionAgent, type Agent } from "@/lib/agent/agents";
import { runRevocationMonitorForAll } from "@/lib/agent/revocationMonitor";

export const maxDuration = 300;

/**
 * GET /api/agent/cron
 *
 * Called hourly by Vercel Cron. Iterates every agent in MongoDB and runs the
 * full plan→execute→reflect loop for any agent that:
 *   1. Has a `scheduleIntervalMs` set (opt-in autonomous mode)
 *   2. Has lastRunAt older than that interval (or has never run)
 *   3. Is not currently running (status !== "executing")
 *
 * Each agent is run by POSTing to the existing /api/agent/run-stream endpoint
 * and consuming the SSE stream to completion. This reuses 100% of the live-run
 * logic — same plan, same tools, same reflection, same Telegram report —
 * without requiring a connected browser.
 */
export async function GET(request: NextRequest) {
  // Verify Vercel cron secret (only enforced in production)
  const authHeader = request.headers.get("authorization");
  if (process.env.VERCEL && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = request.nextUrl.origin;
  const db = await getDb();
  if (!db) {
    return NextResponse.json({ ran: 0, reason: "Database unavailable" });
  }

  // ── Step 1: Recover stalled agents (crashed mid-run >5min ago) ───────────
  const stalled = await findStalledAgents();
  for (const a of stalled) {
    await transitionAgent(a.id, {
      status:      "failed",
      lastError:   "Stalled — phase exceeded 5 min timeout (likely server crash)",
      currentRunId: null,
    });
    console.warn(`[cron] recovered stalled agent ${a.name} (${a.id}) → failed`);
  }

  // Find all agents with a schedule configured
  const allAgents = await db
    .collection<Agent & { scheduleIntervalMs?: number }>("agents")
    .find({ scheduleIntervalMs: { $gt: 0 } })
    .toArray();

  const now = Date.now();
  const dueAgents = allAgents.filter((a) => {
    // Skip agents that are mid-run or in a non-runnable state
    if (a.status === "executing" || a.status === "planning" || a.status === "reflecting") return false;
    if (a.status === "paused" || a.status === "blocked" || a.status === "failed") return false;
    const interval = a.scheduleIntervalMs ?? 0;
    if (!interval) return false;
    const last = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
    return now - last >= interval;
  });

  if (dueAgents.length === 0) {
    return NextResponse.json({
      ran:     0,
      checked: allAgents.length,
      reason:  "No agents due to run",
    });
  }

  // A2A-3 fix: topological sort — run parent agents before children so Scout's
  // team insights are written to DB before Risk Monitor / Executor read them.
  // Build a map of agentId → agent for O(1) lookup
  const agentById = new Map(allAgents.map(a => [a.id, a]));
  function topoSort(agents: typeof dueAgents): typeof dueAgents {
    const sorted: typeof dueAgents = [];
    const visited = new Set<string>();
    function visit(a: typeof dueAgents[0]) {
      if (visited.has(a.id)) return;
      visited.add(a.id);
      // Visit parent first (if parent is also due to run)
      const parent = a.parentAgentId ? agentById.get(a.parentAgentId) : null;
      if (parent && dueAgents.find(d => d.id === parent.id)) visit(parent as typeof dueAgents[0]);
      sorted.push(a);
    }
    for (const a of agents) visit(a);
    return sorted;
  }
  const orderedAgents = topoSort(dueAgents);

  const results: Array<{ agentId: string; name: string; ok: boolean; error?: string }> = [];

  // Run each due agent serially in topological order (parent first)
  for (const agent of orderedAgents) {
    try {
      // Internal call to run-stream — we consume the SSE stream and discard events
      // The stream itself is what triggers all the work (plan, execute, reflect, media, telegram)
      const res = await fetch(`${origin}/api/agent/run-stream`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          agentId:            agent.id,
          walletAddress:      agent.walletAddress,
          permissionsContext: agent.delegationContext,
          delegationManager:  agent.delegationManagerAddress,
          // WF-3 fix: pass delegationId so x402/pay can use 1Shot's stored-redelegate
          // path. Without this, cron-triggered runs always fall back to "direct" mode.
          delegationId:       (agent as typeof agent & { delegationId?: string }).delegationId,
        }),
      });

      if (!res.body) {
        results.push({ agentId: agent.id, name: agent.name, ok: false, error: "no stream body" });
        continue;
      }

      // Drain the SSE stream to completion — this drives the entire agent loop
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      results.push({ agentId: agent.id, name: agent.name, ok: true });
      console.log(`[cron] ✓ ${agent.name} (${agent.id})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron] ✗ ${agent.name}:`, msg);
      results.push({ agentId: agent.id, name: agent.name, ok: false, error: msg });
    }
  }

  // ── Auto-revocation monitor ─────────────────────────────────────────────────
  // After running all agents, check every active agent for revocation conditions:
  //   - Budget exhausted (≥95% cap)
  //   - APY below configured minimum
  //   - 3+ consecutive failures
  //   - Stop-loss triggered
  //   - ERC-7715 permission expired
  //
  // Off-chain detection; on-chain revocation via DelegationManager.disableDelegation()
  const allActiveAgentIds = allAgents
    .filter(a => a.delegationStatus === "active" && a.delegationContext !== "0xdemo")
    .map(a => a.id);

  const revocations = await runRevocationMonitorForAll(allActiveAgentIds, origin);

  return NextResponse.json({
    ran:              results.length,
    checked:          allAgents.length,
    stalledRecovered: stalled.length,
    results,
    revocations: revocations.map(r => ({ agentId: r.agentId, reason: r.reason, revokeAll: r.revokeAll })),
  });
}
