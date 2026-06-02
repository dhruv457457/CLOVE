import "server-only";
import { getDb } from "@/lib/db/mongodb";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentStatus =
  | "idle"          // ready to run
  | "planning"     // Venice is generating a plan
  | "executing"    // running tools
  | "reflecting"   // saving insights
  | "paused"       // human-paused or self-paused (budget/risk guard)
  | "blocked"      // awaiting human approval
  | "failed";      // last run errored, manual intervention needed
export type AgentLastAction = "hold" | "deposit" | "rebalance" | "withdraw" | "skip" | null;
export type MediaPolicy = "off" | "milestones" | "daily" | "every-run";

/**
 * The kind of agent — determines its tool set, system prompt, and target chain.
 * Driven by the registry in src/lib/agent/agentTypes.ts (no hardcoded if-branches).
 *   - "yield"       : generic DeFi yield agent (the original behavior)
 *   - "polymarket"  : prediction-market bettor (runs on Polygon)
 *   - "copy-trader" : mirrors on-chain whale trades (Base)
 *   - "narrative"   : narrative-momentum trader, scans X for trending tokens
 *   - "rebalancer"  : real yield rebalancer hitting DeFiLlama / Morpho / Aave directly
 */
export type AgentType =
  | "yield"
  | "polymarket"
  | "copy-trader"
  | "narrative"
  | "rebalancer";

export interface Agent {
  id:                string;
  walletAddress:     string;     // the human owner's wallet
  name:              string;
  goal:              string;
  status:            AgentStatus;

  /** What kind of agent this is — drives tools, prompt, and chain. Default "yield". */
  agentType?:        AgentType;
  /** EVM chain this agent operates on. 8453 = Base (default), 137 = Polygon (Polymarket). */
  chainId?:          number;
  /** Agent-type-specific config (tracked wallets, edge threshold, topic, etc.). */
  typeConfig?:       Record<string, unknown>;
  createdAt:         Date;
  lastRunAt:         Date | null;
  lastAction:        AgentLastAction;

  // Neutral activity counters — NO success-rate ratio
  totalRuns:         number;
  totalExecuted:     number;     // count of runs that produced an on-chain tx
  x402SpentUsdc:     number;
  budgetUsdc:        string;
  budgetUsedUsdc:    number;

  // Media generation policy
  mediaPolicy:       MediaPolicy;

  // ─── Schedule ────────────────────────────────────────────────────────────
  /** If set, the cron job runs this agent every N milliseconds.
   *  Common values: 3600000 (1h), 21600000 (6h), 86400000 (24h). */
  scheduleIntervalMs?: number;

  // ─── ERC-8004 on-chain agent identity (via QuickNode) ───────────────────
  /** Set after successful ERC-8004 registration; identifies this agent on-chain. */
  registryId?:          string | null;
  /** Tx hash of the registration transaction. */
  registryTxHash?:      string | null;

  // ─── State machine — for crash recovery + pause/resume ───────────────────
  /** Current runId if status !== "idle". Lets cron detect stalled runs. */
  currentRunId?:        string | null;
  /** When the current phase started. Cron treats >5min in non-idle as stalled. */
  phaseStartedAt?:      Date | null;
  /** Subgoal index inside the current run, for resume-from-failure. */
  currentSubgoalIdx?:   number;
  /** Why the agent is paused/blocked — surfaced in the UI. */
  pauseReason?:         string | null;
  /** Retry count for the current operation. Resets on phase transition. */
  retryCount?:          number;
  /** Last error message (if status === "failed"). */
  lastError?:           string | null;

  // Optional: canvas position on the top-level multi-agent graph
  position?:         { x: number; y: number };

  /** The workflow this agent belongs to. Set when created via questionnaire.
   *  Null/undefined for legacy agents created before workflows existed. */
  workflowId?:       string | null;

  // ─── Delegation chain ────────────────────────────────────────────────────
  /** If null, this agent gets its budget directly from the user (root). Otherwise,
   *  this agent was sub-delegated to by another agent. */
  parentAgentId?:    string | null;
  /** Children IDs — populated for convenience, derived from agents with parentAgentId === this.id */
  // (no field; computed via listChildAgents)

  /**
   * Bug 3 fix — unique on-chain address for this agent.
   * Derived at creation time via getAgentSmartAccountAddress(agent.id).
   * Each agent gets a distinct counterfactual smart account so sub-delegation
   * scopes are independent (no shared 1Shot wallet between agents).
   */
  onChainAddress?:           string;

  /** The ERC-7710 / ERC-7715 delegation context this agent holds — hex-encoded chain.
   *  For root agents this is the user's permissionsContext from MetaMask;
   *  for sub-agents it's the redelegation context from the parent. */
  delegationContext?:        string;
  /** Hash of this delegation (used for on-chain revocation via DelegationManager.disableDelegation) */
  delegationHash?:           string;
  /** The DelegationManager address — needed to call disableDelegation */
  delegationManagerAddress?: string;
  /** Max USDC this agent can spend (the cap baked into the delegation) */
  delegationCap?:            string;
  /** "active" once delegation is granted; "revoked" after disableDelegation lands on-chain */
  delegationStatus?:         "active" | "revoked" | "pending" | "none";
  /** ISO date when revoked */
  revokedAt?:                Date | null;
  /** Tx hash of the revocation */
  revokedTxHash?:            string | null;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createAgent(input: {
  walletAddress:       string;
  name:                string;
  goal:                string;
  budgetUsdc?:         string;
  mediaPolicy?:        MediaPolicy;
  scheduleIntervalMs?: number;
  position?:           { x: number; y: number };
  workflowId?:         string | null;
  agentType?:          AgentType;
  chainId?:            number;
  typeConfig?:         Record<string, unknown>;
}): Promise<Agent> {
  const id = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // Derive a unique counterfactual smart account address for this agent (Bug 3 fix).
  // Falls back gracefully if serverSession is unavailable (e.g. missing env vars).
  let onChainAddress: string | undefined;
  try {
    const { getAgentSmartAccountAddress } = await import("@/lib/web3/serverSession");
    onChainAddress = await getAgentSmartAccountAddress(id);
  } catch {
    onChainAddress = process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? undefined;
  }

  const agent: Agent = {
    id,
    walletAddress:  input.walletAddress,
    name:           input.name,
    goal:           input.goal,
    status:         "idle",
    createdAt:      new Date(),
    lastRunAt:      null,
    lastAction:     null,
    totalRuns:      0,
    totalExecuted:  0,
    x402SpentUsdc:  0,
    budgetUsdc:     input.budgetUsdc  ?? "10",
    budgetUsedUsdc: 0,
    mediaPolicy:    input.mediaPolicy ?? "milestones",
    scheduleIntervalMs: input.scheduleIntervalMs,
    position:       input.position    ?? { x: 80 + Math.random() * 200, y: 80 + Math.random() * 200 },
    workflowId:     input.workflowId ?? null,
    onChainAddress,
    agentType:      input.agentType ?? "yield",
    chainId:        input.chainId   ?? 8453,
    typeConfig:     input.typeConfig ?? {},
  };
  const db = await getDb();
  if (db) await db.collection<Agent>("agents").insertOne(agent);
  return agent;
}

export async function getAgent(id: string): Promise<Agent | null> {
  const db = await getDb();
  if (!db) return null;
  return db.collection<Agent>("agents").findOne({ id });
}

export async function listAgentsForWallet(walletAddress: string): Promise<Agent[]> {
  const db = await getDb();
  if (!db) return [];
  return db.collection<Agent>("agents").find({ walletAddress }).sort({ createdAt: -1 }).toArray();
}

export async function updateAgent(id: string, patch: Partial<Agent>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<Agent>("agents").updateOne({ id }, { $set: patch });
}

// ── State machine transitions ──────────────────────────────────────────────

/** Atomic state transition with phase timestamp + retry reset. */
export async function transitionAgent(id: string, patch: {
  status?:           AgentStatus;
  currentRunId?:     string | null;
  currentSubgoalIdx?: number;
  pauseReason?:      string | null;
  retryCount?:       number;
  lastError?:        string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const set: Record<string, unknown> = { phaseStartedAt: new Date() };
  if (patch.status            !== undefined) set.status            = patch.status;
  if (patch.currentRunId      !== undefined) set.currentRunId      = patch.currentRunId;
  if (patch.currentSubgoalIdx !== undefined) set.currentSubgoalIdx = patch.currentSubgoalIdx;
  if (patch.pauseReason       !== undefined) set.pauseReason       = patch.pauseReason;
  if (patch.retryCount        !== undefined) set.retryCount        = patch.retryCount;
  if (patch.lastError         !== undefined) set.lastError         = patch.lastError;
  await db.collection<Agent>("agents").updateOne({ id }, { $set: set });
}

/** Detect stalled agents — running for >5 minutes since last phase change.
 *  Used by cron to recover from crashes. */
export async function findStalledAgents(thresholdMs = 5 * 60 * 1000): Promise<Agent[]> {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() - thresholdMs);
  return db.collection<Agent>("agents").find({
    status: { $in: ["planning", "executing", "reflecting"] },
    phaseStartedAt: { $lt: cutoff },
  }).toArray();
}

// ── Budget guard — block over-spend before the tx is built ────────────────

export interface BudgetGuardResult {
  allowed:  boolean;
  reason?:  string;
  budget:   number;
  used:     number;
  remaining: number;
  requested: number;
}

/** Check if `amountUsdc` would exceed the agent's budget. Block at 95% by
 *  default to leave headroom for gas-equivalent slippage / fees. */
export function checkBudgetGuard(agent: Agent, amountUsdc: number, threshold = 0.95): BudgetGuardResult {
  const budget    = Number.parseFloat(agent.budgetUsdc) || 0;
  const used      = agent.budgetUsedUsdc ?? 0;
  const remaining = Math.max(0, budget - used);
  const wouldUse  = used + amountUsdc;
  const allowed   = wouldUse <= budget * threshold;
  return {
    allowed,
    reason:    allowed ? undefined : `Would use ${wouldUse.toFixed(2)} of ${budget.toFixed(2)} USDC budget (>${threshold * 100}% cap)`,
    budget,
    used,
    remaining,
    requested: amountUsdc,
  };
}

export async function bumpAgentCounters(id: string, patch: {
  ranOnce?:     boolean;
  executedOnce?:boolean;
  x402Spent?:   number;
  budgetUsed?:  number;
  lastAction?:  AgentLastAction;
  status?:      AgentStatus;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const inc: Record<string, number> = {};
  if (patch.ranOnce)      inc.totalRuns      = 1;
  if (patch.executedOnce) inc.totalExecuted  = 1;
  if (patch.x402Spent)    inc.x402SpentUsdc  = patch.x402Spent;
  if (patch.budgetUsed)   inc.budgetUsedUsdc = patch.budgetUsed;
  const set: Record<string, unknown> = { lastRunAt: new Date() };
  if (patch.lastAction !== undefined) set.lastAction = patch.lastAction;
  if (patch.status      !== undefined) set.status     = patch.status;
  await db.collection<Agent>("agents").updateOne(
    { id },
    { $inc: inc, $set: set }
  );
}

export async function deleteAgent(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<Agent>("agents").deleteOne({ id });
  // Cascade — drop the agent's thoughts and insights
  await db.collection("agent_thoughts").deleteMany({ agentId: id });
  await db.collection("agent_insights").deleteMany({ agentId: id });
  // Orphan children — promote them to root, mark their delegation revoked
  await db.collection<Agent>("agents").updateMany(
    { parentAgentId: id },
    { $set: { parentAgentId: null, delegationStatus: "revoked", revokedAt: new Date() } }
  );
}

// ── Delegation chain helpers ───────────────────────────────────────────────────

/** Return all agents whose `parentAgentId === id`. */
export async function listChildAgents(id: string): Promise<Agent[]> {
  const db = await getDb();
  if (!db) return [];
  return db.collection<Agent>("agents").find({ parentAgentId: id }).toArray();
}

/** Mark an agent as receiving a (sub-)delegation.
 *
 * delegationStatus is set to:
 *   "active"  — only when the context is a real ERC-7715 hex blob (not demo)
 *   "pending" — when context is a demo placeholder; user still needs to grant
 *               a real MetaMask permission before the agent can execute on-chain
 */
export async function setDelegation(
  id: string,
  params: {
    parentAgentId?:           string | null;
    delegationContext:        string;
    delegationHash:           string;
    delegationManagerAddress: string;
    delegationCap:            string;
  },
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // A context is "real" if the permissionsContext is a genuine ERC-7715 hex blob.
  // The hash may be "0xpending" (we don't have the EIP-712 hash yet) — that's fine,
  // it only affects revocation lookup, not whether the agent can execute.
  const isRealContext =
    params.delegationContext.startsWith("0x") &&
    !params.delegationContext.includes("demo") &&
    params.delegationContext.length > 40;

  const delegationStatus: Agent["delegationStatus"] = isRealContext ? "active" : "pending";

  await db.collection<Agent>("agents").updateOne(
    { id },
    {
      $set: {
        parentAgentId:            params.parentAgentId ?? null,
        delegationContext:        params.delegationContext,
        delegationHash:           params.delegationHash,
        delegationManagerAddress: params.delegationManagerAddress,
        delegationCap:            params.delegationCap,
        delegationStatus,
        revokedAt:                null,
        revokedTxHash:            null,
      },
    }
  );
}

/** Mark an agent's delegation as revoked (after on-chain tx confirmed). */
export async function markDelegationRevoked(id: string, txHash: string | null): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<Agent>("agents").updateOne(
    { id },
    {
      $set: {
        delegationStatus: "revoked",
        revokedAt:        new Date(),
        revokedTxHash:    txHash,
      },
    }
  );
  // Cascade — any agent whose parent is this agent is now orphaned
  const children = await listChildAgents(id);
  for (const child of children) {
    await markDelegationRevoked(child.id, null);
  }
}

/**
 * Returns the unique on-chain address for an agent.
 * Uses the stored `onChainAddress` field (set at creation time) for speed.
 * Falls back to computing it on demand for legacy agents that predate this field.
 */
export async function agentOnChainAddress(agent: Agent): Promise<`0x${string}`> {
  if (agent.onChainAddress && agent.onChainAddress !== "0x") {
    return agent.onChainAddress as `0x${string}`;
  }
  try {
    const { getAgentSmartAccountAddress } = await import("@/lib/web3/serverSession");
    return await getAgentSmartAccountAddress(agent.id);
  } catch {
    return (process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? "0x") as `0x${string}`;
  }
}
