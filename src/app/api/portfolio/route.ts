import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, formatUnits, parseAbi, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { getPositions, getLastRuns } from "@/lib/agent/memory";
import { listAgentsForWallet } from "@/lib/agent/agents";
import { getAgentStats } from "@/lib/agent/stats";
import { getTokenPricesUsd } from "@/lib/prices/dexscreener";
import { getUserProtocolBalance } from "@/lib/web3/cloveAutoDeposit";

/**
 * GET /api/portfolio?wallet=0x...
 *
 * One aggregated payload for the Portfolio dashboard:
 *  - holdings  : live on-chain token balances × DexScreener price
 *  - positions : capital deployed per protocol (agent_positions)
 *  - runs      : tx feed / full history (agent_runs)
 *  - agents    : per-agent activity + spend (active vs idle)
 *  - spend     : x402 (intel/tts/image) + 1Shot relayer fees + deployed capital
 *  - pnl       : total value, deployed, estimated unrealized P/L
 */

// Curated Base token set we value in the wallet. { symbol, address, decimals }.
const TOKENS: { symbol: string; address: `0x${string}`; decimals: number; stable?: boolean }[] = [
  { symbol: "USDC",   address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  stable: true },
  { symbol: "aUSDC",  address: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB", decimals: 6,  stable: true },
  { symbol: "USDT",   address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6,  stable: true },
  { symbol: "DAI",    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, stable: true },
  { symbol: "WETH",   address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  { symbol: "cbBTC",  address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8  },
  { symbol: "cbETH",  address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18 },
  { symbol: "AERO",   address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
  { symbol: "DEGEN",  address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", decimals: 18 },
  { symbol: "BRETT",  address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", decimals: 18 },
  { symbol: "HIGHER", address: "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe", decimals: 18 },
];

const ERC20 = [{
  name: "balanceOf", type: "function", stateMutability: "view",
  inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }],
}] as const;
const ERC20_META = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

// Approx 1Shot public-relayer fee per executed tx (USDC) — seen in execution logs.
const ONESHOT_FEE_USDC = 0.012;

/**
 * PART A — discover tokens the wallet ACTUALLY received (copy-trade buys etc.),
 * not just a hardcoded list. Reads recent inbound ERC-20 Transfer logs (to ==
 * wallet) and returns the token contracts, with symbol + decimals. This is what
 * makes a VVV/cbBTC copy show up in the portfolio instead of $0.
 */
async function discoverHeldTokens(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pub: any,
  wallet: `0x${string}`,
  knownLower: Set<string>,
): Promise<{ symbol: string; address: `0x${string}`; decimals: number }[]> {
  try {
    const latest = await pub.getBlockNumber();
    // Public Base RPCs cap getLogs ranges (~10k blocks). Match the proven bound
    // from /api/whale/activity so this actually returns instead of erroring →
    // [] (which would silently hide discovered tokens). ~10k blocks ≈ 5-6h; older
    // copy positions are still covered by the curated list + run-derived positions.
    const span = 9_000n;
    const from = latest > span ? latest - span : 0n;
    const logs = await pub.getLogs({ fromBlock: from, toBlock: latest, event: TRANSFER_EVENT, args: { to: wallet } }) as Array<{ address: string }>;
    const tokens = [...new Set(logs.map(l => l.address.toLowerCase()))].filter(a => !knownLower.has(a)).slice(0, 20);
    const out: { symbol: string; address: `0x${string}`; decimals: number }[] = [];
    for (const addr of tokens) {
      let symbol = "TOKEN", decimals = 18;
      try { symbol   = await pub.readContract({ address: addr, abi: ERC20_META, functionName: "symbol" })   as string; } catch { /* */ }
      try { decimals = await pub.readContract({ address: addr, abi: ERC20_META, functionName: "decimals" }) as number; } catch { /* */ }
      out.push({ symbol, address: addr as `0x${string}`, decimals });
    }
    return out;
  } catch { return []; }
}

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet param required" }, { status: 400 });

  const rpc = process.env.BASE_RPC ?? "https://mainnet.base.org";
  const pub = createPublicClient({ chain: base, transport: http(rpc) });

  // ── 1. Token universe = curated list + tokens the wallet actually received ──
  // (Part A) Discovery makes copy-trade buys (VVV, cbBTC, …) show up instead of $0.
  const known = new Set(TOKENS.map(t => t.address.toLowerCase()));
  const discovered = await discoverHeldTokens(pub, wallet as `0x${string}`, known);
  const universe: { symbol: string; address: `0x${string}`; decimals: number; stable?: boolean }[] =
    [...TOKENS, ...discovered];

  // ── On-chain balances (parallel) ────────────────────────────────────────────
  const rawBalances = await Promise.all(
    universe.map(async (t) => {
      try {
        const bal = await pub.readContract({
          address: t.address, abi: ERC20, functionName: "balanceOf", args: [wallet as `0x${string}`],
        });
        return Number(formatUnits(bal as bigint, t.decimals));
      } catch { return 0; }
    }),
  );

  // ── 2. Prices for non-stable tokens (stables pinned to $1) ──────────────────
  const priced = await getTokenPricesUsd(universe.filter(t => !t.stable).map(t => t.address));
  const holdings = universe.map((t, i) => {
    const balance = rawBalances[i];
    const price = t.stable ? 1 : (priced[t.address.toLowerCase()] ?? 0);
    return {
      symbol: t.symbol, address: t.address, balance,
      priceUsd: price, valueUsd: balance * price,
    };
  }).filter(h => h.balance > 0);

  const totalValueUsd = holdings.reduce((s, h) => s + h.valueUsd, 0);
  const idleUsdcUsd   = holdings.find(h => h.symbol === "USDC")?.valueUsd ?? 0;

  // ── 3. Positions / runs / agents (reuse existing helpers) ───────────────────
  const [positions, runs, agents] = await Promise.all([
    getPositions(wallet),
    getLastRuns(wallet, 20),
    listAgentsForWallet(wallet),
  ]);

  // Prefer recorded positions; if none, derive deployed capital from the tx
  // history (executed deposits/swaps) so the dashboard still reflects real activity.
  let effectivePositions = positions;
  if (effectivePositions.length === 0 && runs.length > 0) {
    const byProto = new Map<string, { amount: number; apy: number; n: number }>();
    for (const r of runs) {
      if (!r.success || r.action === "hold") continue;
      const amt = Number.parseFloat(r.amount) || 0;
      if (amt <= 0) continue;
      const cur = byProto.get(r.protocol) ?? { amount: 0, apy: 0, n: 0 };
      cur.amount += amt; cur.apy += r.apy || 0; cur.n += 1;
      byProto.set(r.protocol, cur);
    }
    effectivePositions = [...byProto.entries()].map(([protocol, v]) => ({
      walletAddress: wallet, protocol, amount: String(v.amount),
      entryApy: v.n ? +(v.apy / v.n).toFixed(2) : 0,
      entryTimestamp: new Date(), updatedAt: new Date(),
    }));
  }
  const deployedUsd = effectivePositions.reduce((s, p) => s + (Number.parseFloat(p.amount) || 0), 0);

  // ── PART B: AUDITOR — claimed (DB) vs actual (on-chain) ─────────────────────
  // For lending positions (morpho/aave) read the REAL withdrawable balance from
  // the vault and compare to what the run history claims. Catches a silently
  // failed deposit, an over-report, or a hallucinated run — every number on the
  // dashboard becomes provable, not "the agent said so".
  const audit = await Promise.all(
    effectivePositions
      .filter(p => /morpho|aave/i.test(p.protocol))
      .map(async (p) => {
        const proto = p.protocol.toLowerCase().includes("aave") ? "aave" : "morpho";
        let actualUsdc = 0;
        try {
          const atoms = await getUserProtocolBalance(wallet as `0x${string}`, proto);
          actualUsdc = Number(atoms) / 1e6;
        } catch { /* read failed — leave 0 */ }
        const claimedUsdc = Number.parseFloat(p.amount) || 0;
        const drift = +(actualUsdc - claimedUsdc).toFixed(4);
        return {
          protocol: p.protocol,
          claimedUsdc: +claimedUsdc.toFixed(4),
          actualUsdc:  +actualUsdc.toFixed(4),
          drift,
          // Allow a tiny tolerance for yield accrual / rounding; flag real gaps.
          ok: Math.abs(drift) <= Math.max(0.01, claimedUsdc * 0.05),
        };
      }),
  );
  // Estimated unrealized P/L: value of everything that isn't idle USDC, vs the
  // capital deployed into it. Approximate (no per-token cost basis stored), labelled as such.
  const estPnlUsd = (totalValueUsd - idleUsdcUsd) - deployedUsd;

  // ── 4. Per-agent stats + active/idle ────────────────────────────────────────
  const agentCards = await Promise.all(agents.map(async (a) => {
    const stats = await getAgentStats(a.id);
    const active = a.status !== "idle" || !!a.scheduleIntervalMs;
    return {
      id: a.id, name: a.name, agentType: a.agentType ?? "yield",
      status: a.status, active,
      scheduleIntervalMs: a.scheduleIntervalMs ?? null,
      totalRuns: a.totalRuns, totalExecuted: a.totalExecuted,
      lastAction: a.lastAction, lastRunAt: a.lastRunAt,
      budgetUsdc: a.budgetUsdc, budgetUsedUsdc: a.budgetUsedUsdc,
      x402: stats?.breakdown.x402 ?? { intel: 0, tts: 0, image: 0 },
      x402Total: stats?.totalX402SpentUsdc ?? 0,
      workflowId: a.workflowId ?? null,
      // For the Fleet + Delegation tabs:
      parentAgentId:    a.parentAgentId ?? null,
      delegationStatus: a.delegationStatus ?? "none",
      delegationCap:    a.delegationCap ?? null,
      onChainAddress:   a.onChainAddress ?? null,
    };
  }));

  // ── 5. Spend totals ─────────────────────────────────────────────────────────
  const x402Intel = agentCards.reduce((s, a) => s + a.x402.intel, 0);
  const x402Tts   = agentCards.reduce((s, a) => s + a.x402.tts, 0);
  const x402Image = agentCards.reduce((s, a) => s + a.x402.image, 0);
  const x402Total = x402Intel + x402Tts + x402Image;
  const totalExecuted = agentCards.reduce((s, a) => s + a.totalExecuted, 0);
  const oneShotFees = +(totalExecuted * ONESHOT_FEE_USDC).toFixed(4);
  const spend = {
    x402Intel, x402Tts, x402Image, x402Total,
    oneShotFees, deployedUsd,
    total: +(x402Total + oneShotFees).toFixed(4),
  };

  // ── 6. Neutral performance ranking (NO success-rate) ────────────────────────
  const performance = [...agentCards]
    .map(a => ({
      id: a.id, name: a.name, agentType: a.agentType,
      executed: a.totalExecuted, runs: a.totalRuns,
      deployedUsd: Number.parseFloat(a.budgetUsedUsdc as unknown as string) || 0,
      spentUsd: a.x402Total,
    }))
    .sort((x, y) => y.executed - x.executed || y.deployedUsd - x.deployedUsd);

  return NextResponse.json({
    wallet,
    holdings,
    totalValueUsd: +totalValueUsd.toFixed(2),
    positions: effectivePositions,
    deployedUsd: +deployedUsd.toFixed(2),
    estPnlUsd: +estPnlUsd.toFixed(2),
    runs,
    agents: agentCards,
    spend,
    performance,
    audit,                          // Part B: claimed-vs-on-chain per lending position
    fetchedAt: Date.now(),
  });
}
