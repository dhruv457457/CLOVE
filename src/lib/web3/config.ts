import { baseSepolia } from "viem/chains";

export const CHAIN = baseSepolia;
export const CHAIN_ID = baseSepolia.id; // 84532

// USDC on Base Sepolia
export const USDC_ADDRESS =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

// MetaMask facilitator for Base Sepolia (x402 ERC-7710 payments)
export const METAMASK_FACILITATOR_URL =
  "https://tx-sentinel-base-sepolia.api.cx.metamask.io/platform/v2/x402";

// CLOVE agent session smart account address
// Set NEXT_PUBLIC_CLOVE_SESSION_ADDRESS in .env.local after running `npm run derive-session`
export const CLOVE_SESSION_ADDRESS = (
  process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? ""
) as `0x${string}`;
