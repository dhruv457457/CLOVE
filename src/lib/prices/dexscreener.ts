import "server-only";

/**
 * Free live token prices from DexScreener (no API key). Used by the portfolio
 * dashboard to value on-chain holdings and compute P/L.
 *
 * Endpoint: GET https://api.dexscreener.com/latest/dex/tokens/{addr1,addr2,...}
 * Returns { pairs: [{ chainId, baseToken:{address}, priceUsd, liquidity:{usd} }] }.
 * We keep the highest-liquidity Base pair per token.
 */

interface DexPair {
  chainId?:   string;
  baseToken?: { address?: string };
  priceUsd?:  string;
  liquidity?: { usd?: number };
}

interface DexSearchPair {
  chainId?:   string;
  dexId?:     string;
  baseToken?: { address?: string; symbol?: string };
  liquidity?: { usd?: number };
}

const symCache = new Map<string, { address: string; liquidityUsd: number } | null>();

/**
 * Resolve a token SYMBOL to its most-liquid Base contract address via DexScreener
 * search. Returns null if no Base pair is found. The liquidity figure lets callers
 * skip dead/illiquid tokens (a swap into a no-liquidity token would revert).
 *
 * Used by the copy-trade discovery path: Dune convergence reports symbols only,
 * so we resolve them to real, liquid addresses before the agent can mirror them.
 */
export async function resolveSymbolToBaseToken(
  symbol: string,
): Promise<{ address: string; liquidityUsd: number } | null> {
  const q = symbol.trim().replace(/^\$/, "");
  if (!q || /^0x/.test(q)) return null;
  const key = q.toLowerCase();
  if (symCache.has(key)) return symCache.get(key)!;

  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) { symCache.set(key, null); return null; }
    const data = await res.json() as { pairs?: DexSearchPair[] };
    let bestAddr: string | null = null, bestLiq = -1;
    for (const p of data.pairs ?? []) {
      if (p.chainId !== "base") continue;
      // Exact symbol match only — "ETH" must not resolve to "ETHFI" etc.
      if ((p.baseToken?.symbol ?? "").toLowerCase() !== key) continue;
      const addr = p.baseToken?.address?.toLowerCase();
      const liq  = Number(p.liquidity?.usd ?? 0);
      if (addr && /^0x[a-f0-9]{40}$/.test(addr) && liq > bestLiq) { bestAddr = addr; bestLiq = liq; }
    }
    const result = bestAddr ? { address: bestAddr, liquidityUsd: bestLiq } : null;
    symCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

const cache = new Map<string, { price: number; at: number }>();
const TTL_MS = 60_000;

/** Look up USD prices for a set of token addresses (Base). Cached ~60s. */
export async function getTokenPricesUsd(addresses: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const now = Date.now();
  const need: string[] = [];

  for (const raw of addresses) {
    const a = raw.toLowerCase();
    const hit = cache.get(a);
    if (hit && now - hit.at < TTL_MS) out[a] = hit.price;
    else need.push(a);
  }
  if (need.length === 0) return out;

  // Per-token lookup is more reliable than a multi-address batch (majors like
  // WETH are usually the QUOTE token in batch results, so they get missed). For
  // a single token, DexScreener returns pairs where it IS the base token.
  await Promise.all(need.map(async (addr) => {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${addr}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) return;
      const data = await res.json() as { pairs?: DexPair[] };
      let best = 0, bestLiq = -1;
      for (const p of data.pairs ?? []) {
        if (p.chainId !== "base") continue;
        if (p.baseToken?.address?.toLowerCase() !== addr) continue;
        const price = Number(p.priceUsd);
        const liq = Number(p.liquidity?.usd ?? 0);
        if (Number.isFinite(price) && liq > bestLiq) { best = price; bestLiq = liq; }
      }
      if (best > 0) { out[addr] = best; cache.set(addr, { price: best, at: now }); }
    } catch { /* non-fatal — token just won't have a price */ }
  }));
  return out;
}
