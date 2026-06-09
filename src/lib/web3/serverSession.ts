import "server-only";

import {
  toMetaMaskSmartAccount,
  Implementation,
  getSmartAccountsEnvironment,
} from "@metamask/smart-accounts-kit";
import { erc7710WalletActions } from "@metamask/smart-accounts-kit/actions";
import { createPublicClient, createWalletClient, http, keccak256, encodePacked } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, USDC_ADDRESS } from "./config";
import { getSessionPrivateKey } from "@/lib/config/env";

// RPC URL: explicit Base mainnet override, else the configured chain's own
// default RPC. CLOVE runs on Base mainnet only — no testnet fallback.
const rpcUrl =
  process.env.BASE_RPC ??
  CHAIN.rpcUrls.default.http[0];

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(rpcUrl),
});

export const environment = getSmartAccountsEnvironment(CHAIN.id);

// Bug 8 fix: don't singleton-cache — hot-reload and env changes invalidate this.
// getSessionAccount() is called infrequently (revoke, redelegate), so no perf hit.
export async function getSessionAccount() {
  const signer = privateKeyToAccount(getSessionPrivateKey());
  return toMetaMaskSmartAccount({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [signer.address, [], [], []],
    deploySalt: signer.address,
    signer: { account: signer },
  });
}

export async function getSessionAddress(): Promise<`0x${string}`> {
  const account = await getSessionAccount();
  return account.address;
}

/**
 * Per-agent DERIVED key (option C).
 *
 * Each agent gets its OWN private key, derived deterministically from the single
 * root session key: childKey = keccak256(rootKey ‖ agentId). This gives every
 * agent a genuinely independent signer + smart account (truly separate on-chain
 * identities), while only ONE secret (CLOVE_SESSION_KEY) is ever stored.
 *
 * This is what makes A2A real: the orchestrator redelegates a scoped budget to
 * each worker's smart account, and the worker signs/redeems with its OWN key.
 */
export function getAgentPrivateKey(agentId: string): `0x${string}` {
  const root = getSessionPrivateKey() as `0x${string}`;
  return keccak256(encodePacked(["bytes32", "string"], [root, agentId]));
}

/** The per-agent EOA signer derived from the root key. */
export function getAgentSigner(agentId: string) {
  return privateKeyToAccount(getAgentPrivateKey(agentId));
}

/**
 * EOA addresses (NOT smart accounts) for delegation chains.
 *
 * When a delegation is signed with a raw private key, the DelegationManager
 * recovers an ECDSA signature and compares it to the `delegator` address. So the
 * delegator MUST be the EOA address of the signing key — using a counterfactual
 * smart-account address there throws InvalidEOASignature(). These helpers return
 * the EOA addresses used as delegators in buildRedeemableWorkerChain.
 */
export function getSessionEoaAddress(): `0x${string}` {
  return privateKeyToAccount(getSessionPrivateKey()).address;
}
export function getAgentEoaAddress(agentId: string): `0x${string}` {
  return getAgentSigner(agentId).address;
}

/** The per-agent MetaMask smart account, OWNED by the agent's derived key. */
export async function getAgentSmartAccount(agentId: string) {
  const signer = getAgentSigner(agentId);
  return toMetaMaskSmartAccount({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [signer.address, [], [], []],
    deploySalt:   "0x", // the derived key already makes the address unique
    signer:       { account: signer },
  });
}

/** Deterministic counterfactual address for an agent (owned by its derived key). */
export async function getAgentSmartAccountAddress(agentId: string): Promise<`0x${string}`> {
  const account = await getAgentSmartAccount(agentId);
  return account.address;
}

/**
 * Bug 4 fix — ERC-7710 actions must sit on the MetaMask smart account,
 * NOT on the raw EOA.  Using the EOA causes 0xb5863604 reverts because
 * DelegationManager checks that the caller is the registered smart account.
 */
export async function getSessionWalletClient() {
  const account = await getSessionAccount();
  return createWalletClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    account: account as any,
    chain: CHAIN,
    transport: http(rpcUrl),
  }).extend(erc7710WalletActions());
}

export { USDC_ADDRESS, CHAIN };
