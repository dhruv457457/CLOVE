import "server-only";
import { getVeniceClient, VENICE_MODELS } from "./client";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AgentContext {
  /** User's current wallet address */
  walletAddress: string;
  /** Current USDC balance */
  usdcBalance?: string;
  /** Current positions across protocols */
  positions?: {
    protocol: string;
    asset:    string;
    amount:   string;
    apy:      number;
  }[];
  /** Live yield data from intelligence API */
  yields?: Record<string, { apy: number; tvl: string; risk: string }>;
  /** Market intelligence from Tavily */
  marketContext?: string;
  /** Risk signals */
  riskLevel?: "low" | "medium" | "high";
  /** ERC-7715 budget available */
  budgetUsdc: string;
  /** User's goal */
  goal?: string;
}

export interface AgentDecision {
  /** What the agent decided to do */
  action: "deposit" | "withdraw" | "swap" | "rebalance" | "hold" | "alert-only";
  /** Target protocol */
  protocol?: "morpho" | "uniswap" | "aerodrome" | "lido" | "sky";
  /** Amount in USDC */
  amount?: string;
  /** Human-readable reasoning */
  reasoning: string;
  /** Confidence 0-1 */
  confidence: number;
  /** Should agent abort? */
  abort?: boolean;
  abortReason?: string;
  /** Secondary action after primary (e.g. withdraw then deposit) */
  followUp?: {
    action:   string;
    protocol: string;
    amount?:  string;
  };
}

// ── Decision prompt ────────────────────────────────────────────────────────────

const DECISION_SYSTEM_PROMPT = `You are CLOVE's AI Decision Engine — the brain of an autonomous DeFi agent.

Given the agent's current context (wallet, positions, live yields, market news, risk signals),
you must decide what the agent should do RIGHT NOW.

## Available actions
- deposit    : Supply USDC to a protocol vault (morpho, sky, aerodrome)
- withdraw   : Withdraw from current position
- swap       : Exchange tokens via Uniswap V3
- rebalance  : Withdraw from one protocol, deposit into a better one
- hold       : Do nothing — current allocation is optimal
- alert-only : Market is too risky — just notify the user, don't move funds

## Decision rules
1. If riskLevel is "high" → always choose "alert-only" or "hold"
2. If a protocol offers >1% more APY than current position → consider "rebalance"
3. If no positions yet → choose "deposit" to the highest yield
4. Never risk more than the budgetUsdc amount in a single action
5. Always explain reasoning in plain English

## Output — ONLY return this JSON, no markdown:
{
  "action": "<action>",
  "protocol": "<protocol or null>",
  "amount": "<USDC amount or null>",
  "reasoning": "<1-2 sentences why>",
  "confidence": <0.0-1.0>,
  "abort": <true/false>,
  "abortReason": "<reason or null>",
  "followUp": null
}`;

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * Ask Venice AI to make a real-time decision based on current agent context.
 * This is what makes CLOVE a TRUE AI agent — not just automation.
 * Venice perceives the state, reasons about it, and returns a concrete decision.
 */
export async function makeAgentDecision(
  context: AgentContext
): Promise<AgentDecision> {
  const client = getVeniceClient();

  // Build rich context message
  const contextLines = [
    `Wallet: ${context.walletAddress}`,
    context.usdcBalance ? `USDC Balance: ${context.usdcBalance}` : "",
    `Budget available: ${context.budgetUsdc} USDC`,
    context.goal ? `User goal: ${context.goal}` : "",
    "",
    context.positions?.length
      ? `Current positions:\n${context.positions.map(p =>
          `  - ${p.protocol}: ${p.amount} ${p.asset} @ ${p.apy}% APY`
        ).join("\n")}`
      : "Current positions: None (fresh wallet)",
    "",
    context.yields
      ? `Live yields:\n${Object.entries(context.yields).map(([p, d]) =>
          `  - ${p}: ${d.apy}% APY, TVL ${d.tvl}, Risk ${d.risk}`
        ).join("\n")}`
      : "",
    "",
    context.riskLevel ? `Risk level: ${context.riskLevel.toUpperCase()}` : "",
    context.marketContext ? `Market context: ${context.marketContext}` : "",
  ].filter(Boolean).join("\n");

  let raw: string;
  try {
    const response = await client.chat.completions.create({
      model: VENICE_MODELS.analyst,
      messages: [
        { role: "system", content: DECISION_SYSTEM_PROMPT },
        { role: "user", content: `Make a decision based on this context:\n\n${contextLines}` },
      ],
      temperature: 0.1, // Low temperature — we want deterministic decisions
      max_tokens: 500,
      // @ts-expect-error Venice-specific
      venice_parameters: { include_venice_system_prompt: false },
    });
    raw = response.choices[0]?.message?.content ?? "";
  } catch (e) {
    console.error("[venice/decision] API error:", e);
    // Safe fallback decision
    return {
      action:     "hold",
      reasoning:  "Venice AI unavailable — holding position to avoid uninformed action.",
      confidence: 0.5,
      abort:      false,
    };
  }

  // Strip markdown fences
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    const decision = JSON.parse(raw) as AgentDecision;
    return decision;
  } catch {
    console.warn("[venice/decision] JSON parse failed:", raw.slice(0, 100));
    return {
      action:     "hold",
      reasoning:  "Could not parse Venice decision — holding to be safe.",
      confidence: 0.3,
    };
  }
}
