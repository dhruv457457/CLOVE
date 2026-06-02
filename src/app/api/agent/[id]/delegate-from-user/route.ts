import { NextRequest, NextResponse } from "next/server";
import { getAgent, setDelegation } from "@/lib/agent/agents";

/**
 * Bind a user's ERC-7715 permission to this agent — making it a "root" agent
 * that can spend USDC up to the user's cap. Called from the client right after
 * `requestUsdcPermission()` returns a permissionsContext.
 *
 * The hash is stored so we can later call DelegationManager.disableDelegation()
 * for on-chain revocation.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  let body: {
    permissionsContext:        string;
    delegationManagerAddress:  string;
    delegationHash:            string;
    capUsdc:                   string;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!body.permissionsContext || !body.delegationManagerAddress) {
    return NextResponse.json({ error: "Missing permissionsContext or delegationManagerAddress" }, { status: 400 });
  }

  // Preserve the existing parentAgentId — do NOT overwrite it with null.
  // When Scan's "Grant All" calls this for child agents (Risk Guard, Executor),
  // their Scout→Risk→Executor chain must stay intact so canvas edges render correctly.
  await setDelegation(id, {
    parentAgentId:            agent.parentAgentId ?? null,
    delegationContext:        body.permissionsContext,
    delegationHash:           body.delegationHash,
    delegationManagerAddress: body.delegationManagerAddress,
    delegationCap:            body.capUsdc,
  });

  const updated = await getAgent(id);
  return NextResponse.json({ ok: true, agent: updated });
}
