import "server-only";
import { getDb } from "./mongodb";

/**
 * One-time index creation for CLOVE's MongoDB collections.
 * Called lazily on first request. MongoDB createIndex is idempotent.
 */

let _initialized = false;

export async function ensureIndexes(): Promise<void> {
  if (_initialized) return;
  const db = await getDb();
  if (!db) return;
  _initialized = true;

  try {
    await Promise.all([
      // agents
      db.collection("agents").createIndex({ id: 1 }, { unique: true }),
      db.collection("agents").createIndex({ walletAddress: 1, createdAt: -1 }),
      db.collection("agents").createIndex({ scheduleIntervalMs: 1, status: 1, lastRunAt: 1 }),
      db.collection("agents").createIndex({ parentAgentId: 1 }),
      db.collection("agents").createIndex({ workflowId: 1 }),

      // agent_thoughts
      db.collection("agent_thoughts").createIndex({ id: 1 }, { unique: true }),
      db.collection("agent_thoughts").createIndex({ agentId: 1, createdAt: -1 }),
      db.collection("agent_thoughts").createIndex({ runId: 1, createdAt: 1 }),

      // agent_insights
      db.collection("agent_insights").createIndex({ agentId: 1, createdAt: -1 }),
      db.collection("agent_insights").createIndex({ rootAgentId: 1, scope: 1, createdAt: -1 }),
      db.collection("agent_insights").createIndex({ walletAddress: 1, scope: 1, createdAt: -1 }),

      // agent_runs
      // DB-2 fix: add agentId index for per-agent memory queries (MEM-1)
      db.collection("agent_runs").createIndex({ agentId: 1, timestamp: -1 }),
      db.collection("agent_runs").createIndex({ walletAddress: 1, timestamp: -1 }),
      db.collection("agent_runs").createIndex({ runId: 1 }, { unique: true }),

      // agent_positions
      // DB-1 fix: compound key { walletAddress, protocol } — PROTO-3 changed upsert
      // to key by both fields. Drop the old single-field unique index if it exists,
      // then create the correct compound unique index.
      db.collection("agent_positions").createIndex(
        { walletAddress: 1, protocol: 1 },
        { unique: true }
      ),

      // apy_snapshots
      db.collection("apy_snapshots").createIndex({ timestamp: -1 }),

      // workflows_v2
      db.collection("workflows_v2").createIndex({ id: 1 }, { unique: true }),
      db.collection("workflows_v2").createIndex({ walletAddress: 1, createdAt: -1 }),

      // user_permissions
      db.collection("user_permissions").createIndex({ walletAddress: 1 }, { unique: true }),

      // agent_handoffs — A2A coordination audit trail
      db.collection("agent_handoffs").createIndex({ id: 1 }, { unique: true }),
      db.collection("agent_handoffs").createIndex({ workflowId: 1, createdAt: -1 }),
      db.collection("agent_handoffs").createIndex({ runId: 1 }),
    ]);

    // DB-1 fix: drop the stale single-field unique index on agent_positions if it exists.
    // This is a best-effort drop — it fails silently if the index doesn't exist.
    try {
      await db.collection("agent_positions").dropIndex("walletAddress_1");
    } catch { /* index didn't exist — that's fine */ }

    console.log("[mongodb] ensureIndexes: all indexes created/verified");
  } catch (e) {
    console.warn("[mongodb] ensureIndexes failed (non-fatal):", e);
    _initialized = false;
  }
}
