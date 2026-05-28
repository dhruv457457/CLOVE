import { NextRequest, NextResponse } from "next/server";
import { decodeDelegations } from "@metamask/smart-accounts-kit/utils";
import { getAgent, markDelegationRevoked } from "@/lib/agent/agents";
import { getSessionWalletClient } from "@/lib/web3/serverSession";
import { encodeFunctionData } from "viem";

/**
 * Revoke the delegation this agent holds.
 *
 * Bug 2 fix — the correct ABI for DelegationManager.disableDelegation takes a
 * full Delegation STRUCT (tuple), NOT a bytes32 hash.  The old code passed a
 * hash which caused an ABI selector mismatch and silent revert on every call.
 *
 * Bug 4 fix — getSessionWalletClient() is now async and returns a client backed
 * by the MetaMask smart account, not the raw EOA.
 */

// The correct ABI — verified against @metamask/smart-accounts-kit dist types.
const DISABLE_DELEGATION_ABI = [{
  name: "disableDelegation",
  type: "function" as const,
  stateMutability: "nonpayable" as const,
  inputs: [{
    name: "_delegation",
    type: "tuple",
    components: [
      { name: "delegate",  type: "address" },
      { name: "delegator", type: "address" },
      { name: "authority", type: "bytes32" },
      {
        name: "caveats",
        type: "tuple[]",
        components: [
          { name: "enforcer", type: "address" },
          { name: "terms",    type: "bytes"   },
          { name: "args",     type: "bytes"   },
        ],
      },
      { name: "salt",      type: "uint256" },
      { name: "signature", type: "bytes"   },
    ],
  }],
  outputs: [],
}] as const;

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  if (!agent.delegationContext || agent.delegationStatus !== "active") {
    return NextResponse.json({
      ok: false,
      reason: "Agent has no active delegation",
      status: agent.delegationStatus ?? "none",
    });
  }

  let txHash: string | null = null;
  let via = "state-only";

  // Only attempt on-chain revocation for real delegations (not demo/pending placeholders)
  const isReal =
    agent.delegationContext !== "0xdemo" &&
    agent.delegationContext.length > 40 &&
    agent.delegationManagerAddress &&
    agent.delegationManagerAddress !== "0x" &&
    agent.delegationManagerAddress.length >= 42;

  if (isReal) {
    try {
      // Decode the delegation struct from the stored context so we can pass the
      // full struct to disableDelegation (Bug 2 fix — not just the hash).
      //
      // Two storage formats exist:
      //   a) ABI-encoded ERC-7715 context (root agents, from MetaMask) → use decodeDelegations()
      //   b) Hex-encoded JSON chain (sub-agents, from 1Shot redelegate) → JSON.parse
      let delegationStruct: Parameters<typeof encodeFunctionData<typeof DISABLE_DELEGATION_ABI>>[0]["args"][0] | null = null;

      // Try ABI decode first (root agents)
      try {
        const decoded = decodeDelegations(agent.delegationContext as `0x${string}`);
        if (decoded.length > 0) {
          delegationStruct = decoded[decoded.length - 1] as unknown as typeof delegationStruct;
        }
      } catch { /* not ABI-encoded — try JSON path below */ }

      // Try JSON decode (sub-agents: "0x" + hex-encoded JSON)
      if (!delegationStruct) {
        try {
          const jsonBytes = Buffer.from(agent.delegationContext.slice(2), "hex").toString("utf-8");
          const chain = JSON.parse(jsonBytes) as unknown[];
          // chain = [parent_delegation, child_redelegation] — revoke the last link
          const last = chain[chain.length - 1];
          delegationStruct = last as typeof delegationStruct;
        } catch { /* cannot extract struct */ }
      }

      if (delegationStruct) {
        // Bug 4 fix: getSessionWalletClient() is now async and uses the smart account
        const walletClient = await getSessionWalletClient();
        const calldata = encodeFunctionData({
          abi: DISABLE_DELEGATION_ABI,
          functionName: "disableDelegation",
          args: [delegationStruct],
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        txHash = await (walletClient as any).sendTransaction({
          to:   agent.delegationManagerAddress as `0x${string}`,
          data: calldata,
          // account + chain are already baked into the wallet client — do not repeat them
        });
        via = "on-chain";
      } else {
        console.warn("[agent/revoke] could not decode delegation struct — state-only revoke");
      }
    } catch (e) {
      console.warn("[agent/revoke] on-chain disableDelegation failed:", e);
      via = "state-only-after-error";
    }
  }

  // Always mark revoked in DB (cascades to descendants via markDelegationRevoked)
  await markDelegationRevoked(id, txHash);

  const updated = await getAgent(id);
  return NextResponse.json({ ok: true, via, txHash, agent: updated });
}
