import { NextRequest, NextResponse } from "next/server";
import { createAgent, setDelegation, updateAgent, type MediaPolicy, type AgentType } from "@/lib/agent/agents";
import { createWorkflow, addAgentToWorkflow, bindPermissionToWorkflow } from "@/lib/agent/workflows";
import { getAgentTypeDef, buildTypeSystemPrompt, inferAgentType, COPY_TIER_LIQUIDITY_BOUNDARY_USD } from "@/lib/agent/agentTypes";

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
  minTokenAmount?: number;      // copy-trader: only mirror buys ≥ this many tokens
  copyRatio?:      number;      // copy-trader: deploy this fraction of budget per copied trade (0..1)
  copyRules?:      { minTokenAmount?: number; copyRatio?: number };  // copy-trader: structured form answer
  [key: string]:   unknown;
}

/** Pull type-specific config out of the questionnaire answers. */
function buildTypeConfig(agentType: AgentType, answers: Answers, prompt: string): Record<string, unknown> {
  switch (agentType) {
    case "copy-trader": {
      // 1st: explicit wallet list from questionnaire
      // 2nd: any 0x addresses the user typed directly in the prompt
      // 3rd: empty → discoverWhales tool will find them at runtime
      const fromAnswers = Array.isArray(answers.wallets) ? (answers.wallets as string[]) : [];
      const fromPrompt  = extractWallets(prompt);
      const wallets     = (fromAnswers.length > 0 ? fromAnswers : fromPrompt)
        .filter((w: string) => /^0x[a-fA-F0-9]{40}$/.test(w));
      // Copy RULES — "only buys ≥ 1000 tokens, at 1% of my budget". Read straight
      // from the prompt so the user can just TYPE the conditions; checkWhaleTrades
      // filters on minTokenAmount and executeCopyTrade sizes by copyRatio × budget.
      const copyRules = parseCopyRules(prompt, answers);
      return Object.keys(copyRules).length > 0 ? { wallets, copyRules } : { wallets };
    }
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

/**
 * Parse copy-trade RULES from the prompt (+ explicit questionnaire answers):
 *   minTokenAmount — only mirror buys of at least N tokens (size filter)
 *   copyRatio      — fraction of budget to deploy per copied trade (0..1)
 *
 * Lets the user type "copy 0xfriend, only buys ≥ 1000 tokens, at 1% of my budget"
 * and have it populate typeConfig.copyRules. Explicit form answers always win.
 */
function parseCopyRules(prompt: string, answers: Answers): { minTokenAmount?: number; copyRatio?: number } {
  const rules: { minTokenAmount?: number; copyRatio?: number } = {};

  // Explicit questionnaire answers take precedence over prompt parsing.
  const ansMin   = Number(answers.minTokenAmount ?? answers.copyRules?.minTokenAmount);
  const ansRatio = Number(answers.copyRatio      ?? answers.copyRules?.copyRatio);
  if (Number.isFinite(ansMin)   && ansMin   > 0) rules.minTokenAmount = ansMin;
  if (Number.isFinite(ansRatio) && ansRatio > 0) rules.copyRatio = ansRatio > 1 ? ansRatio / 100 : ansRatio;

  const p = prompt.toLowerCase();

  // minTokenAmount — "≥ 1000 tokens", ">= 1000", "at least 1000", "min 1000",
  // "1000+ tokens", "only buys 1000 tokens". Requires a token/coin/unit noun (or a
  // strong "at least / ≥ / min" anchor) so it never swallows the USDC budget.
  if (rules.minTokenAmount === undefined) {
    const m =
      p.match(/(?:≥|>=|>|at\s*least|atleast|min(?:imum)?|over|above|more\s*than|larger\s*than|bigger\s*than)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:tokens?|coins?|units?)?/)
      ?? p.match(/([\d,]+(?:\.\d+)?)\s*\+?\s*(?:tokens?|coins?|units?)\b/);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) rules.minTokenAmount = n;
    }
  }

  // copyRatio — "1% of my budget", "at 1%", "5% per trade", "0.5%"; or "ratio 0.01".
  // A percentage in a copy-trade prompt means "this share of budget per trade".
  if (rules.copyRatio === undefined) {
    const pct   = p.match(/(\d+(?:\.\d+)?)\s*%/);
    const ratio = p.match(/(?:ratio|fraction)\D{0,12}(0?\.\d+)/);
    if (pct) {
      const n = Number(pct[1]);
      if (Number.isFinite(n) && n > 0 && n <= 100) rules.copyRatio = n / 100;
    } else if (ratio) {
      const n = Number(ratio[1]);
      if (Number.isFinite(n) && n > 0 && n <= 1) rules.copyRatio = n;
    }
  }

  return rules;
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
  const VALID_TYPES: AgentType[] = ["yield", "copy-trader", "rebalancer"];
  const rawType = String(answers.agentType ?? "").toLowerCase().trim();
  const agentType: AgentType =
      (VALID_TYPES.includes(rawType as AgentType) ? (rawType as AgentType) : undefined)
    ?? (rawType ? inferAgentType(rawType) : inferAgentType(prompt));
  const typeDef     = getAgentTypeDef(agentType);
  const typeConfig  = buildTypeConfig(agentType, answers, prompt);
  // Budget: explicit answer wins, else the registry's per-type default (not a hardcoded "10").
  const budget      = String(answers.budget ?? typeDef.defaultBudget);
  // Team-capable archetypes can fan out into a Scout-swarm → Analyzer/Detector →
  // Risk → Executor team:
  //   • yield / rebalancer → one scout per PROTOCOL
  //   • copy-trader        → Whale Discovery/Wallet scouts → Convergence Detector
  // The copy-trade team uses copy-trade-specific roles + tools (not the generic
  // yield Scout/Risk/Executor), so the fan-out fits. polymarket / narrative stay
  // single-agent (their flows don't map to a scout swarm).
  const TEAM_CAPABLE: AgentType[] = ["yield", "rebalancer", "copy-trader"];
  const wantsMulti =
    orchestration.toLowerCase().includes("multi") || orchestration === "Decide for me";
  const isMulti      = wantsMulti && TEAM_CAPABLE.includes(agentType);

  // A type is treated as a single specialized agent when it's NOT "yield" and
  // it is NOT going multi (e.g. rebalancer-single, or any polymarket/narrative/copy).
  const isSpecialized = agentType !== "yield" && !isMulti;

  // ── Build enriched goal ────────────────────────────────────────────────────
  // LLM-5 fix: "Aave" is not in executeDefi's protocol enum — use only valid protocols
  const protoList  = protocols.length > 0 ? protocols.join(", ") : "Morpho, Aave, Lido";
  const notifyMode = notify.includes("Voice note") ? "every-run"
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
  let effectiveGrantedTo: string | undefined;

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
        effectiveGrantedTo         = stored.grantedTo as string | undefined;
      }
    } catch { /* non-fatal */ }
  }

  // Is the active grant a FUND MANAGER grant (user → CLOVE session account)?
  // If so, we can redelegate REAL on-chain-capped scoped slices to each worker
  // (user → session → worker → relayer). Otherwise the grant went straight to
  // the relayer (working single-hop flow) and we keep the existing behaviour.
  let isFundManagerGrant = false;
  try {
    if (effectiveGrantedTo) {
      const { getSessionEoaAddress } = await import("@/lib/web3/serverSession");
      isFundManagerGrant = effectiveGrantedTo.toLowerCase() === getSessionEoaAddress().toLowerCase();
    }
  } catch { /* non-fatal — default to legacy behaviour */ }

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

  // ── COPY DESK — lean 3-agent topology (Fund Manager + 2 risk-tiered copiers) ──
  // Copy-trading needs no scout→analyzer→risk fan-out: the converged signal and
  // the tier liquidity filter both live inside each copier's own run loop. So a
  // copy team is exactly: Fund Manager (holds the grant, splits 70/30) →
  // Conservative Copier (deep-liquidity blue chips) + Aggressive Copier (small
  // caps), each with a real on-chain ERC20TransferAmountEnforcer cap AND a root
  // fallback so a relayer that rejects the multi-hop chain never kills execution.
  if (isMulti && agentType === "copy-trader") {
    const baseCfg   = buildTypeConfig("copy-trader", answers, prompt);
    const budgetNum = Number(budget);
    const consCap   = Number((budgetNum * 0.7).toFixed(4));
    const aggrCap   = Number((budgetNum - consCap).toFixed(4));
    const tierLiqM  = COPY_TIER_LIQUIDITY_BOUNDARY_USD / 1e6;

    // Fund Manager — team root, holds the user's grant.
    const fundManager = await createAgent({
      walletAddress,
      name: "Fund Manager",
      goal:
        `You are the Fund Manager of a copy-trading desk. You hold the user's capped ERC-7715 budget ` +
        `(${budget} USDC) and split it 70/30 into two on-chain-enforced sub-budgets: a Conservative Copier ` +
        `(deep-liquidity blue chips) and an Aggressive Copier (smaller caps). Each copier can only spend ` +
        `within the cap you grant it — overspend reverts on-chain.`,
      budgetUsdc: budget, mediaPolicy: "off",
      position: { x: 60, y: 140 }, workflowId: workflow.id,
      agentType, typeConfig: { role: "fund-manager" },
    });
    await addAgentToWorkflow(workflow.id, fundManager.id);
    await setDelegation(fundManager.id, {
      parentAgentId: null,
      delegationContext:        effectivePermContext!,
      delegationHash:           "0xpending",
      delegationManagerAddress: effectiveDelegationManager!,
      delegationCap:            budget,
    });

    // Scoped, on-chain-capped chain for a copier — falls back to the root grant
    // (so it stays executable) when the grant isn't a redelegatable FM grant or
    // chain assembly fails.
    const tierProtocols = ["uniswap", "aerodrome"];
    const copierContext = async (childId: string, cap: number): Promise<{ context: string; hash: string }> => {
      if (isFundManagerGrant) {
        try {
          const { buildRedeemableWorkerChain } = await import("@/lib/web3/subDelegation");
          const chain = await buildRedeemableWorkerChain(effectivePermContext!, childId, tierProtocols, cap, typeDef.chainId);
          return { context: chain.context, hash: chain.scopedHash };
        } catch (e) {
          console.warn("[from-answers] copier chain build failed — root fallback:", e instanceof Error ? e.message : e);
        }
      }
      return { context: effectivePermContext!, hash: "0xpending" };
    };

    const tierDefs = [
      {
        name: "Conservative Copier", cap: consCap,
        cfg:  { ...baseCfg, copyTier: "conservative", minLiquidityUsd: COPY_TIER_LIQUIDITY_BOUNDARY_USD },
        goal: `${prompt.trim()} You are the CONSERVATIVE side of the copy desk: mirror converged smart-money buys ONLY ` +
              `into deep-liquidity blue chips (pool liquidity ≥ $${tierLiqM}M — cbBTC/WETH class). On-chain cap ${consCap} ` +
              `USDC; overspend reverts. ${scheduleClause} ${notify.includes("Telegram message") ? "Report via Telegram." : ""}`,
      },
      {
        name: "Aggressive Copier", cap: aggrCap,
        cfg:  { ...baseCfg, copyTier: "aggressive", maxLiquidityUsd: COPY_TIER_LIQUIDITY_BOUNDARY_USD },
        goal: `${prompt.trim()} You are the AGGRESSIVE side of the copy desk: mirror converged smart-money buys into ` +
              `smaller/mid-cap tokens (pool liquidity under $${tierLiqM}M) — bigger upside, bigger risk. On-chain cap ${aggrCap} ` +
              `USDC; overspend reverts. ${scheduleClause} ${notify.includes("Telegram message") ? "Report via Telegram." : ""}`,
      },
    ];

    const copiers: Awaited<ReturnType<typeof createAgent>>[] = [];
    for (let i = 0; i < tierDefs.length; i++) {
      const t = tierDefs[i];
      const copier = await createAgent({
        walletAddress, name: t.name, goal: t.goal,
        budgetUsdc: String(t.cap),
        scheduleIntervalMs,            // both tiers run on the schedule (cron runs them serially)
        mediaPolicy: i === 0 ? mediaPolicy : "off",
        position: { x: 460, y: 40 + i * 200 },
        workflowId: workflow.id, agentType,
        typeConfig: t.cfg,
      });
      await addAgentToWorkflow(workflow.id, copier.id);
      const ctx = await copierContext(copier.id, t.cap);
      await setDelegation(copier.id, {
        parentAgentId:            fundManager.id,
        delegationContext:        ctx.context,
        delegationHash:           ctx.hash,
        delegationManagerAddress: effectiveDelegationManager!,
        delegationCap:            String(t.cap),
      });
      // Root-grant fallback for redemption-time relayer rejection of the scoped chain.
      if (ctx.context !== effectivePermContext) {
        await updateAgent(copier.id, { rootFallbackContext: effectivePermContext });
      }
      copiers.push(copier);
    }

    return NextResponse.json({
      agents: [fundManager, ...copiers],
      workflow, wired: true,
      chain: "Fund Manager → Conservative Copier (70%) + Aggressive Copier (30%)",
    });
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
  // Protocols a SPENDING worker may touch — used to scope its on-chain
  // AllowedTargetsEnforcer caveat when redelegating from the Fund Manager.
  let workerProtocols: string[] = ["morpho", "aave"];

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
    workerProtocols = ["uniswap", "aerodrome"]; // copy-trade mirrors via DEX swaps
  } else {
    // yield / rebalancer → one scout per protocol.
    const scoutProtocols = protocols.length > 0 ? protocols : ["Morpho", "Aave", "Lido"];
    // Scope the spending worker to the team's protocols (lowercased registry keys).
    workerProtocols = scoutProtocols.map(p => p.toLowerCase());
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

  // Layout: Fund Manager (root) → scout column → Analyzer → Risk → Executor.
  const FM_X      = 40;
  const SCOUT_X   = 360;
  const SCOUT_Y0  = 40;
  const SCOUT_DY  = 150;
  const centerY   = SCOUT_Y0 + ((scoutUnits.length - 1) * SCOUT_DY) / 2;

  const UNSIGNED_HASH = "0xunsigned";
  const hasRealPermission = _isRealPerm;

  // 0. FUND MANAGER — the team root. Holds the user's ERC-7715 grant and
  //    redelegates scoped, on-chain-capped budgets down to each worker. This is
  //    the orchestrator node users see at the head of the team.
  const fundManager = await createAgent({
    walletAddress,
    name:        "Fund Manager",
    goal:
      `You are the Fund Manager for this strategy. You hold the user's single capped ERC-7715 budget ` +
      `(${budget} USDC) and split it into scoped, on-chain-enforced sub-budgets for each worker agent. ` +
      `Dispatch the protocol scouts, collect their findings, and route the approved allocation to the ` +
      `executor — every worker can only spend within the cap you grant it (overspend reverts on-chain).`,
    budgetUsdc:  budget,
    mediaPolicy: "off",
    position:    { x: FM_X, y: centerY },
    workflowId:  workflow.id,
    agentType,
    typeConfig:  { role: "fund-manager" },
  });
  await addAgentToWorkflow(workflow.id, fundManager.id);

  // The Fund Manager holds the ROOT grant (it is the delegator, not a delegate).
  await setDelegation(fundManager.id, {
    parentAgentId:            null,
    delegationContext:        hasRealPermission ? effectivePermContext! : "0xdemo",
    delegationHash:           hasRealPermission ? "0xpending" : UNSIGNED_HASH,
    delegationManagerAddress: hasRealPermission ? effectiveDelegationManager! : "0x",
    delegationCap:            budget,
  });

  // 1. Convergence Analyzer/Detector — aggregator, child of the Fund Manager.
  const analyzer = await createAgent({
    walletAddress,
    name:        analyzerName,
    goal:        analyzerGoal,
    budgetUsdc:  budget,
    mediaPolicy: "off",
    position:    { x: 680, y: centerY },
    workflowId:  workflow.id,
    agentType,
  });
  await addAgentToWorkflow(workflow.id, analyzer.id);

  // Analyzer is a decision agent under the Fund Manager.
  await setDelegation(analyzer.id, {
    parentAgentId:            fundManager.id,
    delegationContext:        hasRealPermission ? effectivePermContext! : "0xdemo",
    delegationHash:           hasRealPermission ? "0xpending" : UNSIGNED_HASH,
    delegationManagerAddress: hasRealPermission ? effectiveDelegationManager! : "0x",
    delegationCap:            budget,
  });

  // 2. Scouts — one per unit, research-only (no spend), children of Fund Manager.
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
    // Research-only: dispatched by the Fund Manager, but capped to 0
    // (honest non-spending sentinel — marked "pending", can never transact).
    await setDelegation(scout.id, {
      parentAgentId:            fundManager.id,
      delegationContext:        "0xresearch-only",
      delegationHash:           UNSIGNED_HASH,
      delegationManagerAddress: "0x",
      delegationCap:            "0",
    });
    scouts.push(scout);
  }

  // Helper: build a scoped sub-delegation for a SPENDING worker.
  //
  // FUND MANAGER grant (user → session): build the REAL on-chain-capped chain
  //   user → session → worker → relayer via buildRedeemableWorkerChain. The
  //   worker's ERC20TransferAmountEnforcer reverts any overspend. This is the
  //   real A2A path.
  //
  // RELAYER grant (legacy single-hop) OR any failure: fall back to the parent
  //   context so the spender stays executable (working flow preserved).
  async function buildSubContext(
    parentCtx: string,
    childAgent: Awaited<ReturnType<typeof createAgent>>,
    opts?: { protocols?: string[]; capUsdc?: number },
  ): Promise<{ context: string; hash: string }> {
    if (!hasRealPermission || parentCtx === "0xdemo") {
      return { context: "0xdemo", hash: UNSIGNED_HASH };
    }

    if (isFundManagerGrant) {
      try {
        const { buildRedeemableWorkerChain } = await import("@/lib/web3/subDelegation");
        const chain = await buildRedeemableWorkerChain(
          effectivePermContext!,      // the FM grant is always the chain ROOT
          childAgent.id,
          opts?.protocols ?? workerProtocols,
          opts?.capUsdc ?? Number(budget),
          typeDef.chainId,
        );
        console.log(`[from-answers] scoped worker chain for ${childAgent.name}: cap ${opts?.capUsdc ?? budget} USDC, targets ${chain.allowedTargets.length}`);
        return { context: chain.context, hash: chain.scopedHash };
      } catch (e) {
        console.warn("[from-answers] buildRedeemableWorkerChain failed — falling back to root context:", e);
        return { context: effectivePermContext!, hash: "0xpending" };
      }
    }

    // Legacy relayer grant — keep the proven single-hop behaviour.
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
    position:    { x: 1000, y: centerY },
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

  // 4. Executor(s) — for yield/rebalancer with MULTIPLE protocols, create ONE
  //    executor PER PROTOCOL so the Fund Manager can split the budget across them
  //    with on-chain-enforced per-worker caps. Each starts at an equal split;
  //    POST /api/workflow/[id]/allocate-budget re-weights them via a Venice
  //    decision (AI decides the split → the caveat enforces it). Single-protocol
  //    teams keep one executor. (Copy-trader teams are handled by the lean
  //    copy-desk branch above and never reach here.)
  interface ExecUnit { name: string; goal: string; cap: number; protocols?: string[]; typeConfig?: Record<string, unknown> }
  const perProtocol = workerProtocols.length > 1;
  const budgetNum   = Number(budget);

  const execUnits: ExecUnit[] = perProtocol
    ? (() => {
        const eqCap = Number((budgetNum / workerProtocols.length).toFixed(4));
        return workerProtocols.map(proto => ({
          name: `${proto.charAt(0).toUpperCase()}${proto.slice(1)} Executor`,
          cap:  eqCap,
          protocols: [proto],
          typeConfig: { protocols: [proto] },
          goal: `${prompt.trim()} Deposit USDC into ${proto} ONLY, within your on-chain cap of ${eqCap} USDC. ${scheduleClause} ${notify.includes("Telegram message") ? "Report via Telegram." : ""}`,
        }));
      })()
    : [{ name: executorName, cap: budgetNum, goal: executorGoal }];

  const executors: Awaited<ReturnType<typeof createAgent>>[] = [];
  for (let i = 0; i < execUnits.length; i++) {
    const unit = execUnits[i];
    const ex = await createAgent({
      walletAddress,
      name:        unit.name,
      goal:        unit.goal,
      budgetUsdc:  String(unit.cap),
      scheduleIntervalMs: i === 0 ? scheduleIntervalMs : undefined,  // one drives the schedule
      workflowId:  workflow.id,
      mediaPolicy: i === 0 ? mediaPolicy : "off",
      position:    { x: 1320, y: SCOUT_Y0 + i * SCOUT_DY },
      agentType,
      typeConfig:  unit.typeConfig,
    });
    await addAgentToWorkflow(workflow.id, ex.id);
    const exCtx = await buildSubContext(
      rmCtx.context, ex,
      unit.protocols ? { protocols: unit.protocols, capUsdc: unit.cap } : undefined,
    );
    await setDelegation(ex.id, {
      parentAgentId:            riskMonitor.id,
      delegationContext:        exCtx.context,
      delegationHash:           exCtx.hash,
      delegationManagerAddress: effectiveDelegationManager ?? "0x",
      delegationCap:            String(unit.cap),
    });
    executors.push(ex);
  }

  return NextResponse.json({
    agents:   [fundManager, ...scouts, analyzer, riskMonitor, ...executors],
    workflow,
    wired:    true,
    chain:    `${fundManager.name} → ${scouts.length} scouts → ${analyzer.name} → ${riskMonitor.name} → ${executors.length} executor${executors.length > 1 ? "s" : ""}`,
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
