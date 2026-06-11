/**
 * Deploy CloveAutoDeposit v3 (dynamic-tokenOut copy-trade) to Base mainnet.
 *
 * Prereqs:
 *   1. cd contracts && forge build   (produces the artifact this reads)
 *   2. Fund the session EOA (operator) with a little ETH on Base (~$0.02 for gas).
 *
 * Run from the repo root:  node scripts/deploy-autodeposit.mjs
 *
 * Operator = the session EOA (owner of CLOVE_SESSION_KEY). It MUST match, because
 * the server signs forward()/forwardSwap() with that key (onlyOperator).
 */
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import fs from "fs";

const RPC = process.env.BASE_RPC ?? "https://mainnet.base.org";
const pk  = fs.readFileSync(".env.local", "utf8").match(/CLOVE_SESSION_KEY=(0x[0-9a-fA-F]+)/)?.[1];
if (!pk) { console.error("CLOVE_SESSION_KEY not found in .env.local"); process.exit(1); }

const account  = privateKeyToAccount(pk);
const OPERATOR = account.address;

const artifactPath = "contracts/out/CloveAutoDeposit.sol/CloveAutoDeposit.json";
if (!fs.existsSync(artifactPath)) { console.error("Artifact missing. Run: cd contracts && forge build"); process.exit(1); }
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const abi      = artifact.abi;
const bytecode = (artifact.bytecode?.object ?? artifact.bytecode);

const wallet = createWalletClient({ account, chain: base, transport: http(RPC) });
const pub    = createPublicClient({ chain: base, transport: http(RPC) });

(async () => {
  const bal = await pub.getBalance({ address: OPERATOR });
  console.log("Operator (session EOA):", OPERATOR, "· ETH:", Number(bal) / 1e18);
  if (bal < 50000000000000n) { console.error("⚠ Fund the operator with ~$0.02 of ETH on Base first."); process.exit(1); }

  console.log("Deploying CloveAutoDeposit v3…");
  const hash = await wallet.deployContract({ abi, bytecode, args: [OPERATOR] });
  console.log("deploy tx:", hash);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") { console.error("❌ Deploy reverted:", hash); process.exit(1); }

  console.log("\n✅ Deployed at:", receipt.contractAddress);
  console.log("\nNext: set this in .env.local and restart the dev server:");
  console.log("  CLOVE_AUTO_DEPOSIT=" + receipt.contractAddress);
  console.log("\nBasescan:", "https://basescan.org/address/" + receipt.contractAddress);
})().catch(e => console.error("DEPLOY ERROR:", e.shortMessage || e.message));
