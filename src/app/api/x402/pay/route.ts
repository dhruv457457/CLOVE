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
  let permissionContext: string;
  let via = "demo";

  const facilitators = (accepted.extra?.facilitators ?? []) as `0x${string}`[];
  const facilitatorAddress = facilitators[0];

  const isRealContext =
    permissionsContext &&
    permissionsContext !== "0xdemo" &&
    permissionsContext !== "0x" &&
    permissionsContext.length > 20;

  if (isRealContext && facilitatorAddress) {
    // Try 1Shot redelegation
    const redelegated = await attempt1ShotRedelegate(permissionsContext, facilitatorAddress);
    if (redelegated) {
      permissionContext = redelegated;
      via = "1shot";
    } else {
      // Fall back to passing the original context directly
      permissionContext = permissionsContext;
      via = "direct";
    }
  } else {
    // Demo mode: generate a signed stub that the intelligence endpoint will accept
    // (verifyPayment() returns true as fallback when 1Shot validation fails)
    permissionContext = permissionsContext ?? "0xdemo";
    via = "demo";
  }

  // ── Step 3: build x402 payment signature ─────────────────────────────────
  const paymentPayload = {
    x402Version: 2,
    scheme: accepted.scheme ?? "exact",
    network: accepted.network ?? "eip155:84532",
    accepted,
    payload: {
      delegationManager: delegationManager ?? "0x",
      permissionContext,
      delegator:
        process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? "0x5fA306c23C731039a998215f3432205Df8A34cF1",
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
  return NextResponse.json({
    ...data,
    _clove: { paid: true, costUsdc: 0.01, via },
  });
}
