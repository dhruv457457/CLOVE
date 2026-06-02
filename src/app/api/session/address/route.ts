import { NextResponse } from "next/server";

/**
 * Returns the address users must grant ERC-7715 permissions TO.
 *
 * PRIMARY path: 1Shot Public Relayer targetAddress.
 * Users grant to this address so the relayer can execute DeFi actions
 * on their behalf. Gas is paid in USDC — no ETH, no billing needed.
 *
 * The targetAddress is stable on Base mainnet (from relayer_getCapabilities).
 * We return NEXT_PUBLIC_CLOVE_SESSION_ADDRESS which is set to this value in .env.
 */
export async function GET() {
  const address = process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS;

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_CLOVE_SESSION_ADDRESS not set or invalid" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    address,
    source:  "1shot-public-relayer",
    note:    "Grant ERC-7715 permission to this address. Gas is paid in USDC via the 1Shot Public Relayer.",
    relayer: "https://relayer.1shotapi.com/relayers",
  });
}
