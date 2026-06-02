import { NextRequest, NextResponse } from "next/server";

interface PayRequest {
  endpoint: string;
  permissionsContext: string;
  delegationManager: string;
  delegationId?: string;
}

async function attempt1ShotRedelegate(
  permissionsContext: string,
  facilitatorAddress: `0x${string}`,
): Promise<string | null> {
  const apiKey    = process.env.ONESHOT_API_KEY;
  const apiSecret = process.env.ONESHOT_API_SECRET;
  const walletId  = process.env.ONESHOT_WALLET_ID;
  if (!apiKey || !apiSecret || !walletId) return null;

  try {
    // Get access token
    const tokenRes = await fetch("https://api.1shotapi.com/v0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: apiKey,
        client_secret: apiSecret,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) {
      console.warn("[x402/pay] 1Shot token failed:", tokenRes.status, await tokenRes.text());
      return null;
    }
    const { access_token } = await tokenRes.json();

    // Redelegate
    const reRes = await fetch(
      `https://api.1shotapi.com/v0/wallets/${walletId}/redelegate-with-delegation-data`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          delegationData: permissionsContext,
          delegateAddress: facilitatorAddress,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!reRes.ok) {
      console.warn("[x402/pay] 1Shot redelegate failed:", reRes.status, await reRes.text());
      return null;
    }
    const result = await reRes.json();

    // Encode into hex permissionContext
    const chain = [JSON.parse(result.parent), JSON.parse(result.redelegation)];
    return "0x" + Buffer.from(JSON.stringify(chain)).toString("hex");
  } catch (e) {
    console.warn("[x402/pay] 1Shot exception:", e);
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: PayRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { endpoint, permissionsContext, delegationManager } = body;
  if (!endpoint) {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }

  // ── Step 1: fetch 402 challenge ───────────────────────────────────────────
  const resolvedEndpoint = endpoint.startsWith("http")
    ? endpoint
    : `${request.nextUrl.origin}${endpoint}`;

  let challengeRes: Response;
  try {
    challengeRes = await fetch(resolvedEndpoint);
  } catch (e) {
    return NextResponse.json(
      { error: `Endpoint unreachable: ${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }

  if (challengeRes.status !== 402) {
    if (challengeRes.ok) return NextResponse.json(await challengeRes.json());
    return NextResponse.json(
      { error: `Expected 402, got ${challengeRes.status}` },
      { status: 400 }
    );
  }

  const paymentRequiredHeader = challengeRes.headers.get("PAYMENT-REQUIRED");
  if (!paymentRequiredHeader) {
    return NextResponse.json({ error: "No PAYMENT-REQUIRED header" }, { status: 400 });
  }

  let paymentRequired: {
    accepts: Array<{
      scheme?: string;
      price?: string;
      network?: string;
      payTo?: string;
      asset?: string;
      amount?: string;
      extra?: { assetTransferMethod?: string; facilitators?: string[] };
    }>;
  };
  try {
    paymentRequired = JSON.parse(
      Buffer.from(paymentRequiredHeader, "base64").toString("utf-8")
    );
  } catch {
    return NextResponse.json({ error: "Bad PAYMENT-REQUIRED encoding" }, { status: 400 });
  }

  const accepted = paymentRequired.accepts?.[0];
  if (!accepted) {
    return NextResponse.json({ error: "No accepted payment terms" }, { status: 400 });
  }

  // ── Step 2: determine permissionContext for the payment ───────────────────
  // FAIL-CLOSED: we only build a payment from a REAL ERC-7710 delegation context.
  // There is no demo/stub path — without a real context the caller cannot pay, and
  // the downstream verifier would reject a fabricated signature anyway.
  let permissionContext: string;
  let via: string;

  const facilitators = (accepted.extra?.facilitators ?? []) as `0x${string}`[];
  const facilitatorAddress = facilitators[0];

  const isRealContext =
    !!permissionsContext &&
    permissionsContext !== "0xdemo" &&
    permissionsContext !== "0x" &&
    !/^0x0*$/.test(permissionsContext) &&
    permissionsContext.length > 40;

  if (!isRealContext) {
    return NextResponse.json(
      { error: "No real ERC-7710 permission context — cannot construct a payment. Grant a permission first." },
      { status: 400 },
    );
  }

  if (facilitatorAddress) {
    // Try 1Shot redelegation to the facilitator; else pass the original context.
    const redelegated = await attempt1ShotRedelegate(permissionsContext, facilitatorAddress);
    permissionContext = redelegated ?? permissionsContext;
    via = redelegated ? "1shot" : "direct";
  } else {
    permissionContext = permissionsContext;
    via = "direct";
  }

  // ── Step 3: build x402 payment signature ─────────────────────────────────
  const paymentPayload = {
    x402Version: 2,
    scheme: accepted.scheme ?? "exact",
    network: accepted.network ?? "eip155:8453",
    accepted,
    payload: {
      delegationManager: delegationManager ?? "0x",
      permissionContext,
      // Bug 7 fix: never fall back to a publicly known Hardhat address.
      // If the session address env var is missing, the payment is unsigned/demo.
      delegator: process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? "0x",
      timestamp: Date.now(),
      nonce: Math.random().toString(36).slice(2),
    },
  };

  const encodedPayment = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

  // ── Step 4: make the paid request ────────────────────────────────────────
  const paidRes = await fetch(resolvedEndpoint, {
    headers: { "PAYMENT-SIGNATURE": encodedPayment },
  });

  if (!paidRes.ok) {
    const errBody = await paidRes.json().catch(() => ({ error: paidRes.statusText }));
    return NextResponse.json(
      { error: errBody.error ?? "Paid request failed", via },
      { status: paidRes.status }
    );
  }

  const data = await paidRes.json();
  // Real charged amount comes from the 402 challenge price (e.g. "$0.01").
  const costUsdc = Number.parseFloat((accepted.price ?? "0").replace(/[^0-9.]/g, "")) || 0;
  return NextResponse.json({
    ...data,
    _clove: { paid: true, costUsdc, via },
  });
}
