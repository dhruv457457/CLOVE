import "server-only";

import {
  toMetaMaskSmartAccount,
  Implementation,
  getSmartAccountsEnvironment,
} from "@metamask/smart-accounts-kit";
import { erc7710WalletActions } from "@metamask/smart-accounts-kit/actions";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, USDC_ADDRESS } from "./config";

// Session private key — stays server-side only.
// Replace with a real key via CLOVE_SESSION_KEY env var.
// Demo fallback is Hardhat account #0 (publicly known — fine for testnet demos).
const SESSION_PRIVATE_KEY = (
  process.env.CLOVE_SESSION_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
) as `0x${string}`;

const rpcUrl = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(rpcUrl),
});

export const environment = getSmartAccountsEnvironment(CHAIN.id);

let _sessionAccount: Awaited<ReturnType<typeof toMetaMaskSmartAccount>> | null = null;

export async function getSessionAccount() {
  if (_sessionAccount) return _sessionAccount;
  const signer = privateKeyToAccount(SESSION_PRIVATE_KEY);
  _sessionAccount = await toMetaMaskSmartAccount({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [signer.address, [], [], []],
    deploySalt: signer.address,
    signer: { account: signer },
  });
  return _sessionAccount;
}

export async function getSessionAddress(): Promise<`0x${string}`> {
  const account = await getSessionAccount();
  return account.address;
}

/** Wallet client for the session EOA, extended with ERC-7710 wallet actions. */
export function getSessionWalletClient() {
  const signer = privateKeyToAccount(SESSION_PRIVATE_KEY);
  return createWalletClient({
    account: signer,
    chain: CHAIN,
    transport: http(rpcUrl),
  }).extend(erc7710WalletActions());
}

export { USDC_ADDRESS, CHAIN };
