import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import { getVeniceClient, VENICE_MODELS } from "@/lib/venice/client";
import { buildMemoryPrompt } from "@/lib/agent/memory";
import { getThread, appendMessages, type ChatMessage } from "@/lib/chat/store";

export const maxDuration = 30;

/**
 * Phase 1 chat: Q&A about CLOVE + light strategy talk. NO agent creation yet —
 * that's Phase 2 (this route will later detect create intent and return a
 * proposed-plan payload). Server-only modules (Venice, memory, Mongo) stay
 * behind this route; the ChatPanel client only ever talks HTTP.
 */
const SYSTEM_PROMPT = `You are CLOVE, an autonomous DeFi agent OS on Base mainnet (chainId 8453).

WHAT YOU ARE:
- Users describe a strategy in plain English; you assemble a TEAM of autonomous agents that execute it on-chain using a delegated, on-chain-capped USDC budget.
- Permissions: the user grants an ERC-7715 USDC budget; each agent gets its own scoped cap enforced on-chain. Gas is paid in USDC via the 1Shot public relayer — the user never needs ETH.
- Agent types: yield teams (scout → risk → execute), copy-traders (mirror smart-money swaps), and rebalancers (move funds to better yields). Agents run on a schedule and report to Telegram.
- The user controls everything from this dashboard or from the linked Telegram bot.

HOW TO BEHAVE:
- Be concise, warm, and concrete. You are a guide, not a sales pitch.
- Answer questions about what CLOVE is and what the user can do here.
- If the user describes a strategy they want to run, help them shape it — but DO NOT claim to have created anything. Agent creation happens when they confirm via the "New workflow" flow. If they're ready, tell them to describe it in the prompt bar / click New workflow.
- Never invent transaction hashes, balances, or APYs. If you don't have live data in context, say so.
- Keep replies short (a few sentences). Use plain language, not jargon dumps.`;

export async function POST(req: NextRequest) {
  let body: { message?: unknown; walletAddress?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const message = String(body.message ?? "").trim();
  const wallet  = String(body.walletAddress ?? "").trim();
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

  // Prior turns for continuity (shared with Telegram via the same wallet key).
  const history = wallet ? await getThread(wallet) : [];

  // Inject the existing memory layer as context (positions, recent runs, insights).
  let memoryContext = "";
  if (wallet) {
    try {
      memoryContext = await buildMemoryPrompt(wallet);
    } catch {
      /* memory is best-effort context, never fatal */
    }
  }

  const system =
    SYSTEM_PROMPT +
    (memoryContext ? `\n\n=== THIS USER'S CONTEXT (live) ===\n${memoryContext}` : "");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    // Last 10 turns is plenty of continuity without blowing the context window.
    ...history.slice(-10).map((m): OpenAI.Chat.ChatCompletionMessageParam => ({
      role:    m.role,
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  let reply = "";
  try {
    const client = getVeniceClient();
    const res = await client.chat.completions.create({
      // `fast` (llama-3.2-3b) keeps chat replies snappy — Q&A about CLOVE doesn't
      // need the heavier `analyst`/`reasoning` models (which ran ~16s/reply).
      model:       VENICE_MODELS.fast,
      messages,
      temperature: 0.6,
    });
    reply = res.choices[0]?.message?.content?.trim() ?? "";
  } catch (e) {
    console.warn("[api/chat] Venice call failed:", e instanceof Error ? e.message : e);
    reply = "I couldn't reach my reasoning model just now — give me a moment and try again.";
  }
  if (!reply) reply = "I didn't catch that — could you rephrase?";

  // Persist both turns (fire-and-forget; only when we have a wallet to key on).
  if (wallet) {
    const userTurn: ChatMessage      = { role: "user",      content: message, ts: new Date().toISOString(), source: "web" };
    const assistantTurn: ChatMessage = { role: "assistant", content: reply,   ts: new Date().toISOString(), source: "web" };
    void appendMessages(wallet, [userTurn, assistantTurn]);
  }

  return NextResponse.json({ reply });
}

/** Load a wallet's thread so the panel can rehydrate on reload. */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ messages: [] });
  const messages = await getThread(wallet);
  return NextResponse.json({ messages });
}
