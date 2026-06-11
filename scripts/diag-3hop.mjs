/**
 * DIAGNOSTIC — rebuild the exact 3-hop worker chain and print the relayer's
 * FULL response, so we can see why send7710Transaction returns "Not Found".
 * Read-only on funds: it submits the same over-cap attempt that reverts anyway.
 *   node scripts/diag-3hop.mjs
 */
import { createPublicClient, http, encodeFunctionData, parseUnits, toHex, keccak256, encodePacked } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { createDelegation, signDelegation, getSmartAccountsEnvironment, createCaveat } from "@metamask/smart-accounts-kit";
import { encodeDelegations, decodeDelegations } from "@metamask/smart-accounts-kit/utils";
import fs from "fs";

const RELAYER     = "https://relayer.1shotapi.com/relayers";
const RELAYER_TGT = "0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a";
const FEE_COLLECT = "0xE936e8FAf4A5655469182A49a505055B71C17604";
const USDC        = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MORPHO      = "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca";
const WALLET      = "0x8dd782e70683eec48b0c4c8081c5a365598dd2ab";

const sessionKey = fs.readFileSync(".env.local", "utf8").match(/CLOVE_SESSION_KEY=(0x[0-9a-fA-F]+)/)[1];
const workerKey  = keccak256(encodePacked(["bytes32", "string"], [sessionKey, "proof-worker"]));
const sessionAcct = privateKeyToAccount(sessionKey);
const workerAcct  = privateKeyToAccount(workerKey);
const env = getSmartAccountsEnvironment(8453);
const dm  = env.DelegationManager;

const erc20Abi = [{ name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }];

function toRelayerJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return toHex(v);
  if (Array.isArray(v)) return v.map(toRelayerJson);
  if (typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = toRelayerJson(x); return o; }
  return v;
}
async function rpc(method, params, id = 1) {
  const r = await fetch(RELAYER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  return r.json();
}

async function main() {
  console.log("session EOA:", sessionAcct.address, "| worker EOA:", workerAcct.address);
  const grant = (await (await fetch(`http://localhost:3000/api/permission?wallet=${WALLET}`)).json()).permission.permissionsContext;
  const root = decodeDelegations(grant);
  console.log("root grant delegations:", root.length, "| root[0].delegate:", root[0]?.delegate, "delegator:", root[0]?.delegator);

  // session → worker (packed caveats)
  const targets = ("0x" + [RELAYER_TGT, USDC, MORPHO].map(a => a.slice(2)).join("")).toLowerCase();
  const targetsCaveat = createCaveat(env.caveatEnforcers.AllowedTargetsEnforcer, targets);
  const capCaveat = createCaveat(env.caveatEnforcers.ERC20TransferAmountEnforcer, encodePacked(["address", "uint256"], [USDC, parseUnits("0.05", 6)]));
  const stw = createDelegation({ from: sessionAcct.address, to: workerAcct.address, environment: env, parentPermissionContext: grant, caveats: [targetsCaveat, capCaveat] });
  const stwSig = await signDelegation({ privateKey: sessionKey, delegation: stw, delegationManager: dm, chainId: 8453, allowInsecureUnrestrictedDelegation: false });
  const signedSTW = { ...stw, signature: stwSig };

  // worker → relayer
  const wtr = createDelegation({ from: workerAcct.address, to: RELAYER_TGT, environment: env, parentPermissionContext: encodeDelegations([signedSTW]), caveats: [] });
  const wtrSig = await signDelegation({ privateKey: workerKey, delegation: wtr, delegationManager: dm, chainId: 8453, allowInsecureUnrestrictedDelegation: true });
  const signedWTR = { ...wtr, signature: wtrSig };

  const context = encodeDelegations([signedWTR, signedSTW, ...root]);
  const chain = decodeDelegations(context);
  console.log("\nfull chain length:", chain.length);
  chain.forEach((d, i) => console.log(`  [${i}] delegator=${d.delegator} delegate=${d.delegate} caveats=${d.caveats?.length ?? 0} authority=${(d.authority ?? "").slice(0, 14)}…`));

  const fee = await rpc("relayer_getFeeData", { chainId: "8453", token: USDC });
  const permissionContext = chain.map(toRelayerJson);
  const executions = [
    { target: USDC, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [FEE_COLLECT, parseUnits("0.05", 6)] }) },
    { target: USDC, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [WALLET, parseUnits("1", 6)] }) },
  ];
  const sendParams = { chainId: "8453", context: fee.result.context, transactions: [{ permissionContext, executions }], memo: "diag-3hop" };

  console.log("\nSubmitting… (permissionContext entries:", permissionContext.length, ")");
  const resp = await rpc("relayer_send7710Transaction", sendParams, 9);
  console.log("\n=== FULL RELAYER RESPONSE ===");
  console.log(JSON.stringify(resp, null, 2));
}
main().catch(e => console.error("DIAG ERROR:", e));
