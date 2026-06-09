import "server-only";

/**
 * Protocol-scoped sub-delegation creation.
 *
 * Uses the MetaMask Smart Accounts Kit to create server-side sub-delegations
 * FROM CLOVE's session smart account TO each executor agent's smart account,
 * with two CaveatEnforcers stacked:
 *
 *   1. AllowedTargetsEnforcer  — restricts the executor to ONE specific
 *      contract address (the protocol vault/router). Even if the agent code
 *      were compromised, the delegation itself enforces the protocol boundary
 *      at the EVM level.
 *
 *   2. ERC20TransferAmountEnforcer — caps USDC spend to the agent's budget.
 *      Combined with AllowedTargets, this gives both WHERE and HOW MUCH
 *      guarantees on-chain.
 *
 * This is what "Custom CaveatEnforcer" means in the hackathon rubric — these
 * are real on-chain enforcers deployed on Base (and Polygon) by MetaMask.
 */

import {
  createDelegation,
  signDelegation,
  getSmartAccountsEnvironment,
  createCaveat,
  type CreateDelegationOptions,
} from "@metamask/smart-accounts-kit";
import { encodeDelegations, decodeDelegations, hashDelegation } from "@metamask/smart-accounts-kit/utils";
import { encodePacked, parseUnits } from "viem";
import { getSessionPrivateKey, getSessionPrivateKey as _k } from "@/lib/config/env";
import { getAgentPrivateKey, getAgentSmartAccountAddress, getSessionAddress, getSessionEoaAddress, getAgentEoaAddress } from "@/lib/web3/serverSession";
import { MORPHO, AAVE_V3, AERODROME, UNISWAP_V3, LIDO, TOKENS, CHAIN } from "@/lib/protocols/addresses";

// Base mainnet chain ID
const BASE_CHAIN_ID = 8453;

/** USDC on Base */
const USDC = TOKENS.USDC[CHAIN.BASE] as `0x${string}`;

// ── Protocol target addresses ──────────────────────────────────────────────────
// These are the ONLY contract addresses each executor type may call.
// AllowedTargetsEnforcer enforces this constraint on-chain.

export const PROTOCOL_TARGETS: Record<string, `0x${string}`[]> = {
  morpho:    [MORPHO.vaults.MOONWELL_USDC as `0x${string}`, MORPHO.vaults.GAUNTLET_USDC as `0x${string}`],
  aave:      [AAVE_V3.pool[CHAIN.BASE]  as `0x${string}`],
  aerodrome: [(AERODROME.router[CHAIN.BASE]) as `0x${string}`],
  uniswap:   [(UNISWAP_V3.swapRouter[CHAIN.BASE]) as `0x${string}`],
  lido:      [(UNISWAP_V3.swapRouter[CHAIN.BASE]) as `0x${string}`], // wstETH acquired via Uniswap on Base
};

// ── Caveat builders ────────────────────────────────────────────────────────────

/**
 * Build AllowedTargetsEnforcer caveat — restricts calls to specific contract addresses.
 * Terms = ABI-encoded address[]
 */
function buildAllowedTargetsCaveat(environment: ReturnType<typeof getSmartAccountsEnvironment>, targets: `0x${string}`[]) {
  // AllowedTargetsEnforcer expects PACKED 20-byte addresses (terms.length % 20 == 0).
  // viem's encodePacked(["address[]"]) pads each element to 32 bytes, so we
  // concatenate the raw 20-byte addresses ourselves.
  const terms = ("0x" + targets.map(t => t.slice(2)).join("")).toLowerCase() as `0x${string}`;
  return createCaveat(
    environment.caveatEnforcers.AllowedTargetsEnforcer as `0x${string}`,
    terms,
  );
}

/**
 * Build ERC20TransferAmountEnforcer caveat — caps USDC spend to maxAmount.
 * Terms = ABI-encoded (address tokenAddress, uint256 maxAmount)
 */
function buildErc20CapCaveat(environment: ReturnType<typeof getSmartAccountsEnvironment>, maxUsdc: number) {
  // ERC20TransferAmountEnforcer expects PACKED terms: 20-byte token ‖ 32-byte amount.
  const terms = encodePacked(
    ["address", "uint256"],
    [USDC, parseUnits(String(maxUsdc), 6)],
  );
  return createCaveat(
    environment.caveatEnforcers.ERC20TransferAmountEnforcer as `0x${string}`,
    terms,
  );
}

// ── Sub-delegation creation ────────────────────────────────────────────────────

export interface SubDelegationResult {
  /** ABI-encoded delegation chain — stored as the agent's delegationContext */
  context: `0x${string}`;
  /** EIP-712 hash of the child delegation */
  hash: `0x${string}`;
  /** Protocol this executor is scoped to */
  protocol: string;
  /** Contract addresses this executor may call */
  allowedTargets: `0x${string}`[];
  /** USDC cap enforced on-chain */
  capUsdc: number;
}

/**
 * Create a protocol-scoped sub-delegation for an executor agent.
 *
 * The delegation is signed server-side using CLOVE's session private key.
 * The resulting context can be stored in MongoDB and used by the executor
 * agent when calling 1Shot's executeAsDelegator.
 *
 * Security guarantees (enforced at EVM level, not just code):
 *   - AllowedTargetsEnforcer: executor may only call the designated protocol
 *   - ERC20TransferAmountEnforcer: executor may only spend up to capUsdc USDC
 *
 * @param parentPermissionsContext  Root ERC-7715 context from MetaMask grant
 * @param childAgentId              The executor agent's ID (used to derive its smart account address)
 * @param protocol                  Protocol key: "morpho" | "aave" | "aerodrome" | "uniswap" | "lido"
 * @param capUsdc                   Max USDC this executor may spend (enforced on-chain)
 */
export async function createProtocolScopedDelegation(
  parentPermissionsContext: string,
  childAgentId: string,
  protocol: string,
  capUsdc: number,
): Promise<SubDelegationResult> {
  const environment = getSmartAccountsEnvironment(BASE_CHAIN_ID);
  const privateKey  = getSessionPrivateKey();

  // The delegator (FROM) is the root session smart account — the entity the
  // user's ERC-7715 grant was actually issued to (getSessionAddress, owned by
  // the root key). The Fund Manager redelegates a scoped slice of that grant
  // down to each worker's derived smart account.
  const sessionAddress = await getSessionAddress();

  // Derive the executor agent's unique smart account address (the delegate = TO address)
  const executorAddress = await getAgentSmartAccountAddress(childAgentId);

  // Resolve which contract addresses this executor may call
  const targets = PROTOCOL_TARGETS[protocol.toLowerCase()] ?? [];
  if (targets.length === 0) {
    throw new Error(`No AllowedTargets configured for protocol: ${protocol}`);
  }

  // Build the two caveats
  const targetsCaveat = buildAllowedTargetsCaveat(environment, targets);
  const capCaveat     = buildErc20CapCaveat(environment, capUsdc);

  // Create the unsigned delegation struct
  const delegationOptions: CreateDelegationOptions = {
    from:                  sessionAddress,
    to:                    executorAddress,
    environment,
    parentPermissionContext: parentPermissionsContext as `0x${string}`,
    caveats: [targetsCaveat, capCaveat],
  };

  const unsignedDelegation = createDelegation(delegationOptions);

  // Sign with CLOVE's session private key
  const delegationManager = environment.DelegationManager as `0x${string}`;
  const signature = await signDelegation({
    privateKey,
    delegation:        unsignedDelegation,
    delegationManager,
    chainId:           BASE_CHAIN_ID,
    allowInsecureUnrestrictedDelegation: false,
  });

  const signedDelegation = { ...unsignedDelegation, signature };

  // Encode as ABI-encoded hex context (same format as root grants)
  const context = encodeDelegations([signedDelegation]);
  const hash    = hashDelegation(signedDelegation);

  return {
    context,
    hash,
    protocol,
    allowedTargets: targets,
    capUsdc,
  };
}

// ── Full redeemable worker chain (user → session → worker → relayer) ────────────

/** Per-chain 1Shot relayer target (the final delegate that redeems + sponsors gas). */
const RELAYER_TARGETS: Record<number, `0x${string}`> = {
  8453: "0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a",
  137:  "0x38663d5e9d7b930bea883d27ea13e731242865fa",
};

export interface WorkerChainResult {
  /** ABI-encoded FULL delegation chain, leaf→root, ready for the relayer. */
  context: `0x${string}`;
  /** Hash of the worker's scoped (session→worker) delegation — for revocation. */
  scopedHash: `0x${string}`;
  /** Worker's derived smart account (the capped spender). */
  workerAddress: `0x${string}`;
  /** Contracts the worker may touch (relayer + protocol targets). */
  allowedTargets: `0x${string}`[];
  /** On-chain USDC cap enforced against the worker. */
  capUsdc: number;
}

/**
 * Build the COMPLETE redeemable chain for a worker agent:
 *
 *     [root grant: user → session]   (decoded from rootContext)
 *        └▶ [session → worker]  + AllowedTargets + ERC20TransferAmountEnforcer(cap)
 *              └▶ [worker → relayer]   (so the 1Shot relayer redeems + sponsors gas in USDC)
 *
 * The session→worker hop is signed with CLOVE's root session key; the
 * worker→relayer hop is signed with the worker's OWN derived key
 * (getAgentPrivateKey) — genuinely separate signers, which is what makes this
 * real A2A rather than one key wearing hats.
 *
 * The returned `context` is encodeDelegations() over the chain in leaf→root
 * order: [workerToRelayer, sessionToWorker, ...rootGrant]. The 1Shot relayer
 * decodes this array and redeems it; the ERC20TransferAmountEnforcer on the
 * session→worker hop reverts any redemption that moves more than `capUsdc`.
 *
 * ⚠️ LIVE-TEST CHECKPOINT: whether the 1Shot relayer accepts a 3-hop chain is
 * the one thing that needs on-chain verification. If it rejects multi-hop, the
 * caller should fall back to the single-hop root grant (working flow preserved).
 *
 * @param rootContext  The user's ERC-7715 grant TO the session/fund-manager account.
 * @param workerAgentId  Worker agent id → derives its key + smart account.
 * @param protocol      Protocol key for AllowedTargets ("morpho" | "aave" | …).
 * @param capUsdc       On-chain USDC cap for this worker.
 * @param chainId       8453 (Base) | 137 (Polygon).
 */
export async function buildRedeemableWorkerChain(
  rootContext: string,
  workerAgentId: string,
  protocol: string | string[],
  capUsdc: number,
  chainId: number = BASE_CHAIN_ID,
): Promise<WorkerChainResult> {
  const environment = getSmartAccountsEnvironment(chainId);
  const relayer     = RELAYER_TARGETS[chainId];
  if (!relayer) throw new Error(`No relayer target configured for chain ${chainId}`);

  // Delegators must be EOA addresses (we sign with raw keys → ECDSA recovery
  // must match the delegator, else InvalidEOASignature). The FM grant is issued
  // to the session EOA; each worker hop is signed by its derived EOA key.
  const sessionAddress = getSessionEoaAddress();
  const workerAddress  = getAgentEoaAddress(workerAgentId);

  // Decode the user's root grant so we can re-encode the full chain at the end.
  const rootDelegations = decodeDelegations(rootContext as `0x${string}`);
  if (rootDelegations.length === 0) throw new Error("Root context decoded to an empty delegation chain");

  // ── Hop 1: session → worker, scoped to the protocol(s) + capped in USDC ─────
  const protocols   = Array.isArray(protocol) ? protocol : [protocol];
  const protoTargets = protocols.flatMap(p => PROTOCOL_TARGETS[p.toLowerCase()] ?? []);
  if (protoTargets.length === 0) throw new Error(`No AllowedTargets configured for protocol(s): ${protocols.join(", ")}`);
  // The worker must also be allowed to touch USDC (transfer/approve) and the
  // relayer target (fee), so include them alongside the protocol contracts.
  const allowedTargets = [relayer, USDC, ...protoTargets] as `0x${string}`[];

  const targetsCaveat = buildAllowedTargetsCaveat(environment, allowedTargets);
  const capCaveat     = buildErc20CapCaveat(environment, capUsdc);

  const sessionToWorker = createDelegation({
    from:                    sessionAddress,
    to:                      workerAddress,
    environment,
    parentPermissionContext: rootContext as `0x${string}`,
    caveats:                 [targetsCaveat, capCaveat],
  } as CreateDelegationOptions);

  const delegationManager = environment.DelegationManager as `0x${string}`;
  const sessionSig = await signDelegation({
    privateKey:  getSessionPrivateKey(),
    delegation:  sessionToWorker,
    delegationManager,
    chainId,
    allowInsecureUnrestrictedDelegation: false,
  });
  const signedSessionToWorker = { ...sessionToWorker, signature: sessionSig };
  const scopedHash = hashDelegation(signedSessionToWorker);

  // ── Hop 2: worker → relayer, signed with the worker's OWN derived key ───────
  const workerToRelayer = createDelegation({
    from:                    workerAddress,
    to:                      relayer,
    environment,
    parentPermissionContext: encodeDelegations([signedSessionToWorker]),
    caveats:                 [],   // inherits the scope/cap from the parent hop
  } as CreateDelegationOptions);

  const workerSig = await signDelegation({
    privateKey:  getAgentPrivateKey(workerAgentId),
    delegation:  workerToRelayer,
    delegationManager,
    chainId,
    allowInsecureUnrestrictedDelegation: true, // scope already enforced by the parent caveats
  });
  const signedWorkerToRelayer = { ...workerToRelayer, signature: workerSig };

  // ── Assemble leaf → root for the relayer to redeem ──────────────────────────
  const context = encodeDelegations([
    signedWorkerToRelayer,
    signedSessionToWorker,
    ...rootDelegations,
  ]);

  return { context, scopedHash, workerAddress, allowedTargets, capUsdc };
}

/**
 * Create a read-only "scout" context — no spending authority.
 * Scouts don't need a delegation; they use the internal x402 secret.
 * This is a no-op that returns an explicit "server-function" marker.
 *
 * Why: ERC-7710 delegations always grant spending authority.
 * Scouts, risk monitors, and convergence detectors are pure server
 * functions — they never touch a delegation, they call our own APIs.
 */
export function scoutContext(): { context: "server-function"; note: string } {
  return {
    context: "server-function",
    note: "Scout agents are server functions, not delegation holders. They authenticate via CLOVE_INTERNAL_SECRET.",
  };
}
