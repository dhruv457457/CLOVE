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
  address:             string;       // the 1Shot wallet (on-chain agent identity)
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

  return {
    address:             process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? "0x",
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
