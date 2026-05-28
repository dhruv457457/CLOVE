"use client";

import { createWalletClient, custom, parseUnits, encodeFunctionData } from "viem";
import { erc7715ProviderActions } from "@metamask/smart-accounts-kit/actions";
import { hashDelegation, decodeDelegations } from "@metamask/smart-accounts-kit/utils";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import { CHAIN, USDC_ADDRESS } from "./config";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      isMetaMask?: boolean;
    };
  }
}

/** Returns true only when MetaMask Flask (not regular MM) is present. */
export async function isFlaskInstalled(): Promise<boolean> {
  if (typeof window === "undefined" || !window.ethereum) return false;
  try {
    const version = await window.ethereum.request({ method: "web3_clientVersion" });
    return String(version).toLowerCase().includes("flask");
  } catch {
    return false;
  }
}

/** Prompt the user to connect their MetaMask account and return address. */
export async function connectWallet(): Promise<`0x${string}` | null> {
  if (!window.ethereum) return null;
  const accounts = (await window.ethereum.request({
    method: "eth_requestAccounts",
  })) as string[];
  return (accounts[0] as `0x${string}`) ?? null;
}

/** Get already-connected addresses without prompting. */
export async function getConnectedAccounts(): Promise<`0x${string}`[]> {
  if (!window.ethereum) return [];
  const accounts = (await window.ethereum.request({
    method: "eth_accounts",
  })) as string[];
  return accounts as `0x${string}`[];
}

export interface GrantedPermission {
  permissionsContext: string;
  delegationManager: `0x${string}`;
  grantedTo: `0x${string}`;
  budgetUsdc: string;
  periodDays: number;
  expiresAt: number;
  /** Set after the permission is stored in 1Shot API. */
  delegationId?: string;
}

/**
 * Request an ERC-7715 ERC-20 periodic permission from the connected MetaMask Flask account.
 * @param sessionAddress The CLOVE agent smart account that will redeem this permission.
 * @param budgetUsdc     Max USDC spend per period, e.g. "50"
 * @param periodDays     Period length in days, e.g. 30
 * @param justification  Human-readable reason shown in MetaMask
 */
export async function requestUsdcPermission(
  sessionAddress: `0x${string}`,
  budgetUsdc: string,
  periodDays: number,
  justification: string
): Promise<GrantedPermission> {
  if (!window.ethereum) throw new Error("MetaMask not found");

  const walletClient = createWalletClient({
    transport: custom(window.ethereum),
  }).extend(erc7715ProviderActions());

  const currentTime = Math.floor(Date.now() / 1000);
  const expiry = currentTime + 90 * 24 * 60 * 60; // 90 days

  // Bug 9 fix: isAdjustmentAllowed belongs at the TOP LEVEL of the grant object,
  // not nested inside `permission`.  Placing it inside `permission` is non-standard
  // and MetaMask Flask silently ignores it, preventing future budget adjustments.
  const grantedPermissions = await walletClient.requestExecutionPermissions([
    {
      chainId: CHAIN.id,
      to: sessionAddress, // CLOVE's smart account — NOT the user's EOA
      expiry,
      // isAdjustmentAllowed belongs top-level per ERC-7715 spec but the SDK's
      // PermissionRequestParameter type only allows it inside `permission`.
      permission: {
        type: "erc20-token-periodic" as const,
        isAdjustmentAllowed: true,   // ← SDK BasePermission requires it here
        data: {
          tokenAddress: USDC_ADDRESS,
          periodAmount: parseUnits(budgetUsdc, 6),
          periodDuration: periodDays * 24 * 60 * 60,
          startTime: currentTime,
          justification,
        },
      },
    },
  ]);

  const first = grantedPermissions[0];
  if (!first) throw new Error("No permissions returned from MetaMask");

  const permissionsContext: string =
    (first as { context?: string }).context ?? JSON.stringify(grantedPermissions);

  // Regular MetaMask v12+ doesn't include `signerMeta` in the response (only
  // Flask does). Fall back to the chain's canonical DelegationManager address
  // from the smart-accounts-kit environment.
  let delegationManager: `0x${string}` =
    ((first as { signerMeta?: { delegationManager?: string } }).signerMeta
      ?.delegationManager as `0x${string}`) ?? "0x";
  if (delegationManager === "0x" || delegationManager.length < 10) {
    try {
      const env = getSmartAccountsEnvironment(CHAIN.id);
      const envAddr = (env as { DelegationManager?: string; delegationManager?: string })
        .DelegationManager ?? (env as { delegationManager?: string }).delegationManager;
      if (envAddr) delegationManager = envAddr as `0x${string}`;
    } catch { /* keep "0x" */ }
  }

  return {
    permissionsContext,
    delegationManager,
    grantedTo: sessionAddress,
    budgetUsdc,
    periodDays,
    expiresAt: expiry,
  };
}

/**
 * Permission persistence has moved to MongoDB (server-side).
 * These are kept as no-ops so existing call-sites don't break while
 * the store handles all loading/saving via /api/permission.
 */
export function savePermission(_permission: GrantedPermission) {
  // no-op — store handles persistence via API
}

export function loadPermission(): GrantedPermission | null {
  // no-op — store fetches from API after wallet connects
  return null;
}

export function clearPermission() {
  // no-op — store calls DELETE /api/permission
}

// ── On-chain Revocation ────────────────────────────────────────────────────────

/**
 * ABI for DelegationManager.disableDelegation(Delegation _delegation)
 * The function takes the FULL Delegation struct, not a bytes32 hash.
 * Source: @metamask/smart-accounts-kit dist/index-DXdlz7t4.d.ts
 */
const DISABLE_DELEGATION_ABI = [{
  name: "disableDelegation",
  type: "function" as const,
  stateMutability: "nonpayable" as const,
  inputs: [{
    name: "_delegation",
    type: "tuple",
    components: [
      { name: "delegate",  type: "address" },
      { name: "delegator", type: "address" },
      { name: "authority", type: "bytes32" },
      {
        name: "caveats",
        type: "tuple[]",
        components: [
          { name: "enforcer", type: "address" },
          { name: "terms",    type: "bytes"   },
          { name: "args",     type: "bytes"   },
        ],
      },
      { name: "salt",      type: "uint256" },
      { name: "signature", type: "bytes"   },
    ],
  }],
  outputs: [],
}] as const;

export interface RevocationResult {
  txHash: `0x${string}`;
  delegationHash: `0x${string}`;
}

/**
 * Revoke a granted ERC-7715 permission on-chain.
 *
 * Calls DelegationManager.disableDelegation(Delegation) from the user's
 * MetaMask account (the delegator).  The contract hashes the struct internally
 * and marks that hash as disabled — no future redemptions are possible.
 */
export async function revokePermissionOnChain(
  permission: GrantedPermission,
  userAddress: `0x${string}`
): Promise<RevocationResult> {
  if (!window.ethereum) throw new Error("MetaMask not found");

  // Decode the ABI-encoded delegation chain stored in permissionsContext
  const delegations = decodeDelegations(permission.permissionsContext as `0x${string}`);
  if (!delegations.length) throw new Error("No delegations found in permissionsContext");

  const rootDelegation = delegations[0];
  const delegationHash = hashDelegation(rootDelegation);

  // Encode: disableDelegation(Delegation struct) — NOT a bytes32 hash
  // The SDK Delegation type has salt as `0x${string}` but the ABI tuple needs bigint;
  // cast through unknown so viem can ABI-encode it correctly.
  const calldata = encodeFunctionData({
    abi: DISABLE_DELEGATION_ABI,
    functionName: "disableDelegation",
    args: [rootDelegation as unknown as {
      delegate:  `0x${string}`;
      delegator: `0x${string}`;
      authority: `0x${string}`;
      caveats:   { enforcer: `0x${string}`; terms: `0x${string}`; args: `0x${string}` }[];
      salt:      bigint;
      signature: `0x${string}`;
    }],
  });

  // Send via MetaMask — user (delegator) signs the transaction
  const txHash = (await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{
      from:    userAddress,
      to:      permission.delegationManager,
      data:    calldata,
      chainId: `0x${CHAIN.id.toString(16)}`,
    }],
  })) as `0x${string}`;

  return { txHash, delegationHash };
}
