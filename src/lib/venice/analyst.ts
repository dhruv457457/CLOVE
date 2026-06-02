import "server-only";

import { getVeniceClient, VENICE_MODELS } from "./client";
import { fetchLiveYields, type LiveYield } from "@/lib/defi/llamaYields";
import { X402_PRICES } from "@/lib/config/env";

export interface YieldReport {
  /** Per-protocol APY map (real DeFiLlama numbers), keyed by protocol name. */
  yields: Record<string, { usdc: number }>;
  recommended: string;
  bestApy: number;
  reason: string;
  analysis: string;
  timestamp: number;
  pricePaid: number;
  poweredBy: "venice+defillama" | "defillama";
  /** Raw real yield rows backing this report. */
  live: LiveYield[];
  source: "defillama";
  error?: string;
}

/**
 * Venice's role here is REASONING ONLY — it never invents numbers.
 * It is given the real DeFiLlama rows and must pick a recommendation and explain
 * why, using only those rows.
 */
const ANALYST_SYSTEM_PROMPT = `You are a DeFi yield analyst. You are given REAL, live yield rows fetched from DeFiLlama.
Do NOT invent or alter any APY/TVL numbers — reason only over the rows provided.

Return ONLY valid JSON:
{
  "recommended": "<protocol name copied exactly from the rows>",
  "reason": "<one sentence on why this row is the best risk-adjusted pick>",
  "analysis": "<2-3 sentences of market context grounded in the provided rows>"
}
Return ONLY the JSON object.`;

export async function analyzeYieldsWithVenice(): Promise<YieldReport> {
  // ── 1. Fetch REAL yields (no fabrication) ─────────────────────────────────
  // Prefer stablecoin USDC lending on Base; broaden if that comes back empty.
  let live = await fetchLiveYields({ chain: "Base", asset: "USDC", stableOnly: true, minTvl: 1_000_000, limit: 8 });
  if (live.yields.length === 0) {
    live = await fetchLiveYields({ chain: "Base", minTvl: 1_000_000, limit: 8 });
  }

  const rows = live.yields;
  const buildYieldsMap = (rs: LiveYield[]): Record<string, { usdc: number }> => {
    const map: Record<string, { usdc: number }> = {};
    for (const r of rs) {
      // Keep the highest APY per protocol.
      const key = r.protocol;
      if (!map[key] || r.apy > map[key].usdc) map[key] = { usdc: r.apy };
    }
    return map;
  };

  // No real data → return an HONEST empty report (never fabricate).
  if (rows.length === 0) {
    return {
      yields: {},
      recommended: "",
      bestApy: 0,
      reason: "",
      analysis: "No live yield data available from DeFiLlama right now.",
      timestamp: Date.now(),
      pricePaid: X402_PRICES.intelligence,
      poweredBy: "defillama",
      live: [],
      source: "defillama",
      error: live.error ?? "no pools matched",
    };
  }

  const yieldsMap = buildYieldsMap(rows);
  const bestRow   = rows[0]; // already sorted desc by apy in fetchLiveYields

  // ── 2. Ask Venice to REASON over the real rows (recommendation + prose) ───
  const rowsText = rows
    .map(r => `- ${r.protocol} (${r.symbol}): ${r.apy}% APY, TVL $${Math.round(r.tvlUsd).toLocaleString()}, ilRisk=${r.ilRisk}, outlook=${r.outlook ?? "n/a"}`)
    .join("\n");

  let recommended = bestRow.protocol;
  let reason      = `${bestRow.protocol} offers the highest live APY (${bestRow.apy}%) on Base with TVL $${Math.round(bestRow.tvlUsd).toLocaleString()}.`;
  let analysis    = "";
  let poweredBy: YieldReport["poweredBy"] = "defillama";

  try {
    const client = getVeniceClient();
    const response = await client.chat.completions.create({
      model: VENICE_MODELS.analyst,
      messages: [
        { role: "system", content: ANALYST_SYSTEM_PROMPT },
        { role: "user", content: `Real live yield rows on Base (from DeFiLlama):\n${rowsText}\n\nPick the best risk-adjusted recommendation from these rows and explain.` },
      ],
      temperature: 0.3,
      max_tokens: 400,
      // @ts-expect-error Venice-specific parameter
      venice_parameters: { include_venice_system_prompt: false },
    });
    const raw = (response.choices[0]?.message?.content ?? "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(raw) as { recommended?: string; reason?: string; analysis?: string };

    // Only accept a recommendation that actually exists in the real rows.
    if (parsed.recommended && yieldsMap[parsed.recommended]) {
      recommended = parsed.recommended;
    }
    if (parsed.reason)   reason   = parsed.reason;
    if (parsed.analysis) analysis = parsed.analysis;
    poweredBy = "venice+defillama";
  } catch (e) {
    console.warn("[venice/analyst] reasoning step failed; returning real data with templated prose:", e);
  }

  return {
    yields: yieldsMap,
    recommended,
    bestApy: yieldsMap[recommended]?.usdc ?? bestRow.apy,
    reason,
    analysis,
    timestamp: Date.now(),
    pricePaid: X402_PRICES.intelligence,
    poweredBy,
    live: rows,
    source: "defillama",
  };
}
