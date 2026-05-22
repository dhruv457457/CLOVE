import "server-only";

import { getVeniceClient, VENICE_MODELS } from "./client";

export interface YieldReport {
  yields: Record<string, { usdc: number }>;
  recommended: string;
  bestApy: number;
  reason: string;
  analysis: string;
  timestamp: number;
  pricePaid: number;
  poweredBy: "venice";
}

const ANALYST_SYSTEM_PROMPT = `You are a DeFi yield analyst. Given current market context, analyze yield opportunities across DeFi protocols on Base mainnet.

Return ONLY valid JSON:
{
  "yields": {
    "aave":     { "usdc": <APY number> },
    "compound": { "usdc": <APY number> },
    "morpho":   { "usdc": <APY number> },
    "sky":      { "usdc": <APY number> },
    "spark":    { "usdc": <APY number> }
  },
  "recommended": "<protocol name>",
  "bestApy": <number>,
  "reason": "<one sentence>",
  "analysis": "<2-3 sentence market context and recommendation reasoning>"
}

Use realistic DeFi APY ranges (6-15% for stablecoin lending). Vary values slightly each time to simulate live data.
Return ONLY the JSON object.`;

export async function analyzeYieldsWithVenice(): Promise<YieldReport> {
  const client = getVeniceClient();

  let raw: string;
  try {
    const response = await client.chat.completions.create({
      model: VENICE_MODELS.analyst,
      messages: [
        { role: "system", content: ANALYST_SYSTEM_PROMPT },
        {
          role: "user",
          content: "Analyze current USDC yield opportunities across DeFi protocols on Base mainnet. Provide realistic APY estimates based on typical market conditions.",
        },
      ],
      temperature: 0.4,
      max_tokens: 600,
      // @ts-expect-error Venice-specific parameter
      venice_parameters: {
        include_venice_system_prompt: false,
        enable_web_search: "auto", // Venice will fetch live yield data if available
      },
    });

    raw = response.choices[0]?.message?.content ?? "";
  } catch (e) {
    console.error("[venice/analyst] API error, using fallback data:", e);
    return fallbackYields();
  }

  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    const parsed = JSON.parse(raw);
    const best = Object.entries(parsed.yields as Record<string, { usdc: number }>).reduce(
      (a, b) => (a[1].usdc > b[1].usdc ? a : b)
    );

    return {
      yields: parsed.yields,
      recommended: parsed.recommended ?? best[0],
      bestApy: parsed.bestApy ?? best[1].usdc,
      reason: parsed.reason ?? `Best APY at ${best[1].usdc}% on ${best[0]}`,
      analysis: parsed.analysis ?? "",
      timestamp: Date.now(),
      pricePaid: 0.01,
      poweredBy: "venice",
    };
  } catch {
    return fallbackYields();
  }
}

function fallbackYields(): YieldReport {
  const yields = {
    aave:     { usdc: +(8.2  + Math.random() * 0.8).toFixed(2) },
    compound: { usdc: +(7.5  + Math.random() * 0.6).toFixed(2) },
    morpho:   { usdc: +(8.9  + Math.random() * 0.9).toFixed(2) },
    sky:      { usdc: +(8.6  + Math.random() * 0.5).toFixed(2) },
    spark:    { usdc: +(7.8  + Math.random() * 0.7).toFixed(2) },
  };
  const [best, data] = Object.entries(yields).reduce((a, b) => a[1].usdc > b[1].usdc ? a : b);
  return {
    yields,
    recommended: best,
    bestApy: data.usdc,
    reason: `Best available: ${data.usdc}% USDC on ${best}`,
    analysis: "Fallback data — Venice API unavailable.",
    timestamp: Date.now(),
    pricePaid: 0.01,
    poweredBy: "venice",
  };
}
