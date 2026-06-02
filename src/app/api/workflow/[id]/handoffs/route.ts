import { NextRequest, NextResponse } from "next/server";
import { listHandoffPackets } from "@/lib/agent/handoff";

/** GET /api/workflow/{id}/handoffs?limit=10 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: workflowId } = await ctx.params;
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "10");
  const packets = await listHandoffPackets(workflowId, limit);
  return NextResponse.json({ packets });
}
