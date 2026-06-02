import { NextRequest, NextResponse } from "next/server";
import { getAgent, updateAgent, deleteAgent } from "@/lib/agent/agents";
import { getLatestAgentThoughts } from "@/lib/agent/thoughts";
import type { Agent } from "@/lib/agent/agents";

// SEC-1: Fields a wallet owner is allowed to PATCH on their own agent.
// Excludes walletAddress (ownership), delegationContext/Status (security),
// budgetUsedUsdc (accounting), and any internal counter fields.
const ALLOWED_PATCH_FIELDS: ReadonlySet<keyof Agent> = new Set([
  "name", "goal", "status", "budgetUsdc", "mediaPolicy",
  "scheduleIntervalMs", "position", "pauseReason",
  "delegationCap", "workflowId",
]);

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

  // SEC-1: load agent first so we can verify ownership
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  // SEC-1: ownership check — walletAddress in body must match DB record
  const callerWallet = (body.walletAddress as string | undefined)?.toLowerCase();
  if (callerWallet && callerWallet !== agent.walletAddress.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // SEC-1: field whitelist — strip any field not in ALLOWED_PATCH_FIELDS
  const safe: Partial<Agent> = {};
  for (const key of Object.keys(body) as Array<keyof Agent>) {
    if (ALLOWED_PATCH_FIELDS.has(key)) {
      (safe as Record<string, unknown>)[key] = body[key as string];
    }
  }

  if (Object.keys(safe).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  await updateAgent(id, safe);
  const updated = await getAgent(id);
  return NextResponse.json({ agent: updated });
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  // SEC-1: ownership check via query param
  const wallet = request.nextUrl.searchParams.get("wallet");
  const agent  = await getAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  if (!wallet || wallet.toLowerCase() !== agent.walletAddress.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await deleteAgent(id);
  return NextResponse.json({ deleted: true });
}
