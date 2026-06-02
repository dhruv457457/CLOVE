import "server-only";
import { getDb } from "@/lib/db/mongodb";

// ── Payload shapes ─────────────────────────────────────────────────────────────

/** Structured intelligence produced by the Scout agent (single x402 payment). */
export interface IntelligencePayload {
  bestApy:      number;
  recommended:  string;
  reason:       string;
  yields:       Record<string, { apy: number; tvl: string; risk: string }>;
  marketNews?:  string;
  x402Receipt?: string;   // base64 payment sig used — proof Scout paid
  x402Cost:     number;
  fetchedAt:    number;
}

/** Decision produced by the Risk Monitor agent after evaluating Scout's findings. */
export interface DecisionPayload {
  action:     "deposit" | "hold" | "rebalance" | "withdraw";
  protocol?:  string;
  amount?:    string;
  confidence: number;   // 0–1
  reasoning:  string;
  approved:   boolean;
  riskLevel:  "LOW" | "MEDIUM" | "HIGH";
}

/** Execution result produced by the Executor agent. */
export interface ExecutionPayload {
  txHash?:         string;
  protocol:        string;
  amount:          string;
  success:         boolean;
  via:             string;
  contractAddress?: string;
  basescanUrl?:    string;
  error?:          string;
}

// ── Handoff Packet ─────────────────────────────────────────────────────────────

/**
 * AgentHandoffPacket — the explicit artifact that travels between agents.
 *
 * This replaces DB-mediated semantic memory polling as the coordination
 * mechanism. Each agent adds its contribution to the packet and passes it
 * directly to the next agent via the orchestrator.
 *
 * Stored in MongoDB for audit trail, replayability, and the UI timeline.
 */
export interface AgentHandoffPacket {
  id:           string;
  workflowId:   string;
  runId:        string;
  createdAt:    Date;
  completedAt?: Date;

  // Agent IDs
  scoutAgentId:    string;
  riskAgentId:     string;
  executorAgentId: string;

  // Human-readable agent names (for UI display)
  scoutName:    string;
  riskName:     string;
  executorName: string;

  // Payloads — filled sequentially by each agent
  intelligence?: IntelligencePayload;
  decision?:     DecisionPayload;
  execution?:    ExecutionPayload;

  // Live delegation contexts — created at RUNTIME by the orchestrator
  // (not the static contexts frozen at agent-creation time)
  scoutDelegationContext?:    string;
  riskDelegationContext?:     string;   // redelegated from scout mid-run
  executorDelegationContext?: string;   // redelegated from risk mid-run

  // Phase tracking
  phase:  "pending" | "scouting" | "redelegating-risk" | "risk-check" |
          "redelegating-executor" | "executing" | "complete" | "failed";
  error?: string;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createHandoffPacket(
  input: Pick<AgentHandoffPacket,
    "workflowId" | "runId" |
    "scoutAgentId" | "riskAgentId" | "executorAgentId" |
    "scoutName" | "riskName" | "executorName" |
    "scoutDelegationContext"
  >,
): Promise<AgentHandoffPacket> {
  const packet: AgentHandoffPacket = {
    id:           `hp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    phase:        "pending",
    createdAt:    new Date(),
    ...input,
  };

  const db = await getDb();
  if (db) await db.collection<AgentHandoffPacket>("agent_handoffs").insertOne(packet);
  return packet;
}

export async function updateHandoffPacket(
  id: string,
  patch: Partial<AgentHandoffPacket>,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<AgentHandoffPacket>("agent_handoffs")
    .updateOne({ id }, { $set: patch });
}

export async function getHandoffPacket(id: string): Promise<AgentHandoffPacket | null> {
  const db = await getDb();
  if (!db) return null;
  return db.collection<AgentHandoffPacket>("agent_handoffs").findOne({ id });
}

/** Last N handoff packets for a workflow — newest first. */
export async function listHandoffPackets(
  workflowId: string,
  limit = 10,
): Promise<AgentHandoffPacket[]> {
  const db = await getDb();
  if (!db) return [];
  return db.collection<AgentHandoffPacket>("agent_handoffs")
    .find({ workflowId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}
