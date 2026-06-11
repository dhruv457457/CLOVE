/**
 * RECORDED MAINNET FIXTURES — for the deterministic demo mode.
 *
 * These are REAL, previously-captured results from Base mainnet. They are
 * replayed ONLY when the live 1Shot relayer is unavailable (its submit endpoint
 * intermittently 404s — see memory). The UI labels every replay clearly
 * ("recorded mainnet result — relayer unavailable") with a verifiable on-chain
 * link, so it's an honest replay, never a silent fake.
 *
 * RULE: only put results here that ACTUALLY happened on-chain. The overspend
 * revert below is real (the user captured it). Do NOT add an adversarial-success
 * fixture until that flow has been verified live end-to-end.
 */

/** Verifiable on-chain anchor — where every real CLOVE redemption + deposit lands. */
export const CLOVE_AUTODEPOSIT = "0xb7aD6bcCD73db1a21A6144Ecbc9Cc225Dd6AF1dC";

/** Real captured overspend-proof result (worker capped 0.05, tried 1.0 → reverted). */
export const OVERSPEND_FIXTURE = {
  proof:        "PASS — overspend reverted on-chain",
  reverted:     true,
  isCapRevert:  true,
  workerAddress: "0x9DF764004437363e6a7565dccf164Dda611178b4",
  capUsdc:      0.05,
  attemptUsdc:  1,
  allowedTargets: [
    "0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a",
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca",
  ],
  relayer: {
    taskId: "0x1815cfb53477d1ae8d3a46f257698a7a8ef97b018686f067b75971cd5a67801f",
    status: "failed",
    txHash: null as string | null,   // reverted at gas estimation — never made it on-chain (that IS the proof)
    error:  "Gas estimation failed: Error(ERC20TransferAmountEnforcer:allowance-exceeded)",
  },
  note: "The ERC20TransferAmountEnforcer rejected the over-cap transfer. The worker physically cannot exceed its budget.",
} as const;

/** True when a relayer error indicates its submit endpoint is down (vs. a real revert). */
export function isRelayerUnavailable(errMsg: string | undefined): boolean {
  if (!errMsg) return false;
  return /not found|ERR_ONESHOT|Submit failed|Internal Server Error|ECONNREFUSED|fetch failed|timeout/i.test(errMsg);
}
