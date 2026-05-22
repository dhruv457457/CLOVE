"use client";

import { createWalletClient, custom, parseUnits, encodeFunctionData } from "viem";
import { erc7715ProviderActions } from "@metamask/smart-accounts-kit/actions";
import { hashDelegation, decodeDelegations } from "@metamask/smart-accounts-kit/utils";
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

  const grantedPermissions = await walletClient.requestExecutionPermissions([
    {
      chainId: CHAIN.id,
      to: sessionAddress, // CLOVE's smart account — NOT the user's EOA
      expiry,
      permission: {
        type: "erc20-token-periodic" as const,
        isAdjustmentAllowed: true,
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
  const delegationManager: `0x${string}` =
    ((first as { signerMeta?: { delegationManager?: string } }).signerMeta
      ?.delegationManager as `0x${string}`) ?? "0x";

  return {
    permissionsContext,
    delegationManager,
    grantedTo: sessionAddress,
    budgetUsdc,
    periodDays,
    expiresAt: expiry,
  };
}

/** Persist permission to localStorage. */
export function savePermission(permission: GrantedPermission) {
  localStorage.setItem("clove_permission", JSON.stringify(permission));
}

/** Load saved permission from localStorage. */
export function loadPermission(): GrantedPermission | null {
  try {
    const raw = localStorage.getItem("clove_permission");
    return raw ? (JSON.parse(raw) as GrantedPermission) : null;
  } catch {
    return null;
  }
}

export function clearPermission() {
  localStorage.removeItem("clove_permission");
}

// ── On-chain Revocation ────────────────────────────────────────────────────────

const DISABLE_DELEGATION_ABI = [{
  name: "disableDelegation",
  type: "function" as const,
  inputs: [{ name: "_delegation", type: "bytes32" }],
  stateMutability: "nonpayable" as const,
  outputs: [],
}];

export interface RevocationResult {
  txHash: `0x${string}`;
  delegationHash: `0x${string}`;
}

/**
 * Revoke a granted ERC-7715 permission on-chain.
 * The user's MetaMask wallet (delegator) sends a transaction to
 * DelegationManager.disableDelegation(delegationHash).
 *
 * After this call the delegation is permanently disabled — no future
 * redemptions are possible even if the permissionsContext is still stored.
 */
export async function revokePermissionOnChain(
  permission: GrantedPermission,
  userAddress: `0x${string}`
): Promise<RevocationResult> {
  if (!window.ethereum) throw new Error("MetaMask not found");

  // Decode the hex-encoded delegation chain to get the root delegation struct
  const delegations = decodeDelegations(permission.permissionsContext as `0x${string}`);
  if (!delegations.length) throw new Error("No delegations found in permissionsContext");

  const rootDelegation = delegations[0];
  const delegationHash = hashDelegation(rootDelegation);

  // Encode the disableDelegation call
  const calldata = encodeFunctionData({
    abi: DISABLE_DELEGATION_ABI,
    functionName: "disableDelegation",
    args: [delegationHash],
  });

  // Send via MetaMask (user signs a regular transaction as the delegator)
  const txHash = (await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{
      from: userAddress,
      to: permission.delegationManager,
      data: calldata,
      chainId: `0x${CHAIN.id.toString(16)}`,
    }],
  })) as `0x${string}`;

  return { txHash, delegationHash };
}
