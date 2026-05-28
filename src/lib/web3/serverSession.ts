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

// Session private key — stays server-side only.
const SESSION_PRIVATE_KEY = (
  process.env.CLOVE_SESSION_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
) as `0x${string}`;

const rpcUrl = process.env.BASE_RPC ?? process.env.BASE_SEPOLIA_RPC ?? "https://mainnet.base.org";

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(rpcUrl),
});

export const environment = getSmartAccountsEnvironment(CHAIN.id);

// Bug 8 fix: don't singleton-cache — hot-reload and env changes invalidate this.
// getSessionAccount() is called infrequently (revoke, redelegate), so no perf hit.
export async function getSessionAccount() {
  const signer = privateKeyToAccount(SESSION_PRIVATE_KEY);
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
  const signer = privateKeyToAccount(SESSION_PRIVATE_KEY);
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
