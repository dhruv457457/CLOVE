import { NextRequest, NextResponse } from "next/server";
import { encodeFunctionData, parseUnits } from "viem";
import { UNISWAP_V3, MORPHO, LIDO, AAVE_V3, AERODROME, TOKENS, CHAIN } from "@/lib/protocols/addresses";
import { executeViaPublicRelayer } from "@/lib/oneshot/publicRelayer";

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
  aaveSupply: [{
    name: "supply", type: "function" as const,
    inputs: [
      { name: "asset",          type: "address" },
      { name: "amount",         type: "uint256" },
      { name: "onBehalfOf",     type: "address" },
      { name: "referralCode",   type: "uint16"  },
    ],
    stateMutability: "nonpayable" as const, outputs: [],
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
  // Aave v3 supply replaces Sky/sUSDS — Sky has no direct USDC deposit on Base.
  // supply(asset, amount, onBehalfOf, referralCode=0) → mints aUSDC to onBehalfOf.
  "aave-supply": {
    methodIdEnv: "ONESHOT_METHOD_AAVE_SUPPLY",
    contract: AAVE_V3.pool[CHAIN.BASE] as `0x${string}`,
    buildParams: (amount: bigint, onBehalfOf: `0x${string}`) => ({
      asset:        TOKENS.USDC[CHAIN.BASE],
      amount:       amount.toString(),
      onBehalfOf,
      referralCode: "0",
    }),
  },
  // BREAK-5 fix: on Base, wstETH is acquired by swapping USDC → wstETH via Uniswap
  // (there is no stETH on Base to wrap). We reuse the Uniswap swap route but target wstETH.
  "lido-wrap": {
    methodIdEnv: "ONESHOT_METHOD_UNISWAP_SWAP_EXACT_INPUT",  // reuse Uniswap swap
    contract: (UNISWAP_V3.swapRouter as Record<number, string>)[CHAIN.BASE] as `0x${string}`,
    buildParams: (amount: bigint, recipient: `0x${string}`) => ({
      params: {
        tokenIn:           TOKENS.USDC[CHAIN.BASE],
        tokenOut:          LIDO.wstETH[CHAIN.BASE],  // USDC → wstETH on Base
        fee:               500,  // 0.05% pool
        recipient,
        amountIn:          amount.toString(),
        amountOutMinimum:  "0",
        sqrtPriceLimitX96: "0",
      },
    }),
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

/**
 * Decode a permissionsContext into the delegationData array 1Shot expects.
 *
 * 1Shot's executeAsDelegator `delegationData` must be an array of JSON strings,
 * one per delegation in the chain (parent first, child last) with BigInts as
 * decimal strings — NOT the hex-encoded blob stored in the DB.
 *
 * Two storage formats exist:
 *   a) 0x + hex(JSON array)  — sub-agents from 1Shot redelegate → decode + split
 *   b) Raw ABI-encoded ERC-7715 context (root grants from MetaMask) — pass as-is
 *      in a single-element array; 1Shot handles ABI-encoded contexts too.
 */
function decodeDelegationData(permissionsContext: string): string[] {
  if (!permissionsContext.startsWith("0x")) return [permissionsContext];
  try {
    const json = Buffer.from(permissionsContext.slice(2), "hex").toString("utf-8");
    // If valid JSON it's the [parent, redelegation] array from 1Shot redelegate.
    const chain = JSON.parse(json) as unknown[];
    if (Array.isArray(chain) && chain.length > 0) {
      return chain.map(d => JSON.stringify(d));
    }
  } catch { /* not hex-encoded JSON — fall through */ }
  // ABI-encoded root context from MetaMask: pass the hex string directly.
  return [permissionsContext];
}

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

  // Decode to the array-of-JSON-strings format 1Shot requires.
  const delegationData = decodeDelegationData(permissionsContext);

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
          // delegationData: array of JSON strings, one per link in the chain
          // (parent first, child last). BigInts must be decimal strings in JSON.
          delegationData,
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
    // CODE-6: don't expose internal registry keys — just return the error
    return NextResponse.json({
      prepared: false,
      error: `Unknown action: ${action ?? protocol}. Supported: morpho-vault-deposit, aave-supply, lido-wrap, uniswap-swap-exact-input, aerodrome-swap-exact-tokens.`,
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

  // ── Try real on-chain execution ───────────────────────────────────────────────
  const methodId = process.env[registryEntry.methodIdEnv];
  const hasRealContext =
    permissionsContext &&
    permissionsContext !== "0xdemo" &&
    permissionsContext !== "0x" &&
    !/^0x0*$/.test(permissionsContext) &&
    permissionsContext.length > 20;

  if (hasRealContext) {
    // ── 1Shot Public Relayer — REAL DeFi deposit (approve + supply/deposit/swap) ──
    // The FunctionCall-scoped delegation authorizes the relayer to call USDC.approve
    // + the protocol method. Bundle = [fee] + [approve] + [protocol action].
    // Gas paid in USDC, relayed through the 1Shot permissionless mainnet relayer.
    const USDC_ADDR = TOKENS.USDC[CHAIN.BASE] as `0x${string}`;

    // approve(protocol, amount) — let the protocol pull USDC
    const approveData = encodeFunctionData({
      abi: ABIS.erc20Approve, functionName: "approve",
      args: [registryEntry.contract, defaultAmount],
    });

    // The protocol action calldata
    let workData: `0x${string}` = "0x";
    switch (actionKey) {
      case "morpho-vault-deposit":
        workData = encodeFunctionData({ abi: ABIS.morphoVaultDeposit, functionName: "deposit", args: [defaultAmount, walletAddress as `0x${string}`] }); break;
      case "aave-supply":
        workData = encodeFunctionData({ abi: ABIS.aaveSupply, functionName: "supply", args: [USDC_ADDR, defaultAmount, walletAddress as `0x${string}`, 0] }); break;
      case "uniswap-swap-exact-input":
        workData = encodeFunctionData({ abi: ABIS.uniswapSwap, functionName: "exactInputSingle", args: [{ tokenIn: USDC_ADDR, tokenOut: TOKENS.WETH[CHAIN.BASE] as `0x${string}`, fee: 3000, recipient: walletAddress as `0x${string}`, amountIn: defaultAmount, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] }); break;
      case "aerodrome-swap-exact-tokens":
        workData = encodeFunctionData({ abi: ABIS.aerodromeSwap, functionName: "swapExactTokensForTokens", args: [defaultAmount, 0n, [{ from: USDC_ADDR, to: TOKENS.AERO[CHAIN.BASE] as `0x${string}`, stable: false, factory: (AERODROME.poolFactory as Record<number, string>)[CHAIN.BASE] as `0x${string}` }], walletAddress as `0x${string}`, BigInt(Math.floor(Date.now() / 1000) + 1800)] }); break;
      default:
        workData = "0x"; // usdc-approve etc. — approve only
    }

    const workExecutions = workData !== "0x"
      ? [
          { target: USDC_ADDR,              data: approveData }, // approve protocol
          { target: registryEntry.contract, data: workData    }, // deposit / supply / swap
        ]
      : [
          { target: USDC_ADDR, data: approveData },              // approve-only action
        ];

    try {
      const relayResult = await executeViaPublicRelayer({
        userPermissionsContext: permissionsContext,
        workExecutions,
        memo:                   `CLOVE: ${actionKey}`,
      });
      if (relayResult.status !== "failed") {
        return NextResponse.json({
          submitted:       true,
          txHash:          relayResult.txHash,
          taskId:          relayResult.taskId,
          action:          actionKey,
          protocol,
          contractAddress: registryEntry.contract,
          amount:          defaultAmount.toString(),
          feeUsdc:         relayResult.feeUsdc,
          via:             "1shot-public-relayer",
        });
      }
      // Relayer gave a definitive failure (e.g. allowance exceeded) — surface it,
      // don't bother with the dead 1Shot fallback.
      return NextResponse.json({
        submitted: false,
        error:     relayResult.error ?? "Relayer rejected the transaction.",
        taskId:    relayResult.taskId,
        action:    actionKey,
        protocol,
        code:      "relayer-rejected",
      }, { status: 400 });
    } catch (e) {
      console.warn("[execute/defi] Public relayer exception:", e instanceof Error ? e.message : e);
    }

    // ── Path B: Authenticated 1Shot API (fallback when method UUIDs are set) ──
    if (methodId) {
      const oneshotParams = (registryEntry.buildParams as (a: bigint, b: `0x${string}`) => Record<string, unknown>)(
        defaultAmount, walletAddress as `0x${string}`,
      );
      const result = await executeViaOneShot(methodId, oneshotParams, permissionsContext, `CLOVE: ${actionKey}`);
      if (result) {
        return NextResponse.json({
          submitted:       true,
          txHash:          result.txHash,
          transactionId:   result.id,
          action:          actionKey,
          protocol,
          contractAddress: registryEntry.contract,
          amount:          defaultAmount.toString(),
          via:             "1shot",
        });
      }
    }
    // Both paths failed — hard fail, no demo fallback.
  }

  // No real context = no execution. Return a clear error.
  if (!hasRealContext) {
    return NextResponse.json({
      error: "No real ERC-7715 permission context. Grant a permission via MetaMask before running agents.",
      code:  "needs-permission",
    }, { status: 400 });
  }

  // Real context exists but both execution paths failed — surface the error.
  return NextResponse.json({
    error: "Execution failed via both 1Shot Public Relayer and executeAsDelegator. Check server logs.",
    action: actionKey,
    protocol,
    submitted: false,
  }, { status: 502 });
}
