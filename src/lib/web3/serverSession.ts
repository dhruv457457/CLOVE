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
 * Bug 3 fix — per-agent smart account address.
 *
 * Each agent gets a deterministic counterfactual smart account address derived
 * from keccak256(signerAddress || agentId).  The account is NOT deployed until
 * the agent actually executes — it's purely address derivation (cheap).
 *
 * This gives each agent an independent on-chain identity so sub-delegations
 * scope correctly (A → B → C, each with separate caps and revocations).
 */
export async function getAgentSmartAccountAddress(agentId: string): Promise<`0x${string}`> {
  const signer = privateKeyToAccount(getSessionPrivateKey());
  const salt   = keccak256(encodePacked(["address", "string"], [signer.address, agentId]));
  const account = await toMetaMaskSmartAccount({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [signer.address, [], [], []],
    deploySalt:    salt,
    signer:        { account: signer },
  });
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
