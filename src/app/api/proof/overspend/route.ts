import { NextRequest, NextResponse } from "next/server";

/**
 * A2A OVERSPEND PROOF — the demo artifact for "Best A2A coordination".
 *
 * Demonstrates that a worker's on-chain budget is enforced by a real
 * CaveatEnforcer, not by app logic:
 *
 *   1. Build a scoped worker delegation chain (user → session → worker → relayer)
 *      with an ERC20TransferAmountEnforcer capped at `capUsdc` (default 0.05).
 *   2. Ask the 1Shot relayer to redeem a USDC transfer of `attemptUsdc`
 *      (default 1.00) — i.e. WAY over the worker's cap.
 *   3. The enforcer reverts: `ERC20TransferAmountEnforcer: allowance-exceeded`.
 *
 * A clean run RETURNS the revert as the success signal: the cap held.
 *
 * Requires a Fund Manager grant (user → session). Get the target via
 *   GET /api/session/address?role=fund-manager
 * then grant with requestFundManagerPermission(). The grant is read from the
 * stored permission, or passed explicitly as `rootContext` in the body.
 *
 * Body: { walletAddress, rootContext?, protocol?, capUsdc?, attemptUsdc?, chainId? }
 */
export async function POST(req: NextRequest) {
  let body: {
    walletAddress?: string;
    rootContext?:   string;
    protocol?:      string;
    capUsdc?:       number;
    attemptUsdc?:   number;
    chainId?:       number;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const walletAddress = (body.walletAddress ?? "").toLowerCase();
  const protocol      = body.protocol ?? "morpho";
  const capUsdc       = body.capUsdc ?? 0.05;
  const attemptUsdc   = body.attemptUsdc ?? 1.0;
  const chainId       = body.chainId ?? 8453;

  if (attemptUsdc <= capUsdc) {
    return NextResponse.json(
      { error: "attemptUsdc must exceed capUsdc for the proof to be meaningful" },
      { status: 400 },
    );
  }

  // ── Resolve the user's Fund Manager grant context ──────────────────────────
  let rootContext = body.rootContext;
  if (!rootContext) {
    if (!walletAddress) {
      return NextResponse.json({ error: "walletAddress or rootContext required" }, { status: 400 });
    }
    try {
      const { getDb } = await import("@/lib/db/mongodb");
      const db = await getDb();
      const stored = db
        ? await db.collection("user_permissions").findOne({ walletAddress })
        : null;
      rootContext = stored?.permissionsContext as string | undefined;
    } catch { /* fall through */ }
  }
  if (!rootContext || rootContext.length < 40) {
    return NextResponse.json(
      { error: "No Fund Manager grant found. Grant to /api/session/address?role=fund-manager first." },
      { status: 400 },
    );
  }

  // ── Build the scoped chain + attempt an over-cap redemption ─────────────────
  try {
    const { buildRedeemableWorkerChain } = await import("@/lib/web3/subDelegation");
    const { executeViaPublicRelayer }    = await import("@/lib/oneshot/publicRelayer");

    const chain = await buildRedeemableWorkerChain(
      rootContext,
      "proof-worker",
      protocol,
      capUsdc,
      chainId,
    );

    // Attempt to move MORE than the worker's cap — this must be rejected on-chain.
    const result = await executeViaPublicRelayer({
      userPermissionsContext: chain.context,
      recipient:              walletAddress as `0x${string}`,   // send back to the user (irrelevant; it should revert)
      workAmountUsdc:         attemptUsdc,
      memo:                   `CLOVE A2A overspend proof — cap ${capUsdc}, attempt ${attemptUsdc}`,
      chainId,
    });

    const reverted = result.status === "failed";
    const isCapRevert = /allowance|transfer-amount|exceed/i.test(result.error ?? "");

    return NextResponse.json({
      proof:        reverted && isCapRevert ? "PASS — overspend reverted on-chain" : "INCONCLUSIVE",
      reverted,
      isCapRevert,
      workerAddress:  chain.workerAddress,
      capUsdc,
      attemptUsdc,
      allowedTargets: chain.allowedTargets,
      relayer: {
        taskId:  result.taskId,
        status:  result.status,
        txHash:  result.txHash ?? null,
        error:   result.error ?? null,
      },
      note: reverted
        ? "The ERC20TransferAmountEnforcer rejected the over-cap transfer. The worker physically cannot exceed its budget."
        : "Transfer was NOT rejected — inspect the relayer status. If status is 'confirmed', the cap did not hold (check chain assembly / multi-hop support).",
    });
  } catch (e) {
    return NextResponse.json(
      {
        proof: "ERROR",
        error: e instanceof Error ? e.message : String(e),
        hint:  "If this is a multi-hop redemption error from the relayer, that is the live-test checkpoint: the 3-hop chain may need ordering adjustment or the relayer may not support it.",
      },
      { status: 500 },
    );
  }
}
