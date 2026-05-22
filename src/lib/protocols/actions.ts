/**
 * Protocol action definitions for CLOVE's workflow nodes.
 * Each action maps to a specific smart contract call that the
 * 1Shot executeAsDelegator engine will execute on behalf of the user.
 */

export type ActionType = "read" | "write";
export type ProtocolSlug = "uniswap" | "morpho" | "aerodrome" | "lido" | "sky";

export interface ProtocolAction {
  slug: string;
  protocol: ProtocolSlug;
  label: string;
  description: string;
  type: ActionType;
  contract: string;         // key in addresses map
  function: string;         // solidity function name
  category: string;         // display category
  inputs: ActionInput[];
}

export interface ActionInput {
  name: string;
  type: string;
  label: string;
  required?: boolean;
  default?: string;
  decimals?: boolean | number;
}

// ── Uniswap V3 Actions ────────────────────────────────────────────────────────

export const UNISWAP_ACTIONS: ProtocolAction[] = [
  {
    slug: "uniswap-swap-exact-input",
    protocol: "uniswap",
    label: "Swap (Exact Input)",
    description: "Swap an exact amount of input tokens for as many output tokens as possible",
    type: "write",
    contract: "swapRouter",
    function: "exactInputSingle",
    category: "Swap",
    inputs: [
      { name: "tokenIn",          type: "address", label: "Input Token" },
      { name: "tokenOut",         type: "address", label: "Output Token" },
      { name: "fee",              type: "uint24",  label: "Fee Tier (500/3000/10000)", default: "3000" },
      { name: "recipient",        type: "address", label: "Recipient" },
      { name: "amountIn",         type: "uint256", label: "Amount In (wei)", decimals: true },
      { name: "amountOutMinimum", type: "uint256", label: "Min Out (wei)",   default: "0" },
      { name: "sqrtPriceLimitX96",type: "uint160", label: "Price Limit",    default: "0" },
    ],
  },
  {
    slug: "uniswap-quote-exact-input",
    protocol: "uniswap",
    label: "Get Swap Quote",
    description: "Get the expected output for a swap without executing it",
    type: "read",
    contract: "quoter",
    function: "quoteExactInputSingle",
    category: "Quote",
    inputs: [
      { name: "tokenIn",          type: "address", label: "Input Token" },
      { name: "tokenOut",         type: "address", label: "Output Token" },
      { name: "amountIn",         type: "uint256", label: "Amount In (wei)", decimals: true },
      { name: "fee",              type: "uint24",  label: "Fee Tier",       default: "3000" },
      { name: "sqrtPriceLimitX96",type: "uint160", label: "Price Limit",   default: "0" },
    ],
  },
];

// ── Morpho Actions ────────────────────────────────────────────────────────────

export const MORPHO_ACTIONS: ProtocolAction[] = [
  {
    slug: "morpho-vault-deposit",
    protocol: "morpho",
    label: "Deposit to Vault",
    description: "Deposit assets into a MetaMorpho vault for optimised yield",
    type: "write",
    contract: "vault",
    function: "deposit",
    category: "Yield",
    inputs: [
      { name: "assets",   type: "uint256", label: "Amount (wei)", decimals: true },
      { name: "receiver", type: "address", label: "Receiver" },
    ],
  },
  {
    slug: "morpho-vault-withdraw",
    protocol: "morpho",
    label: "Withdraw from Vault",
    description: "Withdraw assets from a MetaMorpho vault",
    type: "write",
    contract: "vault",
    function: "withdraw",
    category: "Yield",
    inputs: [
      { name: "assets",   type: "uint256", label: "Amount (wei)", decimals: true },
      { name: "receiver", type: "address", label: "Receiver" },
      { name: "owner",    type: "address", label: "Owner" },
    ],
  },
  {
    slug: "morpho-supply",
    protocol: "morpho",
    label: "Supply to Market",
    description: "Supply loan tokens directly to a Morpho lending market",
    type: "write",
    contract: "blue",
    function: "supply",
    category: "Lend",
    inputs: [
      { name: "loanToken",       type: "address", label: "Loan Token" },
      { name: "collateralToken", type: "address", label: "Collateral Token" },
      { name: "oracle",          type: "address", label: "Oracle" },
      { name: "irm",             type: "address", label: "IRM" },
      { name: "lltv",            type: "uint256", label: "LLTV" },
      { name: "assets",          type: "uint256", label: "Amount (wei)", decimals: true },
      { name: "shares",          type: "uint256", label: "Shares (0 = use assets)", default: "0" },
      { name: "onBehalf",        type: "address", label: "On Behalf Of" },
      { name: "data",            type: "bytes",   label: "Callback Data", default: "0x" },
    ],
  },
];

// ── Aerodrome Actions ─────────────────────────────────────────────────────────

export const AERODROME_ACTIONS: ProtocolAction[] = [
  {
    slug: "aerodrome-swap-exact-tokens",
    protocol: "aerodrome",
    label: "Swap (Aerodrome)",
    description: "Swap tokens on Aerodrome (Base-native DEX)",
    type: "write",
    contract: "router",
    function: "swapExactTokensForTokens",
    category: "Swap",
    inputs: [
      { name: "amountIn",     type: "uint256",  label: "Amount In (wei)", decimals: true },
      { name: "amountOutMin", type: "uint256",  label: "Min Out (wei)",   default: "0" },
      { name: "routes",       type: "tuple[]",  label: "Routes (token path)" },
      { name: "to",           type: "address",  label: "Recipient" },
      { name: "deadline",     type: "uint256",  label: "Deadline (unix)", default: "0" },
    ],
  },
];

// ── Lido Actions ──────────────────────────────────────────────────────────────

export const LIDO_ACTIONS: ProtocolAction[] = [
  {
    slug: "lido-wrap",
    protocol: "lido",
    label: "Wrap stETH → wstETH",
    description: "Convert rebasing stETH into non-rebasing wstETH",
    type: "write",
    contract: "wstETH",
    function: "wrap",
    category: "Staking",
    inputs: [
      { name: "_stETHAmount", type: "uint256", label: "stETH Amount (wei)", decimals: 18 },
    ],
  },
  {
    slug: "lido-unwrap",
    protocol: "lido",
    label: "Unwrap wstETH → stETH",
    description: "Convert wstETH back into rebasing stETH",
    type: "write",
    contract: "wstETH",
    function: "unwrap",
    category: "Staking",
    inputs: [
      { name: "_wstETHAmount", type: "uint256", label: "wstETH Amount (wei)", decimals: 18 },
    ],
  },
  {
    slug: "lido-steth-per-token",
    protocol: "lido",
    label: "Get stETH/wstETH Rate",
    description: "Read the current exchange rate between stETH and wstETH",
    type: "read",
    contract: "wstETH",
    function: "stEthPerToken",
    category: "Staking",
    inputs: [],
  },
];

// ── Sky Actions ───────────────────────────────────────────────────────────────

export const SKY_ACTIONS: ProtocolAction[] = [
  {
    slug: "sky-deposit",
    protocol: "sky",
    label: "Deposit to sUSDS",
    description: "Deposit USDS into Sky Savings (sUSDS) to earn yield",
    type: "write",
    contract: "sUSDS",
    function: "deposit",
    category: "Savings",
    inputs: [
      { name: "assets",   type: "uint256", label: "USDS Amount (wei)", decimals: 18 },
      { name: "receiver", type: "address", label: "Receiver" },
    ],
  },
  {
    slug: "sky-withdraw",
    protocol: "sky",
    label: "Withdraw from sUSDS",
    description: "Withdraw USDS from Sky Savings",
    type: "write",
    contract: "sUSDS",
    function: "withdraw",
    category: "Savings",
    inputs: [
      { name: "assets",   type: "uint256", label: "USDS Amount (wei)", decimals: 18 },
      { name: "receiver", type: "address", label: "Receiver" },
      { name: "owner",    type: "address", label: "Owner" },
    ],
  },
];

// ── Combined registry ─────────────────────────────────────────────────────────

export const ALL_ACTIONS: ProtocolAction[] = [
  ...UNISWAP_ACTIONS,
  ...MORPHO_ACTIONS,
  ...AERODROME_ACTIONS,
  ...LIDO_ACTIONS,
  ...SKY_ACTIONS,
];

export const ACTION_BY_SLUG = Object.fromEntries(
  ALL_ACTIONS.map((a) => [a.slug, a])
);

export const PROTOCOL_METADATA: Record<ProtocolSlug, {
  name: string;
  description: string;
  color: string;
  website: string;
}> = {
  uniswap:   { name: "Uniswap V3",       description: "DEX swaps and liquidity",          color: "#FF007A", website: "https://uniswap.org" },
  morpho:    { name: "Morpho",            description: "Optimized lending vaults",          color: "#2470ff", website: "https://morpho.org" },
  aerodrome: { name: "Aerodrome",         description: "Base-native DEX and LP",           color: "#ff6b00", website: "https://aerodrome.finance" },
  lido:      { name: "Lido",              description: "Liquid ETH staking",               color: "#00a3ff", website: "https://lido.fi" },
  sky:       { name: "Sky (MakerDAO)",    description: "Stablecoin savings (sUSDS/USDS)",  color: "#f4b731", website: "https://sky.money" },
};
