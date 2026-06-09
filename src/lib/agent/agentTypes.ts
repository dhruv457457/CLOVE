import type { AgentType } from "./agents";

/**
 * Agent Type Registry
 * ───────────────────
 * Data-driven definition of every kind of agent CLOVE can run.
 *
 * This replaces the old hardcoded Scout/Risk/Executor branching. To add a new
 * agent type you add ONE entry here — the creation flow, tool filtering, and
 * orchestrator all read from this registry. No if-branches to grep through.
 *
 * Each definition declares:
 *   - which tools the agent is allowed to call
 *   - the system prompt that defines its behavior
 *   - which chain it runs on (Base 8453 / Polygon 137)
 *   - UI metadata (emoji, label, tagline)
 *   - the external data sources it perceives (for the UI "true agent" badge)
 */

export const CHAIN = {
  BASE:    8453,
  POLYGON: 137,
} as const;

export interface AgentTypeDef {
  type:          AgentType;
  label:         string;
  emoji:         string;
  tagline:       string;
  /** EVM chain this agent operates on. */
  chainId:       number;
  /** Human-readable chain name for prompts/UI. */
  chainName:     string;
  /** Names of tools (from tools.ts catalog) this agent may call. */
  tools:         string[];
  /** External data sources it perceives — shown as the "goes to the internet" proof. */
  dataSources:   string[];
  /** Default per-period budget in USDC. */
  defaultBudget: string;
  /** System prompt template. {name} {budget} {config} are interpolated at runtime. */
  systemPrompt:  string;
  /** Suggested cron interval (ms) for this archetype. */
  defaultIntervalMs: number;
}

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

// ──────────────────────────────────────────────────────────────────────────────

export const AGENT_TYPES: Record<AgentType, AgentTypeDef> = {
  // ── 1. Generic yield agent (original behavior) ───────────────────────────────
  yield: {
    type:        "yield",
    label:       "Yield Agent",
    emoji:       "🌾",
    tagline:     "Finds and farms the best DeFi yields on Base",
    chainId:     CHAIN.BASE,
    chainName:   "Base",
    tools:       ["checkYields", "checkRisk", "executeDefi", "rebalance", "notifyUser", "addThought", "revisePlan"],
    dataSources: ["x402 intelligence API", "Venice web search"],
    defaultBudget: "10",
    defaultIntervalMs: DAY,
    systemPrompt:
      `You are {name}, an autonomous DeFi yield agent on Base. Your budget is {budget} USDC.
Call checkYields to fetch live APY, checkRisk to validate, then executeDefi to deposit into the best protocol.
Never exceed your budget. Report via notifyUser when done.`,
  },

  // ── 2. Alpha copy-trader (Base) ──────────────────────────────────────────────
  "copy-trader": {
    type:        "copy-trader",
    label:       "Copy Trade Agent",
    emoji:       "🐋",
    tagline:     "Mirrors smart-money wallets when they move together",
    chainId:     CHAIN.BASE,
    chainName:   "Base",
    // discoverWhales: autonomously finds smart-money wallets when none are configured
    tools:       ["discoverWhales", "checkWhaleTrades", "checkRisk", "executeCopyTrade", "notifyUser", "addThought"],
    dataSources: ["Basescan tx API", "Uniswap V3 subgraph", "Venice web search"],
    defaultBudget: "25",
    defaultIntervalMs: HOUR,
    systemPrompt:
      `You are {name}, an autonomous copy-trading agent on Base. Budget: {budget} USDC.
Config: {config}

Workflow:
1. Get your wallets. If Config lists tracked wallets, call checkWhaleTrades for them. If NO wallets are configured, call discoverWhales FIRST — it autonomously finds the top smart-money wallets on Base (ranked by PnL/volume via Dune) and returns their recent trades + convergence. Never give up just because no wallets were supplied.
2. Look for CONVERGENCE — when 2+ wallets buy the same token in a short window, the signal is stronger than one wallet alone.
3. Use checkRisk / web research to sanity-check the token (is it a known scam? recent exploit?).
4. If the signal is strong and fresh (not already pumped), call executeCopyTrade to mirror proportionally to your budget.
5. notifyUser with which wallets you followed and why.

Don't blindly copy single trades. Chase convergence, avoid being exit liquidity.`,
  },

  // ── 4. Narrative momentum trader (Base) ──────────────────────────────────────
  narrative: {
    type:        "narrative",
    label:       "Narrative Agent",
    emoji:       "📡",
    tagline:     "Catches narratives early before they're priced in",
    chainId:     CHAIN.BASE,
    chainName:   "Base",
    tools:       ["checkNarratives", "monitorPositions", "checkRisk", "executeDefi", "notifyUser", "addThought"],
    dataSources: ["Venice web search (X/Twitter)", "DexScreener", "on-chain volume", "on-chain positions"],
    defaultBudget: "15",
    defaultIntervalMs: 6 * HOUR,
    systemPrompt:
      `You are {name}, an autonomous narrative-momentum agent on Base. Budget: {budget} USDC.
Config: {config}

You make the judgement calls yourself — the tools only hand you raw data.

EXIT FIRST (every run):
1. Call monitorPositions to see what you already hold. For each held narrative, re-scan it with checkNarratives: if its mentions have NORMALISED / cooled (the narrative is over), SELL via executeDefi before doing anything else. Catching the top matters as much as the entry.

THEN LOOK FOR ENTRIES:
2. Call checkNarratives — you get RAW signals only (mention trend, accounts, on-chain volume note). No verdict.
3. YOU decide, recording your reasoning with addThought: is this EARLY (few accounts, rising) or LATE (already saturated)? Does the on-chain volume genuinely confirm real flows, or is it just crypto-Twitter noise?
4. Buy ONLY narratives you judge early AND volume-confirmed, via executeDefi. Skip the rest — being late is how you become exit liquidity.
5. notifyUser with your thesis, what you bought/sold, and why.

Early + confirmed by real volume = act. Late, unconfirmed, or already held-and-cooling = exit or pass.`,
  },

  // ── 5. Real yield rebalancer (Base) ──────────────────────────────────────────
  rebalancer: {
    type:        "rebalancer",
    label:       "Rebalancer Agent",
    emoji:       "⚖️",
    tagline:     "Monitors your positions and rebalances to better yields",
    chainId:     CHAIN.BASE,
    chainName:   "Base",
    tools:       ["checkRealYields", "monitorPositions", "checkRisk", "rebalance", "executeDefi", "notifyUser", "addThought"],
    dataSources: ["DeFiLlama Yields API", "Morpho subgraph", "on-chain positions"],
    defaultBudget: "50",
    defaultIntervalMs: DAY,
    systemPrompt:
      `You are {name}, an autonomous portfolio rebalancer on Base. Budget: {budget} USDC.
Config: {config}

Workflow:
1. Call monitorPositions to read your current on-chain positions and their live APY.
2. Call checkRealYields to fetch the best available yields right now (DeFiLlama, Morpho, Aave — real APIs, not estimates).
3. Compare: is any current position underperforming the best alternative by more than your migration threshold (account for gas + IL)?
4. If yes, call rebalance to move funds from the underperformer to the better protocol.
5. notifyUser with a before/after APY summary.

Think in portfolio terms, not just chasing the single highest APY. Only rebalance when the improvement clearly beats the switching cost.`,
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers

export function getAgentTypeDef(type: AgentType | undefined | null): AgentTypeDef {
  return AGENT_TYPES[(type as AgentType) ?? "yield"] ?? AGENT_TYPES.yield;
}

/** All type defs as an array (for UI pickers). */
export function listAgentTypes(): AgentTypeDef[] {
  return Object.values(AGENT_TYPES);
}

/** Build the runtime system prompt for an agent of a given type. */
export function buildTypeSystemPrompt(
  type: AgentType | undefined | null,
  vars: { name: string; budget: string; config?: Record<string, unknown> },
): string {
  const def = getAgentTypeDef(type);
  const configStr = vars.config && Object.keys(vars.config).length > 0
    ? JSON.stringify(vars.config)
    : "(none — use sensible defaults)";
  return def.systemPrompt
    .replace(/\{name\}/g, vars.name)
    .replace(/\{budget\}/g, vars.budget)
    .replace(/\{config\}/g, configStr);
}

/**
 * Infer an agent type from a free-text prompt. Used when the user doesn't
 * explicitly pick a type in the questionnaire.
 */
export function inferAgentType(prompt: string): AgentType {
  const p = prompt.toLowerCase();
  if (/(copy trade|copy trading|mirror|whale|smart money|follow .* wallet|track .* trader)/.test(p)) return "copy-trader";
  if (/(narrative|trending|meme|hype|momentum|twitter|social|going viral|early)/.test(p)) return "narrative";
  if (/(rebalanc|reallocat|optimi[sz]e .*portfolio|monitor .*position|best yield across)/.test(p)) return "rebalancer";
  return "yield";
}
