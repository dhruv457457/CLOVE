// ─────────────────────────────────────────────────────────────────────────────
// CLOVE · 1Shot contract-method bootstrap
// ─────────────────────────────────────────────────────────────────────────────
// Creates the five Base-mainnet contract methods that /api/execute/defi needs,
// then prints the ONESHOT_METHOD_* env lines to paste into .env.local.
//
// Each method's contract address + ABI mirrors src/app/api/execute/defi/route.ts
// (METHOD_REGISTRY) and src/lib/protocols/addresses.ts exactly.
//
// Run (Node 20.6+):
//   node --env-file=.env.local scripts/setup-1shot-methods.mjs
//
// Idempotent: if a method with the same contract+function already exists for the
// business, it is reused (no duplicate created).
// ─────────────────────────────────────────────────────────────────────────────

import { OneShotClient } from "@1shotapi/client-sdk";

const {
  ONESHOT_API_KEY,
  ONESHOT_API_SECRET,
  ONESHOT_BUSINESS_ID,
  ONESHOT_WALLET_ID,
} = process.env;

function requireEnv(name, val) {
  if (!val || !val.trim()) {
    console.error(`✗ Missing required env var: ${name} (set it in .env.local first)`);
    process.exit(1);
  }
  return val.trim();
}

requireEnv("ONESHOT_API_KEY", ONESHOT_API_KEY);
requireEnv("ONESHOT_API_SECRET", ONESHOT_API_SECRET);
requireEnv("ONESHOT_BUSINESS_ID", ONESHOT_BUSINESS_ID);
requireEnv("ONESHOT_WALLET_ID", ONESHOT_WALLET_ID);

const CHAIN_ID = 8453; // Base mainnet only

// ── Base mainnet addresses (must match src/lib/protocols/addresses.ts) ──────────
const ADDR = {
  USDC:             "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  MORPHO_MOONWELL:  "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca", // Moonwell Flagship USDC vault
  SKY_SUSDS:        "0x5875eEE11Cf8398102FdAd704C9E96607675467a",
  UNISWAP_ROUTER02: "0x2626664c2603336E57B271c5C0b26F421741e481", // SwapRouter02 (no deadline in struct)
  AERODROME_ROUTER: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
};

// ── The five methods CLOVE executes ─────────────────────────────────────────────
// NOTE: 1Shot does NOT use standard ABI notation. Its schema (from the SDK's zod
// validation) is:
//   • type ∈ {address, bool, bytes, int, string, uint, struct}  (no "uint256"/"tuple")
//   • sized ints/bytes  → type:"uint"|"int"|"bytes" + typeSize: <bits>  (256 = default, omit)
//   • arrays            → isArray: true   (e.g. uint256[] = {type:"uint", isArray:true})
//   • structs/tuples    → type:"struct" + typeStruct:{ name, params:[…recursive…] }
// Param `name`s MUST match the keys produced by buildParams() in execute/defi/route.ts.
const METHODS = [
  {
    envVar:          "ONESHOT_METHOD_USDC_APPROVE",
    name:            "CLOVE · USDC approve",
    description:     "Approve a spender to move USDC (pre-step for deposits/swaps).",
    contractAddress: ADDR.USDC,
    functionName:    "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address", index: 0 },
      { name: "amount",  type: "uint",    index: 1 },
    ],
    outputs: [{ name: "success", type: "bool", index: 0 }],
  },
  {
    envVar:          "ONESHOT_METHOD_MORPHO_VAULT_DEPOSIT",
    name:            "CLOVE · Morpho vault deposit",
    description:     "ERC-4626 deposit into the Moonwell USDC MetaMorpho vault.",
    contractAddress: ADDR.MORPHO_MOONWELL,
    functionName:    "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets",   type: "uint",    index: 0 },
      { name: "receiver", type: "address", index: 1 },
    ],
    outputs: [{ name: "shares", type: "uint", index: 0 }],
  },
  {
    envVar:          "ONESHOT_METHOD_SKY_DEPOSIT",
    name:            "CLOVE · Sky sUSDS deposit",
    description:     "ERC-4626 deposit into Sky sUSDS (USDS savings).",
    contractAddress: ADDR.SKY_SUSDS,
    functionName:    "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets",   type: "uint",    index: 0 },
      { name: "receiver", type: "address", index: 1 },
    ],
    outputs: [{ name: "shares", type: "uint", index: 0 }],
  },
  {
    envVar:          "ONESHOT_METHOD_UNISWAP_SWAP_EXACT_INPUT",
    name:            "CLOVE · Uniswap exactInputSingle",
    description:     "Uniswap V3 SwapRouter02 single-hop exact-input swap (USDC → token / wstETH).",
    contractAddress: ADDR.UNISWAP_ROUTER02,
    functionName:    "exactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params", type: "struct", index: 0,
        typeStruct: {
          name: "ExactInputSingleParams",
          params: [
            { name: "tokenIn",           type: "address", index: 0 },
            { name: "tokenOut",          type: "address", index: 1 },
            { name: "fee",               type: "uint", typeSize: 24,  index: 2 },
            { name: "recipient",         type: "address", index: 3 },
            { name: "amountIn",          type: "uint", index: 4 },
            { name: "amountOutMinimum",  type: "uint", index: 5 },
            { name: "sqrtPriceLimitX96", type: "uint", typeSize: 160, index: 6 },
          ],
        },
      },
    ],
    outputs: [{ name: "amountOut", type: "uint", index: 0 }],
  },
  {
    envVar:          "ONESHOT_METHOD_AERODROME_SWAP_EXACT_TOKENS",
    name:            "CLOVE · Aerodrome swapExactTokensForTokens",
    description:     "Aerodrome router multi-route exact-tokens swap on Base.",
    contractAddress: ADDR.AERODROME_ROUTER,
    functionName:    "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn",     type: "uint", index: 0 },
      { name: "amountOutMin", type: "uint", index: 1 },
      {
        name: "routes", type: "struct", isArray: true, index: 2,
        typeStruct: {
          name: "Route",
          params: [
            { name: "from",    type: "address", index: 0 },
            { name: "to",      type: "address", index: 1 },
            { name: "stable",  type: "bool",    index: 2 },
            { name: "factory", type: "address", index: 3 },
          ],
        },
      },
      { name: "to",       type: "address", index: 3 },
      { name: "deadline", type: "uint",    index: 4 },
    ],
    outputs: [{ name: "amounts", type: "uint", isArray: true, index: 0 }],
  },
];

const client = new OneShotClient({
  apiKey:    ONESHOT_API_KEY,
  apiSecret: ONESHOT_API_SECRET,
});

const businessId = ONESHOT_BUSINESS_ID;
const walletId   = ONESHOT_WALLET_ID;

/** Find an existing live method matching contract+function so we don't duplicate. */
async function findExisting(contractAddress, functionName) {
  try {
    const res = await client.contractMethods.list(businessId, {
      chainId: CHAIN_ID,
      contractAddress,
      status:  "live",
    });
    const rows = res?.response ?? res ?? [];
    return rows.find((m) => m.functionName === functionName) ?? null;
  } catch {
    return null; // listing failed → just attempt create
  }
}

const results = [];

for (const m of METHODS) {
  process.stdout.write(`→ ${m.envVar} (${m.functionName} @ ${m.contractAddress.slice(0, 10)}…) … `);
  try {
    const existing = await findExisting(m.contractAddress, m.functionName);
    if (existing) {
      console.log(`reused ${existing.id}`);
      results.push({ envVar: m.envVar, id: existing.id, reused: true });
      continue;
    }
    const created = await client.contractMethods.create(businessId, {
      chainId:         CHAIN_ID,
      contractAddress: m.contractAddress,
      walletId,
      name:            m.name,
      description:     m.description,
      functionName:    m.functionName,
      stateMutability: m.stateMutability,
      inputs:          m.inputs,
      outputs:         m.outputs,
    });
    const id = created?.id ?? created?.response?.id;
    console.log(`created ${id}`);
    results.push({ envVar: m.envVar, id, reused: false });
  } catch (e) {
    console.log("FAILED");
    console.error(`   ${e instanceof Error ? e.message : String(e)}`);
    results.push({ envVar: m.envVar, id: null, error: true });
  }
}

// ── Print the env block ─────────────────────────────────────────────────────────
console.log("\n──────────────────────────────────────────────────────────────");
console.log("Paste these into .env.local (Base mainnet contract-method UUIDs):\n");
let allOk = true;
for (const r of results) {
  if (r.id) console.log(`${r.envVar}=${r.id}`);
  else { allOk = false; console.log(`# ${r.envVar}=  <-- FAILED, create manually in the 1Shot dashboard`); }
}
console.log("──────────────────────────────────────────────────────────────");

if (!allOk) {
  console.error(
    "\n⚠ Some methods failed. The two swap methods use struct inputs; if the SDK\n" +
    "  rejected the tuple shape, create them in dashboard.1shotapi.com → Contract\n" +
    "  Methods using the same contract address + function name above.",
  );
  process.exit(1);
}
console.log("\n✓ All five methods are ready. On-chain DeFi execution is now wireable.");
