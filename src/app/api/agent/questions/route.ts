import { NextRequest, NextResponse } from "next/server";
import { getVeniceClient, VENICE_MODELS } from "@/lib/venice/client";

/**
 * POST { prompt: string }
 *
 * Venice reads the user's raw prompt and generates 5-7 contextual clarification
 * questions — Claude Design style. The frontend renders these as a multi-step
 * questionnaire before creating the agent.
 *
 * Returns: { questions: Question[], summary: string }
 */

export interface Question {
  id:       string;
  label:    string;
  hint?:    string;
  type:     "single" | "multi" | "slider" | "text";
  options?: string[];
  min?: number; max?: number; step?: number; defaultVal?: number;
  unit?: string;
}

const SYSTEM = `You are an AI assistant helping configure an autonomous DeFi agent named CLOVE.

A user typed a prompt describing what they want their agent to do. Your job:
1. Reason about their intent (yield? copy-trade? narrative? rebalance? multi-agent?)
2. EXTRACT every config detail the user ALREADY stated in their prompt.
3. Ask clarifying questions ONLY for the fields that are still MISSING or ambiguous.

CRITICAL — DO NOT re-ask what the user already told you:
- If the prompt states a budget (e.g. "$2", "10 USDC") → do NOT ask budget.
- If it states a cadence (e.g. "every 5 minutes", "weekly", "daily") → do NOT ask schedule.
- If it names protocols (Morpho, Aave, etc.) → do NOT ask protocols.
- If it states risk appetite ("safe", "aggressive", "skip risky") → do NOT ask risk.
- If it says how to be notified ("Telegram", "voice") → do NOT ask notify.
- If it says single vs team / "multi-agent" → do NOT ask orchestration.
- If the agent type is obvious from the prompt → do NOT ask agent type.
Only emit a question when the value genuinely cannot be inferred. If the prompt is
fully specified, return an EMPTY questions array.

Question types available:
- "single": pick one option
- "multi": pick multiple options (check-boxes)
- "slider": numeric range
- "text": free text (use sparingly, 1 max)

The fields a fully-configured agent needs (ask only the ones still unknown):
agentType, protocols, risk, budget, schedule, notify, orchestration.

CLOVE supports these agent archetypes (the "agentType" question MUST use exactly these option strings):
- "yield" — Finds and farms the best DeFi yields on Base
- "polymarket" — Bets on Polymarket prediction markets (runs on Polygon)
- "copy-trader" — Mirrors smart-money wallets when they converge (Base)
- "narrative" — Catches social/narrative momentum early (Base)
- "rebalancer" — Monitors real on-chain positions & rebalances to better yields (Base)

ALSO return a "prefilled" object containing every field you DID extract from the prompt,
using the same option strings/format as the questions (budget as a number). Example:
"prefilled": { "agentType": "copy-trader", "budget": 2, "schedule": "Every 5 minutes", "notify": ["Telegram message"] }

Return ONLY valid JSON — no prose:
{
  "summary": "One sentence describing what you understood the user wants",
  "prefilled": { /* fields extracted from the prompt */ },
  "questions": [  /* ONLY the still-missing fields; [] if none */
    {
      "id": "agentType",
      "label": "What kind of agent is this?",
      "hint": "Each archetype perceives a different real data source and acts on its own",
      "type": "single",
      "options": ["yield", "polymarket", "copy-trader", "narrative", "rebalancer"]
    },
    {
      "id": "protocols",
      "label": "Which protocols should the agent use?",
      "hint": "Agents are pre-wired for all of these on Base mainnet",
      "type": "multi",
      "options": ["Morpho", "Uniswap", "Aerodrome", "Lido", "Aave"]
    },
    {
      "id": "risk",
      "label": "Risk tolerance?",
      "hint": "Shapes when the agent holds vs. acts",
      "type": "single",
      "options": ["Conservative — skip if any uncertainty", "Moderate — act on clear signals", "Aggressive — always seek best yield"]
    },
    {
      "id": "budget",
      "label": "USDC budget per period?",
      "type": "slider",
      "min": 1, "max": 500, "step": 1, "defaultVal": 10, "unit": "USDC"
    },
    {
      "id": "schedule",
      "label": "How often should the agent run?",
      "type": "single",
      "options": ["Every minute", "Every 5 minutes", "Every hour", "Every 6 hours", "Daily", "Weekly", "On-demand only"]
    },
    {
      "id": "notify",
      "label": "How should the agent report back?",
      "type": "multi",
      "options": ["Telegram message", "Voice note (x402 TTS)", "Strategy image (x402 art)", "Silent — just execute"]
    },
    {
      "id": "orchestration",
      "label": "Agent architecture?",
      "hint": "Multi-agent creates a Scout + Risk Monitor + Executor team",
      "type": "single",
      "options": ["Single agent (simple)", "Multi-agent team — auto-wired orchestration", "Decide for me"]
    }
  ]
}`;

export async function POST(request: NextRequest) {
  let body: { prompt?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

  const client = getVeniceClient();

  try {
    const res = await client.chat.completions.create({
      model: VENICE_MODELS.compiler,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user",   content: `User prompt: "${prompt}"\n\nExtract everything already specified into "prefilled", and ask ONLY the fields still missing in "questions" ([] if none). Return ONLY JSON.` },
      ],
      temperature:     0.5,
      response_format: { type: "json_object" },
    });

    const text = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as { summary?: string; questions?: Question[]; prefilled?: Record<string, unknown> };

    // Respect a deliberately-empty array (prompt fully specified → ask nothing).
    // Only fall back to the full default set if the model didn't return an array.
    const questions = Array.isArray(parsed.questions) ? parsed.questions : defaultQuestions();

    return NextResponse.json({
      summary:   parsed.summary ?? "Setting up your DeFi agent.",
      questions,
      prefilled: parsed.prefilled ?? {},
    });
  } catch (e) {
    console.warn("[agent/questions] Venice failed, using defaults:", e);
    return NextResponse.json({ summary: "Setting up your DeFi agent.", questions: defaultQuestions(), prefilled: {} });
  }
}

function defaultQuestions(): Question[] {
  return [
    {
      id: "agentType", label: "What kind of agent is this?",
      hint: "Each archetype perceives a different real data source and acts on its own",
      type: "single",
      options: ["yield", "polymarket", "copy-trader", "narrative", "rebalancer"],
    },
    {
      id: "protocols", label: "Which protocols should the agent use?",
      hint: "All are live on Base mainnet", type: "multi",
      options: ["Morpho", "Uniswap", "Aerodrome", "Lido", "Aave"],
    },
    {
      id: "risk", label: "Risk tolerance?",
      hint: "Shapes when the agent holds vs. acts", type: "single",
      options: ["Conservative", "Moderate", "Aggressive"],
    },
    {
      id: "budget", label: "USDC budget per period?", type: "slider",
      min: 1, max: 500, step: 1, defaultVal: 10, unit: "USDC",
    },
    {
      id: "schedule", label: "How often should the agent run?", type: "single",
      options: ["Every minute", "Every 5 minutes", "Every hour", "Every 6 hours", "Daily", "Weekly", "On-demand only"],
    },
    {
      id: "notify", label: "How should the agent report back?", type: "multi",
      options: ["Telegram message", "Voice note (x402 TTS)", "Strategy image", "Silent"],
    },
    {
      id: "orchestration", label: "Agent architecture?",
      hint: "Multi-agent creates Scout + Risk Monitor + Executor team, auto-wired",
      type: "single",
      options: ["Single agent", "Multi-agent team — auto-wired", "Decide for me"],
    },
  ];
}
