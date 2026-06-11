import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbi, parseAbiItem, formatUnits } from "viem";
import { base } from "viem/chains";

/**
 * GET /api/whale/activity?wallets=0xabc,0xdef&hours=2
 *
 * Reads a wallet's recent token ACQUISITIONS directly from Base via RPC — the
 * ERC-20 Transfer logs where `to == wallet` (i.e. tokens the wallet just bought
 * /received from a swap). 100% Base-native: no Basescan, no Etherscan V2 (whose
 * free tier doesn't cover Base — the old bug that made this endpoint return
 * empty). Works for ANY address: discovered whales OR a friend's wallet.
 *
 * Returns each acquisition WITH the token amount, so callers can apply copy
 * conditions ("only copy buys ≥ X tokens") and proportional sizing.
 */

const RPC = process.env.BASE_RPC ?? "https://mainnet.base.org";
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ERC20_META = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// Stables / quote assets — receiving these is usually a SALE, not a "buy signal".
const QUOTE_TOKENS = new Set([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // USDT
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI
].map(a => a.toLowerCase()));

export interface WhaleTrade {
  wallet:     string;
  token:      string;     // token contract acquired
  symbol:     string;
  amount:     string;     // human-readable amount acquired
  amountNum:  number;
  from:       string;     // who sent it (usually a router/pool)
  txHash:     string;
  timestamp:  number;
  ageMinutes: number;
  basescanUrl: string;
}

const metaCache = new Map<string, { symbol: string; decimals: number }>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tokenMeta(pub: any, token: `0x${string}`) {
  const k = token.toLowerCase();
  if (metaCache.has(k)) return metaCache.get(k)!;
  let symbol = "?", decimals = 18;
  try { symbol   = await pub.readContract({ address: token, abi: ERC20_META, functionName: "symbol" }) as string; } catch { /* */ }
  try { decimals = await pub.readContract({ address: token, abi: ERC20_META, functionName: "decimals" }) as number; } catch { /* */ }
  const m = { symbol, decimals };
  metaCache.set(k, m);
  return m;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const wallets = (sp.get("wallets") ?? "")
    .split(",").map(w => w.trim().toLowerCase()).filter(w => /^0x[a-f0-9]{40}$/.test(w))
    .slice(0, 5);
  const hours = Math.min(Math.max(Number(sp.get("hours") ?? "2"), 0.25), 6);

  if (wallets.length === 0) {
    return NextResponse.json({ trades: [], wallets: [], convergence: [], error: "no wallets — pass ?wallets=0x.." });
  }

  const pub = createPublicClient({ chain: base, transport: http(RPC) });
  const latest = await pub.getBlockNumber();
  // Base ≈ 2s blocks. Bound the range for public-RPC reliability (~3h max).
  const span = BigInt(Math.min(Math.round(hours * 1800), 10000));
  const fromBlock = latest > span ? latest - span : 0n;
  const now = Date.now();
  // Approximate per-block timestamp (avoids one getBlock per log).
  const blockMs = (n: bigint) => now - Number(latest - n) * 2000;

  type XferLog = { address: string; args: { from?: string; to?: string; value?: bigint }; blockNumber?: bigint; transactionHash?: string };
  const perWallet = await Promise.all(wallets.map(async (w) => {
    let logs: XferLog[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logs = await (pub as any).getLogs({
        fromBlock, toBlock: latest,
        event: TRANSFER_EVENT,
        args: { to: w as `0x${string}` },          // tokens the wallet RECEIVED (bought)
      }) as XferLog[];
    } catch { return [] as WhaleTrade[]; }

    const out: WhaleTrade[] = [];
    for (const log of logs.slice(-40)) {   // newest-ish
      const token = log.address.toLowerCase();
      if (QUOTE_TOKENS.has(token)) continue;          // skip stablecoin inflows (sales)
      const m = await tokenMeta(pub, log.address as `0x${string}`);
      let amountNum = 0;
      try { amountNum = Number(formatUnits(log.args.value ?? 0n, m.decimals)); } catch { /* */ }
      if (amountNum <= 0) continue;
      const ts = blockMs(log.blockNumber ?? latest);
      out.push({
        wallet: w, token, symbol: m.symbol,
        amount: amountNum.toLocaleString(undefined, { maximumFractionDigits: 4 }),
        amountNum,
        from: (log.args.from ?? "").toLowerCase(),
        txHash: log.transactionHash ?? "",
        timestamp: ts,
        ageMinutes: Math.round((now - ts) / 60000),
        basescanUrl: `https://basescan.org/tx/${log.transactionHash}`,
      });
    }
    return out;
  }));

  const trades = perWallet.flat().sort((a, b) => b.timestamp - a.timestamp);

  // Convergence — a token acquired by 2+ tracked wallets in the window.
  const byToken = new Map<string, { symbol: string; wallets: Set<string>; totalAmount: number }>();
  for (const t of trades) {
    const e = byToken.get(t.token) ?? { symbol: t.symbol, wallets: new Set(), totalAmount: 0 };
    e.wallets.add(t.wallet); e.totalAmount += t.amountNum;
    byToken.set(t.token, e);
  }
  const convergence = [...byToken.entries()]
    .filter(([, e]) => e.wallets.size >= 2)
    .map(([token, e]) => ({ target: e.symbol, token, walletCount: e.wallets.size, totalAmount: e.totalAmount }))
    .sort((a, b) => b.walletCount - a.walletCount);

  return NextResponse.json({
    trades: trades.slice(0, 40),
    wallets, convergence,
    hours,
    source: "base-rpc",
    fetchedAt: now,
  });
}
