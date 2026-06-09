import "server-only";
import OpenAI from "openai";
import { internalHeaders } from "@/lib/auth/internal";

/**
 * The tool catalog for the new goalâ†’planâ†’execute agent loop.
 *
 * Includes the 5 DeFi/intel tools the old ReAct agent had, PLUS two new
 * "meta-tools" that let Venice dynamically grow its own thought graph:
 *   - addThought   â€” inject an arbitrary thought-node (observation / hypothesis)
 *   - revisePlan   â€” replace the remaining subgoals mid-run
 *
 * The meta-tools are what makes the inner canvas mutate in real time.
 */
export const TOOL_DEFINITIONS: OpenAI.Chat.ChatCompletionTool[] = [
  // â”€â”€ DeFi / Intel tools â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    type: "function",
    function: {
      name: "checkYields",
      description:
        "Fetch live DeFi yields (APY) + market news from Morpho, Aave, Aerodrome, Lido, Uniswap on Base. ALWAYS call first when scouting.",
      parameters: {
        type: "object",
        properties: {
          protocols: {
            type: "array",
            items: { type: "string" },
            description: "Optional subset of protocols to check",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checkRisk",
      description: "Classify market risk (LOW / MEDIUM / HIGH) from news + context. If HIGH, do not execute.",
      parameters: {
        type: "object",
        required: ["context"],
        properties: {
          context: { type: "string", description: "Market news or context to evaluate" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "executeDefi",
      description: "Deposit / swap / stake on a DeFi protocol via the user's ERC-7715 delegation. Gas is sponsored by 1Shot.",
      parameters: {
        type: "object",
        required: ["protocol", "amount", "reasoning"],
        properties: {
          protocol:  { type: "string", enum: ["morpho", "uniswap", "aerodrome", "lido", "aave"] },
          action:    { type: "string", enum: ["deposit", "swap", "stake", "save", "lp"] },
          amount:    { type: "string", description: "Amount in USDC, e.g. '0.1'" },
          reasoning: { type: "string", description: "Why this protocol was chosen" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rebalance",
      description: "Withdraw from current protocol + deposit into a better one in a single atomic action.",
      parameters: {
        type: "object",
        required: ["fromProtocol", "toProtocol", "amount", "reasoning"],
        properties: {
          fromProtocol: { type: "string", enum: ["morpho", "uniswap", "aerodrome", "lido", "aave"] },
          toProtocol:   { type: "string", enum: ["morpho", "uniswap", "aerodrome", "lido", "aave"] },
          amount:       { type: "string" },
          reasoning:    { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notifyUser",
      description: "Send a Telegram update. ALWAYS the last tool call.",
      parameters: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string" },
        },
      },
    },
  },

  // â”€â”€ Copy-trader tools (Base) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    type: "function",
    function: {
      name: "discoverWhales",
      description:
        "Autonomously find candidate smart-money wallets by scanning recent Base DEX router flow (most active high-value swappers). Returns ranked wallets PLUS their recent trades and convergence. Use when no wallets were supplied.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many top wallets to discover (default 5)" },
          hours: { type: "number", description: "Lookback window in hours (default 24)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checkWhaleTrades",
      description:
        "Read recent on-chain swaps of tracked smart-money wallets from Basescan (real on-chain data). Returns trades plus convergence signals (tokens bought by multiple wallets).",
      parameters: {
        type: "object",
        properties: {
          wallets: { type: "array", items: { type: "string" }, description: "Wallet addresses to track (omit to use the configured set)" },
          hours:   { type: "number", description: "Lookback window in hours (default 24)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "executeCopyTrade",
      description:
        "Mirror a whale's trade by swapping into the same token, sized to your budget. Uses the user's ERC-7715 delegation. Call only after confirming a strong, fresh signal.",
      parameters: {
        type: "object",
        required: ["protocol", "amount", "reasoning"],
        properties: {
          protocol:  { type: "string", enum: ["uniswap", "aerodrome"], description: "DEX to route the copy trade through" },
          tokenSymbol: { type: "string", description: "Token being copied, for the log" },
          amount:    { type: "string", description: "USDC amount to deploy" },
          reasoning: { type: "string", description: "Which wallets you're following and why" },
        },
      },
    },
  },

  // â”€â”€ Narrative-momentum tools (Base) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    type: "function",
    function: {
      name: "checkNarratives",
      description:
        "Scan X/Twitter and crypto news (via web search) for tokens/themes whose social mentions are growing. Returns RAW signals only â€” mention trend, rough mention volume, notable accounts, and any on-chain volume note. It deliberately does NOT tell you whether to buy or whether a narrative is early/late: YOU must judge that from the raw signals and record your reasoning with addThought.",
      parameters: {
        type: "object",
        properties: {
          focus: { type: "string", description: "Optional theme to bias the scan, e.g. 'AI agents', 'Base memecoins', 'RWA'" },
        },
      },
    },
  },

  // â”€â”€ Rebalancer tools (Base) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    type: "function",
    function: {
      name: "checkRealYields",
      description:
        "Fetch live best yields directly from DeFiLlama (real APY data across all Base protocols, not CLOVE's proxy). Returns sorted pools with APY, TVL, and risk.",
      parameters: {
        type: "object",
        properties: {
          asset:      { type: "string", description: "Filter by asset symbol, e.g. 'USDC'" },
          stableOnly: { type: "boolean", description: "Only stablecoin pools" },
          limit:      { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "monitorPositions",
      description:
        "Read the agent owner's current on-chain DeFi positions and their live APY. Use before rebalancing to know what you currently hold.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },

  // â”€â”€ Meta-tools â€” for dynamic canvas growth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    type: "function",
    function: {
      name: "addThought",
      description:
        "Insert a free-form thought node onto the inner canvas (an observation, hypothesis, or note). Use this when you want to record reasoning the user should see, without performing an action.",
      parameters: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", description: "The observation / hypothesis" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "revisePlan",
      description:
        "Replace the remaining subgoals with a new list. Use ONLY when scout results show the original plan no longer fits (e.g. you discovered a high-risk situation).",
      parameters: {
        type: "object",
        required: ["newSubgoals"],
        properties: {
          newSubgoals: {
            type: "array",
            items: {
              type: "object",
              required: ["description", "tools"],
              properties: {
                description: { type: "string" },
                tools:       { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
  },
];

// â”€â”€ Result types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ToolCallResult {
  tool:   string;
  args:   Record<string, unknown>;
  result: string;
  cost?:  number;   // x402 + execution cost in USDC
  txHash?: string;
  isMeta?: boolean; // true for addThought / revisePlan
}

// â”€â”€ Executor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ExecutorContext {
  baseUrl:             string;
  walletAddress:       string;
  permissionsContext?: string;
  delegationManager?:  string;
  delegationId?:       string;
  budgetUsdc:          string;
  /** Set when run-stream wants the budget guard active. */
  agentId?:            string;
  budgetUsedUsdc?:     number;
  /** Chain the agent runs on (8453 Base). */
  chainId?:            number;
  /** Agent-type-specific config (tracked wallets, edge threshold, topic, etc.). */
  typeConfig?:         Record<string, unknown>;
}

/**
 * Execute a single tool call. Returns the result JSON-stringified for Venice
 * to consume, plus any extracted metadata (cost, txHash, isMeta).
 *
 * Meta-tools (addThought / revisePlan) return immediately with `isMeta: true`
 * so the caller can interpret them specially (emit a thought / replan).
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx:  ExecutorContext,
): Promise<ToolCallResult> {
  // â”€â”€ Meta-tools â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (name === "addThought") {
    return {
      tool: name,
      args,
      result: JSON.stringify({ acknowledged: true, text: args.text }),
      isMeta: true,
    };
  }
  if (name === "revisePlan") {
    return {
      tool: name,
      args,
      result: JSON.stringify({ acknowledged: true, newSubgoalCount: Array.isArray(args.newSubgoals) ? args.newSubgoals.length : 0 }),
      isMeta: true,
    };
  }

  // â”€â”€ checkYields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (name === "checkYields") {
    try {
      let data: {
        bestApy?: number;
        recommended?: string;
        reason?: string;
        yields?: Record<string, { apy: number; tvl: string; risk: string }>;
        marketIntel?: { tavilyAnswer?: string; newsHeadline?: string };
        _clove?: { paid?: boolean; costUsdc?: number; via?: string };
      };
      // Call the internal intelligence endpoint directly (x402 removed).
      const res = await fetch(`${ctx.baseUrl}/api/intelligence`, {
        headers: internalHeaders(),
      });
      data = await res.json();
      return {
        tool: name,
        args,
        result: JSON.stringify({
          bestApy:      data.bestApy,
          recommended:  data.recommended,
          reason:       data.reason,
          yields:       data.yields,
          marketNews:   data.marketIntel?.tavilyAnswer?.slice(0, 200),
        }),
      };
    } catch (e) {
      return { tool: name, args, result: JSON.stringify({ error: String(e) }) };
    }
  }

  // â”€â”€ checkRisk â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (name === "checkRisk") {
    const context = String(args.context ?? "");

    // V-2: use Venice's built-in web search to get real-time protocol risk data
    // instead of just pattern-matching on whatever text checkYields returned.
    try {
      const veniceRes = await fetch("https://api.venice.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${process.env.VENICE_API_KEY ?? ""}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b",
          messages: [{
            role: "user",
            content: `You are a DeFi risk analyst. Using web search, assess the current risk level (LOW/MEDIUM/HIGH) for Base chain DeFi protocols.
Context from yield scout: ${context.slice(0, 400)}
Search for: recent exploits, governance risks, depeg events, protocol pauses on Base DeFi.
Return ONLY JSON: { "riskLevel": "LOW"|"MEDIUM"|"HIGH", "safeToExecute": true|false, "reason": "<1 sentence>" }`,
          }],
          venice_parameters: { enable_web_search: "on" },
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (veniceRes.ok) {
        const vData = await veniceRes.json();
        const raw = vData.choices?.[0]?.message?.content ?? "{}";
        const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
        const parsed = JSON.parse(text) as { riskLevel?: string; safeToExecute?: boolean; reason?: string };
        if (parsed.riskLevel) {
          return { tool: name, args, result: JSON.stringify({
            riskLevel:     parsed.riskLevel,
            safeToExecute: parsed.safeToExecute ?? parsed.riskLevel !== "HIGH",
            reason:        parsed.reason ?? "",
            source:        "venice-web-search",
          })};
        }
      }
    } catch { /* fallback to keyword heuristic below */ }

    // Fallback: fast keyword heuristic when Venice web search unavailable
    const text = context.toLowerCase();
    const high = ["hack", "exploit", "vulnerability", "attack", "breach", "drain", "rug", "pause"];
    const med  = ["risk", "volatile", "warning", "caution", "dip", "uncertainty"];
    const level = high.some(w => text.includes(w)) ? "HIGH"
                : med.some(w => text.includes(w))  ? "MEDIUM" : "LOW";
    return {
      tool: name,
      args,
      result: JSON.stringify({ riskLevel: level, safeToExecute: level !== "HIGH", source: "heuristic" }),
    };
  }

  // â”€â”€ executeDefi â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (name === "executeDefi") {
    const actionMap: Record<string, string> = {
      "morpho-deposit":    "morpho-vault-deposit",
      "aave-supply":       "aave-supply",
      "aave-deposit":      "aave-supply",
      "lido-stake":        "lido-wrap",
      "uniswap-swap":      "uniswap-swap-exact-input",
      "aerodrome-lp":      "aerodrome-swap-exact-tokens",
      "aerodrome-deposit": "aerodrome-swap-exact-tokens",
    };
    const protocol  = String(args.protocol ?? "morpho");
    const action    = String(args.action ?? "deposit");
    const slug      = actionMap[`${protocol}-${action}`] ?? `${protocol}-${action}`;
    const amount    = String(args.amount ?? "0.1");

    // â”€â”€ BUDGET GUARD â€” block if this tx would exceed 95% of budget â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const amountNum = Number.parseFloat(amount) || 0;
    const budgetNum = Number.parseFloat(ctx.budgetUsdc) || 0;
    const used      = ctx.budgetUsedUsdc ?? 0;
    if (budgetNum > 0 && (used + amountNum) > budgetNum * 0.95) {
      return {
        tool: name,
        args,
        result: JSON.stringify({
          blocked:     true,
          reason:      "Budget guard triggered â€” would exceed 95% of agent cap",
          budgetUsdc:  budgetNum,
          usedUsdc:    used,
          requested:   amountNum,
          remaining:   Math.max(0, budgetNum - used),
        }),
        cost: 0,
      };
    }

    try {
      const res = await fetch(`${ctx.baseUrl}/api/execute/defi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:             slug,
          protocol,
          nodeConfig:         { amount, platform: protocol, action },
          permissionsContext: ctx.permissionsContext,
          delegationManager:  ctx.delegationManager  ?? "0x",
          delegationId:       ctx.delegationId,
          walletAddress:      ctx.walletAddress,
        }),
      });
      const data = await res.json() as {
        submitted?: boolean; prepared?: boolean; txHash?: string;
        contractAddress?: string; via?: string;
        receiptToken?: { symbol: string; address: string; name: string };
        receivedAmount?: string;
      };
      return {
        tool: name,
        args,
        txHash: data.txHash,
        cost: 0, // CODE-1: DeFi execution cost tracked via on-chain gas (sponsored by 1Shot)
        result: JSON.stringify({
          reasoning:       args.reasoning,
          protocol,
          submitted:       data.submitted,
          prepared:        data.prepared,
          txHash:          data.txHash,
          via:             data.via,
          contractAddress: data.contractAddress,
          receiptToken:    data.receiptToken,
          receivedAmount:  data.receivedAmount,
        }),
      };
    } catch (e) {
      return { tool: name, args, result: JSON.stringify({ error: String(e) }) };
    }
  }

  // â”€â”€ rebalance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (name === "rebalance") {
    const fromProtocol = String(args.fromProtocol ?? "aave");
    const toProtocol   = String(args.toProtocol   ?? "morpho");
    const amount       = String(args.amount ?? "0.1");

    // BREAK-2: budget guard â€” rebalance was bypassing the guard that executeDefi has
    const amountNum = Number.parseFloat(amount) || 0;
    const budgetNum = Number.parseFloat(ctx.budgetUsdc) || 0;
    const used      = ctx.budgetUsedUsdc ?? 0;
    if (budgetNum > 0 && (used + amountNum) > budgetNum * 0.95) {
      return {
        tool: name, args,
        result: JSON.stringify({
          blocked: true,
          reason: "Budget guard â€” rebalance would exceed 95% of agent cap",
          budgetUsdc: budgetNum, usedUsdc: used, requested: amountNum,
        }),
        cost: 0,
      };
    }

    try {
      // BREAK-2: withdraw first â€” track whether it succeeded before attempting deposit
      const wRes = await fetch(`${ctx.baseUrl}/api/execute/defi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:             `${fromProtocol}-withdraw`,
          protocol:           fromProtocol,
          nodeConfig:         { amount, action: "withdraw" },
          permissionsContext: ctx.permissionsContext,
          delegationManager:  ctx.delegationManager  ?? "0x",
          delegationId:       ctx.delegationId,
          walletAddress:      ctx.walletAddress,
        }),
      });
      const wData = await wRes.json() as { prepared?: boolean; submitted?: boolean; txHash?: string; error?: string };

      // BREAK-2: only proceed to deposit if withdraw succeeded â€” prevent stuck positions
      if (wData.error || (!wData.prepared && !wData.submitted)) {
        return {
          tool: name, args,
          result: JSON.stringify({
            reasoning: args.reasoning,
            from: fromProtocol, to: toProtocol, amount,
            withdraw: { error: wData.error ?? "withdraw not prepared", txHash: wData.txHash },
            deposit:  { skipped: true, reason: "withdraw failed â€” deposit skipped to prevent fund loss" },
          }),
        };
      }

      // Deposit
      const dRes = await fetch(`${ctx.baseUrl}/api/execute/defi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:             toProtocol === "lido" ? "lido-wrap" : toProtocol === "aave" ? "aave-supply" : `${toProtocol}-deposit`,
          protocol:           toProtocol,
          nodeConfig:         { amount, action: "deposit" },
          permissionsContext: ctx.permissionsContext,
          delegationManager:  ctx.delegationManager  ?? "0x",
          delegationId:       ctx.delegationId,
          walletAddress:      ctx.walletAddress,
        }),
      });
      const dData = await dRes.json() as { prepared?: boolean; submitted?: boolean; txHash?: string };
      return {
        tool: name,
        args,
        txHash: dData.txHash ?? wData.txHash,
        result: JSON.stringify({
          reasoning: args.reasoning,
          from: fromProtocol, to: toProtocol, amount,
          withdraw: { prepared: wData.prepared, txHash: wData.txHash },
          deposit:  { prepared: dData.prepared, txHash: dData.txHash },
        }),
      };
    } catch (e) {
      return { tool: name, args, result: JSON.stringify({ error: String(e) }) };
    }
  }

  // â”€â”€ notifyUser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (name === "notifyUser") {
    try {
      const res = await fetch(`${ctx.baseUrl}/api/notify/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: args.message }),
      });
      const data = await res.json();
      return { tool: name, args, result: JSON.stringify({ sent: data.sent }) };
    } catch {
      return { tool: name, args, result: JSON.stringify({ sent: false }) };
    }
  }

  // ── discoverWhales ──────────────────────────────────────────────────────────
  if (name === "discoverWhales") {
    try {
      const limit = Number(args.limit ?? 5);
      const hours = Number(args.hours ?? 24);
      const res = await fetch(`${ctx.baseUrl}/api/whale/discover?limit=${limit}&hours=${hours}`, {
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json() as {
        wallets?: string[];
        discovered?: Array<{ wallet: string; swaps: number; ethMoved: number; lastSeenMinutes: number }>;
        trades?: unknown[];
        convergence?: Array<{ target: string; walletCount: number }>;
        note?: string;
      };
      return { tool: name, args, result: JSON.stringify({
        discoveredCount: data.wallets?.length ?? 0,
        wallets:         data.wallets ?? [],
        discovered:      data.discovered ?? [],
        tradeCount:      data.trades?.length ?? 0,
        trades:          (data.trades ?? []).slice(0, 15),
        convergence:     data.convergence ?? [],
        source:          "basescan",
        note:            data.note,
      })};
    } catch (e) {
      return { tool: name, args, result: JSON.stringify({ error: String(e), wallets: [], trades: [], convergence: [] }) };
    }
  }

  if (name === "checkWhaleTrades") {
    try {
      const cfgWallets = Array.isArray(ctx.typeConfig?.wallets) ? (ctx.typeConfig!.wallets as string[]) : [];
      const wallets = Array.isArray(args.wallets) && args.wallets.length > 0
        ? (args.wallets as string[])
        : cfgWallets;
      const hours = Number(args.hours ?? 24);
      const qs = new URLSearchParams();
      if (wallets.length > 0) qs.set("wallets", wallets.join(","));
      qs.set("hours", String(hours));
      const res = await fetch(`${ctx.baseUrl}/api/whale/activity?${qs}`, {
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json() as {
        trades?: Array<{ wallet: string; action: string; symbol?: string; router?: string; ageMinutes: number; basescanUrl: string }>;
        convergence?: Array<{ target: string; walletCount: number }>;
        error?: string;
      };
      return { tool: name, args, result: JSON.stringify({
        tradeCount:  data.trades?.length ?? 0,
        trades:      (data.trades ?? []).slice(0, 15),
        convergence: data.convergence ?? [],
        source:      "basescan",
        error:       data.error,
      })};
    } catch (e) {
      return { tool: name, args, result: JSON.stringify({ error: String(e), trades: [] }) };
    }
  }

  // â”€â”€ executeCopyTrade (thin wrapper over executeDefi swap) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // ── executeCopyTrade ────────────────────────────────────────────────────────
  if (name === "executeCopyTrade") {
    const protocol    = String(args.protocol ?? "uniswap");
    const amount      = String(args.amount ?? "0.1");
    const tokenSymbol = String(args.tokenSymbol ?? "");
    // BUG 1+6 fix: map well-known Base token symbols to contract addresses.
    // Without this, every copy trade swaps USDC→WETH regardless of what the whale bought.
    const TOKEN_ADDRESSES: Record<string, string> = {
      WETH:   "0x4200000000000000000000000000000000000006",
      ETH:    "0x4200000000000000000000000000000000000006",
      AERO:   "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
      cbETH:  "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
      cbBTC:  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      DEGEN:  "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
      BRETT:  "0x532f27101965dd16442E59d40670FaF5eBB142E4",
      HIGHER: "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe",
      USDT:   "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
      DAI:    "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    };
    // Case-INSENSITIVE lookup: registry keys are mixed-case (cbBTC, cbETH) but
    // symbols arrive in any case. A naive toUpperCase() match failed on cbBTC
    // ("CBBTC" !== "cbBTC") — blocking a token that was actually supported.
    const tokenOut = (() => {
      if (!tokenSymbol) return null;
      const want = tokenSymbol.toLowerCase();
      for (const [sym, addr] of Object.entries(TOKEN_ADDRESSES)) {
        if (sym.toLowerCase() === want) return addr;
      }
      return null;
    })();
    if (!tokenOut) {
      return {
        tool: name, args, cost: 0,
        result: JSON.stringify({
          blocked: true,
          reason: tokenSymbol
            ? ("Token " + tokenSymbol + " not in registry. Supported: " + Object.keys(TOKEN_ADDRESSES).join(", "))
            : "No tokenSymbol provided — specify which token the whale bought (from checkWhaleTrades results)",
        }),
      };
    }
    const amountNum = Number.parseFloat(amount) || 0;
    const budgetNum = Number.parseFloat(ctx.budgetUsdc) || 0;
    const used      = ctx.budgetUsedUsdc ?? 0;
    if (budgetNum > 0 && (used + amountNum) > budgetNum * 0.95) {
      return {
        tool: name, args, cost: 0,
        result: JSON.stringify({ blocked: true, reason: "Budget guard — copy trade would exceed 95% of cap", budgetUsdc: budgetNum, usedUsdc: used, requested: amountNum }),
      };
    }
    try {
      const action = protocol === "aerodrome" ? "aerodrome-swap-exact-tokens" : "uniswap-swap-exact-input";
      const res = await fetch(`${ctx.baseUrl}/api/execute/defi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          protocol,
          nodeConfig:         { amount, platform: protocol, action: "swap", tokenSymbol, tokenOut },
          permissionsContext: ctx.permissionsContext,
          delegationManager:  ctx.delegationManager  ?? "0x",
          delegationId:       ctx.delegationId,
          walletAddress:      ctx.walletAddress,
        }),
        // On-chain copy trade = relayer submit + forward() + confirmation, which
        // routinely takes 30-60s. A 25s abort made the tool report "timeout /
        // not-executed" while the tx actually succeeded on-chain. Wait long enough.
        signal: AbortSignal.timeout(120000),
      });
      const data = await res.json() as { submitted?: boolean; prepared?: boolean; txHash?: string; via?: string };
      return {
        tool: name, args, txHash: data.txHash, cost: 0,
        result: JSON.stringify({ reasoning: args.reasoning, tokenSymbol, tokenOut, submitted: data.submitted, prepared: data.prepared, txHash: data.txHash, via: data.via }),
      };
    } catch (e) {
      return { tool: name, args, result: JSON.stringify({ error: String(e) }) };
    }
  }

  // â”€â”€ checkNarratives (Venice web search over X/news) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (name === "checkNarratives") {
    const focus = String(args.focus ?? (ctx.typeConfig?.focus ?? "Base ecosystem tokens"));
    try {
      const veniceRes = await fetch("https://api.venice.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${process.env.VENICE_API_KEY ?? ""}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b",
          messages: [{
            role: "user",
            content: `You are a crypto data collector (NOT an analyst). Using web search, find 3-5 tokens/themes on Base or broader crypto whose social mentions (X/Twitter) are moving right now (focus: ${focus}).
Report ONLY raw, observable signals. Do NOT decide whether anything is "early", "late", or a buy â€” that judgement is made by someone else.
For each, report what you can actually observe: rough mention volume now vs ~6h/24h ago, a few notable accounts driving it, approximate market cap if known, and any on-chain volume figure you found (with its source).
Return ONLY JSON: { "signals": [ { "token": "...", "theme": "...", "mentionTrend": "<e.g. ~5x in 6h / steady / cooling>", "approxMentions": "<rough count or 'unknown'>", "notableAccounts": ["@..."], "approxMarketCap": "<or 'unknown'>", "onchainVolumeNote": "<observed volume + source, or 'not found'>" } ] }`,
          }],
          venice_parameters: { enable_web_search: "on" },
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (veniceRes.ok) {
        const vData = await veniceRes.json();
        const raw = vData.choices?.[0]?.message?.content ?? "{}";
        const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
        const parsed = JSON.parse(text) as { signals?: unknown[]; narratives?: unknown[] };
        const signals = Array.isArray(parsed.signals) ? parsed.signals
                      : Array.isArray(parsed.narratives) ? parsed.narratives : [];
        return { tool: name, args, result: JSON.stringify({
          signals: signals.slice(0, 5),
          focus,
          instruction: "These are RAW signals only. YOU must now judge: is each narrative early or already saturated? Does on-chain volume confirm it or is it just CT noise? Record your verdict with addThought, then only buy the ones you judge early AND volume-confirmed.",
          source: "venice-web-search",
        })};
      }
    } catch { /* fall through */ }
    return { tool: name, args, result: JSON.stringify({ signals: [], focus, source: "unavailable" }) };
  }

  // â”€â”€ checkRealYields (DeFiLlama direct) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (name === "checkRealYields") {
    try {
      const qs = new URLSearchParams({ chain: "Base", limit: String(Number(args.limit ?? 15)) });
      if (args.asset)      qs.set("asset", String(args.asset));
      if (args.stableOnly) qs.set("stableOnly", "true");
      const res = await fetch(`${ctx.baseUrl}/api/yields/live?${qs}`, { signal: AbortSignal.timeout(14000) });
      const data = await res.json() as {
        yields?: Array<{ protocol: string; symbol: string; apy: number; tvlUsd: number; ilRisk: string; outlook?: string }>;
        best?: { protocol: string; symbol: string; apy: number } | null;
        error?: string;
      };
      return { tool: name, args, result: JSON.stringify({
        best:   data.best,
        count:  data.yields?.length ?? 0,
        yields: (data.yields ?? []).slice(0, 12),
        source: "defillama",
        error:  data.error,
      })};
    } catch (e) {
      return { tool: name, args, result: JSON.stringify({ error: String(e), yields: [] }) };
    }
  }

  // â”€â”€ monitorPositions (read the owner's current positions) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (name === "monitorPositions") {
    try {
      const { getPositions } = await import("@/lib/agent/memory");
      const positions = await getPositions(ctx.walletAddress);
      return { tool: name, args, result: JSON.stringify({
        positionCount: positions.length,
        positions:     positions.map(p => ({ protocol: p.protocol, amount: p.amount, entryApy: p.entryApy, entryTimestamp: p.entryTimestamp })),
        source:        "clove-positions",
      })};
    } catch (e) {
      return { tool: name, args, result: JSON.stringify({ error: String(e), positions: [] }) };
    }
  }

  return { tool: name, args, result: JSON.stringify({ error: `Unknown tool: ${name}` }) };
}
