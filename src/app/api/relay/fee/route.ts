import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/relay/fee?action=morpho-vault-deposit&amount=50
 *
 * Returns a live USDC gas fee quote from the 1Shot Public Relayer.
 * Called by the dashboard before the user grants an ERC-7715 permission,
 * so they know exactly how much USDC to budget for gas on top of their
 * DeFi position size.
 *
 * The 1Shot Public Relayer sponsors ETH gas — users pay in USDC instead.
 * This fee is tiny (~$0.01–0.10 on Base L2) but must be disclosed upfront.
 */

const RELAYER_URL = "https://relayer.1shotapi.com/relayers";
const USDC_BASE   = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CHAIN  = "8453";

interface RelayerFeeResult {
  gasPrice:  string;
  rate:      string;
  minFee:    string;  // in USDC atoms (6 decimals)
  expiry:    number;
  context:   string;
}

// Simple in-memory cache — fee data is valid for ~45s (relayer's expiry window)
let feeCache: { data: RelayerFeeResult; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 30_000; // refresh every 30s

async function fetchFeeData(): Promise<RelayerFeeResult> {
  if (feeCache && Date.now() - feeCache.fetchedAt < CACHE_TTL_MS) {
    return feeCache.data;
  }
  const res = await fetch(RELAYER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "relayer_getFeeData",
      params: { chainId: BASE_CHAIN, token: USDC_BASE },
    }),
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json() as { result?: RelayerFeeResult; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  const data = json.result!;
  feeCache = { data, fetchedAt: Date.now() };
  return data;
}

export async function GET(request: NextRequest) {
  const sp     = request.nextUrl.searchParams;
  const amount = Number(sp.get("amount") ?? "50");  // DeFi position size

  try {
    const fee = await fetchFeeData();

    // minFee from relayer may be decimal string (e.g. "0.01") OR atom integer string.
    // Detect by presence of decimal point.
    const minFeeRaw  = fee.minFee ?? "0";
    const minFeeUsdc = minFeeRaw.includes(".")
      ? Number(minFeeRaw)                          // already in USDC
      : Number(minFeeRaw) / 1e6;                   // atoms → USDC

    // Charge the relayer's quoted minFee + 20% buffer, floored at 0.01 (not a flat 0.05).
    const chargedFeeUsdc = Math.max(minFeeUsdc * 1.2, 0.01);

    // Total the user needs: position + gas fee
    const totalNeeded = amount + chargedFeeUsdc;

    return NextResponse.json({
      // What the user pays in gas (USDC)
      gasFeUsdc:      chargedFeeUsdc,
      gasFeeAtoms:    String(Math.round(chargedFeeUsdc * 1e6)),

      // Minimum from relayer
      minFeeUsdc,

      // Current gas price on Base (in gwei)
      gasPriceGwei: (Number(BigInt(fee.gasPrice)) / 1e9).toFixed(4),

      // Total USDC user needs in their wallet
      totalNeededUsdc: totalNeeded,
      positionUsdc:    amount,

      // Quote validity
      expiresAt: fee.expiry,
      expiresInSec: Math.max(0, fee.expiry - Math.floor(Date.now() / 1000)),

      // Human-readable message for the UI
      message: `This agent will spend ~$${chargedFeeUsdc.toFixed(2)} USDC on gas (paid to the 1Shot relayer). Your wallet needs $${totalNeeded.toFixed(2)} USDC total: $${amount} for DeFi + $${chargedFeeUsdc.toFixed(2)} for gas.`,

      // Relayer details
      relayer: "1Shot Public Relayer",
      chain:   "Base mainnet (8453)",
      paidIn:  "USDC",
      note:    "No ETH needed. Gas is paid in USDC from your delegation budget.",

      fetchedAt: Date.now(),
    });
  } catch (e) {
    // If relayer is unreachable, return a safe estimate (matches the ~0.01 minFee)
    const fallbackFee = 0.02;
    return NextResponse.json({
      gasFeUsdc:       fallbackFee,
      gasFeeAtoms:     String(Math.round(fallbackFee * 1e6)),
      minFeeUsdc:      fallbackFee,
      totalNeededUsdc: amount + fallbackFee,
      positionUsdc:    amount,
      message:         `Estimated gas: ~$${fallbackFee.toFixed(2)} USDC. Your wallet needs ~$${(amount + fallbackFee).toFixed(2)} USDC total.`,
      relayer:         "1Shot Public Relayer",
      chain:           "Base mainnet (8453)",
      paidIn:          "USDC",
      note:            "No ETH needed. Gas is paid in USDC.",
      estimated:       true,
      error:           e instanceof Error ? e.message : String(e),
      fetchedAt:       Date.now(),
    });
  }
}
