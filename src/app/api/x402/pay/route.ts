import { NextRequest, NextResponse } from "next/server";
import { encodeDelegations } from "@metamask/smart-accounts-kit/utils";
import {
  redelegatePermissionContextOnce,
  redelegateToFacilitator,
} from "@/lib/oneshot/agentWallet";
import { getSessionWalletClient, environment } from "@/lib/web3/serverSession";
import { CaveatType, ScopeType } from "@metamask/smart-accounts-kit";
import { USDC_ADDRESS } from "@/lib/web3/config";

interface PayRequest {
  endpoint: string;
  permissionsContext: string;
  delegationManager: string;
  /** Optional: a previously stored 1Shot delegation ID (from /api/x402/store-delegation). */
  delegationId?: string;
}

export async function POST(request: NextRequest) {
  let body: PayRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { endpoint, permissionsContext, delegationManager, delegationId } = body;
  if (!endpoint || (!permissionsContext && !delegationId) || !delegationManager) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // ── Step 1: fetch 402 challenge from the endpoint ───────────────────────────
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
    // If endpoint is already accessible, return response directly
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
      asset?: string;
      amount?: string;
      extra?: { facilitators?: string[] };
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

  const facilitators = (accepted.extra?.facilitators ?? []) as `0x${string}`[];
  const facilitatorAddress = facilitators[0];

  // ── Step 2: redelegate using 1Shot API or local wallet client (fallback) ─────
  let permissionContext: `0x${string}`;

  const use1Shot =
    (process.env.ONESHOT_API_KEY && process.env.ONESHOT_WALLET_ID) &&
    facilitatorAddress;

  if (use1Shot && facilitatorAddress) {
    try {
      // Preferred path: 1Shot handles signing on behalf of the server wallet
      const { parent, redelegation } = delegationId
        ? await redelegateToFacilitator(delegationId, facilitatorAddress)
        : await redelegatePermissionContextOnce(permissionsContext, facilitatorAddress);

      // Encode the 1Shot delegation chain into hex permissionContext
      const parentObj = JSON.parse(parent);
      const redelegationObj = JSON.parse(redelegation);
      permissionContext = encodeDelegations([parentObj, redelegationObj]);
    } catch (e) {
      console.warn("[x402/pay] 1Shot redelegate failed, falling back to local:", e);
      permissionContext = await localRedelegate(
        permissionsContext,
        facilitatorAddress,
        accepted,
      );
    }
  } else {
    // Fallback path: local wallet client with private key
    permissionContext = await localRedelegate(
      permissionsContext,
      facilitatorAddress ?? "0x",
      accepted,
    );
  }

  // ── Step 3: build x402 payment payload ───────────────────────────────────────
  const paymentPayload = {
    x402Version: 2,
    accepted,
    payload: {
      delegationManager,
      permissionContext,
      // delegator = 1Shot wallet address (or local session smart account)
      delegator: process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? "0x",
    },
  };

  const encodedPayment = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

  // ── Step 4: make the paid request ────────────────────────────────────────────
  const paidRes = await fetch(resolvedEndpoint, {
    headers: { "PAYMENT-SIGNATURE": encodedPayment },
  });

  if (!paidRes.ok) {
    const errBody = await paidRes.json().catch(() => ({ error: paidRes.statusText }));
    return NextResponse.json(
      { error: errBody.error ?? "Paid request failed" },
      { status: paidRes.status }
    );
  }

  const data = await paidRes.json();
  return NextResponse.json({ ...data, _clove: { paid: true, costUsdc: 0.01, via: use1Shot ? "1shot" : "local" } });
}

/** Fallback: redelegate using the local private-key wallet client. */
async function localRedelegate(
  permissionsContext: string,
  facilitatorAddress: `0x${string}`,
  accepted: { asset?: string; amount?: string; extra?: { facilitators?: string[] } },
): Promise<`0x${string}`> {
  const walletClient = getSessionWalletClient();
  const amount = accepted.amount ? BigInt(accepted.amount) : BigInt(10000);
  const facilitators = (accepted.extra?.facilitators ?? []) as `0x${string}`[];

  const { permissionContext } = await walletClient.redelegatePermissionContext({
    environment,
    permissionContext: permissionsContext as `0x${string}`,
    to: facilitatorAddress,
    scope: {
      type: ScopeType.Erc20TransferAmount,
      tokenAddress: (accepted.asset as `0x${string}`) ?? USDC_ADDRESS,
      maxAmount: amount,
    },
    caveats: facilitators.length
      ? [{ type: CaveatType.Redeemer, redeemers: facilitators }]
      : [],
  });

  return permissionContext;
}
