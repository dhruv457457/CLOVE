"use client";

import { encodeFunctionData, parseUnits, createWalletClient, createPublicClient, custom, http } from "viem";
import { CHAIN } from "./config";

// Protocol addresses on Base mainnet
const USDC    = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const AAVE_V3 = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" as const;
const MORPHO_MOONWELL = "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca" as const;
const UNISWAP_ROUTER  = "0x2626664c2603336E57B271c5C0b26F421741e481" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631" as const;
const AERODROME_ROUTER = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43" as const;
const AERODROME_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as const;

// ABIs
const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
] as const;

const AAVE_ABI = [
  { name: "supply", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "asset",       type: "address" },
      { name: "amount",      type: "uint256" },
      { name: "onBehalfOf",  type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [] },
] as const;

const MORPHO_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }],
    outputs: [{ name: "shares", type: "uint256" }] },
] as const;

const UNISWAP_ABI = [
  { name: "exactInputSingle", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "params", type: "tuple", components: [
      { name: "tokenIn",           type: "address" },
      { name: "tokenOut",          type: "address" },
      { name: "fee",               type: "uint24"  },
      { name: "recipient",         type: "address" },
      { name: "amountIn",          type: "uint256" },
      { name: "amountOutMinimum",  type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ]}],
    outputs: [{ name: "amountOut", type: "uint256" }] },
] as const;

export type ExecStatus = "idle" | "approving" | "depositing" | "done" | "error";

export interface DepositResult {
  txHash: string;
  protocol: string;
  amount: string;
}

/** Approve spender if current allowance is insufficient. */
async function ensureApproval(
  userAddress: `0x${string}`,
  spender: `0x${string}`,
  amountAtoms: bigint,
): Promise<string | null> {
  if (!window.ethereum) throw new Error("MetaMask not found");

  const pub = createPublicClient({ chain: CHAIN, transport: http() });

  const allowance = await pub.readContract({
    address: USDC, abi: ERC20_ABI, functionName: "allowance",
    args: [userAddress, spender],
  }) as bigint;

  if (allowance >= amountAtoms) return null; // already approved

  const approveTx = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{
      from: userAddress,
      to:   USDC,
      data: encodeFunctionData({
        abi: ERC20_ABI, functionName: "approve",
        args: [spender, amountAtoms * 10n], // approve 10× for future runs
      }),
      chainId: `0x${CHAIN.id.toString(16)}`,
    }],
  });

  return approveTx as string;
}

/**
 * Execute a real DeFi deposit using standard MetaMask transactions.
 * User signs approve + deposit — no delegation needed.
 * Equivalent to TANA_TAN's useExecute pattern.
 */
export async function executeRealDeposit(
  userAddress: `0x${string}`,
  protocol: string,
  amountUsdc: number,
  onStatus: (s: ExecStatus) => void,
): Promise<DepositResult> {
  if (!window.ethereum) throw new Error("MetaMask not found");

  // Switch to Base
  await window.ethereum.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${CHAIN.id.toString(16)}` }],
  }).catch(() => {});

  const amountAtoms = parseUnits(String(amountUsdc), 6);
  const proto = protocol.toLowerCase();

  // ── Step 1: Approve ─────────────────────────────────────────────────────────
  onStatus("approving");

  const spender =
    proto === "aave"    ? AAVE_V3 :
    proto === "morpho"  ? MORPHO_MOONWELL :
    proto === "uniswap" ? UNISWAP_ROUTER :
    proto === "aerodrome" ? AERODROME_ROUTER :
    AAVE_V3;

  await ensureApproval(userAddress, spender, amountAtoms);

  // ── Step 2: Deposit / swap ───────────────────────────────────────────────────
  onStatus("depositing");

  let depositCalldata: `0x${string}`;
  let depositTarget: `0x${string}`;
  let depositValue = "0";

  if (proto === "aave") {
    depositTarget   = AAVE_V3;
    depositCalldata = encodeFunctionData({
      abi: AAVE_ABI, functionName: "supply",
      args: [USDC, amountAtoms, userAddress, 0],
    });
  } else if (proto === "morpho") {
    depositTarget   = MORPHO_MOONWELL;
    depositCalldata = encodeFunctionData({
      abi: MORPHO_ABI, functionName: "deposit",
      args: [amountAtoms, userAddress],
    });
  } else if (proto === "uniswap" || proto === "lido") {
    // USDC → WETH (or wstETH) via Uniswap v3
    const tokenOut = proto === "lido"
      ? "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452" as `0x${string}` // wstETH on Base
      : WETH;
    depositTarget   = UNISWAP_ROUTER;
    depositCalldata = encodeFunctionData({
      abi: UNISWAP_ABI, functionName: "exactInputSingle",
      args: [{
        tokenIn:           USDC,
        tokenOut,
        fee:               500,
        recipient:         userAddress,
        amountIn:          amountAtoms,
        amountOutMinimum:  0n,
        sqrtPriceLimitX96: 0n,
      }],
    });
  } else {
    // Default → Aave
    depositTarget   = AAVE_V3;
    depositCalldata = encodeFunctionData({
      abi: AAVE_ABI, functionName: "supply",
      args: [USDC, amountAtoms, userAddress, 0],
    });
  }

  const txHash = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{
      from:    userAddress,
      to:      depositTarget,
      data:    depositCalldata,
      value:   depositValue,
      chainId: `0x${CHAIN.id.toString(16)}`,
    }],
  }) as string;

  onStatus("done");
  return { txHash, protocol: proto, amount: String(amountUsdc) };
}
