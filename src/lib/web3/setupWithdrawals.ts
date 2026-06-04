"use client";

import { encodeFunctionData, encodeAbiParameters, parseAbiParameters } from "viem";

/**
 * Batches all 5 ERC-20 approve() calls into ONE MetaMask transaction
 * using Multicall3 (deployed at the same address on all EVM chains).
 *
 * One click → one popup → all 5 protocols enabled for withdrawal.
 */

// Multicall3 — same address on Base, Ethereum, Polygon, Arbitrum, etc.
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

const APPROVE_ABI = [{
  name: "approve",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount",  type: "uint256" },
  ],
  outputs: [{ type: "bool" }],
}] as const;

// aggregate3(Call3[] calls) — allowFailure=false so we revert if any approval fails
const AGGREGATE3_ABI = [{
  name: "aggregate3",
  type: "function",
  stateMutability: "payable",
  inputs: [{
    name: "calls",
    type: "tuple[]",
    components: [
      { name: "target",       type: "address" },
      { name: "allowFailure", type: "bool"    },
      { name: "callData",     type: "bytes"   },
    ],
  }],
  outputs: [{
    name: "returnData",
    type: "tuple[]",
    components: [
      { name: "success",    type: "bool"  },
      { name: "returnData", type: "bytes" },
    ],
  }],
}] as const;

const RECEIPT_TOKENS = [
  { symbol: "aBasUSDC",      address: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB" }, // Aave
  { symbol: "Morpho shares", address: "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca" }, // Morpho vault
  { symbol: "WETH",          address: "0x4200000000000000000000000000000000000006" }, // Uniswap
  { symbol: "AERO",          address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" }, // Aerodrome
  { symbol: "wstETH",        address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452" }, // Lido
];

export type ApprovalStatus = "idle" | "pending" | "done" | { error: string };

export async function setupWithdrawals(
  userAddress: `0x${string}`,
  onStatus: (s: ApprovalStatus) => void,
): Promise<void> {
  if (!window.ethereum) throw new Error("MetaMask not found");

  const spender = process.env.NEXT_PUBLIC_CLOVE_AUTO_DEPOSIT;
  if (!spender) throw new Error("NEXT_PUBLIC_CLOVE_AUTO_DEPOSIT not set");

  // Switch to Base mainnet
  await window.ethereum.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0x2105" }], // 8453
  }).catch(() => {});

  // Build one approve() calldata (same for all tokens)
  const approveCalldata = encodeFunctionData({
    abi: APPROVE_ABI,
    functionName: "approve",
    args: [spender as `0x${string}`, MAX_UINT256],
  });

  // Build the Multicall3 aggregate3 payload — all 5 approvals in one tx
  const calls = RECEIPT_TOKENS.map(t => ({
    target:       t.address as `0x${string}`,
    allowFailure: false,   // revert the whole batch if any approval fails
    callData:     approveCalldata,
  }));

  const multicallData = encodeFunctionData({
    abi:          AGGREGATE3_ABI,
    functionName: "aggregate3",
    args:         [calls],
  });

  onStatus("pending");

  // ONE MetaMask popup, ONE transaction
  await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{
      from:    userAddress,
      to:      MULTICALL3,
      data:    multicallData,
      chainId: "0x2105",
    }],
  });

  onStatus("done");
}
