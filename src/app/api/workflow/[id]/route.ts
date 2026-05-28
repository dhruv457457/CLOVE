import { NextRequest, NextResponse } from "next/server";
import { getWorkflow, updateWorkflow, deleteWorkflow } from "@/lib/agent/workflows";
import { getAgent } from "@/lib/agent/agents";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const workflow = await getWorkflow(id);
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  // Hydrate the agents so the client gets everything in one request
  const agents = await Promise.all(workflow.agentIds.map(aid => getAgent(aid)));
  return NextResponse.json({ workflow, agents: agents.filter(Boolean) });
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await request.json();
  await updateWorkflow(id, body);
  const workflow = await getWorkflow(id);
  return NextResponse.json({ workflow });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteWorkflow(id);
  return NextResponse.json({ deleted: true });
}
