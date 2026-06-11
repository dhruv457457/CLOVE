/**
 * Recover ERC-20 tokens parked in CloveAutoDeposit back to a wallet.
 *
 * Operator-only: signs with CLOVE_SESSION_KEY (the contract's immutable operator).
 * Use this to pull out USDC that landed in the contract but whose forward()/swap
 * never completed (e.g. a nonce failure left it stuck).
 *
 * Run from the repo root:
 *   node --env-file=.env.local scripts/recover.mjs [toAddress] [tokenAddress]
 *
 *   toAddress     where to send the funds (default: the wallet below)
 *   tokenAddress  token to recover    (default: USDC on Base)
 */
import { createWalletClient, createPublicClient, http, encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const RPC      = process.env.BASE_RPC ?? "https://mainnet.base.org";
const pk       = process.env.CLOVE_SESSION_KEY;
const contract = process.env.CLOVE_AUTO_DEPOSIT;
if (!pk)       { console.error("CLOVE_SESSION_KEY missing — run with: node --env-file=.env.local scripts/recover.mjs"); process.exit(1); }
if (!contract) { console.error("CLOVE_AUTO_DEPOSIT missing in .env.local"); process.exit(1); }

const USDC  = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// Default recipient = the wallet that funded the stuck run.
const to    = (process.argv[2] ?? "0x8dd782e70683eec48b0c4c8081c5a365598dd2ab");
const token = (process.argv[3] ?? USDC);

const account = privateKeyToAccount(pk);
const wallet  = createWalletClient({ account, chain: base, transport: http(RPC) });
const pub     = createPublicClient({ chain: base, transport: http(RPC) });

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
const recoverAbi = parseAbi(["function recover(address token, address to, uint256 amount)"]);

(async () => {
  const bal = await pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [contract] });
  let dec = 6, sym = "TOKEN";
  try { dec = await pub.readContract({ address: token, abi: erc20, functionName: "decimals" }); } catch {}
  try { sym = await pub.readContract({ address: token, abi: erc20, functionName: "symbol" }); } catch {}

  console.log(`Operator:  ${account.address}`);
  console.log(`Contract:  ${contract} holds ${Number(bal) / 10 ** dec} ${sym}`);
  if (bal === 0n) { console.log("Nothing to recover."); return; }

  console.log(`Recovering ${Number(bal) / 10 ** dec} ${sym} → ${to} ...`);
  const data = encodeFunctionData({ abi: recoverAbi, functionName: "recover", args: [token, to, bal] });
  const hash = await wallet.sendTransaction({ to: contract, data });
  console.log("recover tx:", hash);

  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") { console.error("❌ recover reverted:", hash); process.exit(1); }

  const after = await pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [contract] });
  console.log(`✅ Recovered. Contract now holds ${Number(after) / 10 ** dec} ${sym}`);
  console.log("Basescan:", "https://basescan.org/tx/" + hash);
})().catch(e => { console.error("RECOVER ERROR:", e.shortMessage || e.message); process.exit(1); });
