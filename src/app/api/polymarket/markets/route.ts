import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/polymarket/markets?topic=crypto&limit=12
 *
 * Proxies Polymarket's public Gamma API to fetch live open prediction markets
 * with their implied odds. This is REAL external data — the agent reads actual
 * market prices, not a CLOVE-internal mock.
 *
 * Gamma API: https://gamma-api.polymarket.com/markets
 *   - no auth required
 *   - outcomes / outcomePrices come back as JSON-stringified arrays
 */

const GAMMA = "https://gamma-api.polymarket.com/markets";

interface RawMarket {
  id:            string;
  question:      string;
  slug?:         string;
  outcomes?:     string;   // JSON array string e.g. '["Yes","No"]'
  outcomePrices?: string;  // JSON array string e.g. '["0.62","0.38"]'
  volume?:       string;
  volumeNum?:    number;
  liquidity?:    string;
  liquidityNum?: number;
  endDate?:      string;
  category?:     string;
  active?:       boolean;
  closed?:       boolean;
  conditionId?:  string;
  clobTokenIds?: string;   // JSON array string of CLOB token ids
}

export interface PolymarketMarket {
  id:          string;
  question:    string;
  slug?:       string;
  endDate?:    string;
  category?:   string;
  volumeUsd:   number;
  liquidityUsd: number;
  conditionId?: string;
  outcomes:    Array<{ label: string; price: number; clobTokenId?: string }>;
}

function safeParseArray(s?: string): unknown[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

function normalize(m: RawMarket): PolymarketMarket | null {
  const labels = safeParseArray(m.outcomes) as string[];
  const prices = safeParseArray(m.outcomePrices) as string[];
  const tokenIds = safeParseArray(m.clobTokenIds) as string[];
  if (labels.length === 0) return null;

  const outcomes = labels.map((label, i) => ({
    label,
    price:       Number.parseFloat(prices[i] ?? "0") || 0,
    clobTokenId: tokenIds[i],
  }));

  return {
    id:           m.id,
    question:     m.question,
    slug:         m.slug,
    endDate:      m.endDate,
    category:     m.category,
    volumeUsd:    m.volumeNum    ?? (Number.parseFloat(m.volume    ?? "0") || 0),
    liquidityUsd: m.liquidityNum ?? (Number.parseFloat(m.liquidity ?? "0") || 0),
    conditionId:  m.conditionId,
    outcomes,
  };
}

export async function GET(request: NextRequest) {
  const sp     = request.nextUrl.searchParams;
  const topic  = (sp.get("topic") ?? "").toLowerCase().trim();
  const limit  = Math.min(Number(sp.get("limit") ?? "12"), 50);

  // Fetch a generous batch then filter — Gamma's tag filtering is unreliable.
  const url = `${GAMMA}?active=true&closed=false&order=volume&ascending=false&limit=${Math.max(limit * 4, 40)}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal:  AbortSignal.timeout(10000),
      // Polymarket data updates frequently; cache 60s at the edge
      next:    { revalidate: 60 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { markets: [], error: `Gamma API ${res.status}`, source: "polymarket-gamma" },
        { status: 200 },
      );
    }

    const raw = await res.json() as RawMarket[];
    let markets = (Array.isArray(raw) ? raw : [])
      .map(normalize)
      .filter((m): m is PolymarketMarket => m !== null)
      // drop degenerate markets (no real liquidity / already ~resolved)
      .filter(m => m.liquidityUsd > 100 && m.outcomes.some(o => o.price > 0.02 && o.price < 0.98));

    if (topic) {
      const filtered = markets.filter(m =>
        m.question.toLowerCase().includes(topic) ||
        (m.category ?? "").toLowerCase().includes(topic),
      );
      // Fall back to unfiltered if the topic matched nothing (better than empty)
      if (filtered.length > 0) markets = filtered;
    }

    return NextResponse.json({
      markets: markets.slice(0, limit),
      count:   Math.min(markets.length, limit),
      topic:   topic || null,
      source:  "polymarket-gamma",
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return NextResponse.json(
      { markets: [], error: e instanceof Error ? e.message : String(e), source: "polymarket-gamma" },
      { status: 200 },
    );
  }
}
