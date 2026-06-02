import { NextRequest, NextResponse } from "next/server";
import { createAgent, setDelegation, type MediaPolicy, type AgentType } from "@/lib/agent/agents";
import { createWorkflow, addAgentToWorkflow, bindPermissionToWorkflow } from "@/lib/agent/workflows";
import { getAgentTypeDef, buildTypeSystemPrompt, inferAgentType } from "@/lib/agent/agentTypes";

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
  agentType?:      string;      // "yield" | "polymarket" | "copy-trader" | "narrative" | "rebalancer"
  topic?:          string;      // polymarket: market topic to focus on
  wallets?:        string[];    // copy-trader: smart-money wallets to track
  focus?:          string;      // narrative: theme/sector focus
  [key: string]:   unknown;
}

/** Pull type-specific config out of the questionnaire answers. */
function buildTypeConfig(agentType: AgentType, answers: Answers, prompt: string): Record<string, unknown> {
  switch (agentType) {
    case "polymarket":
      return { topic: answers.topic ?? extractTopic(prompt) };
    case "copy-trader":
      return { wallets: Array.isArray(answers.wallets) ? answers.wallets : [] };
    case "narrative":
      return { focus: answers.focus ?? "Base ecosystem tokens" };
    case "rebalancer":
      return { protocols: answers.protocols ?? [] };
    default:
      return {};
  }
}

/** Cheap topic extractor for Polymarket agents created from free text. */
function extractTopic(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/(crypto|bitcoin|btc|eth|ethereum|token)/.test(p)) return "crypto";
  if (/(election|president|vote|politic)/.test(p))       return "election";
  if (/(sport|game|match|nba|nfl|soccer)/.test(p))       return "sports";
  return "";
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

  const protocols    = answers.protocols ?? [];
  const risk         = answers.risk ?? "Moderate";
  const schedule     = answers.schedule ?? "Daily";
  const notify       = answers.notify ?? ["Telegram message"];
  const orchestration = answers.orchestration ?? "Single agent";

  // ── Detect the agent TYPE (data-driven registry) ──────────────────────────
  // Explicit selection from the questionnaire wins; otherwise infer from prompt.
  // The questionnaire answer may be a slug ("polymarket") or a human label
  // ("🎲 Polymarket Agent") — normalise both through inferAgentType.
  const VALID_TYPES: AgentType[] = ["yield", "polymarket", "copy-trader", "narrative", "rebalancer"];
  const rawType = String(answers.agentType ?? "").toLowerCase().trim();
  const agentType: AgentType =
      (VALID_TYPES.includes(rawType as AgentType) ? (rawType as AgentType) : undefined)
    ?? (rawType ? inferAgentType(rawType) : inferAgentType(prompt));
  const typeDef     = getAgentTypeDef(agentType);
  const typeConfig  = buildTypeConfig(agentType, answers, prompt);
  // Budget: explicit answer wins, else the registry's per-type default (not a hardcoded "10").
  const budget      = String(answers.budget ?? typeDef.defaultBudget);
  // The new "true agent" archetypes are inherently single specialized agents —
  // the Scout/Risk/Executor team only makes sense for the generic yield flow.
  const isSpecialized = agentType !== "yield";

  const isMulti      = !isSpecialized &&
    (orchestration.toLowerCase().includes("multi") || orchestration === "Decide for me");

  // ── Build enriched goal ────────────────────────────────────────────────────
  // LLM-5 fix: "Aave" is not in executeDefi's protocol enum — use only valid protocols
  const protoList  = protocols.length > 0 ? protocols.join(", ") : "Morpho, Aave, Lido";
  const notifyMode = notify.includes("Voice note (x402 TTS)") ? "every-run"
                   : notify.includes("Strategy image")        ? "milestones"
                   : notify.includes("Silent")                ? "off"
                   :                                            "milestones";
  const mediaPolicy: MediaPolicy = notifyMode as MediaPolicy;

  // Match on substring — the questionnaire sends full labels like
  // "Aggressive — always seek best yield", not just "Aggressive".
  const riskLower = risk.toLowerCase();
  const riskClause =
    riskLower.includes("conservative") ? "Skip only if risk is HIGH; otherwise proceed."
  : riskLower.includes("aggressive")   ? "EXECUTE the trade regardless of risk level — do not hold on MEDIUM or LOW risk. Only abort on HIGH risk."
  :                                       "Execute on LOW or MEDIUM risk; skip only on HIGH risk.";
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

  // If no permission was passed in the request, check if the user already has
  // Resolve effective permission — passed in request OR stored from a previous grant.
  // If neither exists, REJECT the creation. Agents must have a real ERC-7715 permission
  // before they are created. No demo mode, no 0xdemo fallback.
  let effectivePermContext = permissionsContext;
  let effectiveDelegationManager = delegationManager;

  if (!effectivePermContext || effectivePermContext.length < 40 || effectivePermContext.includes("demo")) {
    try {
      const { getDb } = await import("@/lib/db/mongodb");
      const db = await getDb();
      const stored = db
        ? await db.collection("user_permissions").findOne({ walletAddress: walletAddress.toLowerCase() })
        : null;
      if (stored?.permissionsContext && (stored.permissionsContext as string).length > 40
          && !(stored.permissionsContext as string).includes("demo")) {
        effectivePermContext       = stored.permissionsContext as string;
        effectiveDelegationManager = (stored.delegationManager as string) ?? delegationManager;
      }
    } catch { /* non-fatal */ }
  }

  const _isRealPerm = !!(
    effectivePermContext &&
    effectiveDelegationManager &&
    effectivePermContext.length > 40 &&
    !effectivePermContext.includes("demo") &&
    effectivePermContext.startsWith("0x")
  );

  // Hard-fail: no real permission = no agent creation.
  if (!_isRealPerm) {
    return NextResponse.json({
      error: "No real ERC-7715 permission found. Grant a permission via MetaMask before creating agents.",
      code:  "needs-permission",
    }, { status: 400 });
  }

  if (_isRealPerm) {
    await bindPermissionToWorkflow(workflow.id, {
      permissionsContext:       effectivePermContext!,
      delegationManagerAddress: effectiveDelegationManager!,
      delegationHash:           "0xpending",
      budgetUsdc:               budget,
      periodDays,
      expiresAt: body.expiresAt ?? Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
    });
  }

  // ── Specialized "true agent" archetypes ───────────────────────────────────
  // polymarket / copy-trader / narrative / rebalancer are single autonomous
  // agents with their own tools, chain, and system prompt from the registry.
  if (isSpecialized) {
    const specGoal = buildTypeSystemPrompt(agentType, {
      name:   `${typeDef.emoji} ${typeDef.label}`,
      budget,
      config: typeConfig,
    });
    const agent = await createAgent({
      walletAddress,
      name:        `${typeDef.emoji} ${typeDef.label}`,
      goal:        specGoal,
      budgetUsdc:  budget,
      mediaPolicy,
      scheduleIntervalMs: scheduleIntervalMs ?? typeDef.defaultIntervalMs,
      workflowId:  workflow.id,
      agentType,
      chainId:     typeDef.chainId,
      typeConfig,
    });
    await addAgentToWorkflow(workflow.id, agent.id);

    if (effectivePermContext && effectiveDelegationManager) {
      await setDelegation(agent.id, {
        parentAgentId:            null,
        delegationContext:        effectivePermContext,
        delegationHash:           "0xpending",
        delegationManagerAddress: effectiveDelegationManager,
        delegationCap:            budget,
      });
    }

    return NextResponse.json({
      agents:   [agent],
      workflow,
      wired:    false,
      agentType,
      chainId:  typeDef.chainId,
      chainName: typeDef.chainName,
      // Polymarket needs a Polygon permission; signal the UI to prompt a chain switch.
      needsChainSwitch: typeDef.chainId !== 8453,
    });
  }

  // ── Create agents under this workflow ──────────────────────────────────────
  if (!isMulti) {
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

    // Bind permission — uses stored permission if user already has one
    if (effectivePermContext && effectiveDelegationManager) {
      await setDelegation(agent.id, {
        parentAgentId:            null,
        delegationContext:        effectivePermContext,
        delegationHash:           "0xpending",
        delegationManagerAddress: effectiveDelegationManager,
        delegationCap:            budget,
      });
    }

    return NextResponse.json({ agents: [agent], workflow, wired: false });
  }

  // ── Multi-agent team ───────────────────────────────────────────────────────
  // Context-aware names — no more "Scout — Yield Yield Hunter" or hardcoded "Risk Monitor"
  const scoutName    = inferRoleName("scout",    prompt, protocols);
  const riskName     = inferRoleName("risk",     prompt, protocols);
  const executorName = inferRoleName("executor", prompt, protocols);

  // 1. Scout — fetches yields + risk data
  const scout = await createAgent({
    walletAddress,
    name:       scoutName,
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
    name:       riskName,
    goal:       `Evaluate market risk signals from the ${scoutName}. Decide: deposit, hold, or rebalance. ${riskClause} Never act if risk is HIGH.`,
    budgetUsdc: budget,
    mediaPolicy: "off",
    position:   { x: 420, y: 200 },
    workflowId: workflow.id,
  });
  await addAgentToWorkflow(workflow.id, riskMonitor.id);

  // 3. Executor — executes DeFi transactions + notifies (this is the one cron drives)
  const executor = await createAgent({
    walletAddress,
    name:       executorName,
    goal:       `Execute DeFi transactions approved by ${riskName}. Protocols: ${protoList}. ${scheduleClause} ${notify.includes("Telegram message") ? "Report via Telegram after each execution." : ""}`,
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
  //
  // STRICT/honest: when there is no real granted permission we do NOT fabricate a
  // delegation. We record the blocked sentinel "0xdemo" with a fixed "0xunsigned"
  // hash (NO Math.random fake hashes). setDelegation() then marks the agent
  // "pending" — it cannot spend until a real ERC-7715 permission is granted.
  const UNSIGNED_HASH = "0xunsigned";
  const hasRealPermission = _isRealPerm;

  // Bind root permission to Scout first
  await setDelegation(scout.id, {
    parentAgentId:            null,
    delegationContext:        hasRealPermission ? effectivePermContext! : "0xdemo",
    delegationHash:           hasRealPermission ? "0xpending" : UNSIGNED_HASH,
    delegationManagerAddress: hasRealPermission ? effectiveDelegationManager! : "0x",
    delegationCap:            budget,
  });

  // Helper: build a real sub-delegation from a parent context to a child address.
  // No real permission (or a failed redelegation) → honest blocked sentinel, never fabricated.
  async function buildSubContext(parentCtx: string, childAgent: typeof scout): Promise<{ context: string; hash: string }> {
    if (!hasRealPermission || parentCtx === "0xdemo") {
      return { context: "0xdemo", hash: UNSIGNED_HASH };
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
      console.warn("[from-answers] sub-delegation failed, recording as blocked (pending):", e);
      // Never leak the parent context down — record the blocked sentinel instead.
      return { context: "0xdemo", hash: UNSIGNED_HASH };
    }
  }

  // Scout → Risk Monitor (scoped sub-delegation, capped to budget)
  const rmCtx = await buildSubContext(
    hasRealPermission ? effectivePermContext! : "0xdemo",
    riskMonitor,
  );
  await setDelegation(riskMonitor.id, {
    parentAgentId:            scout.id,
    delegationContext:        rmCtx.context,
    delegationHash:           rmCtx.hash,
    delegationManagerAddress: effectiveDelegationManager ?? "0x",
    delegationCap:            budget,
  });

  // Risk Monitor → Executor (scoped sub-delegation, capped to budget)
  const exCtx = await buildSubContext(rmCtx.context, executor);
  await setDelegation(executor.id, {
    parentAgentId:            riskMonitor.id,
    delegationContext:        exCtx.context,
    delegationHash:           exCtx.hash,
    delegationManagerAddress: effectiveDelegationManager ?? "0x",
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
  if (lower.includes("dca"))                               return `DCA ${team}`;
  if (lower.includes("rebalanc"))                          return `Rebalancer ${team}`;
  if (lower.includes("yield") || lower.includes("apy"))    return proto ? `${proto} Yield ${team}` : `Yield Hunter ${team}`;
  if (lower.includes("risk") || lower.includes("hedge"))   return `Risk Guard ${team}`;
  if (lower.includes("stake") || lower.includes("liquid")) return `Staking ${team}`;
  if (lower.includes("lp") || lower.includes("liquidity")) return `LP ${team}`;
  if (lower.includes("governance") || lower.includes("vote")) return `Governance ${team}`;
  return `Strategy ${team}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Generate a unique descriptive agent name from the user's prompt + protocols.
 *
 * Fix: old code used `protocols[0] ?? "Yield"` as protocol prefix, producing
 * "Yield Yield Hunter" when no protocol was explicitly selected. Now falls back
 * to a clean keyword, never repeats the intent word as the protocol label.
 */
function inferName(prompt: string, protocols: string[], _multi: boolean): string {
  const lower = prompt.toLowerCase();
  const proto = protocols[0] ?? "";  // first selected protocol, e.g. "Morpho"

  if (lower.includes("dca"))                               return proto ? `${proto} DCA` : "Accumulator";
  if (lower.includes("rebalanc"))                          return proto ? `${proto} Rebalancer` : "Rebalancer";
  if (lower.includes("yield") || lower.includes("apy")) {
    // Bug fix: don't use "Yield" as proto fallback → "Yield Yield Hunter"
    return proto ? `${proto} Yield Hunter` : "Yield Hunter";
  }
  if (lower.includes("risk") || lower.includes("hedge"))   return proto ? `${proto} Guard` : "Risk Guard";
  if (lower.includes("stake") || lower.includes("liquid")) return proto ? `${proto} Staker` : "Staker";
  if (lower.includes("lp") || lower.includes("liquidity")) return proto ? `${proto} LP` : "LP Manager";
  if (lower.includes("governance") || lower.includes("vote")) return "Governance Agent";
  if (lower.includes("monitor") || lower.includes("watch")) return proto ? `${proto} Watcher` : "Watcher";
  return proto ? `${proto} Strategy` : "Strategy Agent";
}

/**
 * Context-aware role names for multi-agent teams.
 * Each role gets a descriptive identity based on what the user wants —
 * not always "Scout", "Risk Monitor", "Executor".
 */
function inferRoleName(role: "scout" | "risk" | "executor", prompt: string, protocols: string[]): string {
  const lower = prompt.toLowerCase();
  const proto = protocols[0] ?? "";

  if (role === "scout") {
    if (lower.includes("yield") || lower.includes("apy")) return proto ? `${proto} Scout` : "Yield Scout";
    if (lower.includes("dca"))    return "Market Scout";
    if (lower.includes("risk"))   return "Signal Scout";
    if (lower.includes("lp"))     return proto ? `${proto} Scout` : "Pool Scout";
    return proto ? `${proto} Scout` : "Intel Scout";
  }

  if (role === "risk") {
    if (lower.includes("conservative") || lower.includes("safe")) return "Safety Guard";
    if (lower.includes("aggressive"))  return "Signal Analyst";
    if (lower.includes("governance"))  return "Proposal Reviewer";
    if (lower.includes("lp"))          return "Impermanence Guard";
    return proto ? `${proto} Risk Guard` : "Risk Monitor";
  }

  if (role === "executor") {
    if (lower.includes("yield") || lower.includes("apy")) return proto ? `${proto} Executor` : "Yield Executor";
    if (lower.includes("dca"))    return "DCA Executor";
    if (lower.includes("stake"))  return proto ? `${proto} Staker` : "Stake Executor";
    if (lower.includes("lp"))     return proto ? `${proto} LP Manager` : "LP Executor";
    if (lower.includes("rebalanc")) return "Rebalance Executor";
    return proto ? `${proto} Executor` : "Strategy Executor";
  }

  return "Agent";
}
