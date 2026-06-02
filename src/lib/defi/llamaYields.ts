import "server-only";

/**
 * Real, live yield data from DeFiLlama's public Yields API.
 * ────────────────────────────────────────────────────────
 * Shared source of truth used by BOTH /api/yields/live and the Venice yield
 * analyst. There are NO invented numbers here — if DeFiLlama is unreachable we
 * return an empty list + error, never fabricated APYs.
 *
 * DeFiLlama Yields: https://yields.llama.fi/pools  (free, no auth)
 */

const LLAMA_POOLS = "https://yields.llama.fi/pools";

interface LlamaPool {
  chain:        string;
  project:      string;
  symbol:       string;
  tvlUsd:       number;
  apy:          number;
  apyBase?:     number;
  apyReward?:   number;
  stablecoin?:  boolean;
  ilRisk?:      string;
  exposure?:    string;
  pool:         string;
  poolMeta?:    string | null;
  predictions?: { predictedClass?: string; predictedProbability?: number };
}

export interface LiveYield {
  protocol:   string;
  symbol:     string;
  chain:      string;
  apy:        number;
  apyBase:    number;
  apyReward:  number;
  tvlUsd:     number;
  stablecoin: boolean;
  ilRisk:     string;
  poolId:     string;
  outlook?:   string;   // DeFiLlama's ML prediction (Stable/Up/Down)
}

export interface FetchYieldsOptions {
  chain?:      string;   // default "Base"
  minTvl?:     number;   // default 500_000
  limit?:      number;   // default 15, max 50
  asset?:      string;   // e.g. "USDC"
  stableOnly?: boolean;
}

export interface LiveYieldsResult {
  yields: LiveYield[];
  best:   { protocol: string; symbol: string; apy: number } | null;
  count:  number;
  chain:  string;
  source: "defillama";
  error?: string;
  fetchedAt: number;
}

/**
 * Fetch live yields from DeFiLlama, filtered/sorted. Returns real data or an
 * honest empty result with an error — never random/fabricated values.
 */
export async function fetchLiveYields(opts: FetchYieldsOptions = {}): Promise<LiveYieldsResult> {
  const chain      = opts.chain ?? "Base";
  const minTvl     = opts.minTvl ?? 500_000;
  const limit      = Math.min(opts.limit ?? 15, 50);
  const asset      = (opts.asset ?? "").toUpperCase().trim();
  const stableOnly = opts.stableOnly === true;

  try {
    const res = await fetch(LLAMA_POOLS, {
      headers: { Accept: "application/json" },
      signal:  AbortSignal.timeout(12000),
      next:    { revalidate: 300 },   // yields move slowly; 5-min cache
    });
    if (!res.ok) {
      return { yields: [], best: null, count: 0, chain, source: "defillama", error: `DeFiLlama ${res.status}`, fetchedAt: Date.now() };
    }
    const json  = await res.json() as { status?: string; data?: LlamaPool[] };
    const pools = Array.isArray(json.data) ? json.data : [];

    let filtered = pools.filter(p =>
      p.chain?.toLowerCase() === chain.toLowerCase() &&
      typeof p.apy === "number" && p.apy > 0 &&
      p.tvlUsd >= minTvl,
    );
    if (asset)      filtered = filtered.filter(p => p.symbol?.toUpperCase().includes(asset));
    if (stableOnly) filtered = filtered.filter(p => p.stablecoin === true);

    const yields = filtered
      .sort((a, b) => b.apy - a.apy)
      .slice(0, limit)
      .map<LiveYield>(p => ({
        protocol:   p.project,
        symbol:     p.symbol,
        chain:      p.chain,
        apy:        Number(p.apy.toFixed(2)),
        apyBase:    Number((p.apyBase   ?? 0).toFixed(2)),
        apyReward:  Number((p.apyReward ?? 0).toFixed(2)),
        tvlUsd:     Math.round(p.tvlUsd),
        stablecoin: !!p.stablecoin,
        ilRisk:     p.ilRisk ?? "no",
        poolId:     p.pool,
        outlook:    p.predictions?.predictedClass,
      }));

    const best = yields[0];
    return {
      yields,
      best:   best ? { protocol: best.protocol, symbol: best.symbol, apy: best.apy } : null,
      count:  yields.length,
      chain,
      source: "defillama",
      fetchedAt: Date.now(),
    };
  } catch (e) {
    return { yields: [], best: null, count: 0, chain, source: "defillama", error: e instanceof Error ? e.message : String(e), fetchedAt: Date.now() };
  }
}
