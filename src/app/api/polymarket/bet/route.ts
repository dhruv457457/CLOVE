import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/mongodb";

/**
 * POST /api/polymarket/bet
 * {
 *   agentId, walletAddress,
 *   marketId, conditionId, clobTokenId,
 *   outcome, price, sizeUsdc, reasoning,
 *   permissionsContext?, delegationManager?   // Polygon ERC-7710 authorization
 * }
 *
 * Places a bet on Polymarket. Polymarket settles on Polygon, so execution goes
 * through the Polygon-side delegation (separate from the Base permission).
 *
 * Two modes:
 *   - LIVE:  POLYMARKET_API_KEY set → builds a CLOB order via 1Shot on Polygon
 *   - PREPARED: no key / no real Polygon permission → records an intent only
 *
 * Either way the bet is persisted to `polymarket_bets` so the agent can track
 * open positions across runs.
 */

interface BetBody {
  agentId?:            string;
  walletAddress?:      string;
  marketId:            string;
  conditionId?:        string;
  clobTokenId?:        string;
  outcome:             string;   // "Yes" / "No" / candidate name
  price:               number;   // implied price at order time (0–1)
  sizeUsdc:            number;
  reasoning?:          string;
  permissionsContext?: string;   // Polygon delegation context
  delegationManager?:  string;
}

export interface PolymarketBet {
  id:           string;
  agentId?:     string;
  walletAddress?: string;
  marketId:     string;
  conditionId?: string;
  clobTokenId?: string;
  outcome:      string;
  price:        number;
  sizeUsdc:     number;
  reasoning?:   string;
  status:       "prepared" | "submitted" | "open" | "settled" | "failed";
  via:          string;        // "1shot-polygon" | "prepared"
  txHash?:      string;
  chainId:      number;        // 137 Polygon
  createdAt:    Date;
}

export async function POST(request: NextRequest) {
  let body: BetBody;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!body.marketId || !body.outcome || !body.sizeUsdc) {
    return NextResponse.json({ error: "marketId, outcome, sizeUsdc required" }, { status: 400 });
  }

  const hasRealPerm =
    !!body.permissionsContext &&
    body.permissionsContext.length > 40 &&
    !body.permissionsContext.includes("demo") &&
    body.permissionsContext.startsWith("0x");

  let status: PolymarketBet["status"] = "prepared";
  let via    = "prepared";
  let txHash: string | undefined;
  let error: string | undefined;

  // ── REAL ERC-7710 redemption on Polygon via the 1Shot PUBLIC RELAYER ────────
  // Permissionless, gas paid in USDC from the delegation (no extra gas key, no
  // MATIC). The agent autonomously pulls the user's granted USDC — within the
  // cap, with NO per-bet approval — to the trading wallet that places the bet.
  // This is the same proven path the Base deposits use, extended to Polygon.
  if (hasRealPerm) {
    try {
      const { executeViaPublicRelayer } = await import("@/lib/oneshot/publicRelayer");
      // Collateral must land with the trader that signs the CLOB order, so it
      // can fund the bet. Fall back to the relayer/session address if no key.
      let recipient = (process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? "0x") as `0x${string}`;
      try {
        const { getPolymarketTraderAddress } = await import("@/lib/polymarket/clob");
        recipient = getPolymarketTraderAddress();
      } catch { /* no trader key — keep fallback */ }
      const r = await executeViaPublicRelayer({
        userPermissionsContext: body.permissionsContext!,
        recipient,
        workAmountUsdc:         body.sizeUsdc,
        chainId:                137,                    // Polygon
        memo:                   `Polymarket bet: ${body.outcome} on ${body.marketId}`,
      });
      if (r.status === "confirmed" || r.status === "submitted") {
        txHash = r.txHash;
        via    = r.via;          // "1shot-public-relayer"
        status = "submitted";    // collateral moved to the trading wallet
      } else {
        error = r.error ?? "relayer execution failed";
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      console.warn("[polymarket/bet] Polygon relayer execution failed:", error);
    }
  }

  // ── REAL CLOB order via @polymarket/clob-client ────────────────────────────
  // Once collateral is in the trading account, sign + post the actual order to
  // Polymarket's order book. We attempt this whenever we have a token id and a
  // trader key — independent of the relayer move (the move funds it; the CLOB
  // order is the bet itself). A geo-block surfaces as a clear error.
  const traderKeyPresent = !!(process.env.POLYMARKET_PK || process.env.CLOVE_SESSION_KEY);
  if (body.clobTokenId && traderKeyPresent) {
    try {
      const { placeClobOrder } = await import("@/lib/polymarket/clob");
      const order = await placeClobOrder({
        tokenID: body.clobTokenId,
        price:   body.price,
        size:    body.sizeUsdc,
        side:    "BUY",
        type:    "limit",
      });
      if (order.success) {
        status = "open";                 // order resting / matched on the book
        via    = "polymarket-clob";
        txHash = order.txHashes?.[0] ?? txHash;
        error  = undefined;
      } else {
        // Collateral may have moved (status "submitted") but the order didn't
        // rest — keep the truthful state and report why (e.g. geo block).
        error = order.error ?? "CLOB order was not accepted";
        if (status !== "submitted") { status = "prepared"; via = "prepared-fallback"; }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if (status !== "submitted") { status = "prepared"; via = "prepared-fallback"; }
    }
  }

  const bet: PolymarketBet = {
    id:            `bet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    agentId:       body.agentId,
    walletAddress: body.walletAddress,
    marketId:      body.marketId,
    conditionId:   body.conditionId,
    clobTokenId:   body.clobTokenId,
    outcome:       body.outcome,
    price:         body.price,
    sizeUsdc:      body.sizeUsdc,
    reasoning:     body.reasoning,
    status,
    via,
    txHash,
    chainId:       137,
    createdAt:     new Date(),
  };

  try {
    const db = await getDb();
    if (db) await db.collection<PolymarketBet>("polymarket_bets").insertOne(bet);
  } catch { /* non-fatal — still return the bet */ }

  return NextResponse.json({ bet, prepared: status === "prepared", submitted: status === "submitted", txHash, via, error });
}

/** GET /api/polymarket/bet?agentId=... → open bets for an agent */
export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agentId");
  const wallet  = request.nextUrl.searchParams.get("wallet");
  const db = await getDb();
  if (!db) return NextResponse.json({ bets: [] });
  const query: Record<string, unknown> = {};
  if (agentId) query.agentId = agentId;
  if (wallet)  query.walletAddress = wallet;
  const bets = await db.collection<PolymarketBet>("polymarket_bets")
    .find(query).sort({ createdAt: -1 }).limit(50).toArray();
  return NextResponse.json({ bets });
}
