import { NextRequest, NextResponse } from "next/server";
import { storeDelegation } from "@/lib/oneshot/agentWallet";

interface StoreRequest {
  permissionsContext: string;
  expiresAt: number;
}

/**
 * Stores a user's ERC-7715 permission context in 1Shot API so CLOVE can
 * redelegate it for x402 payments without re-signing.
 */
export async function POST(request: NextRequest) {
  if (!process.env.ONESHOT_API_KEY || !process.env.ONESHOT_WALLET_ID) {
    return NextResponse.json(
      { error: "1Shot not configured — delegation not stored" },
      { status: 503 }
    );
  }

  let body: StoreRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!body.permissionsContext || !body.expiresAt) {
    return NextResponse.json({ error: "Missing permissionsContext or expiresAt" }, { status: 400 });
  }

  try {
    const delegationId = await storeDelegation(body.permissionsContext, body.expiresAt);
    return NextResponse.json({ delegationId, stored: true });
  } catch (e) {
    // Non-fatal — permission is already saved locally in the browser.
    // Return 200 so the client doesn't log a network error.
    console.warn("[store-delegation] 1Shot storage failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ stored: false, reason: e instanceof Error ? e.message : "1Shot store failed" });
  }
}
