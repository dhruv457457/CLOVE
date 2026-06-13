import { NextRequest, NextResponse } from "next/server";
import { getAgent } from "@/lib/agent/agents";
import { decodeDelegations } from "@metamask/smart-accounts-kit/utils";

/**
 * #5 — make the agent visibly on-chain.
 *
 * Decodes the agent's stored `delegationContext` (the ERC-7710 chain it redeems
 * through) into its real hops: user → session → THIS AGENT (capped) → relayer.
 * The frontend renders this so the agent's on-chain role is visible, with the
 * scoped hash linkable to Basescan.
 */

// 1Shot public relayer target on Base — the final delegate that redeems + sponsors gas.
const BASE_RELAYER_TARGET = "0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a";

interface Hop { delegator: string; delegate: string }

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const context = agent.delegationContext;
  const hasContext =
    typeof context === "string" &&
    context.startsWith("0x") &&
    context.length > 20 &&
    !/^0x0*$/.test(context);

  if (!hasContext) {
    return NextResponse.json({
      hasChain: false,
      reason: "This agent has no on-chain delegation yet (grant a permission to activate it).",
    });
  }

  let hops: Hop[] = [];
  try {
    // decodeDelegations returns the chain leaf → root; reverse to read root → leaf
    // (user/session first, relayer last) — the natural left-to-right flow.
    const decoded = decodeDelegations(context as `0x${string}`);
    hops = decoded
      .map(d => ({
        delegator: String((d as { delegator?: string }).delegator ?? ""),
        delegate:  String((d as { delegate?: string }).delegate ?? ""),
      }))
      .reverse();
  } catch (e) {
    return NextResponse.json({
      hasChain: false,
      reason: "Could not decode this agent's delegation context.",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const relayerTarget = (agent.chainId === 8453 || !agent.chainId) ? BASE_RELAYER_TARGET : null;

  return NextResponse.json({
    hasChain:          hops.length > 0,
    hops,                                   // [{ delegator, delegate }] root → leaf
    cap:               agent.delegationCap ?? agent.budgetUsdc,
    scopedHash:        agent.delegationHash ?? null,
    delegationManager: agent.delegationManagerAddress ?? null,
    relayerTarget,
    // The Fund Manager holds the grant and splits the budget — it never trades.
    isCustodian:       /fund manager/i.test(agent.name),
  });
}
