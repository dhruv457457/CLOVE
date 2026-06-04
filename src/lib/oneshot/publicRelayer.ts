import "server-only";

/**
 * 1Shot Public Relayer — permissionless EIP-7710 gas abstraction.
 *
 * No API key. No billing. No credits.
 * Gas is paid in USDC from the user's delegation bundle itself.
 *
 * How it works:
 *   1. Discover relayer's targetAddress + feeCollector via relayer_getCapabilities
 *   2. Get a USDC fee quote via relayer_getFeeData
 *   3. Create a sub-delegation FROM CLOVE's session wallet TO the relayer's targetAddress
 *      (scoped to feeAmount + workAmount USDC — uses AllowedTargetsEnforcer for protocol safety)
 *   4. Bundle = [USDC fee transfer to feeCollector, actual DeFi call]
 *   5. Submit via relayer_send7710Transaction — relayer executes and sponsors ETH gas
 *   6. Track via relayer_getStatus polling → return txHash when confirmed
 *
 * This qualifies CLOVE for the hackathon's "Best Use of 1Shot Permissionless Relayer" track.
 *
 * Live Base mainnet relayer constants (from relayer_getCapabilities):
 *   targetAddress:  0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a
 *   feeCollector:   0xE936e8FAf4A5655469182A49a505055B71C17604
 *   USDC:           0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 */

import { decodeDelegations } from "@metamask/smart-accounts-kit/utils";
import { encodeFunctionData, parseUnits, type Hex } from "viem";
import { TOKENS, CHAIN } from "@/lib/protocols/addresses";

// ── Relayer constants (Base mainnet, from relayer_getCapabilities) ─────────────
const RELAYER_URL        = "https://relayer.1shotapi.com/relayers";
const RELAYER_TARGET     = "0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a" as `0x${string}`;
const FEE_COLLECTOR      = "0xE936e8FAf4A5655469182A49a505055B71C17604" as `0x${string}`;
const USDC               = TOKENS.USDC[CHAIN.BASE] as `0x${string}`;
const BASE_CHAIN_ID      = 8453;
// Floor only — the real fee comes from the relayer's live quote (relayer_getFeeData).
// Base L2 gas is tiny; the relayer's minFee is ~0.01 USDC. We charge the quoted
// minFee with a small buffer, never a fixed inflated amount.
const RELAY_FEE_FLOOR_USDC = 0.01;
const RELAY_FEE_BUFFER     = 1.2; // 20% headroom for gas-price drift between quote and submit

// ── JSON-RPC helpers ───────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function toRelayerJson(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  if (value instanceof Uint8Array) {
    return ("0x" + Buffer.from(value).toString("hex")) as JsonValue;
  }
  if (Array.isArray(value)) return value.map(toRelayerJson) as JsonValue[];
  if (typeof value === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toRelayerJson(v);
    }
    return out;
  }
  return value as JsonValue;
}

async function rpc(method: string, params: unknown, id = 1): Promise<unknown> {
  const res = await fetch(RELAYER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json() as { result?: unknown; error?: { message: string; data?: unknown } };
  if (json.error) throw new Error(`Relayer error [${method}]: ${json.error.message} ${JSON.stringify(json.error.data ?? "")}`);
  return json.result;
}

// ── Capability + fee fetching ──────────────────────────────────────────────────

interface RelayerFeeData {
  gasPrice:  string;
  rate:      string;
  minFee:    string;
  expiry:    number;
  context:   string;
}

/** Fetch fresh fee quote for USDC on Base mainnet. */
export async function getRelayerFeeData(): Promise<RelayerFeeData> {
  const result = await rpc("relayer_getFeeData", {
    chainId: String(BASE_CHAIN_ID),
    token:   USDC,
  });
  return result as RelayerFeeData;
}

/** Get status of a submitted relay task. */
export async function getRelayStatus(taskId: string): Promise<{
  status: number; // 100=Pending, 110=Submitted, 200=Confirmed, 400=Rejected, 500=Reverted
  hash?: string;
  message?: string;
}> {
  const result = await rpc("relayer_getStatus", { id: taskId, logs: true }, 2) as {
    status: number;
    hash?: string;
    message?: string;
    receipt?: { transactionHash?: string };
  };
  // The relayer puts the real tx hash at result.receipt.transactionHash;
  // result.hash is not populated. Prefer the receipt hash.
  return {
    status:  result.status,
    hash:    result.receipt?.transactionHash ?? result.hash,
    message: result.message,
  };
}

// ── Main execution function ────────────────────────────────────────────────────

export interface RelayWorkExecution {
  target: `0x${string}`;
  data:   `0x${string}`;
  value?: string;
}

export interface RelayExecutionParams {
  /** Stored permissionsContext from the user's ERC-7715 grant */
  userPermissionsContext: string;
  /**
   * Recipient of the delegated USDC transfer.
   * For CloveAutoDeposit: this is the contract address — it receives USDC
   * and then CLOVE calls forward() to deposit into the protocol.
   */
  recipient:      `0x${string}`;
  /** USDC amount to transfer to recipient */
  workAmountUsdc: number;
  /**
   * Optional extra calldata executions (currently unused — the erc20-token-periodic
   * enforcer only allows USDC.transfer so this stays empty).
   */
  workExecutions?: RelayWorkExecution[];
  /** Human-readable memo (for debugging) */
  memo?: string;
}

export interface RelayExecutionResult {
  taskId:  string;
  txHash?: string;
  status:  "submitted" | "confirmed" | "failed";
  via:     "1shot-public-relayer";
  feeUsdc: number;
  /** Human-readable reason when status === "failed" (e.g. allowance exceeded). */
  error?:  string;
}

/**
 * Execute a DeFi action via the 1Shot Public Relayer.
 *
 * Gas is paid in USDC from the user's delegation — no ETH needed anywhere.
 * No API key or billing account required.
 *
 * Grant flow for this path:
 *   User grants ERC-7715 directly TO the relayer's targetAddress (0x26a5…).
 *   No sub-delegation needed — the bundle includes [fee transfer + DeFi action]
 *   and the delegation scopes both operations.
 *
 * This is the correct permissionless flow per the 1Shot docs:
 *   bundle = [USDC fee → feeCollector] + [actual DeFi call]
 *   permissionContext = the user's signed delegation to the relayer target
 */
export async function executeViaPublicRelayer(
  params: RelayExecutionParams,
): Promise<RelayExecutionResult> {
  const {
    userPermissionsContext,
    recipient,
    workAmountUsdc,
    memo = "CLOVE agent execution",
  } = params;

  // ── 1. Parse the fee ───────────────────────────────────────────────────────
  const feeData    = await getRelayerFeeData();
  const minFeeRaw  = feeData.minFee ?? "0";
  const minFeeUsdc = minFeeRaw.includes(".") ? Number(minFeeRaw) : Number(minFeeRaw) / 1e6;
  // Charge the relayer's quoted minFee + small buffer, floored at 0.01 — not a fixed 0.05.
  const feeUsdc    = Math.max(minFeeUsdc * RELAY_FEE_BUFFER, RELAY_FEE_FLOOR_USDC);
  const feeAtoms   = parseUnits(feeUsdc.toFixed(6), 6);

  // ── 2. Decode the user's delegation ───────────────────────────────────────
  // The user granted ERC-7715 directly to the relayer's targetAddress.
  // Decode to get the raw struct(s) the relayer expects as JSON objects.
  let permissionContext: ReturnType<typeof toRelayerJson>[];
  try {
    const decoded = decodeDelegations(userPermissionsContext as `0x${string}`);
    permissionContext = decoded.map(d => toRelayerJson(d)) as ReturnType<typeof toRelayerJson>[];
  } catch {
    // Hex-encoded JSON (1Shot redelegate path) — pass as-is
    try {
      const jsonStr = Buffer.from(userPermissionsContext.slice(2), "hex").toString("utf-8");
      const chain = JSON.parse(jsonStr) as unknown[];
      permissionContext = chain.map(d => toRelayerJson(d)) as ReturnType<typeof toRelayerJson>[];
    } catch {
      throw new Error("[publicRelayer] Cannot decode permissionsContext");
    }
  }

  // ── 3. Build execution bundle ─────────────────────────────────────────────
  // Bundle = [fee: USDC.transfer(feeCollector)] + [work: USDC.transfer(recipient)]
  // The erc20-token-periodic enforcer only allows USDC.transfer() — that's fine
  // because `recipient` is CloveAutoDeposit contract which does the real deposit.
  const erc20Abi = [
    { name: "transfer", type: "function", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  ] as const;

  const workAtoms = parseUnits(String(workAmountUsdc), 6);
  const feeCalldata  = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [FEE_COLLECTOR, feeAtoms]  });
  const workCalldata = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient,    workAtoms] });

  const executions = [
    { target: USDC, value: "0", data: feeCalldata  }, // relayer gas fee in USDC
    { target: USDC, value: "0", data: workCalldata }, // USDC→recipient (contract or user)
  ];

  // ── 4. Submit to relayer ──────────────────────────────────────────────────
  const sendParams = {
    chainId: String(BASE_CHAIN_ID),
    ...(feeData.context ? { context: feeData.context } : {}),
    transactions: [{ permissionContext, executions }],
    memo,
  };

  let taskId: string;
  try {
    taskId = (await rpc("relayer_send7710Transaction", sendParams, 3)) as string;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[publicRelayer] Submit failed: ${msg}`);
  }

  console.log(`[publicRelayer] Submitted taskId=${taskId}, fee=${feeUsdc.toFixed(4)} USDC`);

  // ── 6. Poll for confirmation ──────────────────────────────────────────────
  // Poll up to 90s (Base L2 = ~2s block time, usually confirms in 5-15s)
  const deadline    = Date.now() + 90_000;
  const intervalMs  = 3_000;
  let txHash: string | undefined;
  let finalStatus: RelayExecutionResult["status"] = "submitted";
  let failMessage: string | undefined;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const st = await getRelayStatus(taskId);
      // 100=Pending, 110=Submitted, 200=Confirmed, 400=Rejected, 500=Reverted
      if (st.status === 200) {
        txHash      = st.hash;
        finalStatus = "confirmed";
        console.log(`[publicRelayer] Confirmed! txHash=${txHash}`);
        break;
      }
      if (st.status === 400 || st.status === 500) {
        finalStatus = "failed";
        failMessage = st.message ?? "relayer rejected the transaction";
        // Translate the common enforcer errors into plain language.
        if (/transfer-amount-exceeded/i.test(failMessage)) {
          failMessage = "Period spending allowance exceeded — re-grant the permission (fresh period or higher cap) or lower the amount.";
        } else if (/invalid-method/i.test(failMessage)) {
          failMessage = "The permission only allows USDC transfers, not this action.";
        }
        console.warn(`[publicRelayer] Task ${taskId} failed (${st.status}): ${st.message ?? ""}`);
        break;
      }
    } catch { /* transient polling error — keep trying */ }
  }

  return {
    taskId,
    txHash,
    status:  finalStatus,
    via:     "1shot-public-relayer",
    feeUsdc: Number(feeAtoms) / 1e6,
    error:   failMessage,
  };
}

/**
 * Poll a relay task until terminal state.
 * Used by webhooks or delayed checks.
 */
export async function pollRelayTask(taskId: string, timeoutMs = 120_000): Promise<{
  status: "confirmed" | "failed";
  txHash?: string;
}> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3_000));
    const st = await getRelayStatus(taskId);
    if (st.status === 200) return { status: "confirmed", txHash: st.hash };
    if (st.status >= 400)  return { status: "failed" };
  }
  return { status: "failed" };
}
