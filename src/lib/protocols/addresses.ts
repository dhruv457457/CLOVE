/** Contract addresses for all CLOVE-supported protocols on Base mainnet (8453).
 *  MAINNET (Ethereum L1) entries are reference-only for protocols whose canonical
 *  deployment lives on L1 (Sky/Maker converters, stETH). CLOVE executes on Base. */

export const CHAIN = {
  BASE: 8453,
  MAINNET: 1,
} as const;

// ── Tokens ───────────────────────────────────────────────────────────────────

export const TOKENS = {
  USDC: {
    [CHAIN.BASE]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  WETH: {
    [CHAIN.BASE]: "0x4200000000000000000000000000000000000006",
  },
  // USDS: MakerDAO-derived ERC-20 stablecoin (rely/deny/mint pattern)
  USDS: {
    [CHAIN.BASE]: "0x5875eEE11Cf8398102FdAd704C9E96607675467a",
    [CHAIN.MAINNET]: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
  },
  // sUSDS: ERC-4626 savings vault (deposit/withdraw/mint/redeem)
  sUSDS: {
    [CHAIN.BASE]: "0x820C137fa70C8691f0e44Dc420a5e53c168921Dc",
    [CHAIN.MAINNET]: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
  },
  wstETH: {
    [CHAIN.BASE]: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
    [CHAIN.MAINNET]: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  },
  stETH: {
    [CHAIN.MAINNET]: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  },
  AERO: {
    [CHAIN.BASE]: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  },
} as const;

// ── Uniswap V3 ────────────────────────────────────────────────────────────────

export const UNISWAP_V3 = {
  factory: {
    [CHAIN.BASE]: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    [CHAIN.MAINNET]: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  },
  positionManager: {
    [CHAIN.BASE]: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    [CHAIN.MAINNET]: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  },
  swapRouter: {
    [CHAIN.BASE]: "0x2626664c2603336E57B271c5C0b26F421741e481",
    [CHAIN.MAINNET]: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  },
  quoter: {
    [CHAIN.BASE]: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    [CHAIN.MAINNET]: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  },
} as const;

// ── Morpho ────────────────────────────────────────────────────────────────────

export const MORPHO = {
  blue: {
    [CHAIN.BASE]: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
    [CHAIN.MAINNET]: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  },
  // Well-known MetaMorpho vaults on Base
  vaults: {
    /** Moonwell Flagship USDC on Base */
    MOONWELL_USDC: "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca",
    /** Gauntlet USDC Core on Base */
    GAUNTLET_USDC: "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
  },
} as const;

// ── Aerodrome ─────────────────────────────────────────────────────────────────

export const AERODROME = {
  router: {
    [CHAIN.BASE]: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
  },
  voter: {
    [CHAIN.BASE]: "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
  },
  poolFactory: {
    [CHAIN.BASE]: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
  },
  votingEscrow: {
    [CHAIN.BASE]: "0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4",
  },
} as const;

// ── Lido ──────────────────────────────────────────────────────────────────────

export const LIDO = {
  wstETH: TOKENS.wstETH,
  stETH: TOKENS.stETH,
} as const;

// ── Aave v3 (Base mainnet) ────────────────────────────────────────────────────
// Replaces Sky/sUSDS — Sky's savings mechanism on Base requires USDC→USDS
// conversion first (no direct USDC deposit vault on Base).
// Aave v3 Pool.supply(asset, amount, onBehalfOf, referralCode) accepts USDC
// directly and is the cleaner single-method deposit on Base.

export const AAVE_V3 = {
  pool: {
    /** Aave v3 Pool (proxy) on Base — supply/withdraw/borrow */
    [CHAIN.BASE]: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  },
  /** aUSDC token on Base (receipt token from Aave USDC supply) */
  aUSDC: {
    [CHAIN.BASE]: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
  },
} as const;

// ── Sky (MakerDAO) — reference only, not used for Base execution ──────────────
// Sky's sUSDS on Base is an ERC-20 bridge token, not an ERC-4626 vault.
// Direct USDC deposits are not supported. Kept for L1 reference addresses only.
export const SKY = {
  sUSDS: TOKENS.sUSDS,
  USDS: TOKENS.USDS,
  dai: {
    [CHAIN.MAINNET]: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  },
  daiUsdsConverter: {
    [CHAIN.MAINNET]: "0x3225737a9Bbb6473CB4a45b7244ACa2BeFdB276A",
  },
  mkrSkyConverter: {
    [CHAIN.MAINNET]: "0xA1Ea1bA18E88C381C724a75F23a130420C403f9a",
  },
} as const;
