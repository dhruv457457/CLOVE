import "server-only";

import { getOneShotClient } from "./client";

/** Returns the 1Shot server wallet address for CLOVE's agent session account. */
export async function getAgentWalletAddress(): Promise<`0x${string}`> {
  const walletId = process.env.ONESHOT_WALLET_ID;
  if (!walletId) {
    throw new Error("ONESHOT_WALLET_ID is not set. Create a server wallet in 1Shot and set this env var.");
  }

  const client = getOneShotClient();
  const businessId = process.env.ONESHOT_BUSINESS_ID ?? "";

  // List wallets and find the one matching our wallet ID
  const { response: wallets } = await client.wallets.list(businessId, {
    page: 1,
    pageSize: 50,
  });

  const wallet = wallets.find((w) => w.id === walletId);
  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found in 1Shot account.`);
  }

  return wallet.accountAddress as `0x${string}`;
}

/**
 * Store an ERC-7715 permission context in 1Shot so we can later redelegate it.
 * Returns the stored delegation ID.
 */
export async function storeDelegation(
  permissionsContext: string,
  expiresAt: number
): Promise<string> {
  const walletId = process.env.ONESHOT_WALLET_ID ?? "";
  const client = getOneShotClient();

  const delegation = await client.wallets.createDelegation(walletId, {
    // 1Shot expects an array of delegation JSON strings.
    // The MetaMask ERC-7715 permissionsContext is a hex-encoded chain;
    // we wrap it in an array as a single-element serialised delegation.
    delegationData: [permissionsContext],
    startTime: Math.floor(Date.now() / 1000),
    endTime: expiresAt,
    contractAddresses: undefined,
    methods: undefined,
  });

  return delegation.id;
}

/**
 * Redelegate a stored delegation (by ID) to a target address.
 * Returns { parent, redelegation } as JSON strings for use in x402 payloads.
 */
export async function redelegateToFacilitator(
  delegationId: string,
  facilitatorAddress: `0x${string}`
): Promise<{ parent: string; redelegation: string }> {
  const client = getOneShotClient();

  const result = await client.wallets.redelegate(delegationId, {
    delegateAddress: facilitatorAddress,
  });

  return { parent: result.parent, redelegation: result.redelegation };
}

/**
 * Redelegate a one-time permission context (not stored in 1Shot) to a target address.
 * The wallet's address must match the `to` field in the delegation.
 */
export async function redelegatePermissionContextOnce(
  permissionsContext: string,
  facilitatorAddress: `0x${string}`
): Promise<{ parent: string; redelegation: string }> {
  const walletId = process.env.ONESHOT_WALLET_ID ?? "";
  const client = getOneShotClient();

  const result = await client.wallets.redelegateWithDelegationData(walletId, {
    delegationData: permissionsContext,
    delegateAddress: facilitatorAddress,
  });

  return { parent: result.parent, redelegation: result.redelegation };
}
