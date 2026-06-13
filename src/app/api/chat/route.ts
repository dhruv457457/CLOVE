import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import { getVeniceClient, VENICE_MODELS } from "@/lib/venice/client";
import { buildMemoryPrompt } from "@/lib/agent/memory";
import { getThread, appendMessages, listThreads, type ChatMessage } from "@/lib/chat/store";
import { listAgentsForWallet } from "@/lib/agent/agents";

export const maxDuration = 30;

/**
 * Phase 1 chat: Q&A about CLOVE + light strategy talk. NO agent creation yet —
 * that's Phase 2 (this route will later detect create intent and return a
 * proposed-plan payload). Server-only modules (Venice, memory, Mongo) stay
 * behind this route; the ChatPanel client only ever talks HTTP.
 */
const SYSTEM_PROMPT = `You are CLOVE, an autonomous DeFi agent OS on Base mainnet (chainId 8453).

WHAT YOU ARE:
- Users describe a strategy in plain English; you assemble autonomous agents that execute it on-chain using a delegated, on-chain-capped USDC budget.
- Permissions: the user grants an ERC-7715 USDC budget; each agent gets its own scoped cap enforced on-chain. Gas is paid in USDC via the 1Shot public relayer — the user never needs ETH.
- The user controls everything from this dashboard or from the linked Telegram bot.

AGENT TYPES (these are DISTINCT and enforced by the code — never say the distinction isn't enforced):
- yield 🌾 — finds the best DeFi yield and DEPOSITS fresh USDC into it (checkYields → checkRisk → executeDefi). Can be a single agent OR a multi-agent TEAM: Fund Manager → Scout → Convergence Analyzer → Risk Monitor → Executors.
- copy-trader 🐋 — mirrors smart-money wallets when 2+ converge on a token (discoverWhales / checkWhaleTrades → executeCopyTrade).
- rebalancer ⚖️ — a SINGLE agent that reads the user's CURRENT on-chain positions (monitorPositions), checks the best real yields (checkRealYields), and MOVES funds from an underperforming protocol to a better one (rebalance) ONLY when the gain beats gas + switching cost. It does NOT deposit fresh capital and is NOT a team.
- A multi-agent "team" (Fund Manager + Scout + Risk + Executors) is ALWAYS the yield topology — it deposits. If a user wanted rebalancing but has a Scout/Risk/Executor team, they built a yield team; a true rebalancer is one ⚖️ agent. Tell them this plainly.

HOW TO BEHAVE:
- Be concise, warm, and concrete. You are a guide, not a sales pitch.
- Answer questions about what CLOVE is and what the user can do here.
- When asked about the user's agents ("how many", "what are they"), use THE USER'S AGENTS list below — give the real count/names, never a generic answer. If the list is absent, say you can't see their agents (wallet not connected).
- If the user describes a strategy, help them shape it — but DO NOT claim to have created anything. Building happens when they confirm in the chat.
- Never invent transaction hashes, balances, or APYs, and never invent agent counts. If you don't have it in context, say so.
- Keep replies short (a few sentences). Plain language, not jargon dumps.`;

export async function POST(req: NextRequest) {
  let body: { message?: unknown; walletAddress?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const message  = String(body.message ?? "").trim();
  const wallet   = String(body.walletAddress ?? "").trim();
  const threadId = String((body as { threadId?: unknown }).threadId ?? "").trim();
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

  // Prior turns for continuity within THIS thread (shared with Telegram via the
  // same wallet+thread key).
  const history = wallet && threadId ? await getThread(wallet, threadId) : [];

  // Inject the existing memory layer as context (positions, recent runs, insights).
  let memoryContext = "";
  if (wallet) {
    try {
      memoryContext = await buildMemoryPrompt(wallet);
    } catch {
      /* memory is best-effort context, never fatal */
    }
  }

  // The user's REAL agents, so "how many agents do I have" is answered from fact.
  let rosterContext = "";
  if (wallet) {
    try {
      const agents = await listAgentsForWallet(wallet);
      rosterContext = agents.length === 0
        ? "The user has no agents yet."
        : `The user has ${agents.length} agent(s):\n` +
          agents.map(a =>
            `- ${a.name} [type: ${a.agentType ?? "yield"}${a.parentAgentId ? ", team worker" : ""}] — budget ${a.budgetUsdc} USDC`,
          ).join("\n");
    } catch {
      /* non-fatal */
    }
  }

  const system =
    SYSTEM_PROMPT +
    (rosterContext ? `\n\n=== THE USER'S AGENTS ===\n${rosterContext}` : "") +
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

  // Persist both turns (fire-and-forget; only with a wallet + thread to key on).
  if (wallet && threadId) {
    const userTurn: ChatMessage      = { role: "user",      content: message, ts: new Date().toISOString(), source: "web" };
    const assistantTurn: ChatMessage = { role: "assistant", content: reply,   ts: new Date().toISOString(), source: "web" };
    void appendMessages(wallet, threadId, [userTurn, assistantTurn]);
  }

  return NextResponse.json({ reply });
}

/**
 * GET ?wallet=&list=1            → { threads: ThreadSummary[] } (history list)
 * GET ?wallet=&threadId=<id>     → { messages } (rehydrate one thread)
 */
export async function GET(req: NextRequest) {
  const wallet   = req.nextUrl.searchParams.get("wallet");
  const threadId = req.nextUrl.searchParams.get("threadId");
  const list     = req.nextUrl.searchParams.get("list");
  if (!wallet) return NextResponse.json({ messages: [], threads: [] });
  if (list)     return NextResponse.json({ threads: await listThreads(wallet) });
  if (threadId) return NextResponse.json({ messages: await getThread(wallet, threadId) });
  return NextResponse.json({ messages: [] });
}
