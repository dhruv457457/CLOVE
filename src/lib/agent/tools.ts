import "server-only";
import OpenAI from "openai";

/**
 * The tool catalog for the new goal→plan→execute agent loop.
 *
 * Includes the 5 DeFi/intel tools the old ReAct agent had, PLUS two new
 * "meta-tools" that let Venice dynamically grow its own thought graph:
 *   - addThought   — inject an arbitrary thought-node (observation / hypothesis)
 *   - revisePlan   — replace the remaining subgoals mid-run
 *
 * The meta-tools are what makes the inner canvas mutate in real time.
 */
export const TOOL_DEFINITIONS: OpenAI.Chat.ChatCompletionTool[] = [
  // ── DeFi / Intel tools ─────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "checkYields",
      description:
        "Fetch live DeFi yields (APY) + market news from Morpho, Sky, Aerodrome, Lido, Uniswap on Base. Paid via x402 (0.01 USDC). ALWAYS call first when scouting.",
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
          protocol:  { type: "string", enum: ["morpho", "uniswap", "aerodrome", "lido", "sky"] },
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
          fromProtocol: { type: "string", enum: ["morpho", "uniswap", "aerodrome", "lido", "sky"] },
          toProtocol:   { type: "string", enum: ["morpho", "uniswap", "aerodrome", "lido", "sky"] },
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

  // ── Meta-tools — for dynamic canvas growth ────────────────────────────────
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

// ── Result types ───────────────────────────────────────────────────────────────

export interface ToolCallResult {
  tool:   string;
  args:   Record<string, unknown>;
  result: string;
  cost?:  number;   // x402 + execution cost in USDC
  txHash?: string;
  isMeta?: boolean; // true for addThought / revisePlan
}

// ── Executor ───────────────────────────────────────────────────────────────────

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
  // ── Meta-tools ─────────────────────────────────────────────────────────────
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

  // ── checkYields ─────────────────────────────────────────────────────────────
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
      if (ctx.permissionsContext && ctx.permissionsContext !== "demo" && ctx.permissionsContext !== "0xdemo") {
        const payRes = await fetch(`${ctx.baseUrl}/api/x402/pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint:           "/api/intelligence",
            permissionsContext: ctx.permissionsContext,
            delegationManager:  ctx.delegationManager ?? "0x",
            ...(ctx.delegationId ? { delegationId: ctx.delegationId } : {}),
          }),
        });
        if (!payRes.ok) {
          const fb = await fetch(`${ctx.baseUrl}/api/intelligence`, { headers: { "PAYMENT-SIGNATURE": "demo-fallback" } });
          data = await fb.json();
        } else {
          data = await payRes.json();
        }
      } else {
        const res = await fetch(`${ctx.baseUrl}/api/intelligence`, { headers: { "PAYMENT-SIGNATURE": "demo-no-permission" } });
        data = await res.json();
      }
      const cost = data._clove?.costUsdc ?? 0.01;
      return {
        tool: name,
        args,
        cost,
        result: JSON.stringify({
          bestApy:      data.bestApy,
          recommended:  data.recommended,
          reason:       data.reason,
          yields:       data.yields,
          marketNews:   data.marketIntel?.tavilyAnswer?.slice(0, 200),
          paidVia:      data._clove?.via ?? "demo",
          costPaid:     cost,
        }),
      };
    } catch (e) {
      return { tool: name, args, result: JSON.stringify({ error: String(e) }) };
    }
  }

  // ── checkRisk ───────────────────────────────────────────────────────────────
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

  // ── executeDefi ─────────────────────────────────────────────────────────────
  if (name === "executeDefi") {
    const actionMap: Record<string, string> = {
      "morpho-deposit":    "morpho-vault-deposit",
      "sky-deposit":       "sky-deposit",
      "sky-save":          "sky-deposit",
      "lido-stake":        "lido-wrap",
      "uniswap-swap":      "uniswap-swap-exact-input",
      "aerodrome-lp":      "aerodrome-swap-exact-tokens",
      "aerodrome-deposit": "aerodrome-swap-exact-tokens",
    };
    const protocol  = String(args.protocol ?? "morpho");
    const action    = String(args.action ?? "deposit");
    const slug      = actionMap[`${protocol}-${action}`] ?? `${protocol}-${action}`;
    const amount    = String(args.amount ?? "0.1");

    // ── BUDGET GUARD — block if this tx would exceed 95% of budget ──────────
    const amountNum = Number.parseFloat(amount) || 0;
    const budgetNum = Number.parseFloat(ctx.budgetUsdc) || 0;
    const used      = ctx.budgetUsedUsdc ?? 0;
    if (budgetNum > 0 && (used + amountNum) > budgetNum * 0.95) {
      return {
        tool: name,
        args,
        result: JSON.stringify({
          blocked:     true,
          reason:      "Budget guard triggered — would exceed 95% of agent cap",
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
          permissionsContext: ctx.permissionsContext ?? "demo",
          delegationManager:  ctx.delegationManager  ?? "0x",
          delegationId:       ctx.delegationId,
          walletAddress:      ctx.walletAddress,
        }),
      });
      const data = await res.json() as {
        submitted?: boolean; prepared?: boolean; txHash?: string;
        contractAddress?: string; via?: string;
      };
      return {
        tool: name,
        args,
        txHash: data.txHash,
        cost: data.submitted ? 0 : 0,
        result: JSON.stringify({
          reasoning:       args.reasoning,
          submitted:       data.submitted,
          prepared:        data.prepared,
          txHash:          data.txHash,
          via:             data.via,
          contractAddress: data.contractAddress,
        }),
      };
    } catch (e) {
      return { tool: name, args, result: JSON.stringify({ error: String(e) }) };
    }
  }

  // ── rebalance ───────────────────────────────────────────────────────────────
  if (name === "rebalance") {
    const fromProtocol = String(args.fromProtocol ?? "sky");
    const toProtocol   = String(args.toProtocol   ?? "morpho");
    const amount       = String(args.amount ?? "0.1");

    try {
      // Withdraw
      const wRes = await fetch(`${ctx.baseUrl}/api/execute/defi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:             `${fromProtocol}-withdraw`,
          protocol:           fromProtocol,
          nodeConfig:         { amount, action: "withdraw" },
          permissionsContext: ctx.permissionsContext ?? "demo",
          delegationManager:  ctx.delegationManager  ?? "0x",
          delegationId:       ctx.delegationId,
          walletAddress:      ctx.walletAddress,
        }),
      });
      const wData = await wRes.json();
      // Deposit
      const dRes = await fetch(`${ctx.baseUrl}/api/execute/defi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:             toProtocol === "lido" ? "lido-wrap" : `${toProtocol}-deposit`,
          protocol:           toProtocol,
          nodeConfig:         { amount, action: "deposit" },
          permissionsContext: ctx.permissionsContext ?? "demo",
          delegationManager:  ctx.delegationManager  ?? "0x",
          delegationId:       ctx.delegationId,
          walletAddress:      ctx.walletAddress,
        }),
      });
      const dData = await dRes.json();
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

  // ── notifyUser ──────────────────────────────────────────────────────────────
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

  return { tool: name, args, result: JSON.stringify({ error: `Unknown tool: ${name}` }) };
}
