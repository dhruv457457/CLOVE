import "server-only";
import { getDb } from "./mongodb";

/**
 * One-time index creation for CLOVE's MongoDB collections.
 *
 * Called lazily on first request via ensureIndexes(). MongoDB's createIndex
 * is idempotent — re-running is a cheap no-op if indexes exist.
 *
 * Why each index exists:
 *   agents.walletAddress           → listAgentsForWallet (dashboard load)
 *   agents.scheduleIntervalMs+status → cron scan for due agents
 *   agent_thoughts.agentId+createdAt → getLatestAgentThoughts, history drawer
 *   agent_thoughts.runId           → getRunThoughts, replay run
 *   agent_insights.agentId+createdAt → semantic memory candidate pull
 *   agent_insights.rootAgentId+scope → cross-agent team memory
 *   agent_insights.walletAddress+scope → wallet-scoped memory
 *   agent_runs.walletAddress+timestamp → getLastRuns (memory prompt builder)
 *   agent_positions.walletAddress  → getPosition (memory prompt)
 *   apy_snapshots.timestamp        → getApyHistory (trend lines)
 */

let _initialized = false;

export async function ensureIndexes(): Promise<void> {
  if (_initialized) return;
  const db = await getDb();
  if (!db) return;
  _initialized = true;  // optimistic — if create fails, we don't retry forever

  try {
    await Promise.all([
      // agents
      db.collection("agents").createIndex({ id: 1 }, { unique: true }),
      db.collection("agents").createIndex({ walletAddress: 1, createdAt: -1 }),
      db.collection("agents").createIndex({ scheduleIntervalMs: 1, status: 1, lastRunAt: 1 }),
      db.collection("agents").createIndex({ parentAgentId: 1 }),

      // agent_thoughts
      db.collection("agent_thoughts").createIndex({ id: 1 }, { unique: true }),
      db.collection("agent_thoughts").createIndex({ agentId: 1, createdAt: -1 }),
      db.collection("agent_thoughts").createIndex({ runId: 1, createdAt: 1 }),

      // agent_insights — three patterns for cross-scope retrieval
      db.collection("agent_insights").createIndex({ agentId: 1, createdAt: -1 }),
      db.collection("agent_insights").createIndex({ rootAgentId: 1, scope: 1, createdAt: -1 }),
      db.collection("agent_insights").createIndex({ walletAddress: 1, scope: 1, createdAt: -1 }),

      // agent_runs
      db.collection("agent_runs").createIndex({ walletAddress: 1, timestamp: -1 }),
      db.collection("agent_runs").createIndex({ runId: 1 }, { unique: true }),

      // agent_positions
      db.collection("agent_positions").createIndex({ walletAddress: 1 }, { unique: true }),

      // apy_snapshots
      db.collection("apy_snapshots").createIndex({ timestamp: -1 }),
    ]);
    console.log("[mongodb] ensureIndexes: all indexes created/verified");
  } catch (e) {
    console.warn("[mongodb] ensureIndexes failed (non-fatal):", e);
    _initialized = false; // allow retry on next call
  }
}
