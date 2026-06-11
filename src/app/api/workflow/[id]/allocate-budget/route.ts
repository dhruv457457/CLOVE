import { NextRequest, NextResponse } from "next/server";
import { getWorkflow } from "@/lib/agent/workflows";
import { getAgent, updateAgent, setDelegation, type Agent } from "@/lib/agent/agents";
import { decideAllocation, weightsToCaps, type ProtocolFinding } from "@/lib/agent/allocator";

/**
 * FUND MANAGER · DYNAMIC BUDGET SPLIT.
 *
 * "AI decides the split, the chain enforces it." The Fund Manager (Venice) reads
 * each protocol's live yield + risk and decides what fraction of the budget each
 * per-protocol executor gets. Those fractions become each executor's REAL
 * on-chain ERC20TransferAmountEnforcer cap (rebuilt via buildRedeemableWorkerChain
 * — signing only, no relayer call). Overspend past the allocated slice reverts.
 *
 * Body: { walletAddress, rootContext?, findings?, riskTolerance? }
 *   findings: [{ protocol, apy, risk, tvl }] — the scouts' live readings (optional;
 *             if absent the Fund Manager allocates from general knowledge).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const wf = await getWorkflow(id);
  if (!wf) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

  let body: { walletAddress?: string; rootContext?: string; findings?: ProtocolFinding[]; riskTolerance?: string } = {};
  try { body = await req.json(); } catch { /* optional */ }

  // Resolve the per-protocol executors (each carries typeConfig.protocols = [proto]).
  const agents = (await Promise.all(wf.agentIds.map(aid => getAgent(aid)))).filter(Boolean) as Agent[];
  const executors = agents.filter(a =>
    Array.isArray((a.typeConfig as { protocols?: string[] } | undefined)?.protocols) &&
    ((a.typeConfig as { protocols?: string[] }).protocols!.length === 1) &&
    Number(a.budgetUsdc) >= 0 && /executor/i.test(a.name),
  );
  if (executors.length < 2) {
    return NextResponse.json(
      { error: "This workflow has no per-protocol executors to split across (single-executor team).", executors: executors.length },
      { status: 400 },
    );
  }

  const protocols = executors.map(e => (e.typeConfig as { protocols: string[] }).protocols[0].toLowerCase());
  const total = Number(wf.budgetUsdc) || executors.reduce((s, e) => s + Number(e.budgetUsdc), 0);

  // ── 1. The decision: Venice splits the budget across protocols ──────────────
  // Use passed findings, else auto-fetch LIVE yields so the split is data-driven.
  let findings = body.findings ?? [];
  if (findings.length === 0) {
    findings = await gatherLiveFindings(protocols, req.nextUrl.origin);
  }
  const decision = await decideAllocation(protocols, findings, body.riskTolerance ?? "moderate");
  const caps = weightsToCaps(decision.weights, total);

  // ── 2. Resolve the FM grant (root of every worker chain) ────────────────────
  let rootContext = body.rootContext;
  if (!rootContext) {
    try {
      const { getDb } = await import("@/lib/db/mongodb");
      const db = await getDb();
      const stored = db && body.walletAddress
        ? await db.collection("user_permissions").findOne({ walletAddress: body.walletAddress.toLowerCase() })
        : null;
      rootContext = stored?.permissionsContext as string | undefined;
    } catch { /* */ }
  }

  // ── 3. Apply: update each executor's cap + rebuild its scoped chain ─────────
  const allocations: { name: string; protocol: string; weight: number; capUsdc: number; rewired: boolean }[] = [];
  for (const ex of executors) {
    const proto = (ex.typeConfig as { protocols: string[] }).protocols[0].toLowerCase();
    const capUsdc = caps[proto] ?? 0;
    await updateAgent(ex.id, { budgetUsdc: String(capUsdc) });

    let rewired = false;
    if (rootContext && rootContext.length > 40 && capUsdc > 0) {
      try {
        const { buildRedeemableWorkerChain } = await import("@/lib/web3/subDelegation");
        const chain = await buildRedeemableWorkerChain(rootContext, ex.id, [proto], capUsdc, ex.chainId ?? 8453);
        await setDelegation(ex.id, {
          parentAgentId:            ex.parentAgentId ?? null,
          delegationContext:        chain.context,
          delegationHash:           chain.scopedHash,
          delegationManagerAddress: ex.delegationManagerAddress ?? "0x",
          delegationCap:            String(capUsdc),
        });
        rewired = true;
      } catch (e) {
        console.warn(`[allocate-budget] chain rebuild failed for ${ex.name}:`, e instanceof Error ? e.message : e);
      }
    }
    allocations.push({ name: ex.name, protocol: proto, weight: decision.weights[proto] ?? 0, capUsdc, rewired });
  }

  return NextResponse.json({
    ok: true,
    reasoning: decision.reasoning,
    source:    decision.source,        // "venice" | "fallback-equal"
    totalUsdc: total,
    findings,                          // the live yields the FM reasoned over
    allocations,                       // per-protocol weight + new on-chain cap
  });
}

/** Pull live per-protocol APY/risk/TVL from /api/intelligence for the FM to reason over. */
async function gatherLiveFindings(protocols: string[], baseUrl: string): Promise<ProtocolFinding[]> {
  try {
    const { internalHeaders } = await import("@/lib/auth/internal");
    const res = await fetch(`${baseUrl}/api/intelligence`, { headers: internalHeaders() });
    if (!res.ok) return [];
    const data = await res.json() as { yields?: Record<string, { apy?: number; tvlUsd?: number; risk?: string }> };
    const yields = data.yields ?? {};
    return protocols.map(p => {
      const key = Object.keys(yields).find(k => k.toLowerCase().includes(p));
      const y = key ? yields[key] : undefined;
      return { protocol: p, apy: y?.apy, risk: y?.risk, tvl: y?.tvlUsd };
    });
  } catch { return []; }
}
