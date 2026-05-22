import "server-only";
import OpenAI from "openai";

/**
 * CLOVE AI Agent — ReAct loop using Venice AI + tool calling
 *
 * Venice AI DECIDES which tools to call and in what order.
 * This is what makes CLOVE a true AI agent, not just automation.
 *
 * Pattern: Reason → Act → Observe → Reason → Act → …
 */

function getVeniceClient() {
  return new OpenAI({
    apiKey: process.env.VENICE_API_KEY || "x402-no-key",
    baseURL: "https://api.venice.ai/api/v1",
    defaultHeaders: { "X-Venice-Include-System-Prompt": "false" },
  });
}

export interface CloveAgentInput {
  walletAddress:       string;
  budgetUsdc:          string;
  permissionsContext?: string;
  delegationManager?:  string;
  delegationId?:       string;
  goal?:               string;
  baseUrl:             string;
}

export interface CloveAgentResult {
  success:    boolean;
  steps:      Array<{ tool: string; result: string }>;
  finalText:  string;
  bestApy?:   number;
  protocol?:  string;
  txHash?:    string;
  costPaid:   number;
  durationMs: number;
}

// ── Tool definitions (OpenAI function-calling format) ──────────────────────────

const TOOL_DEFINITIONS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "checkYields",
      description: "Fetch current DeFi yield rates (APY) from Morpho, Sky, Aerodrome, Lido, Uniswap on Base. Also returns market news and risk signals. ALWAYS call this first.",
      parameters: {
        type: "object",
        properties: {
          protocols: { type: "array", items: { type: "string" }, description: "Which protocols to check" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checkRisk",
      description: "Evaluate current market risk. Returns LOW, MEDIUM, or HIGH. If HIGH, do NOT execute any DeFi transactions.",
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
      description: "Deposit funds into a DeFi protocol using the user's ERC-7715 delegated budget. Gas is free via 1Shot relay. Only call after confirming risk is not HIGH.",
      parameters: {
        type: "object",
        required: ["protocol", "amount", "reasoning"],
        properties: {
          protocol:  { type: "string", enum: ["morpho", "uniswap", "aerodrome", "lido", "sky"] },
          amount:    { type: "string", description: "Amount in USDC e.g. '10.00'" },
          reasoning: { type: "string", description: "Why you chose this protocol" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rebalance",
      description: "Withdraw from the current protocol and deposit into a better one. Use when memory shows user is in a protocol that is no longer optimal (e.g., Sky at 6.1% but Morpho is now 9.1%).",
      parameters: {
        type: "object",
        required: ["fromProtocol", "toProtocol", "amount", "reasoning"],
        properties: {
          fromProtocol: { type: "string", enum: ["morpho", "uniswap", "aerodrome", "lido", "sky"], description: "Protocol to withdraw from" },
          toProtocol:   { type: "string", enum: ["morpho", "uniswap", "aerodrome", "lido", "sky"], description: "Protocol to deposit into" },
          amount:       { type: "string", description: "Amount to move in USDC" },
          reasoning:    { type: "string", description: "Why rebalancing makes sense" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notifyUser",
      description: "Send a Telegram notification to the user. Always call this as the final step.",
      parameters: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string", description: "Summary message for the user" },
        },
      },
    },
  },
];

// ── Tool executor ──────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  input: CloveAgentInput,
  costRef: { value: number },
): Promise<string> {
  const { baseUrl, walletAddress, permissionsContext, delegationManager, delegationId } = input;

  if (name === "checkYields") {
    try {
      // ── REAL x402 payment using user's ERC-7715 delegated budget ─────────
      // If we have a permissionsContext, route through x402/pay which:
      // 1. Calls /api/intelligence → gets 402 challenge
      // 2. Uses 1Shot to redelegate to the x402 facilitator
      // 3. Calls /api/intelligence with real PAYMENT-SIGNATURE
      // 4. Returns yield data — user's USDC budget was actually used
      let data: {
        bestApy?: number; recommended?: string; reason?: string;
        yields?: Record<string, { apy: number; tvl: string; risk: string }>;
        marketIntel?: { tavilyAnswer?: string; newsHeadline?: string };
        _clove?: { paid?: boolean; costUsdc?: number; via?: string };
      };

      if (permissionsContext && permissionsContext !== "demo") {
        // Real path: pay via ERC-7715 → 1Shot → x402
        const payRes = await fetch(`${baseUrl}/api/x402/pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint:           "/api/intelligence",
            permissionsContext,
            delegationManager:  delegationManager ?? "0x",
            ...(delegationId ? { delegationId } : {}),
          }),
        });
        if (!payRes.ok) {
          // x402 pay failed — fall back to direct call for demo
          console.warn("[agent] x402 pay failed, using demo mode");
          const fallback = await fetch(`${baseUrl}/api/intelligence`, {
            headers: { "PAYMENT-SIGNATURE": "demo-fallback" },
          });
          data = await fallback.json();
        } else {
          data = await payRes.json();
        }
        if (data._clove?.costUsdc) costRef.value += data._clove.costUsdc;
        else costRef.value += 0.01;
      } else {
        // Demo path: no real permission — call directly
        const res = await fetch(`${baseUrl}/api/intelligence`, {
          headers: { "PAYMENT-SIGNATURE": "demo-no-permission" },
        });
        data = await res.json();
        costRef.value += 0.01;
      }

      return JSON.stringify({
        bestApy:      data.bestApy,
        recommended:  data.recommended,
        reason:       data.reason,
        yields:       data.yields,
        marketNews:   data.marketIntel?.tavilyAnswer?.slice(0, 200),
        newsHeadline: data.marketIntel?.newsHeadline,
        paidVia:      data._clove?.via ?? "demo",
      });
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  }

  if (name === "checkRisk") {
    const text = String(args.context ?? "").toLowerCase();
    const highRisk = ["hack", "exploit", "vulnerability", "attack", "breach", "drain", "rug", "pause"];
    const medRisk  = ["risk", "volatile", "warning", "caution", "dip", "uncertainty"];
    const level    = highRisk.some(w => text.includes(w)) ? "HIGH"
                   : medRisk.some(w => text.includes(w))  ? "MEDIUM" : "LOW";
    return JSON.stringify({ riskLevel: level, safeToExecute: level !== "HIGH" });
  }

  if (name === "executeDefi") {
    const actionMap: Record<string, string> = {
      "morpho-deposit":    "morpho-vault-deposit",
      "sky-deposit":       "sky-deposit",
      "lido-wrap":         "lido-wrap",
      "uniswap-swap":      "uniswap-swap-exact-input",
      "aerodrome-deposit": "aerodrome-swap-exact-tokens",
    };
    const protocol  = String(args.protocol ?? "morpho");
    const action    = String(args.action   ?? "deposit");
    const actionSlug = actionMap[`${protocol}-${action}`] ?? `${protocol}-${action}`;
    try {
      const res = await fetch(`${baseUrl}/api/execute/defi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:             actionSlug,
          protocol,
          nodeConfig:         { amount: args.amount, platform: protocol, action },
          permissionsContext: permissionsContext ?? "demo",
          delegationManager:  delegationManager  ?? "0x",
          delegationId,
          walletAddress,
        }),
      });
      const data = await res.json() as { submitted?: boolean; prepared?: boolean; txHash?: string; calldata?: string; contractAddress?: string; error?: string };
      return JSON.stringify({ reasoning: args.reasoning, submitted: data.submitted, prepared: data.prepared, txHash: data.txHash, calldata: data.calldata?.slice(0, 40) });
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  }

  if (name === "rebalance") {
    // Step 1: withdraw from old protocol
    const fromProtocol = String(args.fromProtocol ?? "sky");
    const toProtocol   = String(args.toProtocol   ?? "morpho");
    const amount       = String(args.amount ?? "10.00");

    const withdrawMap: Record<string, string> = {
      "morpho-withdraw":   "morpho-vault-withdraw",
      "sky-withdraw":      "sky-withdraw",
      "lido-withdraw":     "lido-unwrap",
      "uniswap-withdraw":  "uniswap-swap-exact-input",
      "aerodrome-withdraw":"aerodrome-swap-exact-tokens",
    };
    const depositMap: Record<string, string> = {
      "morpho-deposit":    "morpho-vault-deposit",
      "sky-deposit":       "sky-deposit",
      "lido-deposit":      "lido-wrap",
      "uniswap-deposit":   "uniswap-swap-exact-input",
      "aerodrome-deposit": "aerodrome-swap-exact-tokens",
    };

    try {
      // Withdraw from old protocol
      const withdrawRes = await fetch(`${baseUrl}/api/execute/defi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:             withdrawMap[`${fromProtocol}-withdraw`] ?? `${fromProtocol}-withdraw`,
          protocol:           fromProtocol,
          nodeConfig:         { amount, platform: fromProtocol, action: "withdraw" },
          permissionsContext: permissionsContext ?? "demo",
          delegationManager:  delegationManager  ?? "0x",
          delegationId,
          walletAddress,
        }),
      });
      const withdrawData = await withdrawRes.json() as { prepared?: boolean; txHash?: string; error?: string };

      // Deposit to new protocol
      const depositRes = await fetch(`${baseUrl}/api/execute/defi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:             depositMap[`${toProtocol}-deposit`] ?? `${toProtocol}-deposit`,
          protocol:           toProtocol,
          nodeConfig:         { amount, platform: toProtocol, action: "deposit" },
          permissionsContext: permissionsContext ?? "demo",
          delegationManager:  delegationManager  ?? "0x",
          delegationId,
          walletAddress,
        }),
      });
      const depositData = await depositRes.json() as { prepared?: boolean; txHash?: string; error?: string };

      return JSON.stringify({
        reasoning:      args.reasoning,
        fromProtocol,
        toProtocol,
        amount,
        withdraw:       { prepared: withdrawData.prepared, txHash: withdrawData.txHash },
        deposit:        { prepared: depositData.prepared,  txHash: depositData.txHash  },
        success:        !!(withdrawData.prepared || withdrawData.txHash) && !!(depositData.prepared || depositData.txHash),
      });
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  }

  if (name === "notifyUser") {
    try {
      const res = await fetch(`${baseUrl}/api/notify/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: args.message }),
      });
      const data = await res.json() as { sent?: boolean };
      return JSON.stringify({ sent: data.sent });
    } catch {
      return JSON.stringify({ sent: false });
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

// ── Main ReAct loop ────────────────────────────────────────────────────────────

export async function runCloveAgent(input: CloveAgentInput): Promise<CloveAgentResult> {
  const started   = Date.now();
  const steps:    Array<{ tool: string; result: string }> = [];
  const costRef   = { value: 0 };
  const client    = getVeniceClient();

  // ── Load agent memory from MongoDB ──────────────────────────────────────────
  let memoryPrompt = "AGENT MEMORY: First run — no history yet.";
  if (input.walletAddress && input.baseUrl) {
    try {
      const memRes = await fetch(
        `${input.baseUrl}/api/agent/memory/prompt?wallet=${encodeURIComponent(input.walletAddress)}`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (memRes.ok) {
        const memData = await memRes.json() as { prompt?: string };
        if (memData.prompt) memoryPrompt = memData.prompt;
      }
    } catch { /* non-fatal — proceed without memory */ }
  }

  const systemPrompt = `You are CLOVE — an autonomous DeFi agent on Base blockchain.

Your job: check yields, assess risk, EXECUTE a DeFi deposit, and notify the user.
Budget: ${input.budgetUsdc} USDC | Wallet: ${input.walletAddress}
Goal: ${input.goal ?? "Deposit to the highest-yield safe protocol on Base"}

${memoryPrompt}

Decision rules based on memory:
- If CURRENT POSITION is empty → call executeDefi (deposit to highest APY)
- If CURRENT POSITION is already in the BEST protocol → HOLD (skip to notifyUser)
- If another protocol offers >1.5% more APY → call rebalance (withdraw old, deposit new)
- If risk=HIGH → skip executeDefi and rebalance, just call notifyUser with warning

Available actions:
- executeDefi: deposit into a protocol
- rebalance: withdraw from current protocol, deposit into better one
- (skip both): hold current position

You MUST call tools in order:
1. checkYields — fetch live yields AND pay via x402 with the user's delegated budget
2. checkRisk — evaluate marketNews from step 1
3. executeDefi OR rebalance OR hold (based on memory + yields)
4. notifyUser — ALWAYS call this last with a clear summary

Do not explain your plan. Just call the tools.`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: "Run a full DeFi strategy cycle now." },
  ];

  let finalText = "";
  let bestApy: number | undefined;
  let protocol: string | undefined;
  let txHash: string | undefined;

  /** Parse Venice's occasional "text-mode" function call: <function=name,{...}> */
  function parseTextFunctionCall(
    text: string,
  ): Array<{ id: string; function: { name: string; arguments: string } }> | null {
    // Match <function=toolName,{...}> or <function=toolName,{...}</function>
    const match = text.match(/<function=([a-zA-Z]+),(\{[\s\S]*?\})(?:<\/function>)?/);
    if (!match) return null;
    const [, name, argsRaw] = match;
    if (!TOOL_DEFINITIONS.some(t => (t as { function?: { name?: string } }).function?.name === name)) return null;
    try {
      JSON.parse(argsRaw); // validate
      return [{ id: `text-call-${Date.now()}`, function: { name, arguments: argsRaw } }];
    } catch { return null; }
  }

  // ReAct loop — Venice decides when to stop
  for (let iteration = 0; iteration < 8; iteration++) {
    const response = await client.chat.completions.create({
      model:       "llama-3.3-70b",  // Fast, reliable tool calling
      messages,
      tools:       TOOL_DEFINITIONS,
      tool_choice: "auto",
    });

    const msg = response.choices[0]?.message;
    if (!msg) break;

    // Add assistant message to history
    messages.push(msg);

    // Check for text-mode function calls (Venice llama quirk)
    let effectiveToolCalls = msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
    if (!effectiveToolCalls?.length && msg.content) {
      const parsed = parseTextFunctionCall(msg.content);
      if (parsed) effectiveToolCalls = parsed;
    }

    // If no tool calls → agent is done
    if (!effectiveToolCalls?.length) {
      finalText = msg.content ?? "";
      break;
    }

    // Execute each tool call Venice requested
    const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];

    for (const tc of effectiveToolCalls) {
      const toolCall = tc as unknown as { id: string; function: { name: string; arguments: string } };
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>; } catch { /**/ }

      const result = await executeTool(toolCall.function.name, args, input, costRef);
      toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: result });
      steps.push({ tool: toolCall.function.name, result });

      // Extract key values
      try {
        const parsed = JSON.parse(result) as Record<string, unknown>;
        if (toolCall.function.name === "checkYields") {
          bestApy  = parsed.bestApy  as number;
          protocol = parsed.recommended as string;
        }
        if (toolCall.function.name === "executeDefi" && parsed.txHash) {
          txHash = parsed.txHash as string;
        }
      } catch { /**/ }
    }

    // Feed tool results back to Venice for next reasoning step
    messages.push(...toolResults);
  }

  return {
    success:    true,
    steps,
    finalText,
    bestApy,
    protocol,
    txHash,
    costPaid:   costRef.value,
    durationMs: Date.now() - started,
  };
}
