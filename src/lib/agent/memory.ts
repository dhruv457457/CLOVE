import "server-only";
import { getDb } from "@/lib/db/mongodb";

// Lightweight stand-in for the deleted aiCompiler type — workflows are stored
// as opaque JSON in MongoDB for legacy compat; no schema validation needed.
type CompiledWorkflow = { nodes: unknown[]; edges: unknown[]; [k: string]: unknown };

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RunMemory {
  walletAddress: string;
  // MEM-1 fix: add agentId so multi-agent teams don't share each other's run history
  agentId?:      string;
  runId:         string;
  timestamp:     Date;
  success:       boolean;
  protocol:      string;
  action:        string;
  amount:        string;
  apy:           number;
  riskLevel:     string;
  txHash:        string | null;
  costPaid:      number;
  veniceReason:  string;
  durationMs:    number;
}

export interface AgentPosition {
  walletAddress:  string;
  protocol:       string;
  amount:         string;
  entryApy:       number;
  entryTimestamp: Date;
  updatedAt:      Date;
}

export interface ApySnapshot {
  timestamp: Date;
  yields: {
    morpho:    number;
    sky:       number;
    aerodrome: number;
    lido:      number;
    uniswap:   number;
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function saveRun(run: Omit<RunMemory, "timestamp">): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<RunMemory>("agent_runs").insertOne({
    ...run,
    timestamp: new Date(),
  });
}

// MEM-1 fix: filter by agentId when provided so each agent sees only its own history
export async function getLastRuns(walletAddress: string, n = 5, agentId?: string): Promise<RunMemory[]> {
  const db = await getDb();
  if (!db) return [];
  const filter: Record<string, unknown> = { walletAddress };
  if (agentId) filter.agentId = agentId;
  return db
    .collection<RunMemory>("agent_runs")
    .find(filter)
    .sort({ timestamp: -1 })
    .limit(n)
    .toArray();
}

// PROTO-3 fix: return ALL positions for a wallet (keyed by protocol)
export async function getPositions(walletAddress: string): Promise<AgentPosition[]> {
  const db = await getDb();
  if (!db) return [];
  return db.collection<AgentPosition>("agent_positions").find({ walletAddress }).toArray();
}

// Keep single-protocol getter for backward compat
export async function getPosition(walletAddress: string, protocol?: string): Promise<AgentPosition | null> {
  const db = await getDb();
  if (!db) return null;
  const filter: Record<string, unknown> = { walletAddress };
  if (protocol) filter.protocol = protocol;
  return db.collection<AgentPosition>("agent_positions").findOne(filter);
}

export async function updatePosition(
  walletAddress: string,
  protocol: string,
  amount: string,
  entryApy: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // PROTO-3 fix: key by { walletAddress, protocol } so Morpho + Lido don't overwrite each other
  await db.collection<AgentPosition>("agent_positions").updateOne(
    { walletAddress, protocol },
    {
      $set: {
        walletAddress,
        protocol,
        amount,
        entryApy,
        updatedAt: new Date(),
      },
      $setOnInsert: { entryTimestamp: new Date() },
    },
    { upsert: true }
  );
}

export async function saveApySnapshot(yields: ApySnapshot["yields"]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<ApySnapshot>("apy_snapshots").insertOne({
    timestamp: new Date(),
    yields,
  });
}

export async function getApyHistory(days = 7): Promise<ApySnapshot[]> {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .collection<ApySnapshot>("apy_snapshots")
    .find({ timestamp: { $gte: since } })
    .sort({ timestamp: 1 })
    .toArray();
}

// ── Workflow persistence ───────────────────────────────────────────────────────

export interface SavedWorkflow {
  walletAddress: string;
  workflow:      CompiledWorkflow;
  prompt:        string;
  updatedAt:     Date;
}

export interface SavedSchedule {
  walletAddress: string;
  enabled:       boolean;
  interval:      string;
  cron:          string;
  timezone:      string;
  updatedAt:     Date;
}

/** Save the compiled workflow to MongoDB so cron can re-execute it. */
export async function saveWorkflow(walletAddress: string, workflow: CompiledWorkflow, prompt: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<SavedWorkflow>("workflows").updateOne(
    { walletAddress },
    { $set: { walletAddress, workflow, prompt, updatedAt: new Date() } },
    { upsert: true }
  );
}

/** Load the saved workflow for a wallet. */
export async function getWorkflow(walletAddress: string): Promise<SavedWorkflow | null> {
  const db = await getDb();
  if (!db) return null;
  return db.collection<SavedWorkflow>("workflows").findOne({ walletAddress });
}

/** Save schedule config to MongoDB (persists across server restarts). */
export async function saveSchedule(walletAddress: string, schedule: Omit<SavedSchedule, "walletAddress" | "updatedAt">): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<SavedSchedule>("schedules").updateOne(
    { walletAddress },
    { $set: { ...schedule, walletAddress, updatedAt: new Date() } },
    { upsert: true }
  );
}

/** Get all enabled schedules (for cron dispatcher). */
export async function getEnabledSchedules(): Promise<SavedSchedule[]> {
  const db = await getDb();
  if (!db) return [];
  return db.collection<SavedSchedule>("schedules").find({ enabled: true }).toArray();
}

// ── Agent insights (reflection memory) ─────────────────────────────────────────

/** Insight visibility scope.
 *   "agent"  — only this agent's planner sees it (default)
 *   "team"   — shared across all agents under the same root delegator (Scout writes, Executor reads)
 *   "wallet" — shared across all agents owned by the same wallet
 */
export type InsightScope = "agent" | "team" | "wallet";

export interface AgentInsight {
  agentId:       string;
  walletAddress?: string;       // for "wallet" scope queries
  rootAgentId?:  string;        // for "team" scope queries (root of delegation chain)
  runId:         string;
  text:          string;        // e.g. "Sky APY has fallen 4 days straight — deprioritize"
  tags:          string[];      // legacy cheap-retrieval signal — kept for back-compat
  scope:         InsightScope;
  /** 1536-dim Venice embedding for semantic retrieval. */
  embedding?:    number[];
  createdAt:     Date;
}

export async function saveInsight(insight: Omit<AgentInsight, "createdAt" | "scope"> & { scope?: InsightScope }): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<AgentInsight>("agent_insights").insertOne({
    ...insight,
    scope:     insight.scope ?? "agent",
    createdAt: new Date(),
  });
}

/** Most recent N insights for an agent — injected into the next plan prompt. */
export async function getRecentInsights(agentId: string, n = 6): Promise<AgentInsight[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .collection<AgentInsight>("agent_insights")
    .find({ agentId })
    .sort({ createdAt: -1 })
    .limit(n)
    .toArray();
}

/** Retrieve insights by tag overlap — cheap relevance check before LLM injection. */
export async function getInsightsByTags(agentId: string, tags: string[], n = 6): Promise<AgentInsight[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .collection<AgentInsight>("agent_insights")
    .find({ agentId, tags: { $in: tags } })
    .sort({ createdAt: -1 })
    .limit(n)
    .toArray();
}

// ── Semantic + cross-agent retrieval ──────────────────────────────────────────

/**
 * Get the candidate pool for cross-agent retrieval.
 * Includes:
 *   1. All "agent"-scoped insights from this agent
 *   2. All "team"-scoped insights from agents sharing the same rootAgentId
 *   3. All "wallet"-scoped insights from agents owned by walletAddress
 */
export async function getInsightCandidates(
  agentId: string,
  walletAddress: string,
  rootAgentId: string | undefined,
  limit = 100,
): Promise<AgentInsight[]> {
  const db = await getDb();
  if (!db) return [];

  const orClauses: Record<string, unknown>[] = [
    { agentId, scope: "agent" },
    { walletAddress, scope: "wallet" },
  ];
  if (rootAgentId) orClauses.push({ rootAgentId, scope: "team" });

  return db
    .collection<AgentInsight>("agent_insights")
    .find({ $or: orClauses })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

// ── Memory prompt for Venice ──────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const diffMs   = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs  = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 60)  return `${diffMins}m ago`;
  if (diffHrs  < 24)  return `${diffHrs}h ago`;
  return `${diffDays}d ago`;
}

function apyTrend(snapshots: ApySnapshot[], protocol: keyof ApySnapshot["yields"]): string {
  if (snapshots.length < 2) return "—";
  const vals = snapshots.map(s => s.yields[protocol]).filter(v => v > 0);
  if (vals.length < 2) return "—";
  const first = vals[0];
  const last  = vals[vals.length - 1];
  const diff  = last - first;
  const arrow = diff > 0.1 ? "↑ rising" : diff < -0.1 ? "↓ falling" : "→ stable";
  const points = vals.map(v => `${v.toFixed(1)}%`).join(" → ");
  return `${points} ${arrow}`;
}

// MEM-1 fix: accept agentId so each agent in a multi-agent team gets its own history
export async function buildMemoryPrompt(walletAddress: string, agentId?: string): Promise<string> {
  const [lastRuns, positions, apyHistory] = await Promise.all([
    getLastRuns(walletAddress, 5, agentId),  // MEM-1: agent-scoped runs
    getPositions(walletAddress),             // PROTO-3: all protocol positions
    getApyHistory(7),
  ]);

  if (!lastRuns.length && !positions.length) {
    return "AGENT MEMORY: No previous runs. This is the first execution.";
  }

  const lines: string[] = ["AGENT MEMORY:"];

  // PROTO-3 fix: show ALL active positions, not just the last one
  if (positions.length > 0) {
    lines.push("Active positions:");
    for (const p of positions) {
      const when = relativeTime(p.entryTimestamp ?? p.updatedAt);
      lines.push(`  $${p.amount} in ${p.protocol} @ ${p.entryApy}% APY (entered ${when})`);
    }
  } else {
    lines.push("Current position: None (no active deposit)");
  }

  // Last runs
  if (lastRuns.length > 0) {
    lines.push("");
    lines.push(`Last ${lastRuns.length} runs:`);
    for (const run of lastRuns) {
      const when   = relativeTime(run.timestamp);
      const status = run.success ? "✓" : "✗";
      const desc   = run.action === "hold"
        ? `HELD — ${run.veniceReason?.slice(0, 60) ?? "no action taken"}`
        : `${run.action} $${run.amount} → ${run.protocol} @ ${run.apy}% | risk: ${run.riskLevel}`;
      lines.push(`- [${when}] ${desc} ${status}`);
    }
  }

  // APY trends
  if (apyHistory.length >= 2) {
    lines.push("");
    lines.push("APY Trend (7d):");
    for (const proto of ["morpho", "sky", "aerodrome", "lido"] as const) {
      const trend = apyTrend(apyHistory, proto);
      if (trend !== "—") lines.push(`- ${proto}: ${trend}`);
    }
  }

  // Totals
  if (lastRuns.length > 0) {
    const totalDeployed = lastRuns
      .filter(r => r.action !== "hold")
      .reduce((s, r) => s + parseFloat(r.amount ?? "0"), 0);
    const totalCost = lastRuns.reduce((s, r) => s + (r.costPaid ?? 0), 0);
    lines.push("");
    lines.push(`Total deployed: $${totalDeployed.toFixed(2)} | x402 fees paid: $${totalCost.toFixed(3)}`);
  }

  return lines.join("\n");
}
