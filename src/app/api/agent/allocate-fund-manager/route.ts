import { NextRequest, NextResponse } from "next/server";
import { listAgentsForWallet, setDelegation, type Agent } from "@/lib/agent/agents";

/**
 * FUND MANAGER ALLOCATION — the live A2A step.
 *
 * Called after the user grants ERC-7715 to the Fund Manager (session EOA).
 * The Fund Manager divides that one grant into scoped, on-chain-capped slices
 * for each spending worker:
 *
 *     user ──grant──▶ Fund Manager ──redelegate(cap, targets)──▶ each worker
 *
 * For every Base spending agent we build a real `buildRedeemableWorkerChain`
 * (user → session → worker → relayer) carrying AllowedTargets + an
 * ERC20TransferAmountEnforcer cap, and store it as the agent's delegationContext.
 * Overspend then reverts on-chain (proven via /api/proof/overspend).
 *
 * Body: { walletAddress, permissionsContext, delegationManager }
 */

const KNOWN_PROTOCOLS = ["morpho", "aave", "aerodrome", "uniswap", "lido"];

/** Resolve which protocol targets a worker may touch, from its type/config/goal. */
function resolveProtocols(agent: Agent): string[] {
  if (agent.agentType === "copy-trader" || agent.agentType === "narrative") {
    return ["uniswap", "aerodrome"]; // DEX swaps
  }
  // yield / rebalancer → explicit config, else parse the goal, else a safe default.
  const cfg = (agent.typeConfig?.protocols as string[] | undefined) ?? [];
  const fromCfg = cfg.map(p => p.toLowerCase()).filter(p => KNOWN_PROTOCOLS.includes(p));
  if (fromCfg.length > 0) return fromCfg;

  const goal = (agent.goal ?? "").toLowerCase();
  const fromGoal = KNOWN_PROTOCOLS.filter(p => goal.includes(p));
  if (fromGoal.length > 0) return fromGoal;

  return ["morpho", "aave"];
}

export async function POST(req: NextRequest) {
  let body: { walletAddress?: string; permissionsContext?: string; delegationManager?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const walletAddress = (body.walletAddress ?? "").toLowerCase();
  const rootContext   = body.permissionsContext;
  if (!walletAddress || !rootContext || rootContext.length < 40 || !rootContext.startsWith("0x")) {
    return NextResponse.json({ error: "walletAddress + real permissionsContext required" }, { status: 400 });
  }

  const { getSessionEoaAddress } = await import("@/lib/web3/serverSession");
  const sessionEoa = getSessionEoaAddress();

  // Persist the FM grant so from-answers + future runs see grantedTo === sessionEOA.
  try {
    const { getDb } = await import("@/lib/db/mongodb");
    const db = await getDb();
    if (db) {
      await db.collection("user_permissions").updateOne(
        { walletAddress },
        { $set: {
            walletAddress,
            permissionsContext: rootContext,
            delegationManager:  body.delegationManager ?? "0x",
            grantedTo:          sessionEoa,
            updatedAt:          new Date(),
          } },
        { upsert: true },
      );
    }
  } catch { /* non-fatal */ }

  // Allocate a scoped, capped chain to each Base spending worker.
  const { buildRedeemableWorkerChain } = await import("@/lib/web3/subDelegation");
  const agents = await listAgentsForWallet(walletAddress);

  const allocations: { agentId: string; name: string; capUsdc: number; protocols: string[]; ok: boolean; error?: string }[] = [];

  for (const a of agents) {
    const cap = Number(a.budgetUsdc);
    // Skip the Fund Manager itself (it HOLDS the root grant, not a scoped slice)
    // and read-only scouts (cap 0).
    if (a.typeConfig?.role === "fund-manager") continue;
    if (cap <= 0) continue;

    const protocols = resolveProtocols(a);
    try {
      const chain = await buildRedeemableWorkerChain(rootContext, a.id, protocols, cap, a.chainId ?? 8453);
      await setDelegation(a.id, {
        parentAgentId:            a.parentAgentId ?? null,
        delegationContext:        chain.context,
        delegationHash:           chain.scopedHash,
        delegationManagerAddress: body.delegationManager ?? "0x",
        delegationCap:            a.budgetUsdc,
      });
      allocations.push({ agentId: a.id, name: a.name, capUsdc: cap, protocols, ok: true });
    } catch (e) {
      allocations.push({ agentId: a.id, name: a.name, capUsdc: cap, protocols, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const allocated = allocations.filter(x => x.ok).length;
  return NextResponse.json({
    ok: true,
    fundManager: sessionEoa,
    allocated,
    total: allocations.length,
    allocations,
  });
}
