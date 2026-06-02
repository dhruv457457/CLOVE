import { NextRequest, NextResponse } from "next/server";
import { analyzeYieldsWithVenice } from "@/lib/venice/analyst";
import { searchCryptoYields, searchCryptoNews } from "@/lib/tavily/client";
import { searchProtocolYields } from "@/lib/exa/client";
import { intelligenceCache, INTELLIGENCE_TTL_MS } from "@/lib/agent/cache";
import { build402, verifyPayment } from "@/lib/x402/helpers";
import { X402_PRICES } from "@/lib/config/env";

const PRICE_USDC = X402_PRICES.intelligence;
const PROTOCOLS = ["Morpho", "Uniswap", "Aerodrome", "Lido", "Aave"];

export async function GET(request: NextRequest) {
  const paymentSig = request.headers.get("PAYMENT-SIGNATURE");
  if (!paymentSig) return build402(PRICE_USDC);

  const valid = await verifyPayment(paymentSig);
  if (!valid) return NextResponse.json({ error: "Invalid payment" }, { status: 402 });

  // ── Cache hit? Return same intel for 5 min — DeFi yields don't change faster ──
  // Key by 5-minute UTC bucket so a bad/stale response only poisons the current
  // bucket, and only successful responses (bestApy > 0) are ever stored.
  const bucket = Math.floor(Date.now() / INTELLIGENCE_TTL_MS);
  const CACHE_KEY = `intel:base:${bucket}`;
  const cached = intelligenceCache.get(CACHE_KEY) as Record<string, unknown> | undefined;
  if (cached) {
    return NextResponse.json({ ...cached, _cached: true });
  }

  // ── Run all intelligence sources in parallel ──────────────────────────────
  const [veniceResult, tavilyResult, exaResult, newsResult] = await Promise.allSettled([
    analyzeYieldsWithVenice(),
    process.env.TAVILY_API_KEY ? searchCryptoYields(PROTOCOLS) : Promise.reject("no key"),
    process.env.EXA_API_KEY    ? searchProtocolYields(PROTOCOLS) : Promise.reject("no key"),
    process.env.TAVILY_API_KEY ? searchCryptoNews("DeFi yield Base") : Promise.reject("no key"),
  ]);

  // ── Merge: Venice/DeFiLlama is primary, Tavily/Exa enrich ──────────────────
  const venice = veniceResult.status === "fulfilled" ? veniceResult.value : null;
  const tavily = tavilyResult.status === "fulfilled" ? tavilyResult.value : null;
  const exa    = exaResult.status    === "fulfilled" ? exaResult.value    : null;
  const news   = newsResult.status   === "fulfilled" ? newsResult.value   : null;

  const sources = {
    defillama: !!(venice && venice.live.length > 0),
    venice:    venice?.poweredBy === "venice+defillama",
    tavily:    !!tavily,
    exa:       !!exa,
  };

  // Core yield data — REAL DeFiLlama numbers only. No hardcoded fallback.
  let bestApy     = venice?.bestApy ?? 0;
  let recommended = venice?.recommended ?? "";

  // Build the per-protocol yields map from the REAL DeFiLlama rows.
  const yields: Record<string, { apy: number; tvlUsd: number; risk: string; symbol: string }> = {};
  for (const row of venice?.live ?? []) {
    const key = row.protocol;
    if (!yields[key] || row.apy > yields[key].apy) {
      yields[key] = {
        apy:    row.apy,
        tvlUsd: row.tvlUsd,
        risk:   row.ilRisk && row.ilRisk !== "no" ? "medium" : "low",
        symbol: row.symbol,
      };
    }
  }

  // Cross-validate with Exa if it found a higher rate for a real protocol.
  if (exa && exa.length > 0) {
    const exaBest = exa.reduce((best, r) => ((r.apy ?? 0) > (best.apy ?? 0) ? r : best), exa[0]);
    if (exaBest.apy && exaBest.apy > bestApy) {
      bestApy     = exaBest.apy;
      recommended = exaBest.protocol !== "Unknown" ? exaBest.protocol : recommended;
    }
  }

  const response = {
    bestApy,
    recommended,
    reason: venice?.reason ?? (recommended ? `${recommended} currently offers the best risk-adjusted yield on Base.` : "No live yield data available."),
    analysis: venice?.analysis ?? "",
    error: venice?.error,

    marketIntel: {
      tavilyAnswer: tavily?.answer,
      newsHeadline: news?.results?.[0]?.title,
      newsUrl:      news?.results?.[0]?.url,
      exaProtocols: exa?.filter(r => r.apy).map(r => ({
        protocol: r.protocol,
        apy:      r.apy,
        source:   r.source,
      })),
    },

    yields,

    _clove: {
      paid: true,
      costUsdc: PRICE_USDC,
      via: "x402 + ERC-7710",
      sources,
      source: "defillama",
      timestamp: Date.now(),
    },
  };

  // Only cache real, non-empty results (bestApy > 0). Empty/errored intel is never cached.
  if (response.bestApy > 0) {
    intelligenceCache.set(CACHE_KEY, response, INTELLIGENCE_TTL_MS);
  }

  return NextResponse.json(response, {
    headers: { "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE" },
  });
}
