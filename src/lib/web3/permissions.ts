"use client";

import { createWalletClient, createPublicClient, custom, http, parseUnits, encodeFunctionData } from "viem";
import { erc7715ProviderActions } from "@metamask/smart-accounts-kit/actions";
import { hashDelegation, decodeDelegations, encodeDelegations } from "@metamask/smart-accounts-kit/utils";
import {
  getSmartAccountsEnvironment,
  toMetaMaskSmartAccount,
  Implementation,
  createDelegation,
} from "@metamask/smart-accounts-kit";
import { CHAIN, USDC_ADDRESS } from "./config";

// USDC on Polygon mainnet (for Polymarket agent permissions)
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as const;
// Polygon mainnet chain ID
const POLYGON_CHAIN_ID = 137;

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      isMetaMask?: boolean;
    };
  }
}

// ── Wallet / capability detection ──────────────────────────────────────────────

export type WalletCapability = "none" | "metamask" | "flask" | "mm-advanced";

/**
 * Detect which MetaMask variant is installed.
 *
 * Production MetaMask ≥ v13.23.0 supports `erc20-token-periodic` Advanced
 * Permissions (per MetaMask's Supported Advanced Permissions table). We do NOT
 * probe `wallet_grantPermissions` (that throws a misleading -32601 on a plain
 * EOA even when the wallet would support the grant after a smart-account
 * upgrade). Instead we report by version, and let requestUsdcPermission attempt
 * the real grant (with manual signing as a fallback).
 */
export async function detectWalletCapability(): Promise<{
  capability: WalletCapability;
  version: string;
  supportsERC7715: boolean;
  isFlask: boolean;
}> {
  if (typeof window === "undefined" || !window.ethereum) {
    return { capability: "none", version: "", supportsERC7715: false, isFlask: false };
  }
  if (!window.ethereum.isMetaMask) {
    return { capability: "none", version: "", supportsERC7715: false, isFlask: false };
  }

  let version = "";
  try {
    version = (await window.ethereum.request({ method: "web3_clientVersion" })) as string ?? "";
  } catch { /* ignore */ }

  const isFlask = version.toLowerCase().includes("flask");

  // Parse "MetaMask/v13.32.1" → 13.23.0 is the production threshold for erc20-periodic.
  const verMatch = version.match(/v?(\d+)\.(\d+)\.(\d+)/);
  let supportsERC7715 = isFlask;
  if (!isFlask && verMatch) {
    const [maj, min] = [Number(verMatch[1]), Number(verMatch[2])];
    supportsERC7715 = maj > 13 || (maj === 13 && min >= 23);
  } else if (!isFlask && !verMatch) {
    // Unknown version string — assume modern MetaMask supports it; the grant
    // call will fall back to manual signing if not.
    supportsERC7715 = true;
  }

  const capability: WalletCapability = isFlask ? "flask" : supportsERC7715 ? "mm-advanced" : "metamask";
  return { capability, version, supportsERC7715, isFlask };
}

/** Returns true when any MetaMask-compatible wallet is installed. */
export function isMetaMaskInstalled(): boolean {
  return typeof window !== "undefined" && !!window.ethereum?.isMetaMask;
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
  /** Chain the permission was granted on. 8453 = Base, 137 = Polygon */
  chainId?: number;
  /** Set after the permission is stored in 1Shot API. */
  delegationId?: string;
}

/**
 * Request a USDC periodic spending permission from the user.
 *
 * PRIMARY: ERC-7715 Advanced Permissions via `requestExecutionPermissions`.
 *   - Supported on PRODUCTION MetaMask ≥ v13.23.0 for `erc20-token-periodic`
 *     (per MetaMask's "Supported Advanced Permissions" table) — NO Flask needed.
 *   - Shows the rich human-readable permission UI (amount / period / token).
 *   - Requires the user's account to be a MetaMask smart account; recent MetaMask
 *     upgrades the EOA automatically (EIP-7702) during the grant.
 *
 * FALLBACK: manual EIP-712 delegation signing (`signDelegation`).
 *   - Used only if the wallet doesn't expose `wallet_grantPermissions`
 *     (older MetaMask). Produces the same ABI permissionsContext.
 *
 * @param delegateTo     Session account / relayer target that will redeem
 * @param budgetUsdc     Max USDC per period, e.g. "2"
 * @param periodDays     Period length in days (allowance resets each period)
 * @param justification  Human-readable reason shown in MetaMask
 * @param targetChainId  8453 (Base) or 137 (Polygon)
 */
export async function requestUsdcPermission(
  delegateTo: `0x${string}`,
  budgetUsdc: string,
  periodDays: number,
  justification: string,
  targetChainId: number = CHAIN.id,
): Promise<GrantedPermission> {
  if (!window.ethereum) throw new Error("MetaMask not found");

  // ── 1. Connect + switch chain ─────────────────────────────────────────────
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
  const userEoa = accounts[0] as `0x${string}`;
  if (!userEoa) throw new Error("No account connected in MetaMask");

  await window.ethereum.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${targetChainId.toString(16)}` }],
  }).catch(() => { /* already on chain */ });

  const usdcAddress   = targetChainId === POLYGON_CHAIN_ID ? USDC_POLYGON : USDC_ADDRESS;
  const currentTime   = Math.floor(Date.now() / 1000);
  const periodSeconds = periodDays * 24 * 60 * 60;
  const expiry        = currentTime + 90 * 24 * 60 * 60; // permission valid 90 days

  // ── 2. PRIMARY: ERC-7715 Advanced Permissions (rich UI, production MM v13.23+) ──
  try {
    const walletClient = createWalletClient({
      transport: custom(window.ethereum),
    }).extend(erc7715ProviderActions());

    const granted = await walletClient.requestExecutionPermissions([{
      chainId: targetChainId,
      expiry,
      to: delegateTo,
      permission: {
        type: "erc20-token-periodic",
        data: {
          tokenAddress:   usdcAddress,
          periodAmount:   parseUnits(budgetUsdc, 6),
          periodDuration: periodSeconds,
          startTime:      currentTime,
          justification,
        },
        isAdjustmentAllowed: true,
      },
    }]);

    const first = granted[0];
    if (!first) throw new Error("No permission returned from MetaMask");

    const permissionsContext = (first as { context?: string }).context
      ?? JSON.stringify(granted);
    let delegationManager =
      (first as { delegationManager?: string }).delegationManager as `0x${string}`
      ?? (first as { signerMeta?: { delegationManager?: string } }).signerMeta?.delegationManager as `0x${string}`;
    if (!delegationManager || delegationManager.length < 10) {
      delegationManager = getSmartAccountsEnvironment(targetChainId).DelegationManager as `0x${string}`;
    }

    return {
      permissionsContext,
      delegationManager,
      grantedTo:  delegateTo,
      budgetUsdc,
      periodDays,
      expiresAt:  expiry,
      chainId:    targetChainId,
    };
  } catch (e: unknown) {
    const code = (e as { code?: number })?.code;
    const msg  = ((e as { message?: string })?.message ?? "").toLowerCase();
    const methodMissing =
      code === -32601 ||
      msg.includes("does not exist") ||
      msg.includes("not found") ||
      msg.includes("not supported") ||
      msg.includes("unsupported method");

    // A real rejection (user denied, etc.) — surface it, don't fall back.
    if (!methodMissing) throw e;

    // ── 3. FALLBACK: manual EIP-712 delegation signing (older MetaMask) ──────
    console.warn("[permissions] Advanced Permissions unavailable; using manual delegation signing");
    return signDelegationManually(userEoa, delegateTo, budgetUsdc, periodDays, targetChainId);
  }
}

/**
 * Manual EIP-712 delegation signing fallback.
 *
 * Uses Implementation.Stateless7702 so the delegator address == the user's EOA.
 * This keeps on-chain revocation simple: the user calls disableDelegation()
 * from their EOA, and msg.sender == delegator, so it's accepted.
 */
async function signDelegationManually(
  userEoa: `0x${string}`,
  delegateTo: `0x${string}`,
  budgetUsdc: string,
  periodDays: number,
  targetChainId: number,
): Promise<GrantedPermission> {
  const environment  = getSmartAccountsEnvironment(targetChainId);
  const publicClient = createPublicClient({ chain: CHAIN, transport: http() });
  const walletClient = createWalletClient({ account: userEoa, transport: custom(window.ethereum!) });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const smartAccount = await toMetaMaskSmartAccount({
    client:         publicClient as any,
    implementation: Implementation.Stateless7702,
    address:        userEoa,                 // smart account address == EOA
    signer:         { walletClient: walletClient as any },
  });

  const delegation = createDelegation({
    from:  smartAccount.address,
    to:    delegateTo,
    environment,
    salt:  `0x${Date.now().toString(16).padStart(64, "0")}` as `0x${string}`,
    scope: {
      type:         "erc20TransferAmount" as const,
      tokenAddress: (targetChainId === POLYGON_CHAIN_ID ? USDC_POLYGON : USDC_ADDRESS),
      maxAmount:    parseUnits(budgetUsdc, 6),
    },
  });

  const signature   = await smartAccount.signDelegation({ delegation });
  const signedDeleg = { ...delegation, signature };

  return {
    permissionsContext: encodeDelegations([signedDeleg]),
    delegationManager:  environment.DelegationManager as `0x${string}`,
    grantedTo:          delegateTo,
    budgetUsdc,
    periodDays,
    expiresAt:          Math.floor(Date.now() / 1000) + periodDays * 24 * 60 * 60,
    chainId:            targetChainId,
  };
}

/**
 * Request an ERC-7715 permission scoped for the 1Shot Public Relayer.
 *
 * For the public relayer path, the user grants directly TO the relayer's
 * targetAddress (0x26a5…). No sub-delegation is needed — the bundle
 * includes both the USDC fee and the DeFi action.
 *
 * This is a SEPARATE grant from the executeAsDelegator grant (which goes
 * to the 1Shot wallet 0x7195…). Both can coexist independently.
 */
export async function requestRelayerPermission(
  budgetUsdc: string,
  periodDays: number,
): Promise<GrantedPermission> {
  // Relayer's targetAddress on Base mainnet (from relayer_getCapabilities)
  const RELAYER_TARGET = "0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a" as `0x${string}`;
  return requestUsdcPermission(
    RELAYER_TARGET,
    budgetUsdc,
    periodDays,
    "CLOVE agents — pay for DeFi execution + gas in USDC via 1Shot Public Relayer",
    CHAIN.id,
  );
}

/**
 * Request a Polygon ERC-7715 permission specifically for the Polymarket agent.
 *
 * Uses chainId 137 (Polygon) so the agent can place CLOB bets on Polymarket
 * using ERC-7710 delegation redemption — the same MetaMask DelegationManager
 * is deployed on Polygon at 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3.
 *
 * This makes Polymarket the ONLY agent in CLOVE that uses cross-chain ERC-7715:
 * all other agents run on Base (8453); Polymarket runs on Polygon (137).
 */
export async function requestPolymarketPermission(
  budgetUsdc: string,
  periodDays: number,
): Promise<GrantedPermission> {
  // Switch MetaMask to Polygon first
  try {
    await window.ethereum?.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x89" }], // 0x89 = 137 (Polygon)
    });
  } catch (switchErr: unknown) {
    // Chain not added yet — add it
    if ((switchErr as { code?: number })?.code === 4902) {
      await window.ethereum?.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x89",
          chainName: "Polygon Mainnet",
          nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
          rpcUrls: ["https://polygon-rpc.com"],
          blockExplorerUrls: ["https://polygonscan.com"],
        }],
      });
    } else throw switchErr;
  }

  // Polygon relayer targetAddress (same relayer, different chain)
  const POLYGON_RELAYER = "0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a" as `0x${string}`;
  return requestUsdcPermission(
    POLYGON_RELAYER,
    budgetUsdc,
    periodDays,
    "CLOVE Polymarket agent — places prediction market bets on Polygon",
    POLYGON_CHAIN_ID,
  );
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
