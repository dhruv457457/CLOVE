import { NextRequest, NextResponse } from "next/server";
import { getWorkflowHistory } from "@/lib/agent/workflows";

/** GET — full run history for a workflow (across all its agents). */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const runs = await getWorkflowHistory(id, 50);
  return NextResponse.json({ runs });
}
