import "server-only";
import { getVeniceClient, VENICE_MODELS } from "@/lib/venice/client";
import type { AgentInsight } from "@/lib/agent/memory";
import type { AgentType } from "@/lib/agent/agents";
import { getAgentTypeDef } from "@/lib/agent/agentTypes";

// One-line descriptions for every tool the planner can put in a subgoal.
// Keeps the planner's "AVAILABLE TOOLS" section in sync with the registry.
const TOOL_DESCRIPTIONS: Record<string, string> = {
  checkYields:            "fetch live APYs + market news from Morpho, Sky, Lido, Uniswap, Aerodrome",
  checkRisk:              "evaluate current market risk (uses Venice web search for real-time data)",
  executeDefi:            "deposit / swap / stake on a protocol via ERC-7715 delegation",
  rebalance:              "withdraw from one protocol and deposit into a better one atomically",
  notifyUser:             "send Telegram report (always include as the final subgoal)",
  checkWhaleTrades:       "read recent on-chain swaps of tracked smart-money wallets (Basescan)",
  executeCopyTrade:       "mirror a smart-money swap proportionally to your budget",
  checkNarratives:        "find tokens/themes whose social mentions are spiking (Venice web search over X)",
  checkRealYields:        "fetch the best real yields right now directly from DeFiLlama",
  monitorPositions:       "read your current on-chain positions and their live APY",
};

// ── Plan shape ─────────────────────────────────────────────────────────────────

export interface SubGoal {
  id:          string;     // local id within this plan, e.g. "s1"
  description: string;     // e.g. "Check current best USDC APY across Base"
  tools:       string[];   // e.g. ["checkYields", "checkRisk"]
}

export interface Plan {
  subgoals:  SubGoal[];
  reasoning: string;       // short, surfaced to the user as a "plan" thought
}

/** Build the system prompt for the planner — uses memory + insights to plan smarter. */
function planSystemPrompt(memoryPrompt: string, insights: AgentInsight[], agentType?: AgentType, hasWallets = false): string {
  const insightLines = insights.length
    ? insights.map(i => {
        // Show scope so the planner knows when an insight came from a teammate
        const scope = (i as AgentInsight & { scope?: string }).scope;
        const sim   = (i as AgentInsight & { _similarity?: number })._similarity;
        const tag   = scope === "team"   ? "[from team]"
                    : scope === "wallet" ? "[from your other agents]"
                    : "";
        const relevance = typeof sim === "number" ? ` (${(sim * 100).toFixed(0)}% rel)` : "";
        return `- ${i.text} ${tag}${relevance}`;
      }).join("\n")
    : "(none yet — this is an early run)";

  // Separate team data (from upstream agents) from own history for clarity
  const teamLines = insights.filter(i => (i as AgentInsight & { scope?: string }).scope === "team");
  const ownLines  = insights.filter(i => (i as AgentInsight & { scope?: string }).scope !== "team");

  const teamBlock = teamLines.length
    ? teamLines.map(i => {
        const sim = (i as AgentInsight & { _similarity?: number })._similarity;
        const rel = typeof sim === "number" ? ` (${(sim * 100).toFixed(0)}% relevant)` : "";
        return `  • ${i.text}${rel}`;
      }).join("\n")
    : "  (no team data yet — this may be the first run or the first agent in the chain)";

  const ownBlock = ownLines.length
    ? ownLines.map(i => {
        const sim = (i as AgentInsight & { _similarity?: number })._similarity;
        const rel = typeof sim === "number" ? ` (${(sim * 100).toFixed(0)}% relevant)` : "";
        return `  • ${i.text}${rel}`;
      }).join("\n")
    : "  (no personal history yet)";

  // Build the AVAILABLE TOOLS section from the agent-type registry so each
  // archetype (yield / polymarket / copy-trader / narrative / rebalancer) only
  // sees — and plans with — the tools it is actually allowed to call.
  const def        = getAgentTypeDef(agentType);
  const allowed    = def.tools.filter(t => t !== "addThought" && t !== "revisePlan");
  const toolsBlock = allowed
    .map(t => `- ${t}   — ${TOOL_DESCRIPTIONS[t] ?? "(agent tool)"}`)
    .join("\n");

  // Type-specific planning rules. Generic yield/rebalancer keep the original
  // rules; the "true agent" archetypes get rules matching their workflow.
  // Copy-trader has TWO modes — the planner must pick the right entry tool:
  //   • FRIEND mode (wallets configured): copy each qualifying buy from THOSE
  //     wallets directly — the user chose them, so no 2+ convergence is required.
  //   • DISCOVERY mode (no wallets): discoverWhales finds smart money first, and
  //     convergence (2+ wallets on one token) is the safety gate against being exit
  //     liquidity.
  // ⚠️ CRITICAL: the read tool (discoverWhales / checkWhaleTrades) and
  // executeCopyTrade MUST live in the SAME subgoal. Each subgoal runs as an
  // isolated reasoning loop, so a split means the copy step never sees which
  // token was discovered — and the agent holds forever. Keep them together.
  const copyTraderRules = hasWallets
?
`1. Plan a SINGLE subgoal that contains BOTH checkWhaleTrades AND executeCopyTrade AND notifyUser together — they MUST share one reasoning step so the token's CONTRACT ADDRESS from the trade flows straight into the copy. NEVER split them across subgoals.
2. Inside that subgoal: read your tracked wallets' recent buys, then copy EACH fresh buy that passes the copy rules (minTokenAmount) via executeCopyTrade — pass the token's CONTRACT ADDRESS from the trade. You do NOT need 2+ convergence; the user chose these wallets.
3. Skip a copy only for an obvious scam/honeypot, not for ordinary buys. End by notifying the user. Generate 1–2 subgoals total.`
:
`1. Plan a SINGLE subgoal that contains BOTH discoverWhales AND executeCopyTrade AND notifyUser together — they MUST share one reasoning step so the converged token flows straight into the copy. NEVER split them across subgoals (a split makes the copy step blind and the agent holds).
2. Inside that subgoal: call discoverWhales (no wallets are configured), then copy the STRONGEST converged token (most wallets) via executeCopyTrade — pass its CONTRACT ADDRESS, or the symbol if that's all the result gives.
3. End by notifying the user. Generate 1–2 subgoals total.`;

  const rulesByType: Partial<Record<AgentType, string>> = {
    "copy-trader": copyTraderRules,
    narrative:
`1. Plan monitorPositions FIRST — exit cooling narratives you already hold via executeDefi before considering new buys.
2. Then checkNarratives for raw signals; YOU judge early-vs-late and volume confirmation (record it with addThought).
3. Plan executeDefi only for narratives you judge early AND volume-confirmed.
4. Always end with notifyUser. Generate 2–4 subgoals maximum.`,
    rebalancer:
`1. Start with monitorPositions, then checkRealYields (DeFiLlama — real APYs).
2. Plan rebalance only when a current position underperforms the best alternative beyond the switching cost.
3. Always end with notifyUser. Generate 2–4 subgoals maximum.`,
  };
  const genericRules =
`1. If teammate data already has fresh yield/risk info, SKIP checkYields/checkRisk and go straight to executeDefi
2. Always end with notifyUser to report what happened
3. If risk is HIGH in teammate data, plan a HOLD subgoal instead of executeDefi
4. Use rebalance (not executeDefi) when switching from one protocol to another
5. Generate 2–4 subgoals maximum`;
  const rulesBlock = (agentType && rulesByType[agentType]) ? rulesByType[agentType]! : genericRules;

  return `You are the PLANNING phase of an autonomous ${def.label} on ${def.chainName}.

═══ AGENT CONTEXT ════════════════════════════════════════════
${memoryPrompt}

═══ DATA FROM TEAMMATE AGENTS (read this first) ══════════════
${teamBlock}

═══ YOUR OWN PAST INSIGHTS ══════════════════════════════════
${ownBlock}

═══ AVAILABLE TOOLS (you may ONLY use these) ═══════════════
${toolsBlock}

═══ PLANNING RULES ══════════════════════════════════════════
${rulesBlock}

Think step by step about what the agent actually needs to do given the context above.
Then return ONLY this JSON:
{
  "reasoning": "<one sentence: what you will do and why>",
  "subgoals": [
    { "id": "s1", "description": "<concrete action>", "tools": ["checkYields"] },
    { "id": "s2", "description": "<concrete action>", "tools": ["executeDefi", "notifyUser"] }
  ]
}`;
}

/** Build a plan from the agent's goal + memory + past insights. */
export async function veniceGeneratePlan(
  goal:          string,
  memoryPrompt:  string,
  insights:      AgentInsight[],
  agentType?:    AgentType,
  hasWallets:    boolean = false,
): Promise<Plan> {
  const client  = getVeniceClient();
  const system  = planSystemPrompt(memoryPrompt, insights, agentType, hasWallets);
  const userMsg = `Goal: ${goal}\n\nReturn ONLY the JSON plan.`;

  // The analyst model (GLM) returns EMPTY content when response_format=json_object
  // is forced — that's the "Unexpected end of JSON input" we kept hitting. So:
  //   • call GLM WITHOUT json mode (rely on the "ONLY JSON" prompt + fence strip),
  //   • retry once, and
  //   • on the final attempt use the compiler model (qwen), which DOES honour
  //     json_object reliably.
  const attempts: Array<{ model: string; jsonMode: boolean }> = [
    { model: VENICE_MODELS.analyst,  jsonMode: false },
    { model: VENICE_MODELS.analyst,  jsonMode: false },
    { model: VENICE_MODELS.compiler, jsonMode: true  },
  ];

  for (let i = 0; i < attempts.length; i++) {
    const { model, jsonMode } = attempts[i];
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user",   content: userMsg },
        ],
        temperature: 0.4,
        ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      });
      const raw = res.choices[0]?.message?.content ?? "";
      // Some models wrap JSON in ```json ... ``` fences — strip before parsing.
      const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      if (!text) throw new Error("empty response content");
      const parsed = JSON.parse(text) as Plan;
      if (!Array.isArray(parsed.subgoals) || parsed.subgoals.length === 0) {
        throw new Error("empty subgoals list");
      }
      return {
        reasoning: parsed.reasoning ?? "Plan generated.",
        subgoals: parsed.subgoals.map((s, idx) => ({
          id:          s.id          ?? `s${idx + 1}`,
          description: s.description ?? "(no description)",
          tools:       Array.isArray(s.tools) ? s.tools : [],
        })),
      };
    } catch (e) {
      console.warn(`[planner] attempt ${i + 1}/${attempts.length} (${model}${jsonMode ? ", json" : ""}) failed:`, e instanceof Error ? e.message : e);
      // try the next attempt; on the last one we fall through to the default plan
    }
  }

  // Fallback: a sensible, type-aware default plan so the loop never gets stuck.
  console.warn("[planner] all attempts failed — using fallback plan");
  return fallbackPlan(agentType, hasWallets);
}

/** A minimal, valid default plan per agent type (used when the LLM call fails). */
function fallbackPlan(agentType?: AgentType, hasWallets = false): Plan {
  switch (agentType) {
    case "copy-trader":
      // Mode-aware: discovery (no wallets) MUST start with discoverWhales, else
      // checkWhaleTrades returns nothing and the agent holds forever.
      // ONE subgoal: read + copy + notify share a single reasoning loop so the
      // discovered token's address flows into executeCopyTrade. Splitting them
      // makes the copy step blind (separate subgoals don't share context).
      return hasWallets
        ? {
            reasoning: "Default plan: read tracked wallets' buys and copy each qualifying one, then notify.",
            subgoals: [
              { id: "s1", description: "Read tracked wallets' recent buys and copy each qualifying buy", tools: ["checkWhaleTrades", "executeCopyTrade", "notifyUser"] },
            ],
          }
        : {
            reasoning: "Default plan: discover smart money and copy the strongest converged buy, then notify.",
            subgoals: [
              { id: "s1", description: "Discover smart money and copy the strongest converged token", tools: ["discoverWhales", "executeCopyTrade", "notifyUser"] },
            ],
          };
    case "narrative":
      return {
        reasoning: "Default plan: check held positions → exit cooling → scan → buy early → notify.",
        subgoals: [
          { id: "s1", description: "Review held narratives, exit any that have cooled", tools: ["monitorPositions", "executeDefi"] },
          { id: "s2", description: "Scan raw narrative signals and judge them",         tools: ["checkNarratives", "addThought"] },
          { id: "s3", description: "Buy early, volume-confirmed narratives, then report", tools: ["executeDefi", "notifyUser"] },
        ],
      };
    case "rebalancer":
      return {
        reasoning: "Default plan: read positions → compare real yields → rebalance → notify.",
        subgoals: [
          { id: "s1", description: "Read current positions and live APY", tools: ["monitorPositions", "checkRealYields"] },
          { id: "s2", description: "Rebalance to a better yield",         tools: ["rebalance", "notifyUser"] },
        ],
      };
    default:
      return {
        reasoning: "Default plan: scout → decide → notify.",
        subgoals: [
          { id: "s1", description: "Scout yields and risk signals",     tools: ["checkYields", "checkRisk"] },
          { id: "s2", description: "Decide whether to deposit or hold",  tools: ["executeDefi"] },
          { id: "s3", description: "Report the outcome to the user",     tools: ["notifyUser"] },
        ],
      };
  }
}

// ── Reflection ─────────────────────────────────────────────────────────────────

export interface Reflection {
  insight:    string;    // short lesson learnt this run, < 280 chars
  tags:       string[];  // ["sky","apy","trend"]
  didSucceed: boolean;
}

export async function veniceReflect(
  goal:        string,
  plan:        Plan,
  toolResults: Array<{ tool: string; result: string }>,
  /** Ground truth about on-chain execution — prevents the model fabricating
   *  "executed X" insights on runs where nothing was broadcast. */
  execution?:  { executed: boolean; holdReason?: string | null },
): Promise<Reflection> {
  const client = getVeniceClient();
  // LLM-3 fix: 200 chars cuts off APY data mid-sentence. Use 800 chars so the
  // reflection model sees the full protocol comparison before writing the insight.
  // Format tool results in a human-readable way, not raw JSON dumps
  const resultsBlock = toolResults.map((r, i) => {
    let summary = r.result.slice(0, 800);
    try {
      const p = JSON.parse(r.result) as Record<string, unknown>;
      if (r.tool === "checkYields")  summary = `bestApy=${p.bestApy}, recommended=${p.recommended}, reason=${String(p.reason ?? "").slice(0, 120)}`;
      if (r.tool === "checkRisk")    summary = `riskLevel=${p.riskLevel}, safeToExecute=${p.safeToExecute}, reason=${String(p.reason ?? "").slice(0, 120)}`;
      if (r.tool === "executeDefi")  summary = `submitted=${p.submitted}, protocol=${r.result.includes("blocked") ? "BLOCKED" : "ok"}, txHash=${p.txHash ?? "none"}`;
      if (r.tool === "rebalance")    summary = `from=${JSON.stringify(p.from)}, to=${JSON.stringify(p.to)}, txHash=${p.txHash ?? "none"}`;
      if (r.tool === "notifyUser")   summary = `sent=${p.sent}`;
    } catch { /**/ }
    return `${i + 1}. [${r.tool}] ${summary}`;
  }).join("\n");

  const sys = `You are the REFLECTION phase of an autonomous DeFi agent.

Analyze what just happened and extract ONE actionable lesson for future runs.
Focus on: which protocols performed, what risks were found, what decisions were made, what worked or failed.

Good lessons (be specific, include numbers when available):
- "Morpho USDC APY was 9.3% — deposited $5. Sky was 4.1% — skipped"
- "checkRisk returned HIGH due to Morpho governance vote — correctly held"
- "executeDefi blocked by budget guard at 95% utilization — reduce allocation"
- "Risk Monitor correctly identified MEDIUM risk and still executed — threshold is appropriate"

Return ONLY JSON:
{
  "insight": "<single specific lesson under 280 chars, include APY numbers if available>",
  "tags": ["protocol_name", "action_taken", "outcome"],
  "didSucceed": true/false
}`;

  try {
    // Ground-truth execution line — without this the model routinely INVENTS
    // "executed copy trade with token XYZ" on runs where nothing was broadcast.
    const execLine = execution
      ? execution.executed
        ? "GROUND TRUTH: a real on-chain transaction WAS broadcast this run."
        : `GROUND TRUTH: NO on-chain transaction was broadcast this run — do NOT claim any trade, deposit, or execution happened. The run held${execution.holdReason ? ` because: ${execution.holdReason}` : ""}. Your insight must reflect the hold and its reason.`
      : "";

    const res = await client.chat.completions.create({
      // LLM-2 fix: reflection writes permanent memory — use the full 70B model,
      // not the 3B fast model. Low-quality insights poison every future plan.
      model: VENICE_MODELS.reasoning,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Goal: ${goal}\n\nPlan reasoning: ${plan.reasoning}\n\nResults:\n${resultsBlock}\n\n${execLine}\n\nReturn ONLY JSON.` },
      ],
      temperature: 0.3,
      // NOTE: llama-3.3-70b on Venice returns a bare 400 when response_format is
      // json_object — that mode only works on the qwen compiler model. The prompt
      // already asks for "ONLY JSON" and we strip fences + JSON.parse below, so we
      // don't need the strict response_format here.
    });
    const raw  = res.choices[0]?.message?.content ?? "{}";
    // LLM-4 fix: strip markdown code fences if model wraps the response
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(text) as Reflection;
    return {
      insight:    (parsed.insight ?? "Run completed without notable lessons.").slice(0, 280),
      tags:       Array.isArray(parsed.tags) ? parsed.tags.slice(0, 6).map(t => String(t).toLowerCase()) : [],
      didSucceed: typeof parsed.didSucceed === "boolean" ? parsed.didSucceed : true,
    };
  } catch (e) {
    console.warn("[planner] veniceReflect failed:", e);
    return {
      // Even without the LLM, the insight must be truthful about a hold.
      insight: execution && !execution.executed
        ? `Held — ${execution.holdReason ?? "no qualifying action this run"}.`.slice(0, 280)
        : "Run completed (no LLM reflection available).",
      tags: [],
      didSucceed: execution ? execution.executed : true,
    };
  }
}

/** Compose a performance-art image prompt from the run's reflection + context. */
export function imagePromptForReflection(
  reflection: Reflection,
  ctx?: { protocol?: string; apy?: number; action?: string },
): string {
  const palette = "quiet luxury palette, paper #F4F1EA background, ink #0B0C09, single jolt of acid lime #C8FF3D";
  const motif = ctx?.action === "deposit"  ? "capital flowing into a single petal"
              : ctx?.action === "rebalance"? "two petals exchanging energy"
              : ctx?.action === "withdraw" ? "a petal withdrawing inward"
              : "a quiet field at dawn, capital at rest";
  const tag = ctx?.protocol && ctx?.apy ? ` — ${ctx.protocol} ${ctx.apy.toFixed(2)}% APY` : "";
  return `Editorial generative art, ${motif}${tag}. ${palette}. ${reflection.insight}. Minimal, calm, no text, abstract.`;
}
