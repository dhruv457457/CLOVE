// Sweep USDC + aUSDC from one wallet to another on Base mainnet.
//
// Usage (PowerShell):
//   $env:SWEEP_PK = "0xYOUR_PRIVATE_KEY"
//   node scripts/sweep-funds.mjs
//
// The key is read from the env var — it is NOT stored in this file.

import { createPublicClient, createWalletClient, http, formatUnits, formatEther, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// ── Config ──────────────────────────────────────────────────────────────────
const TO    = "0x8dd782e70683Eec48B0c4c8081c5a365598dD2Ab";          // destination
const USDC  = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";          // USDC on Base
const AUSDC = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB";          // aBasUSDC
const RPC   = "https://mainnet.base.org";

const PK = process.env.SWEEP_PK;
if (!PK) {
  console.error("Set SWEEP_PK env var first:  $env:SWEEP_PK = \"0x...\"");
  process.exit(1);
}

const ERC20 = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }] },
];

const account = privateKeyToAccount(PK);
const pub     = createPublicClient({ chain: base, transport: http(RPC) });
const wallet  = createWalletClient({ account, chain: base, transport: http(RPC) });

async function bal(token) {
  return pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account.address] });
}

async function sweep(token, label) {
  const amount = await bal(token);
  if (amount === 0n) { console.log(`${label}: 0 — nothing to send`); return; }
  console.log(`${label}: sending ${formatUnits(amount, 6)} → ${TO}`);
  const data = encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [TO, amount] });
  const hash = await wallet.sendTransaction({ to: token, data });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  ✓ https://basescan.org/tx/${hash}`);
}

(async () => {
  console.log("From:", account.address);
  console.log("ETH (gas):", formatEther(await pub.getBalance({ address: account.address })));
  await sweep(USDC,  "USDC");
  await sweep(AUSDC, "aUSDC");
  console.log("Done.");
})().catch((e) => { console.error("Failed:", e.message); process.exit(1); });
