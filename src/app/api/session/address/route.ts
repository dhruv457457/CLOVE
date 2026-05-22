import { NextResponse } from "next/server";
import { getAgentWalletAddress } from "@/lib/oneshot/agentWallet";
import { getSessionAddress } from "@/lib/web3/serverSession";

/**
 * Returns the CLOVE agent session account address.
 * Uses the 1Shot server wallet if configured, falls back to the
 * local private-key-derived smart account for development.
 */
export async function GET() {
  // Prefer 1Shot server wallet (production)
  if (process.env.ONESHOT_WALLET_ID && process.env.ONESHOT_API_KEY) {
    try {
      const address = await getAgentWalletAddress();
      return NextResponse.json({ address, source: "1shot" });
    } catch (e) {
      console.warn("[session/address] 1Shot lookup failed, falling back:", e);
    }
  }

  // Fallback: local private key → MetaMask smart account
  try {
    const address = await getSessionAddress();
    return NextResponse.json({ address, source: "local" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to get session address" },
      { status: 500 }
    );
  }
}
