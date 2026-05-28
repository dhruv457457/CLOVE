import "server-only";
import { getVeniceClient, VENICE_MODELS } from "@/lib/venice/client";
import type { AgentInsight } from "@/lib/agent/memory";

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
function planSystemPrompt(memoryPrompt: string, insights: AgentInsight[]): string {
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

  return `You are the PLANNING phase of an autonomous DeFi agent named CLOVE.

Your job is NOT to execute. Your job is to break the user's goal into 2-5 concrete subgoals,
each of which uses one or more of the available tools.

Available tools:
- checkYields   — fetch live APYs + market news (paid via x402)
- checkRisk     — evaluate market risk from news context
- executeDefi   — deposit / swap / stake on a DeFi protocol (Morpho, Sky, Lido, Uniswap, Aerodrome)
- rebalance     — withdraw from one protocol + deposit into another
- notifyUser    — send Telegram notification (always last)

You MAY add subgoals that loop or branch. You MAY use checkYields multiple times
across subgoals to verify decisions. Reflect on past insights — don't repeat mistakes.

${memoryPrompt}

LEARNED INSIGHTS FROM PAST RUNS:
${insightLines}

V-5: Think step by step about the goal, the available tools, and any past insights before deciding on subgoals.
Then at the end, return ONLY a single JSON object matching this shape exactly:
{
  "reasoning": "<one short sentence explaining the plan>",
  "subgoals": [
    { "id": "s1", "description": "<what to do>", "tools": ["checkYields"] },
    { "id": "s2", "description": "...", "tools": ["checkRisk", "executeDefi"] }
  ]
}`;
}

/** Build a plan from the agent's goal + memory + past insights. */
export async function veniceGeneratePlan(
  goal:          string,
  memoryPrompt:  string,
  insights:      AgentInsight[],
): Promise<Plan> {
  const client = getVeniceClient();
  try {
    const res = await client.chat.completions.create({
      model: VENICE_MODELS.analyst,
      messages: [
        { role: "system", content: planSystemPrompt(memoryPrompt, insights) },
        { role: "user",   content: `Goal: ${goal}\n\nReturn ONLY the JSON plan.` },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
    });
    const raw  = res.choices[0]?.message?.content ?? "{}";
    // LLM-4 fix: some models (GLM, Llama) wrap JSON in ```json ... ``` fences.
    // Strip markdown code fences before parsing.
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const parsed = JSON.parse(text) as Plan;
    if (!Array.isArray(parsed.subgoals) || parsed.subgoals.length === 0) {
      throw new Error("Empty subgoals list");
    }
    return {
      reasoning: parsed.reasoning ?? "Plan generated.",
      subgoals: parsed.subgoals.map((s, i) => ({
        id:          s.id          ?? `s${i + 1}`,
        description: s.description ?? "(no description)",
        tools:       Array.isArray(s.tools) ? s.tools : [],
      })),
    };
  } catch (e) {
    // Fallback: a sensible default plan so the loop never gets stuck
    console.warn("[planner] veniceGeneratePlan failed, using fallback:", e);
    return {
      reasoning: "Default plan: scout → decide → notify.",
      subgoals: [
        { id: "s1", description: "Scout yields and risk signals",        tools: ["checkYields", "checkRisk"] },
        { id: "s2", description: "Decide whether to deposit or hold",    tools: ["executeDefi"] },
        { id: "s3", description: "Report the outcome to the user",       tools: ["notifyUser"] },
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
): Promise<Reflection> {
  const client = getVeniceClient();
  // LLM-3 fix: 200 chars cuts off APY data mid-sentence. Use 800 chars so the
  // reflection model sees the full protocol comparison before writing the insight.
  const resultsBlock = toolResults
    .map((r, i) => `${i + 1}. ${r.tool}: ${r.result.slice(0, 800)}`)
    .join("\n");

  const sys = `You are the REFLECTION phase of an autonomous agent.

Look at the goal, the plan that was generated, and what actually happened.
Produce a SHORT lesson (under 280 chars) that future runs should remember.
Examples of good lessons:
- "Sky APY has been steadily falling; deprioritize"
- "Morpho deposits cost ~0.0001 ETH in gas via 1Shot — cheap"
- "Risk-check returned MEDIUM but executeDefi still succeeded; threshold could be looser"

Return ONLY JSON:
{
  "insight": "<single sentence lesson, <280 chars>",
  "tags": ["lower","snake_case","tags"],
  "didSucceed": true/false
}`;

  try {
    const res = await client.chat.completions.create({
      // LLM-2 fix: reflection writes permanent memory — use the full 70B model,
      // not the 3B fast model. Low-quality insights poison every future plan.
      model: VENICE_MODELS.reasoning,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Goal: ${goal}\n\nPlan reasoning: ${plan.reasoning}\n\nResults:\n${resultsBlock}\n\nReturn ONLY JSON.` },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
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
      insight: "Run completed (no LLM reflection available).",
      tags: [],
      didSucceed: true,
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
