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

  const apiKey      = process.env.POLYMARKET_API_KEY;
  const apiSecret   = process.env.POLYMARKET_API_SECRET;
  const apiPassphrase = process.env.POLYMARKET_PASSPHRASE;   // CLOB needs the full key/secret/passphrase trio
  const builderCode = process.env.POLYMARKET_BUILDER_CODE;   // optional fee-attribution
  const walletId    = process.env.ONESHOT_POLYGON_WALLET_ID ?? process.env.ONESHOT_WALLET_ID;

  const hasRealPerm =
    !!body.permissionsContext &&
    body.permissionsContext.length > 40 &&
    !body.permissionsContext.includes("demo") &&
    body.permissionsContext.startsWith("0x");

  const canExecuteLive = !!(apiKey && apiSecret && apiPassphrase && walletId && hasRealPerm && body.clobTokenId);

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
      const recipient = (process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? "0x") as `0x${string}`;
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

  // Only attempt the (legacy, often-unavailable) 1Shot CLOB path if the real
  // redemption above didn't already execute — never downgrade a good tx.
  if (canExecuteLive && status !== "submitted") {
    try {
      // 1Shot signs the CLOB order on Polygon under the user's delegation.
      // Polymarket's CLOB accepts EIP-712 signed orders; 1Shot produces the
      // signature scoped by the ERC-7710 caveat (max spend).
      const tokenRes = await fetch("https://api.1shotapi.com/v0/token", {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    new URLSearchParams({
          grant_type:    "client_credentials",
          client_id:     process.env.ONESHOT_API_KEY ?? "",
          client_secret: process.env.ONESHOT_API_SECRET ?? "",
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!tokenRes.ok) throw new Error(`1Shot token ${tokenRes.status}`);
      const { access_token } = await tokenRes.json() as { access_token: string };

      // Submit the order intent to Polymarket CLOB via 1Shot's Polygon wallet.
      const orderRes = await fetch(
        `https://api.1shotapi.com/v0/wallets/${walletId}/polymarket/order`,
        {
          method:  "POST",
          headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
          body:    JSON.stringify({
            tokenID:              body.clobTokenId,
            price:                body.price,
            size:                 body.sizeUsdc,
            side:                 "BUY",
            delegationData:       body.permissionsContext,
            polymarketApiKey:     apiKey,
            polymarketSecret:     apiSecret,
            polymarketPassphrase: apiPassphrase,
            ...(builderCode ? { builderCode } : {}),
          }),
          signal: AbortSignal.timeout(20000),
        }
      );
      if (!orderRes.ok) throw new Error(`CLOB order ${orderRes.status}: ${await orderRes.text()}`);
      const order = await orderRes.json() as { txHash?: string; orderId?: string };
      txHash = order.txHash;
      status = "submitted";
      via    = "1shot-polygon";
    } catch (e) {
      error  = e instanceof Error ? e.message : String(e);
      status = "prepared";  // fall back to recording intent
      via    = "prepared-fallback";
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
