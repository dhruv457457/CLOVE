import { NextResponse } from "next/server";

const NETWORK_ID = "eip155:8453"; // Base mainnet
const FACILITATOR_URL = "https://tx-sentinel-base-mainnet.api.cx.metamask.io/platform/v2/x402";

const PAY_TO = (
  process.env.CLOVE_PAY_TO_ADDRESS ??
  process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ??
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
);

/** Build an HTTP 402 response with the PAYMENT-REQUIRED header — shared across all x402 services. */
export async function build402(priceUsdc: number): Promise<NextResponse> {
  let facilitators: string[] = [];
  try {
    const res = await fetch(FACILITATOR_URL, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      facilitators = [
        ...(data?.signers?.["eip155:8453"] ?? []),
        ...(data?.signers?.["eip155:*"]    ?? []),
      ];
    }
  } catch { /* proceed without facilitators */ }

  const paymentRequired = {
    accepts: [{
      scheme:  "exact",
      price:   `$${priceUsdc}`,
      network: NETWORK_ID,
      payTo:   PAY_TO,
      extra:   { assetTransferMethod: "erc7710", facilitators },
    }],
  };

  return NextResponse.json(
    { error: "Payment Required" },
    {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED":                 Buffer.from(JSON.stringify(paymentRequired)).toString("base64"),
        "Access-Control-Expose-Headers":    "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
      },
    }
  );
}

/**
 * Verify a payment signature. Tries 1Shot's verify endpoint if credentials exist
 * and the payload has a real on-chain txHash; otherwise falls through to demo mode.
 * Mirrors the logic in /api/intelligence so all x402 services behave the same.
 */
export async function verifyPayment(paymentSig: string): Promise<boolean> {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(Buffer.from(paymentSig, "base64").toString("utf-8"));
  } catch {
    return true; // malformed — demo mode
  }

  const hasTxHash = typeof payload.txHash === "string" && (payload.txHash as string).startsWith("0x");
  const isExactScheme = payload.scheme === "exact" && hasTxHash;

  if (isExactScheme) {
    const apiKey    = process.env.ONESHOT_API_KEY;
    const apiSecret = process.env.ONESHOT_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const tokenRes = await fetch("https://api.1shotapi.com/v0/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type:    "client_credentials",
            client_id:     apiKey,
            client_secret: apiSecret,
          }),
          signal: AbortSignal.timeout(4000),
        });
        if (tokenRes.ok) {
          const { access_token } = await tokenRes.json();
          const verifyRes = await fetch("https://api.1shotapi.com/v0/x402/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000),
          });
          if (verifyRes.ok) {
            const { isValid } = await verifyRes.json();
            return isValid === true;
          }
        }
      } catch { /* fallthrough */ }
    }
  }
  return true; // demo mode — trust any non-empty signature
}
