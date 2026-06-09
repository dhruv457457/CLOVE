import { NextRequest, NextResponse } from "next/server";
import { getAgent } from "@/lib/agent/agents";
import { saveKnowledge, listKnowledge, clearKnowledge } from "@/lib/agent/knowledge";

/**
 * Per-agent knowledge base (RAG).
 *   POST   { text }  → chunk + embed + store, returns { chunks }
 *   GET              → list stored chunks
 *   DELETE           → clear all knowledge for this agent
 */

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  let body: { text?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const chunks = await saveKnowledge(id, agent.walletAddress, text);
  return NextResponse.json({ ok: true, chunks });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const items = await listKnowledge(id);
  return NextResponse.json({ items });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await clearKnowledge(id);
  return NextResponse.json({ ok: true });
}
