import "server-only";
import { getDb } from "@/lib/db/mongodb";
import { getAgent, type AgentLastAction } from "@/lib/agent/agents";

/**
 * Neutral activity stats for an agent — surfaced as the "Agent activity" card.
 *
 * Deliberately excludes any success-rate / failure-rate / score metric.
 * A new agent with 1 failed run shouldn't be punished with "0% success."
 * We show how busy the agent is and where the budget went. That's it.
 */
export interface AgentStats {
  address:             string;       // the agent's derived delegate key (signs delegations; holds no funds)
  lastTxHash:          string | null; // most recent on-chain execution tx (the real activity)
  totalRuns:           number;       // total cycles (plan + execute combined)
  totalExecuted:       number;       // count of runs that produced an on-chain tx
  totalX402SpentUsdc:  number;
  budgetUsdc:          string;
  budgetUsedUsdc:      number;
  budgetUtilization:   number;       // percent — usage, not success
  lastRunAt:           Date | null;
  lastAction:          AgentLastAction;
  breakdown: {
    x402: {
      intel: number;
      tts:   number;
      image: number;
    };
    gas:  number;
    defi: number;
  };
}

/** Compute live stats for an agent by aggregating the agents collection + thoughts. */
export async function getAgentStats(agentId: string): Promise<AgentStats | null> {
  const agent = await getAgent(agentId);
  if (!agent) return null;

  const db = await getDb();

  // x402 breakdown — sum costPaid by service type from media thoughts + run costs
  let intelCost = 0;
  let ttsCost   = 0;
  let imageCost = 0;
  if (db) {
    // Pull every media + tool-result thought for this agent (cheap query)
    const thoughts = await db
      .collection("agent_thoughts")
      .find({
        agentId,
        type: { $in: ["media", "tool-result"] },
      })
      .toArray();
    for (const t of thoughts) {
      const c = (t.content ?? {}) as { service?: string; cost?: number; tool?: string; costPaid?: number };
      if (c.service === "tts"   && typeof c.cost === "number") ttsCost   += c.cost;
      if (c.service === "image" && typeof c.cost === "number") imageCost += c.cost;
      if (c.tool    === "checkYields" && typeof c.costPaid === "number") intelCost += c.costPaid;
    }
  }

  const budgetN = Number.parseFloat(agent.budgetUsdc || "0") || 0;
  const utilization = budgetN > 0 ? Math.min(100, (agent.budgetUsedUsdc / budgetN) * 100) : 0;

  // Each agent's OWN derived delegate identity (deterministic from root key +
  // agentId). NOTE: this address signs the scoped delegation but holds no funds
  // and sends no txs — funds move from the user's wallet → relayer → protocol
  // (non-custodial). The REAL on-chain activity is the execution txHash below.
  let agentAddress = process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? "0x";
  try {
    const { getAgentEoaAddress } = await import("@/lib/web3/serverSession");
    agentAddress = getAgentEoaAddress(agentId);
  } catch { /* fall back to session address */ }

  // Latest real on-chain execution tx for this agent (from its tool-result thoughts).
  let lastTxHash: string | null = null;
  if (db) {
    const txThought = await db.collection("agent_thoughts")
      .find({ agentId, "content.txHash": { $exists: true, $ne: null } })
      .sort({ _id: -1 }).limit(1).toArray();
    const h = txThought[0]?.content?.txHash;
    if (typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h)) lastTxHash = h;
  }

  return {
    address:             agentAddress,
    lastTxHash,
    totalRuns:           agent.totalRuns,
    totalExecuted:       agent.totalExecuted,
    totalX402SpentUsdc:  agent.x402SpentUsdc,
    budgetUsdc:          agent.budgetUsdc,
    budgetUsedUsdc:      agent.budgetUsedUsdc,
    budgetUtilization:   utilization,
    lastRunAt:           agent.lastRunAt,
    lastAction:          agent.lastAction,
    breakdown: {
      x402: {
        intel: Math.max(intelCost, agent.x402SpentUsdc - ttsCost - imageCost),
        tts:   ttsCost,
        image: imageCost,
      },
      gas:  0,    // 1Shot sponsors gas
      defi: agent.budgetUsedUsdc,
    },
  };
}
