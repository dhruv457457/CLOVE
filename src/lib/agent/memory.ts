import "server-only";
import { getDb } from "@/lib/db/mongodb";
import type { CompiledWorkflow } from "@/lib/aiCompiler";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RunMemory {
  walletAddress: string;
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

export async function getLastRuns(walletAddress: string, n = 5): Promise<RunMemory[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .collection<RunMemory>("agent_runs")
    .find({ walletAddress })
    .sort({ timestamp: -1 })
    .limit(n)
    .toArray();
}

export async function getPosition(walletAddress: string): Promise<AgentPosition | null> {
  const db = await getDb();
  if (!db) return null;
  return db.collection<AgentPosition>("agent_positions").findOne({ walletAddress });
}

export async function updatePosition(
  walletAddress: string,
  protocol: string,
  amount: string,
  entryApy: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<AgentPosition>("agent_positions").updateOne(
    { walletAddress },
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

export async function buildMemoryPrompt(walletAddress: string): Promise<string> {
  const [lastRuns, position, apyHistory] = await Promise.all([
    getLastRuns(walletAddress, 5),
    getPosition(walletAddress),
    getApyHistory(7),
  ]);

  if (!lastRuns.length && !position) {
    return "AGENT MEMORY: No previous runs for this wallet. This is the first execution.";
  }

  const lines: string[] = ["AGENT MEMORY:"];

  // Current position
  if (position) {
    const when = relativeTime(position.entryTimestamp ?? position.updatedAt);
    lines.push(`Current position: $${position.amount} in ${position.protocol} @ ${position.entryApy}% APY (${when})`);
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
