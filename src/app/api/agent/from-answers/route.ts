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
    case "copy-trader": {
      // 1st: explicit wallet list from questionnaire
      // 2nd: any 0x addresses the user typed directly in the prompt
      // 3rd: empty → discoverWhales tool will find them at runtime
      const fromAnswers = Array.isArray(answers.wallets) ? (answers.wallets as string[]) : [];
      const fromPrompt  = extractWallets(prompt);
      const wallets     = (fromAnswers.length > 0 ? fromAnswers : fromPrompt)
        .filter((w: string) => /^0x[a-fA-F0-9]{40}$/.test(w));
      return { wallets };
    }
    case "narrative":
      return { focus: answers.focus ?? "Base ecosystem tokens" };
    case "rebalancer":
      return { protocols: answers.protocols ?? [] };
    default:
      return {};
  }
}

/** Pull EVM wallet addresses out of free text (for copy-trader scouts). */
function extractWallets(prompt: string): string[] {
  const matches = prompt.match(/0x[a-fA-F0-9]{40}/g) ?? [];
  return [...new Set(matches.map(a => a.toLowerCase()))];
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
  // Team-capable archetypes can fan out into a Scout-swarm → Analyzer → Risk →
  // Executor team. "yield" and "rebalancer" both manage capital across multiple
  // protocols, so the per-protocol scout fan-out makes sense for both.
  // polymarket / copy-trader / narrative remain inherently single agents.
  // copy-trader, polymarket, narrative are single-agent by design — their
  // system prompts and tool sets are self-contained, not Scout/Risk/Executor.
  const TEAM_CAPABLE: AgentType[] = ["yield", "rebalancer"];
  const wantsMulti =
    orchestration.toLowerCase().includes("multi") || orchestration === "Decide for me";
  const isMulti      = wantsMulti && TEAM_CAPABLE.includes(agentType);

  // A type is treated as a single specialized agent when it's NOT "yield" and
  // it is NOT going multi (e.g. rebalancer-single, or any polymarket/narrative/copy).
  const isSpecialized = agentType !== "yield" && !isMulti;

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

  // Map schedule string → cron interval ms (used by /api/agent/cron).
  // "Every minute" / "Every 5 minutes" are demo-speed intervals so on-chain
  // results show up quickly without waiting an hour.
  const scheduleIntervalMs: number | undefined =
      schedule === "Every minute"    ? 60 * 1000
    : schedule === "Every 5 minutes" ? 5   * 60 * 1000
    : schedule === "Every hour"      ? 60  * 60 * 1000
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
    : schedule === "Weekly"          ? 7
    : schedule === "Every minute"    ? 1
    : schedule === "Every 5 minutes" ? 1
    : schedule === "Every hour"      ? 1
    : schedule === "Every 6 hours"   ? 1
    :                                  30;  // daily / default

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

  // ── Multi-agent team — generalized scout fan-out ───────────────────────────
  // Topology:   [Scout × N]  →  Convergence Analyzer  →  Risk Monitor  →  Executor
  //
  // The "scout dimension" varies by agent type:
  //   • yield / rebalancer → one scout per PROTOCOL (Morpho, Aave, …)
  //   • copy-trader        → one scout per WHALE WALLET (each tracks one address)
  // The Analyzer aggregates scout findings and decides; the Risk Monitor gates;
  // the Executor performs the on-chain action and reports. The Analyzer holds the
  // root permission; scouts are read-only (no spend); spending flows
  // Analyzer → Risk → Executor via scoped 1Shot sub-delegations.

  type ScoutUnit = {
    name:  string;          // node title, e.g. "Morpho Scout" / "Whale 0x1234 Scout"
    goal:  string;          // scout system goal
    badge: string;          // short label for logs / chain summary
  };

  // Build the scout units + role goals for this agent type.
  let scoutUnits: ScoutUnit[];
  let scoutAgentType: AgentType;
  let analyzerName: string;
  let analyzerGoal: string;
  let riskName: string;
  let riskGoal: string;
  let executorName: string;
  let executorGoal: string;

  if (agentType === "copy-trader") {
    // Two modes, auto-selected:
    //   • MANUAL    — user supplied wallet addresses → one scout per wallet.
    //   • DISCOVERY — no addresses → a single Whale Discovery Scout that finds
    //                 the top smart-money wallets on Base at runtime.
    const fromAnswers = Array.isArray(answers.wallets) ? (answers.wallets as string[]) : [];
    const wallets = (fromAnswers.length > 0 ? fromAnswers : extractWallets(prompt))
      .filter(w => /^0x[a-fA-F0-9]{40}$/.test(w));
    const shortW = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

    if (wallets.length > 0) {
      // MANUAL mode — one scout per tracked wallet.
      scoutUnits = wallets.map(w => ({
        name:  `Whale ${shortW(w)} Scout`,
        badge: shortW(w),
        goal:
          `Track smart-money wallet ${w} on Base. Call checkWhaleTrades scoped to ${w}. ` +
          `Report every buy/sell (token, side, size, timestamp) to shared team memory so the ` +
          `Convergence Detector can spot when multiple whales agree. Read-only — never trade.`,
      }));
    } else {
      // DISCOVERY mode — one scout that finds the wallets itself.
      scoutUnits = [{
        name:  "Whale Discovery Scout",
        badge: "discover",
        goal:
          `Autonomously discover the most active smart-money wallets on Base. Call discoverWhales ` +
          `to find the top traders plus their recent trades and convergence. Report the ranked ` +
          `wallets and any converged tokens to shared team memory so the Convergence Detector can ` +
          `pick the strongest signal. Read-only — never trade.`,
      }];
    }
    scoutAgentType = "copy-trader";
    analyzerName = "Convergence Detector";
    analyzerGoal =
      `You are the convergence detector for a copy-trading desk` +
      (wallets.length > 0 ? ` tracking ${wallets.length} whale wallets. ` : ` over autonomously discovered whales. `) +
      `Read the scout findings from shared team memory. Identify tokens that MULTIPLE ` +
      `whales (2 or more) bought within the same short window — that convergence is the signal. ` +
      `Output the converged token, how many whales agree, and the net direction. ${riskClause}`;
    riskName = "Risk Monitor";
    riskGoal =
      `Review the Convergence Detector's signal. Approve a copy-trade ONLY if the token has healthy ` +
      `liquidity and is not a honeypot/scam, and the convergence is genuine (2+ independent whales). ${riskClause} ` +
      `If approved, hand the trade to the Executor; otherwise hold and report why.`;
    executorName = "Copy-Trade Executor";
    executorGoal =
      `${prompt.trim()} ` +
      `Mirror the trade approved by the Risk Monitor using checkRisk then executeCopyTrade. ${scheduleClause} ` +
      (notify.includes("Telegram message") ? "Report every copied trade via Telegram." : "");
  } else {
    // yield / rebalancer → one scout per protocol.
    const scoutProtocols = protocols.length > 0 ? protocols : ["Morpho", "Aave", "Lido"];
    scoutUnits = scoutProtocols.map(proto => ({
      name:  `${proto} Scout`,
      badge: proto,
      goal:
        `Research live yield + risk for ${proto} on Base. Call checkYields and checkRisk scoped to ${proto}. ` +
        `Report APY, TVL, and risk level to shared team memory so the Convergence Analyzer can rank it. Read-only — never deposit.`,
    }));
    scoutAgentType = "yield";
    analyzerName = "Convergence Analyzer";
    analyzerGoal =
      `You are the convergence analyzer for a ${scoutProtocols.length}-protocol portfolio. ` +
      `Collect the latest findings from every protocol scout (${scoutProtocols.join(", ")}) via shared team memory. ` +
      `Rank protocols by risk-adjusted yield (APY weighted by risk + TVL). ` +
      `Select the BEST and SECOND-BEST protocol and pass the ranking to the Risk Monitor. ${riskClause}`;
    riskName = "Risk Monitor";
    riskGoal =
      `Review the Convergence Analyzer's best/second-best ranking. Approve the allocation ONLY if the selected protocols are within the user's risk tolerance. ${riskClause} ` +
      `If approved, hand the allocation to the Executor; otherwise hold and report why.`;
    executorName = inferRoleName("executor", prompt, protocols);
    executorGoal =
      `${prompt.trim()} ` +
      `Execute the allocation approved by the Risk Monitor across: ${protoList}. ${scheduleClause} ` +
      (notify.includes("Telegram message") ? "Report every decision via Telegram." : "");
  }

  // Vertical layout for the scout column, with the decision chain centered.
  const SCOUT_X   = 60;
  const SCOUT_Y0  = 40;
  const SCOUT_DY  = 150;
  const centerY   = SCOUT_Y0 + ((scoutUnits.length - 1) * SCOUT_DY) / 2;

  const UNSIGNED_HASH = "0xunsigned";
  const hasRealPermission = _isRealPerm;

  // 1. Convergence Analyzer/Detector — delegation root + aggregator.
  const analyzer = await createAgent({
    walletAddress,
    name:        analyzerName,
    goal:        analyzerGoal,
    budgetUsdc:  budget,
    mediaPolicy: "off",
    position:    { x: 420, y: centerY },
    workflowId:  workflow.id,
    agentType,
  });
  await addAgentToWorkflow(workflow.id, analyzer.id);

  // Bind root permission to the Analyzer.
  await setDelegation(analyzer.id, {
    parentAgentId:            null,
    delegationContext:        hasRealPermission ? effectivePermContext! : "0xdemo",
    delegationHash:           hasRealPermission ? "0xpending" : UNSIGNED_HASH,
    delegationManagerAddress: hasRealPermission ? effectiveDelegationManager! : "0x",
    delegationCap:            budget,
  });

  // 2. Scouts — one per unit, research-only (no spend), children of Analyzer.
  const scouts: Awaited<ReturnType<typeof createAgent>>[] = [];
  for (let i = 0; i < scoutUnits.length; i++) {
    const unit = scoutUnits[i];
    const scout = await createAgent({
      walletAddress,
      name:        unit.name,
      goal:        unit.goal,
      budgetUsdc:  "0",
      mediaPolicy: "off",
      position:    { x: SCOUT_X, y: SCOUT_Y0 + i * SCOUT_DY },
      workflowId:  workflow.id,
      agentType:   scoutAgentType,
    });
    await addAgentToWorkflow(workflow.id, scout.id);
    // Research-only: parented to the Analyzer for orchestration, but capped to 0
    // (honest non-spending sentinel — marked "pending", can never transact).
    await setDelegation(scout.id, {
      parentAgentId:            analyzer.id,
      delegationContext:        "0xresearch-only",
      delegationHash:           UNSIGNED_HASH,
      delegationManagerAddress: "0x",
      delegationCap:            "0",
    });
    scouts.push(scout);
  }

  // Helper: build a real scoped sub-delegation from a parent context to a child.
  async function buildSubContext(parentCtx: string, childAgent: Awaited<ReturnType<typeof createAgent>>): Promise<{ context: string; hash: string }> {
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
        hash:    "0xpending",
      };
    } catch (e) {
      console.warn("[from-answers] sub-delegation failed — falling back to parent context so the spender stays executable:", e);
      // 1Shot redelegation is unavailable (it 500s). Rather than blocking the
      // whole chain (which leaves the Executor unable to ever transact), fall
      // back to the PARENT context. The redeemer is always CLOVE's 1Shot wallet,
      // so the root ERC-7715 context is still valid for execution — we just lose
      // per-agent scope isolation until redelegation is fixed. This mirrors the
      // runtime behaviour of liveRedelegate() in the orchestrate route.
      return { context: parentCtx, hash: "0xpending" };
    }
  }

  // 3. Risk Monitor — gates the action on risk tolerance.
  const riskMonitor = await createAgent({
    walletAddress,
    name:        riskName,
    goal:        riskGoal,
    budgetUsdc:  budget,
    mediaPolicy: "off",
    position:    { x: 760, y: centerY },
    workflowId:  workflow.id,
    agentType,
  });
  await addAgentToWorkflow(workflow.id, riskMonitor.id);

  const rmCtx = await buildSubContext(
    hasRealPermission ? effectivePermContext! : "0xdemo",
    riskMonitor,
  );
  await setDelegation(riskMonitor.id, {
    parentAgentId:            analyzer.id,
    delegationContext:        rmCtx.context,
    delegationHash:           rmCtx.hash,
    delegationManagerAddress: effectiveDelegationManager ?? "0x",
    delegationCap:            budget,
  });

  // 4. Executor — performs the on-chain action + reports (cron drives this one).
  const executor = await createAgent({
    walletAddress,
    name:        executorName,
    goal:        executorGoal,
    budgetUsdc:  budget,
    scheduleIntervalMs,  // only the Executor runs on schedule; the rest are invoked around it
    workflowId:  workflow.id,
    mediaPolicy,
    position:    { x: 1100, y: centerY },
    agentType,
  });
  await addAgentToWorkflow(workflow.id, executor.id);

  const exCtx = await buildSubContext(rmCtx.context, executor);
  await setDelegation(executor.id, {
    parentAgentId:            riskMonitor.id,
    delegationContext:        exCtx.context,
    delegationHash:           exCtx.hash,
    delegationManagerAddress: effectiveDelegationManager ?? "0x",
    delegationCap:            budget,
  });

  return NextResponse.json({
    agents:   [...scouts, analyzer, riskMonitor, executor],
    workflow,
    wired:    true,
    chain:    `${scouts.length} scouts → ${analyzer.name} → ${riskMonitor.name} → ${executor.name}`,
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
