import "server-only";

import { getVeniceClient, VENICE_MODELS } from "./client";
import type { BlueprintNode, BlueprintEdge, CompiledWorkflow } from "@/lib/aiCompiler";
import { PROTOCOL_METADATA } from "@/lib/protocols/actions";

const COMPILER_SYSTEM_PROMPT = `You are CLOVE's AI Workflow Compiler. You convert a user's DeFi strategy intent into a structured workflow JSON.

You also receive REAL-TIME MARKET CONTEXT from Tavily search — use this to build smarter, adaptive workflows.

## Node types

| type                | when to use |
|---------------------|-------------|
| trigger             | schedule (cron) or price/event condition |
| budget              | ERC-7715 recurring USDC permission (ALWAYS include) |
| intelligence-tavily | Add when user wants research, news, market context |
| intelligence        | Venice AI yield analysis via x402 (always include) |
| risk-check          | Add when user mentions risk, protection, safety |
| sentiment-check     | Add when strategy is conditional on market mood |
| compare-apy         | Add when user wants best/highest yield selection |
| defi-swap           | Uniswap V3 token swap |
| defi-lend           | Morpho vault deposit/withdraw |
| defi-stake          | Lido stETH wrap/unwrap |
| defi-save           | Sky sUSDS deposit/withdraw |
| defi-lp             | Aerodrome liquidity provision |
| intelligence-fal    | fal.ai visual report / image generation |
| condition           | if/else branch on data value |
| notify              | Telegram or email notification |

## Protocol slugs
uniswap | morpho | aerodrome | lido | sky

## Layout rules
- x: start at 80, increment by 200 per node
- y: alternate between 170 and 230 for visual stagger
- Smart workflow order:
  trigger → budget → [intelligence-tavily if research needed] → intelligence → [risk-check if risky] → [sentiment-check if conditional] → [compare-apy if optimising] → defi → [intelligence-fal if visual] → [notify if alerts mentioned]

## Required output — ONLY return this JSON, no markdown, no extra text:
{
  "nodes": [
    {
      "id": "trigger-node",
      "type": "<NodeType>",
      "label": "<short display name>",
      "description": "<one clear sentence explaining what this node does>",
      "x": <number>,
      "y": <number>,
      "config": { "<key>": "<value>" },
      "protocol": "<slug or omit if not defi-*>",
      "action": "<action slug or omit>"
    }
  ],
  "edges": [{ "id": "e1", "source": "<nodeId>", "target": "<nodeId>" }],
  "summary": "<one-sentence workflow description>"
}

## Node config examples
- intelligence-tavily: { "query": "DeFi hacks protocol risk", "cost": "0.005", "provider": "tavily" }
- intelligence: { "cost": "0.01", "resource": "/api/intelligence", "provider": "venice" }
- budget: { "amount": "<USDC from prompt or 10.00>", "token": "USDC" }
- risk-check: { "threshold": "medium", "action": "pause-if-high" }
- sentiment-check: { "minSentiment": "neutral", "pauseIfBearish": true }
- compare-apy: { "protocols": ["morpho", "sky", "aerodrome"], "metric": "apy" }
- intelligence-fal: { "type": "strategy-visualization", "provider": "fal.ai" }`;

/** Fetch Tavily market context before compiling — gives Venice real-world grounding. */
async function fetchTavilyContext(prompt: string): Promise<string | null> {
  if (!process.env.TAVILY_API_KEY) return null;

  try {
    const { searchCryptoYields, searchCryptoNews } = await import("@/lib/tavily/client");

    const lc = prompt.toLowerCase();
    const isRisk = lc.includes("risk") || lc.includes("protect") || lc.includes("safe") || lc.includes("panic");
    const topic  = isRisk ? "DeFi protocol risk events hacks security" : "DeFi yield rates market";

    const [yields, news] = await Promise.allSettled([
      searchCryptoYields(),
      searchCryptoNews(topic),
    ]);

    const parts: string[] = [];
    if (yields.status === "fulfilled" && yields.value.answer) {
      parts.push(`Current DeFi yields: ${yields.value.answer.slice(0, 200)}`);
    }
    if (news.status === "fulfilled" && news.value.results.length > 0) {
      const headlines = news.value.results.slice(0, 2).map(r => r.title).join("; ");
      parts.push(`Recent news: ${headlines}`);
    }

    return parts.length > 0 ? parts.join("\n") : null;
  } catch {
    return null;
  }
}

export async function compileStrategyWithVenice(
  prompt: string
): Promise<CompiledWorkflow> {
  const client = getVeniceClient();

  // Step 1: Fetch real-time Tavily context (best-effort, non-blocking)
  const marketContext = await fetchTavilyContext(prompt);

  // Step 2: Build enriched user message
  const protocolContext = Object.entries(PROTOCOL_METADATA)
    .map(([slug, meta]) => `- ${slug}: ${meta.name} — ${meta.description}`)
    .join("\n");

  const userMessage = [
    `Available protocols:\n${protocolContext}`,
    marketContext ? `\nReal-time market context (from Tavily):\n${marketContext}` : "",
    `\nCompile this strategy:\n${prompt}`,
  ].filter(Boolean).join("\n");

  let raw: string;
  try {
    const response = await client.chat.completions.create({
      model: VENICE_MODELS.compiler,
      messages: [
        { role: "system", content: COMPILER_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.15,
      max_tokens: 2500,
      // @ts-expect-error Venice-specific parameter
      venice_parameters: { include_venice_system_prompt: false },
    });

    raw = response.choices[0]?.message?.content ?? "";
  } catch (e) {
    console.error("[venice/compiler] API error, falling back to regex:", e);
    const { compilePromptToWorkflow } = await import("@/lib/aiCompiler");
    return compilePromptToWorkflow(prompt, marketContext ?? undefined);
  }

  // Strip markdown fences
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (raw.includes("\n") && !raw.startsWith("{")) {
    raw = raw.split("\n").find(l => l.trim().startsWith("{")) ?? raw;
  }

  let parsed: CompiledWorkflow;
  try {
    parsed = JSON.parse(raw) as CompiledWorkflow;
  } catch {
    console.warn("[venice/compiler] JSON parse failed, falling back");
    const { compilePromptToWorkflow } = await import("@/lib/aiCompiler");
    return compilePromptToWorkflow(prompt, marketContext ?? undefined);
  }

  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    const { compilePromptToWorkflow } = await import("@/lib/aiCompiler");
    return compilePromptToWorkflow(prompt, marketContext ?? undefined);
  }

  return { ...parsed, marketContext: marketContext ?? undefined };
}
