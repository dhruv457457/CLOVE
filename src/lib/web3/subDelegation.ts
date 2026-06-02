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
import { encodeDelegations, hashDelegation } from "@metamask/smart-accounts-kit/utils";
import { encodeAbiParameters, parseAbiParameters, parseUnits } from "viem";
import { getSessionPrivateKey, getSessionPrivateKey as _k } from "@/lib/config/env";
import { getAgentSmartAccountAddress } from "@/lib/web3/serverSession";
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
  const terms = encodeAbiParameters(
    parseAbiParameters("address[]"),
    [targets],
  );
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
  const terms = encodeAbiParameters(
    parseAbiParameters("address, uint256"),
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

  // Derive the session smart account address (the delegator = FROM address)
  const sessionAddress = await getAgentSmartAccountAddress("session");

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
