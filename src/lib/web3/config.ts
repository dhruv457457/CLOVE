import { base } from "viem/chains";

// CLOVE runs on Base mainnet — Morpho vaults, Aerodrome, Lido wstETH,
// Sky sUSDS, and x402 facilitators all live on mainnet.
export const CHAIN = base;
export const CHAIN_ID = base.id; // 8453

// USDC on Base mainnet
export const USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

// MetaMask facilitator for Base mainnet (x402 ERC-7710 payments)
export const METAMASK_FACILITATOR_URL =
  "https://tx-sentinel-base-mainnet.api.cx.metamask.io/platform/v2/x402";

// CLOVE agent session smart account address (1Shot Base mainnet wallet)
export const CLOVE_SESSION_ADDRESS = (
  process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? ""
) as `0x${string}`;
