import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/whale/activity?wallets=0xabc,0xdef&hours=24
 *
 * Reads the recent on-chain transactions of tracked "smart money" wallets from
 * Basescan and extracts DEX swap activity. This is REAL on-chain data — the
 * agent is genuinely watching other people's wallets, not a mock feed.
 *
 * Uses the Etherscan V2 multichain API (chainid=8453 for Base). A free API key
 * works; without one we fall back to the no-key endpoint (rate-limited).
 */

// Known DEX routers on Base — used to classify a tx as a swap.
const BASE_DEX_ROUTERS: Record<string, string> = {
  "0x6ff5693b99212da76ad316178a184ab56d299b43": "Uniswap Universal Router",
  "0x2626664c2603336e57b271c5c0b26f421741e481": "Uniswap V3 Router",
  "0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43": "Aerodrome Router",
  "0x827922686190790b37229fd06084350e74485b72": "Aerodrome Router 2",
  "0x198ef79f1f515f02dfe9e3115ed9fc07183f02fc": "1inch Router",
};

interface BasescanTx {
  hash:          string;
  from:          string;
  to:            string;
  value:         string;
  timeStamp:     string;
  functionName?: string;
  methodId?:     string;
  isError?:      string;
  tokenName?:    string;
  tokenSymbol?:  string;
}

export interface WhaleTrade {
  wallet:    string;
  hash:      string;
  to:        string;
  router?:   string;     // matched DEX router label, if any
  action:    string;     // decoded function name or "transfer"
  symbol?:   string;
  timestamp: number;
  ageMinutes: number;
  basescanUrl: string;
}

async function fetchWalletTxs(wallet: string, apiKey: string, sinceTs: number): Promise<BasescanTx[]> {
  // Etherscan V2 multichain endpoint (chainid 8453 = Base)
  const base = "https://api.etherscan.io/v2/api";
  const params = new URLSearchParams({
    chainid:    "8453",
    module:     "account",
    action:     "txlist",
    address:    wallet,
    startblock: "0",
    endblock:   "99999999",
    page:       "1",
    offset:     "30",
    sort:       "desc",
    apikey:     apiKey || "YourApiKeyToken",
  });
  try {
    const res = await fetch(`${base}?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = await res.json() as { status: string; result: BasescanTx[] | string };
    if (data.status !== "1" || !Array.isArray(data.result)) return [];
    return data.result.filter(tx => Number(tx.timeStamp) * 1000 >= sinceTs);
  } catch {
    return [];
  }
}

function classify(tx: BasescanTx): { action: string; router?: string } {
  const toLower = (tx.to ?? "").toLowerCase();
  const router  = BASE_DEX_ROUTERS[toLower];
  let action = "transfer";
  if (tx.functionName) {
    const fn = tx.functionName.toLowerCase();
    if (fn.includes("swap"))            action = "swap";
    else if (fn.includes("addliquid")) action = "add-liquidity";
    else if (fn.includes("deposit"))   action = "deposit";
    else if (fn.includes("mint"))      action = "mint";
    else action = tx.functionName.split("(")[0] || "call";
  } else if (router) {
    action = "swap";
  }
  return { action, router };
}

export async function GET(request: NextRequest) {
  const sp      = request.nextUrl.searchParams;
  const walletsParam = sp.get("wallets");
  const hours   = Math.min(Number(sp.get("hours") ?? "24"), 168);
  const onlySwaps = sp.get("onlySwaps") !== "false";

  // No fabricated default wallets — the copy-trader must supply real tracked
  // wallets (via its typeConfig.wallets). Without them there is nothing real to watch.
  const wallets = (walletsParam
    ? walletsParam.split(",").map(w => w.trim()).filter(w => /^0x[a-fA-F0-9]{40}$/.test(w))
    : []
  ).slice(0, 10);  // cap to protect rate limits

  if (wallets.length === 0) {
    return NextResponse.json({
      trades: [], wallets: [], convergence: [],
      error: "no wallets configured — pass ?wallets=0x.. (copy-trader requires real tracked wallets)",
    });
  }

  const apiKey  = process.env.BASESCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? "";
  const sinceTs = Date.now() - hours * 60 * 60 * 1000;

  const perWallet = await Promise.all(
    wallets.map(async w => {
      const txs = await fetchWalletTxs(w, apiKey, sinceTs);
      return txs
        .filter(tx => tx.isError !== "1")
        .map<WhaleTrade>(tx => {
          const { action, router } = classify(tx);
          const ts = Number(tx.timeStamp) * 1000;
          return {
            wallet:      w,
            hash:        tx.hash,
            to:          tx.to,
            router,
            action,
            symbol:      tx.tokenSymbol,
            timestamp:   ts,
            ageMinutes:  Math.round((Date.now() - ts) / 60000),
            basescanUrl: `https://basescan.org/tx/${tx.hash}`,
          };
        });
    }),
  );

  let trades = perWallet.flat().sort((a, b) => b.timestamp - a.timestamp);
  if (onlySwaps) trades = trades.filter(t => t.action === "swap" || !!t.router);

  // Convergence detection: routers/tokens hit by multiple distinct wallets recently.
  const byTarget = new Map<string, Set<string>>();
  for (const t of trades) {
    const key = t.symbol ?? t.to;
    if (!byTarget.has(key)) byTarget.set(key, new Set());
    byTarget.get(key)!.add(t.wallet);
  }
  const convergence = [...byTarget.entries()]
    .filter(([, ws]) => ws.size >= 2)
    .map(([target, ws]) => ({ target, walletCount: ws.size }))
    .sort((a, b) => b.walletCount - a.walletCount);

  return NextResponse.json({
    trades:      trades.slice(0, 40),
    wallets,
    convergence,
    hours,
    source:      "basescan",
    hasApiKey:   !!apiKey,
    fetchedAt:   Date.now(),
  });
}
