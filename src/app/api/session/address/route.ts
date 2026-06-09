import { NextRequest, NextResponse } from "next/server";

/**
 * Returns the address users must grant ERC-7715 permissions TO.
 *
 * Two modes:
 *
 *   DEFAULT (?role=relayer) — the 1Shot Public Relayer targetAddress.
 *     The working, single-hop flow: user grants directly to the relayer, the
 *     relayer redeems [fee + work] in one bundle. Gas paid in USDC, no ETH.
 *     Returned from NEXT_PUBLIC_CLOVE_SESSION_ADDRESS.
 *
 *   ?role=fund-manager — CLOVE's REAL session smart account (owned by
 *     CLOVE_SESSION_KEY). This is the delegator for the A2A rewire: the user
 *     grants to the Fund Manager, which redelegates scoped, capped slices down
 *     to each worker (user → session → worker → relayer). Per-worker caps are
 *     then enforced ON-CHAIN by ERC20TransferAmountEnforcer — overspend reverts.
 *     Computed server-side from the session key via getSessionAddress().
 */
export async function GET(req: NextRequest) {
  const role = req.nextUrl.searchParams.get("role") ?? "relayer";

  if (role === "fund-manager") {
    try {
      // The Fund Manager grant must be issued to the session EOA — that EOA is
      // the delegator that signs the scoped redelegation to each worker, so the
      // grant delegate and the redelegation signer must be the same address.
      const { getSessionEoaAddress } = await import("@/lib/web3/serverSession");
      const address = getSessionEoaAddress();
      return NextResponse.json({
        address,
        source: "clove-fund-manager",
        note:   "Grant ERC-7715 to CLOVE's Fund Manager. It redelegates scoped, on-chain-capped budgets to each worker agent.",
      });
    } catch (e) {
      return NextResponse.json(
        { error: `Could not derive Fund Manager address: ${e instanceof Error ? e.message : e}` },
        { status: 500 },
      );
    }
  }

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
