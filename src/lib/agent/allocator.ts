import "server-only";
import { getVeniceClient, VENICE_MODELS } from "@/lib/venice/client";

/**
 * FUND MANAGER ALLOCATION DECISION — the agent's one non-trivial decision.
 *
 * Venice reads each protocol's live yield + risk (from the scouts) and the user's
 * risk tolerance, then decides what FRACTION of the budget to put behind each
 * protocol's worker. Those fractions become each worker's on-chain
 * ERC20TransferAmountEnforcer cap — so "AI decides the split, the chain enforces
 * it." If the AI is wrong, the cap still bounds the damage.
 *
 * Deterministic fallback (equal split) if Venice is unavailable or returns junk —
 * the demo never breaks on an LLM hiccup.
 */

export interface ProtocolFinding {
  protocol: string;
  apy?:     number;   // percent
  risk?:    string;   // "LOW" | "MEDIUM" | "HIGH"
  tvl?:     number;   // USD
}

export interface AllocationResult {
  /** protocol → fraction of budget (0..1), sums to ~1 */
  weights:   Record<string, number>;
  reasoning: string;
  source:    "venice" | "fallback-equal";
}

/** Normalize weights to sum to 1 and drop anything below a floor. */
function normalize(raw: Record<string, number>, protocols: string[]): Record<string, number> {
  const clean: Record<string, number> = {};
  let sum = 0;
  for (const p of protocols) {
    const v = Math.max(0, Number(raw[p]) || 0);
    clean[p] = v; sum += v;
  }
  if (sum <= 0) { // equal split fallback
    const eq = 1 / protocols.length;
    for (const p of protocols) clean[p] = eq;
    return clean;
  }
  for (const p of protocols) clean[p] = clean[p] / sum;
  return clean;
}

function equalSplit(protocols: string[]): AllocationResult {  
  const eq = 1 / Math.max(1, protocols.length);
  return {
    weights:   Object.fromEntries(protocols.map(p => [p, eq])),
    reasoning: "Equal split (no live data / Venice unavailable).",
    source:    "fallback-equal",
  };
}

/**
 * Decide the budget split across `protocols`. `findings` are the scouts' live
 * yield/risk readings (optional — on the first allocation there may be none).
 */
export async function decideAllocation(
  protocols: string[],
  findings: ProtocolFinding[] = [],
  riskTolerance = "moderate",
): Promise<AllocationResult> {
  const uniq = [...new Set(protocols.map(p => p.toLowerCase()))];
  if (uniq.length <= 1) {
    return { weights: { [uniq[0] ?? "morpho"]: 1 }, reasoning: "Single protocol — 100% allocation.", source: "fallback-equal" };
  }

  const findingsText = findings.length
    ? findings.map(f => `- ${f.protocol}: APY ${f.apy ?? "?"}%, risk ${f.risk ?? "?"}${f.tvl ? `, TVL $${(f.tvl / 1e6).toFixed(0)}M` : ""}`).join("\n")
    : "(no live readings yet — use general knowledge of these protocols)";

  try {
    const client = getVeniceClient();
    const res = await client.chat.completions.create({
      model: VENICE_MODELS.reasoning,
      temperature: 0.2,
      messages: [
        { role: "system", content:
          "You are a DeFi Fund Manager splitting a USDC budget across lending protocols to MAXIMIZE " +
          "risk-adjusted yield. Rules: (1) When protocols have similar risk, allocate MORE to the higher " +
          "APY — a 2x APY edge at equal risk should clearly win (e.g. ~70/30, not 50/50). (2) Down-weight " +
          "a protocol only for HIGHER risk or dangerously low TVL (under $5M). (3) Do NOT over-weight large " +
          "TVL; size is a safety floor, not a yield signal. (4) Never allocate 0 to a safe protocol unless " +
          "its APY is near zero. Respect the user's risk tolerance. Output ONLY a JSON object mapping each " +
          "protocol (lowercase) to its budget fraction (0..1, summing to 1). No prose, no code fences." },
        { role: "user", content:
          `Protocols: ${uniq.join(", ")}\nRisk tolerance: ${riskTolerance}\nLive readings:\n${findingsText}\n\n` +
          `Return JSON like {"${uniq[0]}":0.6,"${uniq[1]}":0.4}.` },
      ],
    });
    const text = res.choices[0]?.message?.content ?? "";
    const json = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(json) as Record<string, number>;
    const weights = normalize(
      Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k.toLowerCase(), v])),
      uniq,
    );
    // Build a short human reasoning line from the weights.
    const reasoning = "Fund Manager allocated " +
      uniq.map(p => `${Math.round(weights[p] * 100)}% ${p}`).join(" / ") +
      (findings.length ? " based on live yield + risk." : " (initial split).");
    return { weights, reasoning, source: "venice" };
  } catch (e) {
    console.warn("[allocator] Venice allocation failed, equal split:", e instanceof Error ? e.message : e);
    return equalSplit(uniq);
  }
}

/** Convert weights → per-protocol USDC caps (string atoms-friendly numbers). */
export function weightsToCaps(weights: Record<string, number>, totalUsdc: number): Record<string, number> {
  const caps: Record<string, number> = {};
  for (const [p, w] of Object.entries(weights)) {
    // Round to 4 dp; leave a hair of headroom is handled at execution, not here.
    caps[p] = Math.round(w * totalUsdc * 10000) / 10000;
  }
  return caps;
}
