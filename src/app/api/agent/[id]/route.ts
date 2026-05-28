import { NextRequest, NextResponse } from "next/server";
import { getAgent, updateAgent, deleteAgent } from "@/lib/agent/agents";
import { getLatestAgentThoughts } from "@/lib/agent/thoughts";

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const thoughts = await getLatestAgentThoughts(id);
  return NextResponse.json({ agent, thoughts });
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = await request.json();
  await updateAgent(id, body);
  const agent = await getAgent(id);
  return NextResponse.json({ agent });
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await deleteAgent(id);
  return NextResponse.json({ deleted: true });
}
