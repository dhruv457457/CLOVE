import "server-only";
import { createWalletClient, createPublicClient, http, encodeFunctionData } from "viem";
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

  const hash = await wallet.sendTransaction({ to: contractAddress, data, gas: 400_000n });
  console.log(`[cloveAutoDeposit] withdraw() tx: ${hash}`);
  await pub.waitForTransactionReceipt({ hash });
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

  const hash = await wallet.sendTransaction({
    to:   contractAddress,
    data,
    gas:  300_000n,  // ~150k actual, 2× headroom
  });

  console.log(`[cloveAutoDeposit] forward() tx: ${hash}`);
  await pub.waitForTransactionReceipt({ hash });
  console.log(`[cloveAutoDeposit] Confirmed! Protocol deposit complete.`);

  return hash;
}
