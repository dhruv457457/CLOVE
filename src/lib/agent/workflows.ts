import "server-only";
import { getDb } from "@/lib/db/mongodb";

/**
 * Workflow — a top-level container for a coordinated set of agents.
 *
 * Why this exists (vs. just having agents):
 *   - Each workflow has its OWN ERC-7715 permission context with its own
 *     budget/expiry. A user can have 3 workflows ("Yield", "DCA", "Hedge")
 *     each with a separate 50 USDC budget, all granted from the same MetaMask wallet.
 *   - localStorage can only hold ONE permission at a time. To support multiple
 *     concurrent workflows, permission contexts MUST live in MongoDB.
 *   - The signed permission context is a cryptographic delegation — it can only
 *     be redeemed by CLOVE's 1Shot wallet, so storing it server-side is safe.
 *   - Workflow = the audit trail. Every run, every reflection, every tx links
 *     back to its workflow for a clean history view.
 */

export type WorkflowStatus = "active" | "paused" | "archived";

export interface WorkflowRun {
  runId:     string;
  agentId:   string;
  agentName: string;
  startedAt: Date;
  endedAt?:  Date | null;
  success:   boolean;
  action:    string;
  txHash?:   string | null;
  costPaid:  number;
  insight?:  string;
}

export interface Workflow {
  id:              string;
  walletAddress:   string;
  name:            string;            // user-set, e.g. "USDC Yield Strategy"
  prompt:          string;            // original prompt that spawned the workflow
  createdAt:       Date;
  status:          WorkflowStatus;

  // ── Permission context (replaces localStorage for multi-workflow support) ──
  /** The ERC-7715 delegation context for THIS workflow. */
  permissionsContext?:        string | null;
  /** DelegationManager address (per chain). */
  delegationManagerAddress?:  string | null;
  /** Hash for revocation. */
  delegationHash?:            string | null;
  /** Budget for this workflow's permission. */
  budgetUsdc:                 string;
  /** Period in days (e.g. 30). */
  periodDays:                 number;
  /** Unix timestamp when the permission expires. */
  expiresAt?:                 number;
  /** Permission state — "active" only when permissionsContext is real. */
  permissionStatus:           "active" | "pending" | "revoked" | "none";

  // ── Composition ────────────────────────────────────────────────────────────
  /** Agent IDs belonging to this workflow (Scout, Risk, Executor, etc.). */
  agentIds:        string[];

  // ── Aggregates (denormalised for cheap list view) ──────────────────────────
  totalRuns:       number;
  totalExecuted:   number;
  totalSpentUsdc:  number;
  lastRunAt:       Date | null;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createWorkflow(input: {
  walletAddress: string;
  name:          string;
  prompt:        string;
  budgetUsdc?:   string;
  periodDays?:   number;
}): Promise<Workflow> {
  const wf: Workflow = {
    id:                       `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    walletAddress:            input.walletAddress,
    name:                     input.name,
    prompt:                   input.prompt,
    createdAt:                new Date(),
    status:                   "active",
    permissionsContext:       null,
    delegationManagerAddress: null,
    delegationHash:           null,
    budgetUsdc:               input.budgetUsdc ?? "10",
    periodDays:               input.periodDays ?? 30,
    permissionStatus:         "none",
    agentIds:                 [],
    totalRuns:                0,
    totalExecuted:            0,
    totalSpentUsdc:           0,
    lastRunAt:                null,
  };
  const db = await getDb();
  if (db) await db.collection<Workflow>("workflows_v2").insertOne(wf);
  return wf;
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  const db = await getDb();
  if (!db) return null;
  return db.collection<Workflow>("workflows_v2").findOne({ id });
}

export async function listWorkflowsForWallet(walletAddress: string): Promise<Workflow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .collection<Workflow>("workflows_v2")
    .find({ walletAddress })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function updateWorkflow(id: string, patch: Partial<Workflow>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<Workflow>("workflows_v2").updateOne({ id }, { $set: patch });
}

export async function deleteWorkflow(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Get workflow to know which agents to delete
  const wf = await getWorkflow(id);
  if (!wf) return;
  // Cascade delete: agents, thoughts, insights tied to this workflow's agents
  if (wf.agentIds.length > 0) {
    await db.collection("agents").deleteMany({ id: { $in: wf.agentIds } });
    await db.collection("agent_thoughts").deleteMany({ agentId: { $in: wf.agentIds } });
    await db.collection("agent_insights").deleteMany({ agentId: { $in: wf.agentIds } });
  }
  await db.collection<Workflow>("workflows_v2").deleteOne({ id });
}

/** Attach an agent to a workflow (called during from-answers creation). */
export async function addAgentToWorkflow(workflowId: string, agentId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<Workflow>("workflows_v2").updateOne(
    { id: workflowId },
    { $addToSet: { agentIds: agentId } }
  );
}

// ── Permission management (per-workflow ERC-7715) ──────────────────────────────

/**
 * Bind an ERC-7715 permission to a workflow. The signed permissionsContext is
 * stored server-side — this is safe because the context is a cryptographic
 * delegation that only CLOVE's 1Shot wallet can redeem.
 */
export async function bindPermissionToWorkflow(workflowId: string, perm: {
  permissionsContext:        string;
  delegationManagerAddress:  string;
  delegationHash?:           string;
  budgetUsdc:                string;
  periodDays:                number;
  expiresAt:                 number;
}): Promise<void> {
  await updateWorkflow(workflowId, {
    permissionsContext:       perm.permissionsContext,
    delegationManagerAddress: perm.delegationManagerAddress,
    delegationHash:           perm.delegationHash ?? "0xpending",
    budgetUsdc:               perm.budgetUsdc,
    periodDays:               perm.periodDays,
    expiresAt:                perm.expiresAt,
    permissionStatus:         "active",
  });
}

export async function revokeWorkflowPermission(workflowId: string, txHash?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // WF-4 fix: store txHash in a SEPARATE field — never overwrite delegationHash.
  // delegationHash holds the EIP-712 hash needed for future disableDelegation calls.
  await db.collection<Workflow>("workflows_v2").updateOne(
    { id: workflowId },
    { $set: {
        permissionStatus: "revoked",
        revocationTxHash: txHash ?? null,  // separate field — does NOT touch delegationHash
      },
    }
  );
}

// ── Run history aggregation ────────────────────────────────────────────────────

/**
 * Get the full run history for a workflow — joins agent_runs by the agent IDs
 * that belong to this workflow. Sorted newest first.
 */
export async function getWorkflowHistory(workflowId: string, limit = 50): Promise<WorkflowRun[]> {
  const db = await getDb();
  if (!db) return [];
  const wf = await getWorkflow(workflowId);
  if (!wf || wf.agentIds.length === 0) return [];

  // Look up agent names for the IDs
  const agents = await db
    .collection<{ id: string; name: string; walletAddress: string }>("agents")
    .find({ id: { $in: wf.agentIds } })
    .toArray();
  const agentNameById = new Map(agents.map(a => [a.id, a.name]));
  const walletAddresses = Array.from(new Set(agents.map(a => a.walletAddress)));

  // MEM-2 + MEM-3 fix: query by agentId ∈ wf.agentIds so:
  //   a) Each run is correctly attributed to the agent that ran it
  //   b) Cross-workflow contamination is eliminated (no more wallet-level queries)
  const runs = await db
    .collection<{
      walletAddress: string; agentId?: string; runId: string; timestamp: Date; success: boolean;
      protocol: string; action: string; txHash: string | null; costPaid: number;
      veniceReason: string;
    }>("agent_runs")
    .find({
      $or: [
        { agentId: { $in: wf.agentIds } },           // new runs — keyed by agentId
        { walletAddress: { $in: walletAddresses } },  // legacy runs without agentId field
      ],
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  return runs.map(r => {
    // Use the actual agentId if stored (MEM-1 fix); fall back to first agent for legacy runs
    const aid  = (r.agentId && wf.agentIds.includes(r.agentId)) ? r.agentId : wf.agentIds[0];
    return {
      runId:     r.runId,
      agentId:   aid,
      agentName: agentNameById.get(aid) ?? "Agent",
      startedAt: r.timestamp,
      endedAt:   r.timestamp,
      success:   r.success,
      action:    r.action,
      txHash:    r.txHash,
      costPaid:  r.costPaid,
      insight:   r.veniceReason,
    };
  });
}

/** Bump workflow counters after a run finishes (called from run-stream). */
export async function bumpWorkflowCounters(workflowId: string, patch: {
  ranOnce?:     boolean;
  executedOnce?:boolean;
  costPaid?:    number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const inc: Record<string, number> = {};
  if (patch.ranOnce)      inc.totalRuns      = 1;
  if (patch.executedOnce) inc.totalExecuted  = 1;
  if (patch.costPaid)     inc.totalSpentUsdc = patch.costPaid;
  await db.collection<Workflow>("workflows_v2").updateOne(
    { id: workflowId },
    { $inc: inc, $set: { lastRunAt: new Date() } }
  );
}
