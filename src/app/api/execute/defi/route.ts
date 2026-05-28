import { NextRequest, NextResponse } from "next/server";
import { encodeFunctionData, parseUnits } from "viem";
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

/** Minimal ABIs (still used for the local "prepared" calldata fallback) */
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
        { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
        { name: "fee", type: "uint24" }, { name: "recipient", type: "address" },
        { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" },
        { name: "sqrtPriceLimitX96", type: "uint160" },
      ],
    }],
    stateMutability: "nonpayable" as const, outputs: [{ name: "amountOut", type: "uint256" }],
  }],
  aerodromeSwap: [{
    name: "swapExactTokensForTokens", type: "function" as const,
    inputs: [
      { name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" },
      { name: "routes", type: "tuple[]", components: [
        { name: "from", type: "address" }, { name: "to", type: "address" },
        { name: "stable", type: "bool" }, { name: "factory", type: "address" },
      ]},
      { name: "to", type: "address" }, { name: "deadline", type: "uint256" },
    ],
    stateMutability: "nonpayable" as const, outputs: [{ name: "amounts", type: "uint256[]" }],
  }],
} as const;

// ── 1Shot Contract Method Registry ────────────────────────────────────────────
// Each entry maps a CLOVE action to:
//  - methodIdEnv: name of the env var holding the UUID from 1Shot dashboard
//  - buildParams: shape of params passed to 1Shot.executeAsDelegator
//  - contractAddress: for local calldata fallback
const METHOD_REGISTRY = {
  "usdc-approve": {
    methodIdEnv: "ONESHOT_METHOD_USDC_APPROVE",
    contract: TOKENS.USDC[CHAIN.BASE] as `0x${string}`,
    buildParams: (amount: bigint, spender: `0x${string}`) => ({
      spender, amount: amount.toString(),
    }),
  },
  "morpho-vault-deposit": {
    methodIdEnv: "ONESHOT_METHOD_MORPHO_VAULT_DEPOSIT",
    contract: MORPHO.vaults.MOONWELL_USDC as `0x${string}`,
    buildParams: (amount: bigint, receiver: `0x${string}`) => ({
      assets: amount.toString(), receiver,
    }),
  },
  "sky-deposit": {
    methodIdEnv: "ONESHOT_METHOD_SKY_DEPOSIT",
    contract: SKY.sUSDS[CHAIN.BASE] as `0x${string}`,
    buildParams: (amount: bigint, receiver: `0x${string}`) => ({
      assets: amount.toString(), receiver,
    }),
  },
  "lido-wrap": {
    methodIdEnv: "ONESHOT_METHOD_LIDO_WRAP",
    contract: LIDO.wstETH[CHAIN.BASE] as `0x${string}`,
    buildParams: (amount: bigint) => ({ _stETHAmount: amount.toString() }),
  },
  "uniswap-swap-exact-input": {
    methodIdEnv: "ONESHOT_METHOD_UNISWAP_SWAP_EXACT_INPUT",
    contract: (UNISWAP_V3.swapRouter as Record<number, string>)[CHAIN.BASE] as `0x${string}`,
    buildParams: (amount: bigint, recipient: `0x${string}`) => ({
      params: {
        tokenIn: TOKENS.USDC[CHAIN.BASE],
        tokenOut: TOKENS.WETH[CHAIN.BASE],
        fee: 3000, recipient,
        amountIn: amount.toString(),
        amountOutMinimum: "0",
        sqrtPriceLimitX96: "0",
      },
    }),
  },
  "aerodrome-swap-exact-tokens": {
    methodIdEnv: "ONESHOT_METHOD_AERODROME_SWAP_EXACT_TOKENS",
    contract: (AERODROME.router as Record<number, string>)[CHAIN.BASE] as `0x${string}`,
    buildParams: (amount: bigint, recipient: `0x${string}`) => ({
      amountIn: amount.toString(),
      amountOutMin: "0",
      routes: [{
        from: TOKENS.USDC[CHAIN.BASE],
        to: TOKENS.AERO[CHAIN.BASE],
        stable: false,
        factory: (AERODROME.poolFactory as Record<number, string>)[CHAIN.BASE],
      }],
      to: recipient,
      deadline: (Math.floor(Date.now() / 1000) + 1800).toString(),
    }),
  },
} as const;

type ActionKey = keyof typeof METHOD_REGISTRY;

// ── 1Shot executeAsDelegator wrapper ────────────────────────────────────────
async function executeViaOneShot(
  methodId: string,
  params: Record<string, unknown>,
  permissionsContext: string,
  memo: string,
): Promise<{ txHash?: string; id?: string } | null> {
  const apiKey    = process.env.ONESHOT_API_KEY;
  const apiSecret = process.env.ONESHOT_API_SECRET;
  const walletId  = process.env.ONESHOT_WALLET_ID;
  if (!apiKey || !apiSecret || !walletId) return null;

  try {
    // 1. Get OAuth token
    const tokenRes = await fetch("https://api.1shotapi.com/v0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     apiKey,
        client_secret: apiSecret,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) {
      console.warn("[execute/defi] 1Shot token failed:", await tokenRes.text());
      return null;
    }
    const { access_token } = await tokenRes.json();

    // 2. POST /methods/{id}/execute-as-delegator
    const execRes = await fetch(
      `https://api.1shotapi.com/v0/methods/${methodId}/execute-as-delegator`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          params,
          walletId,
          memo,
          // One-time use: pass the raw ERC-7715 permissionsContext.
          // 1Shot decodes the chain, builds redeemDelegation UserOp, signs, submits.
          delegationData: [permissionsContext],
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!execRes.ok) {
      const errText = await execRes.text();
      console.warn(`[execute/defi] 1Shot exec failed (${execRes.status}):`, errText);
      return null;
    }
    return await execRes.json();
  } catch (e) {
    console.warn("[execute/defi] 1Shot exception:", e);
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: ExecRequest;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const { action, protocol, nodeConfig = {}, permissionsContext, delegationManager, walletAddress } = body;

  const actionKey = (action ?? protocol ?? "") as ActionKey;
  const registryEntry = METHOD_REGISTRY[actionKey];

  if (!registryEntry) {
    return NextResponse.json({
      prepared: false,
      error: `Unknown action: ${action ?? protocol}`,
      available: Object.keys(METHOD_REGISTRY),
    }, { status: 400 });
  }

  // ── Amount in USDC (6 decimals) ─────────────────────────────────────────────
  const amountStr = (nodeConfig.amount as string) ?? "1.00";
  let defaultAmount: bigint;
  try {
    defaultAmount = parseUnits(amountStr, 6);
  } catch {
    defaultAmount = parseUnits("1", 6);
  }

  // ── Try real on-chain execution via 1Shot ────────────────────────────────────
  const methodId = process.env[registryEntry.methodIdEnv];
  const hasRealContext =
    permissionsContext &&
    permissionsContext !== "0xdemo" &&
    permissionsContext !== "0x" &&
    permissionsContext.length > 20;

  if (methodId && hasRealContext) {
    const params = (registryEntry.buildParams as (a: bigint, b: `0x${string}`) => Record<string, unknown>)(
      defaultAmount,
      walletAddress as `0x${string}`,
    );

    const result = await executeViaOneShot(
      methodId,
      params,
      permissionsContext,
      `CLOVE: ${actionKey}`,
    );
    if (result) {
      return NextResponse.json({
        submitted: true,
        txHash:           result.txHash,
        transactionId:    result.id,
        action:           actionKey,
        protocol,
        contractAddress:  registryEntry.contract,
        amount:           defaultAmount.toString(),
        via:              "1shot",
      });
    }
    // Fall through to "prepared" if 1Shot failed
  }

  // ── Fallback: return prepared calldata (when methodId missing OR 1Shot failed) ─
  let calldata: `0x${string}` = "0x";
  let functionName = "";

  try {
    switch (actionKey) {
      case "usdc-approve":
        calldata = encodeFunctionData({
          abi: ABIS.erc20Approve, functionName: "approve",
          args: [registryEntry.contract, defaultAmount],
        });
        functionName = "approve";
        break;
      case "morpho-vault-deposit":
        calldata = encodeFunctionData({
          abi: ABIS.morphoVaultDeposit, functionName: "deposit",
          args: [defaultAmount, walletAddress as `0x${string}`],
        });
        functionName = "deposit";
        break;
      case "sky-deposit":
        calldata = encodeFunctionData({
          abi: ABIS.skyDeposit, functionName: "deposit",
          args: [defaultAmount, walletAddress as `0x${string}`],
        });
        functionName = "deposit";
        break;
      case "lido-wrap":
        calldata = encodeFunctionData({
          abi: ABIS.lidoWrap, functionName: "wrap", args: [defaultAmount],
        });
        functionName = "wrap";
        break;
      case "uniswap-swap-exact-input":
        calldata = encodeFunctionData({
          abi: ABIS.uniswapSwap, functionName: "exactInputSingle",
          args: [{
            tokenIn: TOKENS.USDC[CHAIN.BASE] as `0x${string}`,
            tokenOut: TOKENS.WETH[CHAIN.BASE] as `0x${string}`,
            fee: 3000, recipient: walletAddress as `0x${string}`,
            amountIn: defaultAmount, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
          }],
        });
        functionName = "exactInputSingle";
        break;
      case "aerodrome-swap-exact-tokens":
        calldata = encodeFunctionData({
          abi: ABIS.aerodromeSwap, functionName: "swapExactTokensForTokens",
          args: [
            defaultAmount, 0n,
            [{
              from: TOKENS.USDC[CHAIN.BASE] as `0x${string}`,
              to: TOKENS.AERO[CHAIN.BASE] as `0x${string}`,
              stable: false,
              factory: (AERODROME.poolFactory as Record<number, string>)[CHAIN.BASE] as `0x${string}`,
            }],
            walletAddress as `0x${string}`,
            BigInt(Math.floor(Date.now() / 1000) + 1800),
          ],
        });
        functionName = "swapExactTokensForTokens";
        break;
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Encoding failed: ${e instanceof Error ? e.message : e}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    prepared:        true,
    submitted:       false,
    contractAddress: registryEntry.contract,
    functionName,
    calldata,
    action:          actionKey,
    protocol,
    amount:          defaultAmount.toString(),
    delegationManager,
    permissionsContext: permissionsContext?.slice(0, 40) + "…",
    reason:          methodId
      ? "1Shot executeAsDelegator failed — check server logs"
      : `Set ${registryEntry.methodIdEnv} in .env.local with the 1Shot contract method UUID to enable on-chain submission`,
  });
}
