import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/whale/discover?limit=5&hours=24
 *
 * AUTONOMOUS smart-money discovery. Two backends, tried in order:
 *
 *   1. DUNE (preferred) — runs a saved Dune query that ranks Base wallets by
 *      realized PnL / win-rate. This finds genuine ALPHA traders (wallets that
 *      actually MAKE money), not just large/active ones. Requires DUNE_API_KEY
 *      and DUNE_WHALE_QUERY_ID (the query returns an address column).
 *
 *   2. BASESCAN (fallback) — scans recent flow through Base DEX routers and
 *      ranks addresses by swap count + ETH volume + recency. Finds WHALES by
 *      size/activity, not profitability. Needs no Dune query, just an
 *      Etherscan V2 key (chainid 8453). Used when Dune isn't configured.
 *
 * Either way, the discovered wallets are then enriched with their live recent
 * trades + convergence via the existing /api/whale/activity route.
 */

const SEED_ROUTERS = [
  "0x6ff5693b99212da76ad316178a184ab56d299b43", // Uniswap Universal Router
  "0x2626664c2603336e57b271c5c0b26f421741e481", // Uniswap V3 Router
  "0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43", // Aerodrome Router
];

interface BasescanTx {
  hash: string; from: string; to: string; value: string;
  timeStamp: string; isError?: string;
}

interface DiscoveredWallet {
  wallet: string;
  // From Dune (alpha ranking):
  pnlUsd?: number;
  winRate?: number;
  trades?: number;
  // From Basescan (size/activity ranking):
  swaps?: number;
  ethMoved?: number;
  lastSeenMinutes?: number;
}

// ── Dune backend — alpha traders by PnL ─────────────────────────────────────────
async function discoverViaDune(limit: number): Promise<DiscoveredWallet[] | null> {
  const apiKey  = process.env.DUNE_API_KEY;
  const queryId = process.env.DUNE_WHALE_QUERY_ID;
  if (!apiKey || !queryId) return null;

  try {
    const res = await fetch(
      `https://api.dune.com/api/v1/query/${queryId}/results?limit=${Math.min(limit * 3, 50)}`,
      { headers: { "X-Dune-API-Key": apiKey }, signal: AbortSignal.timeout(20000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as { result?: { rows?: Array<Record<string, unknown>> } };
    const rows = data.result?.rows ?? [];
    if (rows.length === 0) return null;

    const out: DiscoveredWallet[] = [];
    for (const row of rows) {
      // Find the address column (any value that looks like a 0x-address).
      const addr = Object.values(row)
        .map(v => String(v))
        .find(v => /^0x[a-fA-F0-9]{40}$/.test(v));
      if (!addr) continue;
      const num = (keys: string[]): number | undefined => {
        for (const k of Object.keys(row)) {
          if (keys.some(want => k.toLowerCase().includes(want))) {
            const n = Number(row[k]);
            if (Number.isFinite(n)) return n;
          }
        }
        return undefined;
      };
      out.push({
        wallet:  addr.toLowerCase(),
        pnlUsd:  num(["pnl", "profit"]),
        winRate: num(["win", "winrate", "hit"]),
        trades:  num(["trade", "tx", "count"]),
      });
      if (out.length >= limit) break;
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

// ── Dune convergence — tokens 2+ top whales bought recently (the real signal) ──
async function convergenceViaDune(): Promise<{
  convergence: Array<{ target: string; token?: string; liquidityUsd?: number; walletCount: number; totalUsd?: number }>;
  trades: unknown[];
  ageMinutes: number | null;
} | null> {
  const apiKey  = process.env.DUNE_API_KEY;
  const queryId = process.env.DUNE_CONVERGENCE_QUERY_ID;
  if (!apiKey || !queryId) return null;
  try {
    const res = await fetch(
      `https://api.dune.com/api/v1/query/${queryId}/results?limit=20`,
      { headers: { "X-Dune-API-Key": apiKey }, signal: AbortSignal.timeout(20000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      execution_ended_at?: string;
      result?: { rows?: Array<Record<string, unknown>> };
    };
    const rows = data.result?.rows ?? [];
    if (rows.length === 0) return null;
    const ageMinutes = data.execution_ended_at
      ? Math.round((Date.now() - new Date(data.execution_ended_at).getTime()) / 60000)
      : null;

    // Pull the token's CONTRACT ADDRESS out of the row so the copy-trade agent can
    // mirror ANY converged token — not just the handful in the symbol registry.
    // Prefer an explicit address column; else any 0x-address value in the row.
    const addrOf = (r: Record<string, unknown>): string | undefined => {
      const named = ["token_address", "contract_address", "tokenaddress", "address", "token"]
        .map(want => Object.keys(r).find(k => k.toLowerCase() === want))
        .find(Boolean);
      const candidates = [named ? String(r[named]) : "", ...Object.values(r).map(v => String(v))];
      // Skip the zero address — it's a null placeholder, not a copyable token.
      const hit = candidates.find(v => /^0x[a-fA-F0-9]{40}$/.test(v) && !/^0x0+$/.test(v));
      return hit ? hit.toLowerCase() : undefined;
    };

    const convergenceRaw = rows.map(r => {
      const token = addrOf(r);
      const sym   = r.symbol != null ? String(r.symbol) : undefined;
      return {
        target:      sym ?? token ?? String(r.token ?? "?"),
        token,                                          // contract address (when the query provides one)
        walletCount: Number(r.whale_count ?? r.wallet_count ?? r.whales ?? 0),
        totalUsd:    Number(r.total_usd ?? r.volume_usd ?? 0) || undefined,
      };
    }).filter(c => c.walletCount >= 2);

    // Dune convergence usually reports SYMBOLS only. Resolve each to its most-liquid
    // Base contract address via DexScreener so the copy-trade agent can actually
    // mirror it — and so we know it has a pool (no-liquidity tokens are dropped from
    // being copyable). This is what makes discovery-mode copy EXECUTE, not just hold.
    const { resolveSymbolToBaseToken } = await import("@/lib/prices/dexscreener");
    const convergence = await Promise.all(convergenceRaw.slice(0, 8).map(async c => {
      if (c.token && /^0x[a-f0-9]{40}$/.test(c.token)) return { ...c, liquidityUsd: undefined as number | undefined };
      const resolved = await resolveSymbolToBaseToken(c.target);
      return { ...c, token: resolved?.address ?? c.token, liquidityUsd: resolved?.liquidityUsd };
    }));

    // Synthesize a lightweight "trades" view for display/summaries — carry the
    // resolved token address through so executeCopyTrade gets a real `tokenAddress`.
    const trades = convergence.slice(0, 10).map(c => ({
      wallet: "multiple", action: "buy", symbol: c.target, token: c.token,
      ageMinutes: 0, walletCount: c.walletCount, usd: c.totalUsd, liquidityUsd: c.liquidityUsd,
    }));
    return { convergence, trades, ageMinutes };
  } catch {
    return null;
  }
}

// ── Basescan backend — whales by size/activity (fallback) ───────────────────────
async function fetchRouterTraders(router: string, apiKey: string, sinceTs: number) {
  const params = new URLSearchParams({
    chainid: "8453", module: "account", action: "txlist",
    address: router, startblock: "0", endblock: "99999999",
    page: "1", offset: "100", sort: "desc",
    apikey: apiKey || "YourApiKeyToken",
  });
  try {
    const res = await fetch(`https://api.etherscan.io/v2/api?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [] as BasescanTx[];
    const data = await res.json() as { status: string; result: BasescanTx[] | string };
    if (data.status !== "1" || !Array.isArray(data.result)) return [] as BasescanTx[];
    return data.result.filter(tx => tx.isError !== "1" && Number(tx.timeStamp) * 1000 >= sinceTs);
  } catch {
    return [] as BasescanTx[];
  }
}

async function discoverViaBasescan(limit: number, hours: number): Promise<DiscoveredWallet[]> {
  const apiKey  = process.env.BASESCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? "";
  const sinceTs = Date.now() - hours * 60 * 60 * 1000;
  const routerTxs = (await Promise.all(SEED_ROUTERS.map(r => fetchRouterTraders(r, apiKey, sinceTs)))).flat();

  const score = new Map<string, { swaps: number; valueWei: bigint; last: number }>();
  for (const tx of routerTxs) {
    const w = (tx.from ?? "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(w)) continue;
    const cur = score.get(w) ?? { swaps: 0, valueWei: 0n, last: 0 };
    cur.swaps += 1;
    try { cur.valueWei += BigInt(tx.value || "0"); } catch { /**/ }
    cur.last = Math.max(cur.last, Number(tx.timeStamp) * 1000);
    score.set(w, cur);
  }

  return [...score.entries()]
    .sort((a, b) =>
      b[1].swaps - a[1].swaps ||
      (b[1].valueWei > a[1].valueWei ? 1 : b[1].valueWei < a[1].valueWei ? -1 : 0) ||
      b[1].last - a[1].last,
    )
    .slice(0, limit)
    .map(([wallet, s]) => ({
      wallet,
      swaps:           s.swaps,
      ethMoved:        Number(s.valueWei / 10n ** 15n) / 1000,
      lastSeenMinutes: Math.round((Date.now() - s.last) / 60000),
    }));
}

export async function GET(request: NextRequest) {
  const sp    = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? "5"), 1), 10);
  const hours = Math.min(Number(sp.get("hours") ?? "24"), 168);

  // 1. Prefer Dune (alpha by PnL); fall back to Basescan (whales by size).
  const dune = await discoverViaDune(limit);
  const ranked = dune ?? await discoverViaBasescan(limit, hours);
  const method = dune ? "dune-pnl" : "basescan-activity";
  const wallets = ranked.map(r => r.wallet);

  if (wallets.length === 0) {
    return NextResponse.json({
      wallets: [], discovered: [], trades: [], convergence: [],
      method, source: method,
      note: dune === null
        ? "No wallets found. Set DUNE_WHALE_QUERY_ID for alpha ranking, or add BASESCAN_API_KEY for the fallback."
        : "Dune query returned no rows.",
    });
  }

  // 2. Convergence signal — tokens 2+ top whales bought recently.
  //    Preferred: Dune (works on Base). Fallback: /api/whale/activity (Etherscan;
  //    note Etherscan V2 free tier does NOT cover Base, so this is usually empty).
  let trades: unknown[] = [];
  let convergence: unknown[] = [];
  let signalAgeMinutes: number | null = null;
  const duneConv = await convergenceViaDune();
  if (duneConv) {
    convergence = duneConv.convergence;
    trades = duneConv.trades;
    signalAgeMinutes = duneConv.ageMinutes;
    // Keep the signal live without a running cron: if the cached Dune result is
    // older than 10 min, kick a background re-execution (fire-and-forget). The
    // NEXT call then reads fresher data. Vercel Cron also refreshes in prod.
    if (signalAgeMinutes !== null && signalAgeMinutes >= 10) {
      void fetch(`${request.nextUrl.origin}/api/whale/refresh`, { method: "GET" }).catch(() => {});
    }
  } else {
    try {
      const actUrl = `${request.nextUrl.origin}/api/whale/activity?wallets=${wallets.join(",")}&hours=${hours}`;
      const actRes = await fetch(actUrl, { signal: AbortSignal.timeout(20000) });
      if (actRes.ok) {
        const act = await actRes.json() as { trades?: unknown[]; convergence?: unknown[] };
        trades = act.trades ?? [];
        convergence = act.convergence ?? [];
      }
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({
    wallets,
    discovered: ranked,   // wallet + why it was picked (pnl/winRate OR swaps/ethMoved)
    trades,
    convergence,
    signalAgeMinutes,     // how old the cached Dune convergence signal is
    hours,
    method,               // "dune-pnl" (alpha) or "basescan-activity" (size)
    source:    method,
    fetchedAt: Date.now(),
  });
}
