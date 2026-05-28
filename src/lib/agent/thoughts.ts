import "server-only";
import { getDb } from "@/lib/db/mongodb";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ThoughtType =
  | "goal"
  | "plan"
  | "tool-call"
  | "tool-result"
  | "reflect"
  | "media";

export interface AgentThought {
  id:        string;
  agentId:   string;
  runId:     string;
  type:      ThoughtType;
  content:   Record<string, unknown>;
  parentId:  string | null;
  position:  { x: number; y: number };
  createdAt: Date;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Persist a thought to MongoDB. Used by the agent loop to materialise every
 * goal / plan / tool-call / reflection / media as a node on the inner canvas.
 */
export async function saveThought(thought: Omit<AgentThought, "createdAt"> & { createdAt?: Date }): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<AgentThought>("agent_thoughts").insertOne({
    ...thought,
    createdAt: thought.createdAt ?? new Date(),
  });
}

/** All thoughts for a given run, oldest first — for replay on inner canvas. */
export async function getRunThoughts(runId: string): Promise<AgentThought[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .collection<AgentThought>("agent_thoughts")
    .find({ runId })
    .sort({ createdAt: 1 })
    .toArray();
}

/** Most recent run's thoughts for an agent (used when opening the inner canvas). */
export async function getLatestAgentThoughts(agentId: string): Promise<AgentThought[]> {
  const db = await getDb();
  if (!db) return [];
  const latest = await db
    .collection<AgentThought>("agent_thoughts")
    .find({ agentId })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();
  if (!latest.length) return [];
  return getRunThoughts(latest[0].runId);
}

/** Aggregate the last N days of thoughts for an agent (used by daily digest). */
export async function getRecentThoughts(agentId: string, sinceMs: number): Promise<AgentThought[]> {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - sinceMs);
  return db
    .collection<AgentThought>("agent_thoughts")
    .find({ agentId, createdAt: { $gte: since } })
    .sort({ createdAt: 1 })
    .toArray();
}

// ── ID helpers ─────────────────────────────────────────────────────────────────

let _counter = 0;
export function generateThoughtId(): string {
  return `t_${Date.now().toString(36)}_${(_counter++).toString(36)}`;
}

export function generateRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
