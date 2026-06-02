import { NextRequest, NextResponse } from "next/server";
import { hashDelegation, decodeDelegations } from "@metamask/smart-accounts-kit/utils";
import { getAgent, setDelegation, agentOnChainAddress, type Agent } from "@/lib/agent/agents";
import { redelegatePermissionContextOnce } from "@/lib/oneshot/agentWallet";

/**
 * Sub-delegate from this agent (parent) to another agent (child).
 *
 * Uses 1Shot's `redelegateWithDelegationData` flow.  The parent's
 * `delegationContext` is redelegated to the child's unique on-chain
 * address (Bug 3 fix) with a capped budget.
 *
 * If the parent has no active delegation, we record the parent-child
 * link as "pending" WITHOUT leaking the parent's root context (Bug 1 fix).
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: parentId } = await ctx.params;
  const parent = await getAgent(parentId);
  if (!parent) return NextResponse.json({ error: "Parent agent not found" }, { status: 404 });

  let body: { childAgentId: string; capUsdc: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const child = await getAgent(body.childAgentId);
  if (!child) return NextResponse.json({ error: "Child agent not found" }, { status: 404 });
  if (child.id === parent.id) return NextResponse.json({ error: "Cannot self-delegate" }, { status: 400 });

  if (await wouldCreateCycle(parent.id, child.id)) {
    return NextResponse.json({ error: "Delegation would create a cycle" }, { status: 400 });
  }

  const parentCap = Number.parseFloat(parent.delegationCap ?? parent.budgetUsdc) || 0;
  const wantedCap = Number.parseFloat(body.capUsdc) || 0;
  if (wantedCap <= 0) return NextResponse.json({ error: "Cap must be > 0" }, { status: 400 });
  if (wantedCap > parentCap) {
    return NextResponse.json({
      error: `Cap exceeds parent's available cap (${parentCap} USDC)`,
    }, { status: 400 });
  }

  // ── Real on-chain redelegation if parent has an active delegation ──────────
  let onChain: { context: string; hash: string; via: string };
  const hasParentDelegation =
    parent.delegationContext &&
    parent.delegationContext !== "0xdemo" &&
    parent.delegationContext.length > 20 &&
    parent.delegationStatus === "active";

  if (hasParentDelegation) {
    try {
      // Bug 3 fix: use the child's unique smart account address, not the shared 1Shot address
      const childAddress = await agentOnChainAddress(child);
      const result = await redelegatePermissionContextOnce(
        parent.delegationContext!,
        childAddress,
      );

      // Bug 5 fix: compute the real EIP-712 delegation hash using the SDK utility,
      // not the fake DJB2 hash.  The redelegation JSON from 1Shot contains the
      // full Delegation struct — decode it to compute the canonical hash.
      const chain = [JSON.parse(result.parent), JSON.parse(result.redelegation)];
      const encodedContext = "0x" + Buffer.from(JSON.stringify(chain)).toString("hex");

      let delegationHash: string;
      try {
        // Decode the child delegation from 1Shot's JSON response
        const childDelegation = JSON.parse(result.redelegation) as {
          delegate: `0x${string}`;
          delegator: `0x${string}`;
          authority: `0x${string}`;
          caveats: { enforcer: `0x${string}`; terms: `0x${string}`; args: `0x${string}` }[];
          salt: `0x${string}`;
          signature: `0x${string}`;
        };
        delegationHash = hashDelegation(childDelegation as Parameters<typeof hashDelegation>[0]);
      } catch {
        // Fallback: decode from the ABI-encoded context if JSON parse approach fails
        try {
          const delegations = decodeDelegations(encodedContext as `0x${string}`);
          delegationHash = delegations.length > 0
            ? hashDelegation(delegations[delegations.length - 1])
            : "0xpending";
        } catch {
          delegationHash = "0xpending";
        }
      }

      onChain = {
        context: encodedContext,
        hash:    delegationHash,
        via:     "1shot-redelegate",
      };
    } catch (e) {
      console.warn("[agent/delegate] 1Shot redelegate failed, recording as pending:", e);
      // On failure, use "0xdemo" — NEVER pass the parent's root context to the child.
      // A "pending" child with "0xdemo" context is blocked from spending; the user
      // can re-grant permission to activate it.
      onChain = {
        context: "0xdemo",
        hash:    "0xunsigned",
        via:     "pending",
      };
    }
  } else {
    // No active parent delegation — record the parent-child link in a blocked
    // state. No fabricated hash: the child is "pending" and cannot spend until a
    // real permission flows down.
    onChain = {
      context: "0xdemo",
      hash:    "0xunsigned",
      via:     "pending",
    };
  }

  await setDelegation(child.id, {
    parentAgentId:            parent.id,
    delegationContext:        onChain.context,
    delegationHash:           onChain.hash,
    delegationManagerAddress: parent.delegationManagerAddress ?? "0x",
    delegationCap:            body.capUsdc,
  });

  const updated = await getAgent(child.id);
  return NextResponse.json({ ok: true, child: updated, via: onChain.via });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function wouldCreateCycle(parentId: string, childId: string): Promise<boolean> {
  let cur: Agent | null = await getAgent(parentId);
  const visited = new Set<string>();
  while (cur && cur.parentAgentId) {
    if (visited.has(cur.parentAgentId)) return false;
    visited.add(cur.parentAgentId);
    if (cur.parentAgentId === childId) return true;
    cur = await getAgent(cur.parentAgentId);
  }
  return false;
}
