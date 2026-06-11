import "server-only";
import { createWalletClient, createPublicClient, http, encodeFunctionData, parseAbi, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { getSessionPrivateKey } from "@/lib/config/env";

/**
 * Calls CloveAutoDeposit.forward(user, protocol, amount) from the CLOVE
 * session EOA. This is a standard ETH transaction (~$0.001 gas on Base L2)
 * that triggers the deployed contract to deposit USDC into the DeFi protocol.
 *
 * The contract must already hold the USDC (sent there by the relayer).
 */

const CLOVE_AUTO_DEPOSIT_ABI = [
  {
    name: "forward",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user",     type: "address" },
      { name: "protocol", type: "string"  },
      { name: "amount",   type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user",     type: "address" },
      { name: "protocol", type: "string"  },
      { name: "amount",   type: "uint256" },
    ],
    outputs: [],
  },
  // v3 copy-trade: dynamic tokenOut swaps.
  {
    name: "forwardSwap", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" }, { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" }, { name: "amount", type: "uint256" },
    ], outputs: [],
  },
  {
    name: "forwardSwapAero", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" }, { name: "tokenOut", type: "address" },
      { name: "amount", type: "uint256" },
    ], outputs: [],
  },
  {
    name: "usdcBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "userAaveBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "userMorphoBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const RPC = process.env.BASE_RPC ?? "https://mainnet.base.org";

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ERC20_META_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export interface ReceivedToken {
  symbol:  string;
  name:    string;
  address: `0x${string}`;
  amount:  string;   // human-readable, decimals-adjusted
}

// ── Operator nonce serialization ────────────────────────────────────────────
// Every forward()/forwardSwap()/withdraw() is sent by the SAME session EOA. If
// two fire close together, both fetch the same "latest" nonce and the second
// reverts with "nonce too low". We (a) serialize sends through a process-level
// lock and (b) read the PENDING nonce so a still-mempool'd tx is accounted for,
// with one retry on a nonce error.
let operatorTxLock: Promise<unknown> = Promise.resolve();

async function sendFromOperator(
  to:     `0x${string}`,
  data:   `0x${string}`,
  gas:    bigint,
): Promise<`0x${string}`> {
  // Create the clients here (account bound) so the send is correctly typed and
  // the nonce read/serialization are colocated.
  const signer = privateKeyToAccount(getSessionPrivateKey());
  const wallet = createWalletClient({ account: signer, chain: base, transport: http(RPC) });
  const pub    = createPublicClient({ chain: base, transport: http(RPC) });
  const send = operatorTxLock.then(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const nonce = await pub.getTransactionCount({ address: signer.address, blockTag: "pending" });
        return await wallet.sendTransaction({ to, data, gas, nonce });
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (/nonce/i.test(msg) && attempt < 2) {
          await new Promise(r => setTimeout(r, 1500)); // let the pending tx settle, refetch nonce
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  });
  // Keep the chain alive regardless of this send's outcome.
  operatorTxLock = send.then(() => {}, () => {});
  return send as Promise<`0x${string}`>;
}

/**
 * Resolve the ACTUAL token a user received in a transaction — by reading the
 * ERC-20 Transfer logs (to == user) from the tx receipt and the token's own
 * symbol/name/decimals. Works for ANY protocol/vault/swap output (mwUSDC,
 * aBasUSDC, or an arbitrary token from a Uniswap/Aerodrome swap) — no hardcoded
 * map. Returns the last token credited to the user (the final output).
 */
export async function resolveReceivedToken(
  txHash: `0x${string}`,
  user:   `0x${string}`,
): Promise<ReceivedToken | null> {
  const pub = createPublicClient({ chain: base, transport: http(RPC) });
  let receipt;
  try { receipt = await pub.getTransactionReceipt({ hash: txHash }); }
  catch { return null; }
  if (receipt.status !== "success") return null;

  const userTopic = ("0x" + user.toLowerCase().slice(2).padStart(64, "0"));
  const credited = receipt.logs.filter(
    l => l.topics[0]?.toLowerCase() === TRANSFER_TOPIC && l.topics[2]?.toLowerCase() === userTopic,
  );
  if (credited.length === 0) return null;

  // The final credited token is the position/output the user actually holds.
  const log   = credited[credited.length - 1];
  const token = log.address as `0x${string}`;
  let raw = 0n;
  try { raw = BigInt(log.data); } catch { /* keep 0 */ }

  let symbol = "TOKEN", name = "", decimals = 18;
  try { symbol   = await pub.readContract({ address: token, abi: ERC20_META_ABI, functionName: "symbol"   }) as string; } catch { /* */ }
  try { name     = await pub.readContract({ address: token, abi: ERC20_META_ABI, functionName: "name"     }) as string; } catch { /* */ }
  try { decimals = await pub.readContract({ address: token, abi: ERC20_META_ABI, functionName: "decimals" }) as number; } catch { /* */ }

  return { symbol, name, address: token, amount: formatUnits(raw, decimals) };
}

/**
 * Wait until the CloveAutoDeposit contract holds at least `expectedAtoms` USDC.
 * The relayer tx needs to confirm before we call forward().
 */
async function waitForUsdcBalance(
  contractAddress: `0x${string}`,
  expectedAtoms: bigint,
  timeoutMs = 60_000,
): Promise<boolean> {
  const pub = createPublicClient({ chain: base, transport: http(RPC) });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bal = await pub.readContract({
      address: contractAddress,
      abi:     CLOVE_AUTO_DEPOSIT_ABI,
      functionName: "usdcBalance",
    }) as bigint;
    if (bal >= expectedAtoms) return true;
    await new Promise(r => setTimeout(r, 3_000));
  }
  return false;
}

/**
 * Total USDC (atoms) currently sitting in the CloveAutoDeposit contract —
 * i.e. funds that were transferred in but not yet forwarded to a protocol.
 * Used to detect + complete a "stuck" deposit.
 */
export async function getContractUsdcBalance(): Promise<bigint> {
  const contractAddress = process.env.CLOVE_AUTO_DEPOSIT as `0x${string}` | undefined;
  if (!contractAddress) return 0n;
  const pub = createPublicClient({ chain: base, transport: http(RPC) });
  try {
    return await pub.readContract({
      address: contractAddress, abi: CLOVE_AUTO_DEPOSIT_ABI, functionName: "usdcBalance",
    }) as bigint;
  } catch { return 0n; }
}

/**
 * Check how much a user can withdraw from a protocol.
 * Returns the amount in USDC atoms (6 decimals).
 */
export async function getUserProtocolBalance(
  user:     `0x${string}`,
  protocol: string,
): Promise<bigint> {
  const contractAddress = process.env.CLOVE_AUTO_DEPOSIT as `0x${string}` | undefined;
  if (!contractAddress) return 0n;
  const pub = createPublicClient({ chain: base, transport: http(RPC) });
  const proto = protocol.toLowerCase();
  try {
    if (proto === "aave") {
      return await pub.readContract({
        address: contractAddress, abi: CLOVE_AUTO_DEPOSIT_ABI,
        functionName: "userAaveBalance", args: [user],
      }) as bigint;
    }
    if (proto === "morpho") {
      return await pub.readContract({
        address: contractAddress, abi: CLOVE_AUTO_DEPOSIT_ABI,
        functionName: "userMorphoBalance", args: [user],
      }) as bigint;
    }
  } catch { /* non-fatal */ }
  return 0n;
}

/**
 * Call CloveAutoDeposit.withdraw(user, protocol, amount) using CLOVE's session key.
 * Pulls receipt tokens from user and redeems/swaps back to USDC.
 * Requires user to have pre-approved the contract for their receipt token.
 */
export async function withdrawFromProtocol(
  user:        `0x${string}`,
  protocol:    string,
  amountAtoms: bigint,
): Promise<`0x${string}`> {
  const contractAddress = process.env.CLOVE_AUTO_DEPOSIT as `0x${string}` | undefined;
  if (!contractAddress) throw new Error("CLOVE_AUTO_DEPOSIT not set");

  const pk     = getSessionPrivateKey();
  const signer = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account: signer, chain: base, transport: http(RPC) });
  const pub    = createPublicClient({ chain: base, transport: http(RPC) });

  console.log(`[cloveAutoDeposit] Calling withdraw(${user}, ${protocol}, ${amountAtoms})`);

  const data = encodeFunctionData({
    abi: CLOVE_AUTO_DEPOSIT_ABI, functionName: "withdraw",
    args: [user, protocol, amountAtoms],
  });

  let gas = 800_000n;
  try {
    const est = await pub.estimateContractGas({
      address: contractAddress, abi: CLOVE_AUTO_DEPOSIT_ABI,
      functionName: "withdraw", args: [user, protocol, amountAtoms], account: signer,
    });
    gas = (est * 150n) / 100n;
  } catch { /* fall back to generous fixed gas */ }

  const hash = await sendFromOperator(contractAddress, data, gas);
  console.log(`[cloveAutoDeposit] withdraw() tx: ${hash} (gas ${gas})`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`withdraw() reverted on-chain (tx ${hash})`);
  }
  console.log(`[cloveAutoDeposit] Withdrawal confirmed!`);
  return hash;
}

/**
 * Call CloveAutoDeposit.forward(user, protocol, amount) using CLOVE's session key.
 * Returns the tx hash of the protocol deposit transaction.
 */
export async function forwardToProtocol(
  user:     `0x${string}`,
  protocol: string,
  amountAtoms: bigint,
): Promise<`0x${string}`> {
  const contractAddress = process.env.CLOVE_AUTO_DEPOSIT as `0x${string}` | undefined;
  if (!contractAddress) throw new Error("CLOVE_AUTO_DEPOSIT not set in .env.local");

  const pk      = getSessionPrivateKey();
  const signer  = privateKeyToAccount(pk);
  const wallet  = createWalletClient({ account: signer, chain: base, transport: http(RPC) });
  const pub     = createPublicClient({ chain: base, transport: http(RPC) });

  // Wait for USDC to land in the contract (relayer tx must confirm first)
  console.log(`[cloveAutoDeposit] Waiting for ${amountAtoms} USDC atoms in contract…`);
  const arrived = await waitForUsdcBalance(contractAddress, amountAtoms);
  if (!arrived) throw new Error("[cloveAutoDeposit] USDC did not arrive in contract within 60s");

  console.log(`[cloveAutoDeposit] Calling forward(${user}, ${protocol}, ${amountAtoms})`);

  const data = encodeFunctionData({
    abi:          CLOVE_AUTO_DEPOSIT_ABI,
    functionName: "forward",
    args:         [user, protocol, amountAtoms],
  });

  // Estimate gas + 50% buffer (ERC-4626 / Aave deposits run ~385k and vary by
  // protocol state). A fixed 300k was too low for Morpho → out-of-gas revert.
  let gas = 800_000n;
  try {
    const est = await pub.estimateContractGas({
      address: contractAddress, abi: CLOVE_AUTO_DEPOSIT_ABI,
      functionName: "forward", args: [user, protocol, amountAtoms], account: signer,
    });
    gas = (est * 150n) / 100n;
  } catch { /* protocol may revert estimate; fall back to generous fixed gas */ }

  const hash = await sendFromOperator(contractAddress, data, gas);
  console.log(`[cloveAutoDeposit] forward() tx: ${hash} (gas ${gas})`);

  // VERIFY the deposit actually succeeded — waitForTransactionReceipt does NOT
  // throw on revert, so check status explicitly. Otherwise a reverted tx looks
  // like a successful deposit while the USDC stays parked in the contract.
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`forward() reverted on-chain — deposit did NOT happen (tx ${hash})`);
  }
  console.log(`[cloveAutoDeposit] Confirmed! Protocol deposit complete.`);

  return hash;
}

/**
 * COPY-TRADE v3 — swap USDC (already in the contract) into ANY tokenOut and send
 * it to the user. Uses the new forwardSwap (Uniswap V3) / forwardSwapAero
 * (Aerodrome) functions, so the agent can mirror whatever token a whale bought —
 * not just the hardcoded WETH/AERO of the old forward().
 *
 * Requires CLOVE_AUTO_DEPOSIT to point at the v3 contract (with forwardSwap).
 */
export async function forwardSwapToken(
  user:        `0x${string}`,
  tokenOut:    `0x${string}`,
  amountAtoms: bigint,
  useAerodrome = false,
  fee = 3000,
): Promise<`0x${string}`> {
  const contractAddress = process.env.CLOVE_AUTO_DEPOSIT as `0x${string}` | undefined;
  if (!contractAddress) throw new Error("CLOVE_AUTO_DEPOSIT not set");

  const signer = privateKeyToAccount(getSessionPrivateKey());
  const wallet = createWalletClient({ account: signer, chain: base, transport: http(RPC) });
  const pub    = createPublicClient({ chain: base, transport: http(RPC) });

  const arrived = await waitForUsdcBalance(contractAddress, amountAtoms);
  if (!arrived) throw new Error("[cloveAutoDeposit] USDC did not arrive in contract within 60s");

  const data = useAerodrome
    ? encodeFunctionData({ abi: CLOVE_AUTO_DEPOSIT_ABI, functionName: "forwardSwapAero", args: [user, tokenOut, amountAtoms] })
    : encodeFunctionData({ abi: CLOVE_AUTO_DEPOSIT_ABI, functionName: "forwardSwap",     args: [user, tokenOut, fee, amountAtoms] });

  let gas = 900_000n;
  try {
    const est = await pub.estimateContractGas(useAerodrome
      ? { address: contractAddress, abi: CLOVE_AUTO_DEPOSIT_ABI, functionName: "forwardSwapAero", args: [user, tokenOut, amountAtoms], account: signer }
      : { address: contractAddress, abi: CLOVE_AUTO_DEPOSIT_ABI, functionName: "forwardSwap",     args: [user, tokenOut, fee, amountAtoms], account: signer });
    gas = (est * 150n) / 100n;
  } catch { /* swap may revert estimate if no pool — generous fixed gas */ }

  const hash = await sendFromOperator(contractAddress, data, gas);
  console.log(`[cloveAutoDeposit] forwardSwap(${useAerodrome ? "aero" : "uni"}) → ${tokenOut} tx: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`forwardSwap reverted — likely no ${useAerodrome ? "Aerodrome" : "Uniswap"} pool for ${tokenOut} (tx ${hash})`);
  }
  return hash;
}
