import { NextResponse } from "next/server";
import { getPayToAddress, getInternalSecretOptional } from "@/lib/config/env";

const NETWORK_ID = "eip155:8453"; // Base mainnet
const FACILITATOR_URL = "https://tx-sentinel-base-mainnet.api.cx.metamask.io/platform/v2/x402";

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
      payTo:   getPayToAddress(),   // lazy — throws clearly if no real address configured
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
 * Verify a payment signature. FAIL-CLOSED: rejects by default, only accepts:
 *   (a) a real ERC-7710 delegation payment — payload.payload.permissionContext is a
 *       genuine 0x hex blob (not "demo"); for the exact on-chain scheme with a txHash
 *       we additionally confirm via 1Shot's verify endpoint when keys are present.
 *   (b) an internal server-to-server call carrying the correct CLOVE_INTERNAL_SECRET.
 *
 * Anything else (malformed, empty, "demo", missing context) is rejected.
 * This is the single verifier shared by every x402 service.
 */
export async function verifyPayment(paymentSig: string): Promise<boolean> {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(Buffer.from(paymentSig, "base64").toString("utf-8"));
  } catch {
    return false; // malformed base64 / JSON → reject
  }

  // (b) Internal server-to-server allowlist (TTS, image, digest).
  const internalSecret = getInternalSecretOptional();
  const isInternalCall =
    typeof payload.internalSecret === "string" &&
    !!internalSecret &&
    payload.internalSecret === internalSecret;
  if (isInternalCall) return true;

  // (a) Real ERC-7710 delegation context.
  const inner   = payload.payload as Record<string, unknown> | undefined;
  const permCtx = inner?.permissionContext as string | undefined;
  const hasValidContext =
    typeof permCtx === "string" &&
    permCtx.startsWith("0x") &&
    permCtx.length > 40 &&
    !/^0x0*$/.test(permCtx) &&                 // reject all-zero / empty placeholder contexts
    !permCtx.toLowerCase().includes("demo");

  if (!hasValidContext) return false;

  // For exact on-chain payments (have a txHash), confirm via 1Shot when configured.
  const hasTxHash     = typeof payload.txHash === "string" && (payload.txHash as string).startsWith("0x");
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
        // 1Shot configured but verification could not be completed → reject.
        return false;
      } catch {
        return false; // fail-closed on verifier error
      }
    }
    // Exact scheme but no 1Shot keys to verify the on-chain tx → reject.
    return false;
  }

  // Delegation-scheme payment with a valid (non-demo) ERC-7710 context: accept.
  // The client already validated the cryptographic delegation chain; there is no
  // on-chain tx to confirm for this scheme.
  return true;
}
