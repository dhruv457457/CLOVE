import { NextRequest, NextResponse } from "next/server";
import { bindPermissionToWorkflow, getWorkflow } from "@/lib/agent/workflows";
import { updateAgent } from "@/lib/agent/agents";

/**
 * POST — bind an ERC-7715 permission to a workflow.
 *
 * Body: { permissionsContext, delegationManagerAddress, delegationHash?,
 *         budgetUsdc, periodDays, expiresAt }
 *
 * Effect:
 *   1. Stores the signed delegation context on the workflow (MongoDB)
 *   2. Propagates the permission to ALL agents under this workflow
 *      so each can redeem during execution
 *
 * Safety: the permissionsContext is a cryptographic delegation that can only
 * be redeemed by the delegate (CLOVE's 1Shot wallet). Storing it server-side
 * is safe — no one else can use it.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: {
    permissionsContext:        string;
    delegationManagerAddress:  string;
    delegationHash?:           string;
    budgetUsdc:                string;
    periodDays:                number;
    expiresAt:                 number;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!body.permissionsContext || !body.delegationManagerAddress) {
    return NextResponse.json({ error: "permissionsContext + delegationManagerAddress required" }, { status: 400 });
  }

  // 1. Bind to workflow
  await bindPermissionToWorkflow(id, body);

  // 2. Propagate to all agents under this workflow
  const wf = await getWorkflow(id);
  if (wf) {
    for (const agentId of wf.agentIds) {
      await updateAgent(agentId, {
        delegationContext:        body.permissionsContext,
        delegationManagerAddress: body.delegationManagerAddress,
        delegationHash:           body.delegationHash ?? "0xpending",
        delegationCap:            body.budgetUsdc,
        delegationStatus:         "active",
      });
    }
  }

  const updated = await getWorkflow(id);
  return NextResponse.json({ workflow: updated, agentsUpdated: wf?.agentIds.length ?? 0 });
}
