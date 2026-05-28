import { NextRequest, NextResponse } from "next/server";
import { createAgent, setDelegation, type MediaPolicy } from "@/lib/agent/agents";
import { createWorkflow, addAgentToWorkflow, bindPermissionToWorkflow } from "@/lib/agent/workflows";

/**
 * POST { prompt, walletAddress, answers, permissionsContext?, delegationManager? }
 *
 * Creates 1 or more agents from the questionnaire answers and auto-wires
 * delegation between them (multi-agent orchestration).
 *
 * Single agent: creates 1 agent with the right goal + budget + mediaPolicy
 * Multi-agent:  creates 3 agents (Scout, Risk Monitor, Executor), wires
 *               Scout → Risk Monitor → Executor delegation chain, returns all 3
 */

interface Answers {
  protocols?:      string[];    // ["Morpho", "Uniswap", ...]
  risk?:           string;      // "Conservative" | "Moderate" | "Aggressive"
  budget?:         number;      // USDC
  schedule?:       string;      // "Daily" | "Every hour" | etc.
  notify?:         string[];    // ["Telegram message", "Voice note", ...]
  orchestration?:  string;      // "Single agent" | "Multi-agent team..." | "Decide for me"
  [key: string]:   unknown;
}

export async function POST(request: NextRequest) {
  let body: {
    prompt:              string;
    walletAddress:       string;
    answers:             Answers;
    permissionsContext?: string;
    delegationManager?:  string;
    expiresAt?:          number;   // WF-2: real expiry from the MetaMask grant
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const { prompt, walletAddress, answers, permissionsContext, delegationManager } = body;
  if (!prompt || !walletAddress) {
    return NextResponse.json({ error: "prompt and walletAddress required" }, { status: 400 });
  }

  const budget       = String(answers.budget ?? "10");
  const protocols    = answers.protocols ?? [];
  const risk         = answers.risk ?? "Moderate";
  const schedule     = answers.schedule ?? "Daily";
  const notify       = answers.notify ?? ["Telegram message"];
  const orchestration = answers.orchestration ?? "Single agent";
  const isMulti      = orchestration.toLowerCase().includes("multi") || orchestration === "Decide for me";

  // ── Build enriched goal ────────────────────────────────────────────────────
  // LLM-5 fix: "Aave" is not in executeDefi's protocol enum — use only valid protocols
  const protoList  = protocols.length > 0 ? protocols.join(", ") : "Morpho, Sky, Lido";
  const notifyMode = notify.includes("Voice note (x402 TTS)") ? "every-run"
                   : notify.includes("Strategy image")        ? "milestones"
                   : notify.includes("Silent")                ? "off"
                   :                                            "milestones";
  const mediaPolicy: MediaPolicy = notifyMode as MediaPolicy;

  const riskClause = risk === "Conservative" ? "Skip if any risk signal exists."
                   : risk === "Aggressive"   ? "Act even on moderate risk signals."
                   : "Act only on clear low-risk signals.";
  const scheduleClause = schedule === "Every hour" ? "Run every hour." : `Run ${schedule.toLowerCase()}.`;

  // Map schedule string → cron interval ms (used by /api/agent/cron)
  const scheduleIntervalMs: number | undefined =
      schedule === "Every hour"      ? 60  * 60 * 1000
    : schedule === "Every 6 hours"   ? 6   * 60 * 60 * 1000
    : schedule === "Daily"           ? 24  * 60 * 60 * 1000
    : schedule === "Weekly"          ? 7   * 24 * 60 * 60 * 1000
    : schedule === "On-demand only"  ? undefined
    :                                  24  * 60 * 60 * 1000;  // default daily

  const enrichedGoal =
    `${prompt.trim()} Use protocols: ${protoList}. ${riskClause} Budget: ${budget} USDC. ${scheduleClause} ` +
    (notify.includes("Telegram message") ? "Report via Telegram." : "");

  // PROTO-1 fix: use the actual periodDays from answers (defaulting to 30 only as fallback).
  // The questionnaire captures schedule; map it to a sensible period.
  const periodDays = typeof answers.periodDays === "number" ? answers.periodDays
    : schedule === "Weekly"        ? 7
    : schedule === "Every hour"    ? 1
    : schedule === "Every 6 hours" ? 1
    :                                30;  // daily / default

  // ── Create the workflow envelope (one per prompt) ─────────────────────────
  const workflow = await createWorkflow({
    walletAddress,
    name:       inferWorkflowName(prompt, protocols, isMulti),
    prompt,
    budgetUsdc: budget,
    periodDays,
  });

  // If a real ERC-7715 permission was provided, bind it to the workflow now
  // (server-side storage — replaces localStorage for multi-workflow support)
  const _isRealPerm = !!(permissionsContext && delegationManager
    && permissionsContext.length > 40 && !permissionsContext.includes("demo")
    && permissionsContext.startsWith("0x"));
  if (_isRealPerm) {
    await bindPermissionToWorkflow(workflow.id, {
      permissionsContext:       permissionsContext!,
      delegationManagerAddress: delegationManager!,
      delegationHash:           "0xpending",
      budgetUsdc:               budget,
      periodDays,
      // WF-2 fix: MetaMask grants 90 days — don't hardcode 30 days here.
      // Use the expiresAt from the body if provided; otherwise default to 90 days
      // to match what requestUsdcPermission() uses in permissions.ts.
      expiresAt: body.expiresAt ?? Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
    });
  }

  // ── Create agents under this workflow ──────────────────────────────────────
  if (!isMulti) {
    // Single agent
    const agent = await createAgent({
      walletAddress,
      name:        inferName(prompt, protocols, false),
      goal:        enrichedGoal,
      budgetUsdc:  budget,
      mediaPolicy,
      scheduleIntervalMs,
      workflowId:  workflow.id,
    });
    await addAgentToWorkflow(workflow.id, agent.id);

    // Bind permission if provided
    if (permissionsContext && delegationManager) {
      await setDelegation(agent.id, {
        parentAgentId:            null,
        delegationContext:        permissionsContext,
        delegationHash:           "0xpending",
        delegationManagerAddress: delegationManager,
        delegationCap:            budget,
      });
    }

    return NextResponse.json({ agents: [agent], workflow, wired: false });
  }

  // ── Multi-agent team ───────────────────────────────────────────────────────
  // 1. Scout — fetches yields + risk data
  const scout = await createAgent({
    walletAddress,
    name:       `Scout — ${inferName(prompt, protocols, false)}`,
    goal:       `Research yields on ${protoList}. Call checkYields and checkRisk. Report findings. ${riskClause} Budget: ${budget} USDC.`,
    budgetUsdc: budget,
    mediaPolicy: "off",
    position:   { x: 80,  y: 200 },
    workflowId: workflow.id,
  });
  await addAgentToWorkflow(workflow.id, scout.id);

  // 2. Risk Monitor — validates signals, decides action
  const riskMonitor = await createAgent({
    walletAddress,
    name:       "Risk Monitor",
    goal:       `Evaluate market risk signals from the Scout agent. Decide: deposit, hold, or rebalance. ${riskClause} Never act if risk is HIGH.`,
    budgetUsdc: budget,
    mediaPolicy: "off",
    position:   { x: 420, y: 200 },
    workflowId: workflow.id,
  });
  await addAgentToWorkflow(workflow.id, riskMonitor.id);

  // 3. Executor — executes DeFi transactions + notifies (this is the one cron drives)
  const executor = await createAgent({
    walletAddress,
    name:       `Executor — ${inferName(prompt, protocols, false)}`,
    goal:       `Execute DeFi transactions approved by Risk Monitor. Protocols: ${protoList}. ${scheduleClause} ${notify.includes("Telegram message") ? "Report via Telegram after each execution." : ""}`,
    budgetUsdc: budget,
    scheduleIntervalMs,  // only the Executor runs on schedule; Scout/Risk are invoked by it
    workflowId: workflow.id,
    mediaPolicy,
    position:   { x: 760, y: 200 },
  });
  await addAgentToWorkflow(workflow.id, executor.id);

  // 4. Auto-wire delegation: Scout → Risk Monitor → Executor
  //
  // WF-1 fix: each link in the chain gets its OWN capped sub-delegation via
  // 1Shot redelegateWithDelegationData — NOT the same root context.
  // Without this, all agents share the root budget with no isolation.
  const demoHash = () => `0xdemo-${Math.random().toString(16).slice(2, 10)}`;
  const hasRealPermission = !!(permissionsContext && delegationManager &&
    permissionsContext.length > 40 && !permissionsContext.includes("demo"));

  // Bind root permission to Scout first
  await setDelegation(scout.id, {
    parentAgentId:            null,
    delegationContext:        hasRealPermission ? permissionsContext! : "0xdemo",
    delegationHash:           hasRealPermission ? "0xpending" : demoHash(),
    delegationManagerAddress: hasRealPermission ? delegationManager! : "0x",
    delegationCap:            budget,
  });

  // Helper: build a real sub-delegation from a parent context to a child address
  async function buildSubContext(parentCtx: string, childAgent: typeof scout): Promise<{ context: string; hash: string }> {
    if (!hasRealPermission || parentCtx === "0xdemo") {
      return { context: "0xdemo", hash: demoHash() };
    }
    try {
      const { redelegatePermissionContextOnce } = await import("@/lib/oneshot/agentWallet");
      const { agentOnChainAddress } = await import("@/lib/agent/agents");
      const childAddress = await agentOnChainAddress(childAgent);
      const result = await redelegatePermissionContextOnce(parentCtx, childAddress);
      const chain = [JSON.parse(result.parent), JSON.parse(result.redelegation)];
      return {
        context: "0x" + Buffer.from(JSON.stringify(chain)).toString("hex"),
        hash:    "0xpending",  // real hash computed on first revoke attempt
      };
    } catch (e) {
      console.warn("[from-answers] sub-delegation failed, recording as pending:", e);
      // Bug 1 pattern: on failure use "0xdemo" — never leak parent context down
      return { context: "0xdemo", hash: demoHash() };
    }
  }

  // Scout → Risk Monitor (scoped sub-delegation, capped to budget)
  const rmCtx = await buildSubContext(
    hasRealPermission ? permissionsContext! : "0xdemo",
    riskMonitor,
  );
  await setDelegation(riskMonitor.id, {
    parentAgentId:            scout.id,
    delegationContext:        rmCtx.context,
    delegationHash:           rmCtx.hash,
    delegationManagerAddress: delegationManager ?? "0x",
    delegationCap:            budget,
  });

  // Risk Monitor → Executor (scoped sub-delegation, capped to budget)
  const exCtx = await buildSubContext(rmCtx.context, executor);
  await setDelegation(executor.id, {
    parentAgentId:            riskMonitor.id,
    delegationContext:        exCtx.context,
    delegationHash:           exCtx.hash,
    delegationManagerAddress: delegationManager ?? "0x",
    delegationCap:            budget,
  });

  return NextResponse.json({
    agents:   [scout, riskMonitor, executor],
    workflow,
    wired:    true,
    chain:    `${scout.name} → ${riskMonitor.name} → ${executor.name}`,
  });
}

function inferWorkflowName(prompt: string, protocols: string[], isMulti: boolean): string {
  const lower = prompt.toLowerCase();
  const proto = protocols[0] ?? "";
  const team  = isMulti ? "Team" : "Agent";
  if (lower.includes("dca"))                  return `DCA ${team}`;
  if (lower.includes("rebalanc"))             return `Rebalancer ${team}`;
  if (lower.includes("yield") || lower.includes("apy"))
    return proto ? `${proto} Yield ${team}` : `Yield Hunter ${team}`;
  if (lower.includes("risk"))                 return `Risk ${team}`;
  if (lower.includes("stake"))                return `Staking ${team}`;
  if (lower.includes("lp") || lower.includes("liquidity")) return `LP ${team}`;
  if (lower.includes("governance"))           return `Governance ${team}`;
  return `Strategy ${team}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function inferName(prompt: string, protocols: string[], _multi: boolean): string {
  const lower = prompt.toLowerCase();
  if (lower.includes("dca"))         return "DCA Agent";
  if (lower.includes("rebalanc"))    return "Rebalancer";
  if (lower.includes("yield") || lower.includes("apy")) {
    const proto = protocols[0] ?? "Yield";
    return `${proto} Yield Hunter`;
  }
  if (lower.includes("risk"))        return "Risk Monitor";
  if (lower.includes("stake"))       return "Staking Agent";
  if (lower.includes("lp") || lower.includes("liquidity")) return "LP Manager";
  return "Strategy Agent";
}
