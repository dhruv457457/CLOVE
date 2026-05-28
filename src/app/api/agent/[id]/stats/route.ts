import { NextRequest, NextResponse } from "next/server";
import { getAgentStats } from "@/lib/agent/stats";

/**
 * Activity stats for one agent — surfaced as the "Agent activity" card.
 *
 * The response deliberately does NOT include `successRate` or any
 * percentage-based score. New agents shouldn't be punished for thin samples.
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const stats = await getAgentStats(id);
  if (!stats) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json(stats);
}
