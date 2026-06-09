/**
 * SANDBOX SPIKE — 7702-via-1Shot-relayer feasibility (DO NOT wire into the app).
 *
 * Goal: prove the $500 1Shot track requirement is satisfiable WITHOUT touching
 * the working delegation chain. Tests two things on a THROWAWAY EOA:
 *
 *   1. The 1Shot permissionless relayer 7702-UPGRADES the EOA to a smart account
 *      (we include an `authorizationList` entry in relayer_send7710Transaction;
 *      afterwards eth_getCode(EOA) must be non-empty → the 7702 delegation designator).
 *   2. The now-upgraded EOA can still REDEEM a delegation it signed with its raw
 *      key (the relayer executes a tiny USDC transfer scoped by an ERC20 cap).
 *
 * If BOTH pass → option (a) is GO: add `authorizationList` to the session
 * account's first relayer call. If the relayer rejects the chain or the redeem
 * reverts → walk away, drop the track (option b).
 *
 * RUN:
 *   1. Generate a throwaway EOA (this script prints one if SPIKE_PK is unset).
 *   2. Send it ~0.30 USDC on Base (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).
 *   3.  SPIKE_PK=0x<throwaway key> node scripts/spike-7702.mjs
 *
 * It signs + submits ONE real tx on Base via the relayer (gas paid in USDC from
 * the EOA). Total cost ~0.05 USDC. Throwaway key only — never your session key.
 */

import { createWalletClient, createPublicClient, http, encodeFunctionData, parseUnits, toHex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { base } from "viem/chains";
import { createDelegation, signDelegation, getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import { encodeDelegations } from "@metamask/smart-accounts-kit/utils";

const RPC          = process.env.BASE_RPC ?? "https://mainnet.base.org";
const RELAYER_URL  = "https://relayer.1shotapi.com/relayers";
const CHAIN_ID     = 8453;
const IMPL_7702    = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B"; // EIP7702StatelessDeleGatorImpl (Base)
const RELAYER_TGT  = "0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a"; // relayer target (Base)
const FEE_COLLECT  = "0xE936e8FAf4A5655469182A49a505055B71C17604";
const USDC         = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const erc20Abi = [{ name: "transfer", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }];

async function rpc(method, params, id = 1) {
  const res = await fetch(RELAYER_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`relayer ${method}: ${j.error.message} ${JSON.stringify(j.error.data ?? "")}`);
  return j.result;
}

function toRelayerJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return toHex(v);
  if (Array.isArray(v)) return v.map(toRelayerJson);
  if (typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = toRelayerJson(x); return o; }
  return v;
}

async function main() {
  const pk = process.env.SPIKE_PK;
  if (!pk) {
    const fresh = generatePrivateKey();
    console.log("No SPIKE_PK set. Throwaway key generated:\n  SPIKE_PK=" + fresh);
    console.log("EOA address:", privateKeyToAccount(fresh).address);
    console.log("→ Fund this EOA with ~0.30 USDC on Base, then re-run with SPIKE_PK set.");
    return;
  }
  const account = privateKeyToAccount(pk);
  const pub     = createPublicClient({ chain: base, transport: http(RPC) });
  const wallet  = createWalletClient({ account, chain: base, transport: http(RPC) });
  const env     = getSmartAccountsEnvironment(CHAIN_ID);
  const dm      = env.DelegationManager;

  console.log("Throwaway EOA:", account.address);
  const codeBefore = await pub.getCode({ address: account.address });
  console.log("Code BEFORE:", codeBefore ?? "0x (plain EOA)");
  const usdcBal = await pub.readContract({ address: USDC, abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [account.address] });
  console.log("USDC balance:", Number(usdcBal) / 1e6);
  if (usdcBal < 100000n) { console.log("⚠ Fund the EOA with ≥0.10 USDC first."); return; }

  // ── 1. Sign the EIP-7702 authorization (upgrade EOA → Stateless7702 impl) ────
  // SPONSORED: the relayer submits the type-4 tx, not the EOA. So we DO NOT pass
  // executor:"self" — the authorization nonce must equal the EOA's CURRENT nonce
  // (self-execution would need nonce+1 and the relayer would reject it).
  const auth = await wallet.signAuthorization({ contractAddress: IMPL_7702 });
  console.log("\nSigned 7702 authorization:", { chainId: auth.chainId, address: auth.address, nonce: auth.nonce, yParity: auth.yParity });
  const authorizationList = [{
    chainId: String(CHAIN_ID),
    address: IMPL_7702,
    nonce:   toHex(BigInt(auth.nonce)),
    yParity: toHex(BigInt(auth.yParity ?? auth.v - 27n)),
    r:       auth.r,
    s:       auth.s,
  }];

  // ── 2. Build a delegation: upgraded EOA → relayer target, USDC capped ───────
  const fee  = await rpc("relayer_getFeeData", { chainId: String(CHAIN_ID), token: USDC });
  const cap  = parseUnits("0.20", 6);
  const deleg = createDelegation({
    from: account.address, to: RELAYER_TGT, environment: env,
    scope: { type: "erc20TransferAmount", tokenAddress: USDC, maxAmount: cap },
  });
  const signature = await signDelegation({ privateKey: pk, delegation: deleg, delegationManager: dm, chainId: CHAIN_ID, allowInsecureUnrestrictedDelegation: false });
  const context   = encodeDelegations([{ ...deleg, signature }]);

  // ── 3. Executions: relayer fee + a tiny self-transfer (the "work") ──────────
  const feeAtoms  = parseUnits("0.05", 6);
  const workAtoms = parseUnits("0.01", 6);
  const executions = [
    { target: USDC, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [FEE_COLLECT, feeAtoms] }) },
    { target: USDC, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account.address, workAtoms] }) },
  ];

  // ── 4. Submit WITH the 7702 authorizationList ───────────────────────────────
  const permissionContext = JSON.parse(JSON.stringify(toRelayerJson([{ ...deleg, signature }])));
  const sendParams = {
    chainId: String(CHAIN_ID),
    ...(fee.context ? { context: fee.context } : {}),
    authorizationList,
    transactions: [{ permissionContext, executions }],
    memo: "CLOVE 7702 spike",
  };
  console.log("\nSubmitting relayer_send7710Transaction with authorizationList…");
  let taskId;
  try { taskId = await rpc("relayer_send7710Transaction", sendParams, 3); }
  catch (e) { console.log("❌ SUBMIT REJECTED:", e.message); console.log("→ Note the field/shape it complained about; that's the iteration point."); return; }
  console.log("taskId:", taskId);

  // ── 5. Poll + verify ────────────────────────────────────────────────────────
  let status, hash;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const st = await rpc("relayer_getStatus", { id: taskId, logs: true }, 4);
    status = st.status; hash = st.receipt?.transactionHash ?? st.hash;
    if (status === 200) break;
    if (status >= 400) { console.log("❌ relay failed:", st.message); break; }
  }
  const codeAfter = await pub.getCode({ address: account.address });
  console.log("\nRelay status:", status, "tx:", hash ?? "—");
  console.log("Code AFTER:", codeAfter ?? "0x");

  const upgraded = !!codeAfter && codeAfter !== "0x";
  const redeemed = status === 200 && !!hash;
  console.log("\n==================  VERDICT  ==================");
  console.log(upgraded ? "✅ 7702 UPGRADE: EOA now has code (smart account)" : "❌ 7702 UPGRADE: EOA still has no code");
  console.log(redeemed ? "✅ DELEGATION REDEEMED: relayer executed the capped transfer" : "❌ DELEGATION DID NOT REDEEM");
  console.log(upgraded && redeemed
    ? "\n🟢 GO — option (a) works. Wire authorizationList into the session account's first relayer call."
    : "\n🔴 NO-GO or partial — paste this output; we decide wire-in vs drop the track.");
}

main().catch(e => console.error("SPIKE ERROR:", e));
