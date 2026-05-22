import { NextRequest, NextResponse } from "next/server";
import { encodeFunctionData } from "viem";
import { getOneShotClient } from "@/lib/oneshot/client";
import { UNISWAP_V3, MORPHO, LIDO, SKY, AERODROME, TOKENS, CHAIN } from "@/lib/protocols/addresses";

interface ExecRequest {
  action?: string;
  protocol?: string;
  nodeConfig?: Record<string, unknown>;
  permissionsContext: string;
  delegationManager: string;
  delegationId?: string;
  walletAddress: string;
}

/** Minimal ABIs for the actions we support */
const ABIS = {
  erc20Approve: [{
    name: "approve", type: "function" as const,
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    stateMutability: "nonpayable" as const, outputs: [{ type: "bool" }],
  }],
  morphoVaultDeposit: [{
    name: "deposit", type: "function" as const,
    inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }],
    stateMutability: "nonpayable" as const, outputs: [{ type: "uint256" }],
  }],
  skyDeposit: [{
    name: "deposit", type: "function" as const,
    inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }],
    stateMutability: "nonpayable" as const, outputs: [{ type: "uint256" }],
  }],
  lidoWrap: [{
    name: "wrap", type: "function" as const,
    inputs: [{ name: "_stETHAmount", type: "uint256" }],
    stateMutability: "nonpayable" as const, outputs: [{ type: "uint256" }],
  }],
  uniswapSwap: [{
    name: "exactInputSingle", type: "function" as const,
    inputs: [{
      name: "params", type: "tuple",
      components: [
        { name: "tokenIn",           type: "address" },
        { name: "tokenOut",          type: "address" },
        { name: "fee",               type: "uint24"  },
        { name: "recipient",         type: "address" },
        { name: "amountIn",          type: "uint256" },
        { name: "amountOutMinimum",  type: "uint256" },
        { name: "sqrtPriceLimitX96", type: "uint160" },
      ],
    }],
    stateMutability: "nonpayable" as const, outputs: [{ name: "amountOut", type: "uint256" }],
  }],
} as const;

export async function POST(request: NextRequest) {
  let body: ExecRequest;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const {
    action, protocol, nodeConfig = {},
    permissionsContext, delegationManager, delegationId,
    walletAddress,
  } = body;

  // ── Resolve contract address + calldata based on action ──────────────────────

  const chainId = CHAIN.BASE_SEPOLIA;
  let contractAddress: `0x${string}`;
  let calldata: `0x${string}`;
  let functionName: string;
  const defaultAmount = BigInt("1000000"); // 1 USDC (6 decimals)

  try {
    switch (action ?? protocol) {
      case "morpho-vault-deposit":
      case "morpho": {
        const vault = MORPHO.vaults.MOONWELL_USDC as `0x${string}`;
        contractAddress = vault;
        functionName = "deposit";
        calldata = encodeFunctionData({
          abi: ABIS.morphoVaultDeposit,
          functionName: "deposit",
          args: [defaultAmount, walletAddress as `0x${string}`],
        });
        break;
      }
      case "sky-deposit":
      case "sky": {
        contractAddress = SKY.sUSDS[CHAIN.BASE] as `0x${string}`;
        functionName = "deposit";
        calldata = encodeFunctionData({
          abi: ABIS.skyDeposit,
          functionName: "deposit",
          args: [defaultAmount, walletAddress as `0x${string}`],
        });
        break;
      }
      case "lido-wrap":
      case "lido": {
        contractAddress = LIDO.wstETH[CHAIN.BASE] as `0x${string}`;
        functionName = "wrap";
        calldata = encodeFunctionData({
          abi: ABIS.lidoWrap,
          functionName: "wrap",
          args: [defaultAmount],
        });
        break;
      }
      case "uniswap-swap-exact-input":
      case "uniswap": {
        contractAddress = (UNISWAP_V3.swapRouter as Record<number, string>)[chainId] as `0x${string}`
          ?? UNISWAP_V3.swapRouter[CHAIN.SEPOLIA] as `0x${string}`;
        functionName = "exactInputSingle";
        calldata = encodeFunctionData({
          abi: ABIS.uniswapSwap,
          functionName: "exactInputSingle",
          args: [{
            tokenIn:           TOKENS.USDC[CHAIN.BASE_SEPOLIA as keyof typeof TOKENS.USDC] as `0x${string}`,
            tokenOut:          TOKENS.WETH[CHAIN.BASE_SEPOLIA as keyof typeof TOKENS.WETH] as `0x${string}`,
            fee:               3000,
            recipient:         walletAddress as `0x${string}`,
            amountIn:          defaultAmount,
            amountOutMinimum:  0n,
            sqrtPriceLimitX96: 0n,
          }],
        });
        break;
      }
      default: {
        // Generic: return prepared calldata without contract-specific encoding
        return NextResponse.json({
          prepared: true,
          note: "Unknown action — provide action or protocol to resolve calldata",
          action, protocol,
          permissionsContext: permissionsContext.slice(0, 40) + "…",
          delegationManager,
        });
      }
    }
  } catch (e) {
    return NextResponse.json({ error: `Encoding failed: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }

  // ── Try 1Shot executeAsDelegator if configured ────────────────────────────────
  if (
    process.env.ONESHOT_API_KEY &&
    process.env.ONESHOT_API_SECRET &&
    delegationId
  ) {
    try {
      const client = getOneShotClient();

      // Look up the wallet ID
      const walletId = process.env.ONESHOT_WALLET_ID ?? "";

      // Execute via 1Shot delegated execution
      // NOTE: This requires the contract method to be pre-imported in 1Shot.
      // If not set up, 1Shot returns an error and we fall through to "prepared" state.
      const tx = await (client.contractMethods as { executeAsDelegator: Function }).executeAsDelegator(
        // contractMethodId would be needed here — not available without 1Shot setup
        // This path is illustrative; set ONESHOT_CONTRACT_METHOD_ID_<ACTION> env vars
        process.env[`ONESHOT_METHOD_${(action ?? "").toUpperCase().replace(/-/g, "_")}`] ?? "",
        { assets: defaultAmount.toString(), receiver: walletAddress },
        {
          walletId,
          memo: `CLOVE: ${action ?? protocol}`,
          delegationId,
        }
      );

      return NextResponse.json({
        submitted: true,
        txHash: tx?.txHash ?? tx?.id,
        action, protocol, contractAddress,
        via: "1shot",
      });
    } catch (e) {
      console.warn("[execute/defi] 1Shot execution failed:", e);
      // Fall through to "prepared" response
    }
  }

  // ── Return prepared calldata (no bundler configured) ─────────────────────────
  return NextResponse.json({
    prepared: true,
    contractAddress,
    functionName,
    calldata,
    action,
    protocol,
    delegationManager,
    permissionsContext: permissionsContext.slice(0, 40) + "…",
    note: "Calldata ready. Set ONESHOT_METHOD_* env vars + configure 1Shot contract methods to submit on-chain.",
  });
}
