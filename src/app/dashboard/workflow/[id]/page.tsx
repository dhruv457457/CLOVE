"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ReactFlow, Background, BackgroundVariant,
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge, type NodeTypes,
  Handle, Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Clock, Play, Zap, History, LayoutTemplate, ChevronDown, ChevronRight } from "lucide-react";
import { metamaskStore } from "@/lib/web3/metamaskStore";
import type { AgentHandoffPacket } from "@/lib/agent/handoff";

// ── Design tokens ─────────────────────────────────────────────────────────────
const INK        = "#0B0C09";
const INK_1      = "#111210";
const INK_2      = "#171815";
const ACCENT     = "#C8FF3D";
const ACCENT_SOFT = "rgba(200,255,61,0.18)";
const ACCENT_GLOW = "rgba(200,255,61,0.35)";
const TEXT       = "#E8E5DA";
const TEXT2      = "#B5B2A5";
const MID        = "#6B6A60";
const LINE       = "rgba(244,241,234,0.06)";
const LINE_MID   = "rgba(244,241,234,0.11)";

const SCOUT_CLR    = "#3DCEFF";
const RISK_CLR     = "#FFD93D";
const EXECUTOR_CLR = "#FF8A66";

// ── Domain types ──────────────────────────────────────────────────────────────
interface Agent {
  id:               string;
  name:             string;
  goal:             string;
  status:           "idle" | "planning" | "executing" | "reflecting" | "paused" | "blocked" | "failed";
  budgetUsdc:       string;
  position?:        { x: number; y: number };
  parentAgentId?:   string | null;
  delegationStatus?: "active" | "revoked" | "pending" | "none";
  delegationCap?:   string;
  totalRuns:        number;
  lastAction:       "hold" | "deposit" | "rebalance" | "withdraw" | "skip" | null;
  scheduleIntervalMs?: number;
}

interface Workflow {
  id:               string;
  name:             string;
  prompt:           string;
  createdAt:        string;
  status:           "active" | "paused" | "archived";
  permissionStatus: "active" | "pending" | "revoked" | "none";
  budgetUsdc:       string;
  periodDays:       number;
  agentIds:         string[];
  totalRuns:        number;
  totalExecuted:    number;
  totalSpentUsdc:   number;
  lastRunAt:        string | null;
}

interface WorkflowRun {
  runId:     string;
  agentName: string;
  startedAt: string;
  success:   boolean;
  action:    string;
  txHash?:   string | null;
  costPaid:  number;
  insight?:  string;
}

// ── SSE event types ───────────────────────────────────────────────────────────
type LivePhase =
  | "idle"
  | "pending"
  | "scouting"
  | "redelegating-risk"
  | "risk-check"
  | "redelegating-executor"
  | "executing"
  | "complete"
  | "failed";

interface LiveThought {
  agent:   "scout" | "risk" | "executor";
  content: string;
  tool?:   string;
}

interface LiveState {
  phase:       LivePhase;
  packetId?:   string;
  runId?:      string;
  thoughts:    LiveThought[];
  scoutDone:   boolean;
  riskDone:    boolean;
  execDone:    boolean;
  packet?:     AgentHandoffPacket;
  error?:      string;
  startedAt?:  number;
}

const INIT_LIVE: LiveState = {
  phase: "idle", thoughts: [], scoutDone: false, riskDone: false, execDone: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function ago(ts: string | number | Date | null) {
  if (!ts) return "—";
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function shortHash(h?: string) {
  if (!h) return "—";
  return h.slice(0, 6) + "…" + h.slice(-4);
}

function elapsed(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── ReactFlow sub-components ───────────────────────────────────────────────────
function FitViewOnLoad({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (nodeCount > 0) setTimeout(() => fitView({ padding: 0.35, duration: 400 }), 80);
  }, [nodeCount, fitView]);
  return null;
}

function AgentMiniNode({ data }: { data: Agent & { onOpen: () => void } }) {
  const isLive = data.status === "planning" || data.status === "executing" || data.status === "reflecting";
  const border = isLive ? "rgba(200,255,61,0.4)" : LINE_MID;
  const isReal = data.delegationStatus === "active";
  return (
    <div
      onClick={() => data.onOpen()}
      style={{
        width: 230, background: INK_1, border: `1px solid ${border}`, borderRadius: 11,
        padding: "12px 14px", color: TEXT, cursor: "pointer",
        boxShadow: isLive ? `0 0 0 1px rgba(200,255,61,0.25), 0 8px 18px -10px ${ACCENT_GLOW}` : "none",
        transition: "border-color .15s, box-shadow .15s",
        fontFamily: "var(--sans)",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ width: 6, height: 6, background: border, left: -3 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, color: MID, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: isLive ? ACCENT : MID, boxShadow: isLive ? `0 0 0 2px ${ACCENT_SOFT}` : "none" }} />
        agent · {data.status}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.2 }}>{data.name}</div>
      <div style={{ fontSize: 11, color: TEXT2, marginTop: 5, lineHeight: 1.4, fontStyle: "italic", fontFamily: "var(--serif)" }}>
        &ldquo;{data.goal.slice(0, 62)}{data.goal.length > 62 ? "…" : ""}&rdquo;
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9, paddingTop: 8, borderTop: `1px solid ${LINE}`, fontSize: 9.5, color: MID, fontVariantNumeric: "tabular-nums" }}>
        <span>{data.totalRuns} runs</span>
        <span>{data.budgetUsdc} USDC</span>
        <span style={{ color: isReal ? ACCENT : MID }}>{isReal ? "● real on-chain" : "● needs permission"}</span>
      </div>
      <Handle type="source" position={Position.Right} style={{ width: 6, height: 6, background: border, right: -3 }} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { agent: AgentMiniNode };

// ── Agent Conversation Timeline ───────────────────────────────────────────────
function PhaseChip({ label, color, active, done }: { label: string; color: string; active: boolean; done: boolean }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px", borderRadius: 20,
      background: done ? `${color}22` : active ? `${color}18` : "transparent",
      border: `1px solid ${done || active ? color + "55" : LINE}`,
      fontSize: 10.5, color: done || active ? color : MID,
      transition: "all .2s",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: done ? color : active ? color : MID, opacity: done ? 1 : active ? 0.7 : 0.3 }} />
      {label}
      {done && <span style={{ fontSize: 9 }}>✓</span>}
      {active && !done && <span style={{ fontSize: 9, opacity: 0.6 }}>…</span>}
    </div>
  );
}

function ThoughtBubble({ thought, color }: { thought: LiveThought; color: string }) {
  return (
    <div style={{
      padding: "10px 13px", borderRadius: 8,
      background: `${color}0A`, border: `1px solid ${color}22`,
      fontSize: 11.5, color: TEXT2, lineHeight: 1.55,
      fontFamily: "var(--serif)", fontStyle: "italic",
    }}>
      {thought.tool && (
        <span style={{ display: "inline-block", marginBottom: 4, fontSize: 9, fontFamily: "var(--sans)", fontStyle: "normal", color, background: `${color}18`, padding: "1px 7px", borderRadius: 10 }}>
          {thought.tool}
        </span>
      )}
      <div>&ldquo;{thought.content.slice(0, 280)}{thought.content.length > 280 ? "…" : ""}&rdquo;</div>
    </div>
  );
}

function AgentBlock({
  label, role, color, thoughts, done, active, children,
}: {
  label:    string;
  role:     "scout" | "risk" | "executor";
  color:    string;
  thoughts: LiveThought[];
  done:     boolean;
  active:   boolean;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const myThoughts = thoughts.filter(t => t.agent === role);

  return (
    <div style={{
      borderRadius: 12, overflow: "hidden",
      border: `1px solid ${done ? color + "55" : active ? color + "33" : LINE}`,
      background: INK_1,
      transition: "border-color .25s",
      boxShadow: active ? `0 0 0 1px ${color}18, 0 8px 30px -12px ${color}44` : "none",
    }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(x => !x)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "13px 16px",
          cursor: "pointer", borderBottom: expanded ? `1px solid ${LINE}` : "none",
          background: done ? `${color}0A` : "transparent",
        }}
      >
        <span style={{
          width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
          background: `${color}1A`, fontSize: 13, border: `1px solid ${color}33`,
        }}>
          {role === "scout" ? "🔍" : role === "risk" ? "🛡️" : "⚡"}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: done || active ? TEXT : TEXT2, letterSpacing: "-0.01em" }}>{label}</div>
          <div style={{ fontSize: 9.5, color: MID, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 1 }}>
            {done ? "complete" : active ? "running…" : "waiting"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {myThoughts.length > 0 && (
            <span style={{ fontSize: 9.5, color: MID }}>{myThoughts.length} thought{myThoughts.length !== 1 ? "s" : ""}</span>
          )}
          {active && (
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, animation: "pulse 1.2s infinite" }} />
          )}
          {expanded ? <ChevronDown size={13} color={MID} /> : <ChevronRight size={13} color={MID} />}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {myThoughts.length === 0 && !done && !active && (
            <div style={{ fontSize: 11, color: MID, fontStyle: "italic" }}>Waiting for previous agent…</div>
          )}
          {myThoughts.map((t, i) => <ThoughtBubble key={i} thought={t} color={color} />)}
          {children}
        </div>
      )}
    </div>
  );
}

function HandoffArrow({ label, sublabel, color, done }: { label: string; sublabel?: string; color: string; done: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 0" }}>
      <div style={{
        width: 1, height: 18, background: done ? `${color}66` : LINE,
        transition: "background .3s",
      }} />
      <div style={{
        padding: "4px 12px", borderRadius: 20, fontSize: 9.5, fontWeight: 600,
        background: done ? `${color}18` : INK_1,
        border: `1px solid ${done ? color + "44" : LINE}`,
        color: done ? color : MID, letterSpacing: "0.05em", textTransform: "uppercase",
        transition: "all .3s",
      }}>
        {label}
        {sublabel && <span style={{ fontWeight: 400, opacity: 0.7, marginLeft: 5 }}>{sublabel}</span>}
      </div>
      <div style={{
        width: 1, height: 18, background: done ? `${color}66` : LINE,
        transition: "background .3s",
      }} />
    </div>
  );
}

function IntelligenceCard({ intelligence }: { intelligence: AgentHandoffPacket["intelligence"] }) {
  if (!intelligence) return null;
  return (
    <div style={{
      marginTop: 8, padding: "12px 14px", borderRadius: 9,
      background: `${SCOUT_CLR}0A`, border: `1px solid ${SCOUT_CLR}22`,
    }}>
      <div style={{ fontSize: 9.5, color: SCOUT_CLR, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>
        Intelligence Payload
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
        <div style={{ fontSize: 11, color: TEXT2 }}>Best APY</div>
        <div style={{ fontSize: 11, color: SCOUT_CLR, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{intelligence.bestApy.toFixed(2)}%</div>
        <div style={{ fontSize: 11, color: TEXT2 }}>Recommended</div>
        <div style={{ fontSize: 11, color: TEXT }}>{intelligence.recommended}</div>
      </div>
      {intelligence.reason && (
        <div style={{ marginTop: 8, fontSize: 11, color: TEXT2, fontStyle: "italic", fontFamily: "var(--serif)", lineHeight: 1.5 }}>
          &ldquo;{intelligence.reason.slice(0, 200)}&rdquo;
        </div>
      )}
    </div>
  );
}

function DecisionCard({ decision }: { decision: AgentHandoffPacket["decision"] }) {
  if (!decision) return null;
  const col = decision.approved ? ACCENT : EXECUTOR_CLR;
  return (
    <div style={{
      marginTop: 8, padding: "12px 14px", borderRadius: 9,
      background: `${col}0A`, border: `1px solid ${col}22`,
    }}>
      <div style={{ fontSize: 9.5, color: RISK_CLR, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>
        Risk Decision
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
        <div style={{ fontSize: 11, color: TEXT2 }}>Action</div>
        <div style={{ fontSize: 11, color: col, fontWeight: 700, textTransform: "uppercase" }}>{decision.action}</div>
        <div style={{ fontSize: 11, color: TEXT2 }}>Risk Level</div>
        <div style={{ fontSize: 11, color: decision.riskLevel === "LOW" ? ACCENT : decision.riskLevel === "MEDIUM" ? RISK_CLR : EXECUTOR_CLR }}>{decision.riskLevel}</div>
        <div style={{ fontSize: 11, color: TEXT2 }}>Confidence</div>
        <div style={{ fontSize: 11, color: TEXT, fontVariantNumeric: "tabular-nums" }}>{(decision.confidence * 100).toFixed(0)}%</div>
        <div style={{ fontSize: 11, color: TEXT2 }}>Approved</div>
        <div style={{ fontSize: 11, color: col, fontWeight: 600 }}>{decision.approved ? "✓ Yes" : "✗ No"}</div>
      </div>
      {decision.reasoning && (
        <div style={{ marginTop: 8, fontSize: 11, color: TEXT2, fontStyle: "italic", fontFamily: "var(--serif)", lineHeight: 1.5 }}>
          &ldquo;{decision.reasoning.slice(0, 200)}&rdquo;
        </div>
      )}
    </div>
  );
}

function ExecutionCard({ execution }: { execution: AgentHandoffPacket["execution"] }) {
  if (!execution) return null;
  return (
    <div style={{
      marginTop: 8, padding: "12px 14px", borderRadius: 9,
      background: `${EXECUTOR_CLR}0A`, border: `1px solid ${EXECUTOR_CLR}22`,
    }}>
      <div style={{ fontSize: 9.5, color: EXECUTOR_CLR, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>
        Execution Result
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
        <div style={{ fontSize: 11, color: TEXT2 }}>Protocol</div>
        <div style={{ fontSize: 11, color: TEXT }}>{execution.protocol}</div>
        <div style={{ fontSize: 11, color: TEXT2 }}>Amount</div>
        <div style={{ fontSize: 11, color: TEXT, fontVariantNumeric: "tabular-nums" }}>{execution.amount}</div>
        <div style={{ fontSize: 11, color: TEXT2 }}>Via</div>
        <div style={{ fontSize: 11, color: TEXT }}>{execution.via}</div>
        <div style={{ fontSize: 11, color: TEXT2 }}>Success</div>
        <div style={{ fontSize: 11, color: execution.success ? ACCENT : EXECUTOR_CLR, fontWeight: 600 }}>
          {execution.success ? "✓ Yes" : "✗ Failed"}
        </div>
      </div>
      {execution.txHash && (
        <a
          href={execution.basescanUrl ?? `https://basescan.org/tx/${execution.txHash}`}
          target="_blank" rel="noopener noreferrer"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10,
            fontSize: 11, color: ACCENT, textDecoration: "none",
            padding: "5px 11px", borderRadius: 7,
            background: ACCENT_SOFT, border: `1px solid ${ACCENT}44`,
          }}
        >
          ↗ Basescan · tx {shortHash(execution.txHash)}
        </a>
      )}
      {execution.error && (
        <div style={{ marginTop: 8, fontSize: 11, color: EXECUTOR_CLR, fontFamily: "monospace" }}>
          Error: {execution.error.slice(0, 140)}
        </div>
      )}
    </div>
  );
}

function DelegationTag({ label, context }: { label: string; context?: string }) {
  if (!context) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7,
      padding: "5px 10px", borderRadius: 7,
      background: "rgba(200,255,61,0.06)", border: `1px solid ${ACCENT}33`,
      fontSize: 9.5, color: TEXT2,
    }}>
      <span style={{ color: ACCENT, fontWeight: 600 }}>🔑 {label}</span>
      <span style={{ fontFamily: "monospace", fontSize: 9 }}>{context.slice(0, 32)}…</span>
    </div>
  );
}

interface TimelineProps {
  live:    LiveState;
  history: AgentHandoffPacket[];
  agents:  Agent[];
}

function AgentConversationTimeline({ live, history, agents }: TimelineProps) {
  // Derive agent names from agent list
  const names = { scout: "Scout", risk: "Risk Monitor", executor: "Executor" };
  if (agents.length >= 1) names.scout    = agents[0]?.name ?? "Scout";
  if (agents.length >= 2) names.risk     = agents[1]?.name ?? "Risk Monitor";
  if (agents.length >= 3) names.executor = agents[2]?.name ?? "Executor";

  const p = live.packet;
  const isActive = live.phase !== "idle";
  const elapsed_ = live.startedAt ? elapsed(Date.now() - live.startedAt) : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Live run header */}
      {isActive && (
        <div style={{
          marginBottom: 24, padding: "14px 18px", borderRadius: 12,
          background: live.phase === "complete" ? `${ACCENT}0A` : live.phase === "failed" ? `${EXECUTOR_CLR}0A` : `${SCOUT_CLR}0A`,
          border: `1px solid ${live.phase === "complete" ? ACCENT + "44" : live.phase === "failed" ? EXECUTOR_CLR + "44" : SCOUT_CLR + "33"}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: TEXT2, fontWeight: 600 }}>
              A2A Run · {live.runId ? live.runId.slice(0, 16) + "…" : "starting…"}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {elapsed_ && <span style={{ fontSize: 9.5, color: MID }}>{elapsed_}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <PhaseChip label="Scout"    color={SCOUT_CLR}    active={live.phase === "scouting"}              done={live.scoutDone} />
            <PhaseChip label="→ Redelegate" color={RISK_CLR} active={live.phase === "redelegating-risk"}    done={live.phase === "risk-check" || live.riskDone} />
            <PhaseChip label="Risk"     color={RISK_CLR}     active={live.phase === "risk-check"}           done={live.riskDone} />
            <PhaseChip label="→ Redelegate" color={EXECUTOR_CLR} active={live.phase === "redelegating-executor"} done={live.phase === "executing" || live.execDone} />
            <PhaseChip label="Executor" color={EXECUTOR_CLR} active={live.phase === "executing"}            done={live.execDone} />
          </div>
          {live.error && (
            <div style={{ marginTop: 10, fontSize: 11, color: EXECUTOR_CLR, fontFamily: "monospace" }}>
              {live.error}
            </div>
          )}
        </div>
      )}

      {/* Live conversation */}
      {isActive && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Scout */}
          <AgentBlock
            label={p?.scoutName ?? names.scout}
            role="scout" color={SCOUT_CLR}
            thoughts={live.thoughts}
            done={live.scoutDone}
            active={live.phase === "scouting"}
          >
            {p?.intelligence && <IntelligenceCard intelligence={p.intelligence} />}
            {p?.scoutDelegationContext && (
              <DelegationTag label="Scout delegation ctx" context={p.scoutDelegationContext} />
            )}
          </AgentBlock>

          <HandoffArrow
            label="Handoff packet"
            sublabel={p?.intelligence ? `Best APY: ${p.intelligence.bestApy.toFixed(2)}%` : undefined}
            color={RISK_CLR}
            done={live.scoutDone}
          />

          {/* Risk Monitor */}
          <AgentBlock
            label={p?.riskName ?? names.risk}
            role="risk" color={RISK_CLR}
            thoughts={live.thoughts}
            done={live.riskDone}
            active={live.phase === "risk-check"}
          >
            {p?.decision && <DecisionCard decision={p.decision} />}
            {p?.riskDelegationContext && (
              <DelegationTag label="Risk delegation ctx" context={p.riskDelegationContext} />
            )}
          </AgentBlock>

          <HandoffArrow
            label="Live redelegate"
            sublabel={p?.decision ? `Action: ${p.decision.action}` : undefined}
            color={EXECUTOR_CLR}
            done={live.riskDone}
          />

          {/* Executor */}
          <AgentBlock
            label={p?.executorName ?? names.executor}
            role="executor" color={EXECUTOR_CLR}
            thoughts={live.thoughts}
            done={live.execDone}
            active={live.phase === "executing"}
          >
            {p?.execution && <ExecutionCard execution={p.execution} />}
            {p?.executorDelegationContext && (
              <DelegationTag label="Executor delegation ctx" context={p.executorDelegationContext} />
            )}
          </AgentBlock>
        </div>
      )}

      {/* Historical runs */}
      {history.length > 0 && (
        <div style={{ marginTop: isActive ? 40 : 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 16,
            fontSize: 9.5, color: MID, letterSpacing: "0.1em", textTransform: "uppercase",
          }}>
            <History size={10} /> Previous runs · {history.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {history.map(h => (
              <HistoryPacketRow key={h.id} packet={h} names={names} />
            ))}
          </div>
        </div>
      )}

      {!isActive && history.length === 0 && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 12, padding: "60px 0", color: MID,
        }}>
          <Zap size={28} color={MID} strokeWidth={1.2} />
          <div style={{ fontSize: 13, fontStyle: "italic", textAlign: "center", lineHeight: 1.6, maxWidth: 320 }}>
            No A2A runs yet. Click <span style={{ color: ACCENT }}>Run Orchestrated</span> in the toolbar to start the Fund Manager → workers pipeline.
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryPacketRow({ packet, names }: { packet: AgentHandoffPacket; names: { scout: string; risk: string; executor: string } }) {
  const [open, setOpen] = useState(false);
  const ok = packet.phase === "complete";
  const failed = packet.phase === "failed";

  return (
    <div style={{
      borderRadius: 10, background: INK_1,
      border: `1px solid ${ok ? ACCENT + "33" : failed ? EXECUTOR_CLR + "33" : LINE}`,
      overflow: "hidden",
    }}>
      <div
        onClick={() => setOpen(x => !x)}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: ok ? ACCENT : failed ? EXECUTOR_CLR : MID, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, color: TEXT, fontWeight: 500 }}>
            {packet.phase.toUpperCase()}
            {packet.intelligence && (
              <span style={{ marginLeft: 8, fontSize: 10, color: SCOUT_CLR, fontWeight: 400 }}>
                {packet.intelligence.bestApy.toFixed(2)}% APY
              </span>
            )}
            {packet.decision && (
              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: packet.decision.approved ? ACCENT : EXECUTOR_CLR }}>
                → {packet.decision.action.toUpperCase()}
              </span>
            )}
          </div>
          <div style={{ fontSize: 9.5, color: MID, marginTop: 1 }}>
            {ago(packet.createdAt)} · run {packet.runId.slice(0, 14)}…
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {packet.execution?.txHash && (
            <a
              href={packet.execution.basescanUrl ?? `https://basescan.org/tx/${packet.execution.txHash}`}
              target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 9.5, color: ACCENT, textDecoration: "none" }}
            >
              ↗ tx
            </a>
          )}
          {open ? <ChevronDown size={12} color={MID} /> : <ChevronRight size={12} color={MID} />}
        </div>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${LINE}`, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <PhaseChip label={packet.scoutName ?? names.scout}    color={SCOUT_CLR}    active={false} done={!!packet.intelligence} />
            <PhaseChip label={packet.riskName ?? names.risk}      color={RISK_CLR}     active={false} done={!!packet.decision} />
            <PhaseChip label={packet.executorName ?? names.executor} color={EXECUTOR_CLR} active={false} done={!!packet.execution} />
          </div>
          {packet.intelligence && <IntelligenceCard intelligence={packet.intelligence} />}
          {packet.decision && <DecisionCard decision={packet.decision} />}
          {packet.execution && <ExecutionCard execution={packet.execution} />}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WorkflowDetailPage() {
  const router       = useRouter();
  const params       = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const workflowId   = params.id;
  const autoRunFired = useRef(false);

  const [tab, setTab]         = useState<"canvas" | "timeline" | "history">("canvas");
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [agents, setAgents]   = useState<Agent[]>([]);
  const [runs, setRuns]       = useState<WorkflowRun[]>([]);
  const [handoffs, setHandoffs] = useState<AgentHandoffPacket[]>([]);

  const [live, setLive]       = useState<LiveState>(INIT_LIVE);
  const liveRef               = useRef<LiveState>(INIT_LIVE);
  const readerRef             = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // ── Data loading ────────────────────────────────────────────────────────────
  const loadWorkflow = useCallback(async () => {
    const res = await fetch(`/api/workflow/${workflowId}`);
    if (!res.ok) return;
    const data = await res.json() as { workflow: Workflow; agents: Agent[] };
    setWorkflow(data.workflow);
    setAgents(data.agents ?? []);
  }, [workflowId]);

  const loadHistory = useCallback(async () => {
    const res = await fetch(`/api/workflow/${workflowId}/history`);
    if (!res.ok) return;
    const data = await res.json() as { runs: WorkflowRun[] };
    setRuns(data.runs ?? []);
  }, [workflowId]);

  const loadHandoffs = useCallback(async () => {
    const res = await fetch(`/api/workflow/${workflowId}/handoffs?limit=20`);
    if (!res.ok) return;
    const data = await res.json() as { packets: AgentHandoffPacket[] };
    setHandoffs(data.packets ?? []);
  }, [workflowId]);

  useEffect(() => {
    loadWorkflow();
    loadHistory();
    loadHandoffs();
  }, [loadWorkflow, loadHistory, loadHandoffs]);

  // ── ReactFlow canvas ────────────────────────────────────────────────────────
  useEffect(() => {
    setNodes(agents.map((a, i) => ({
      id:       a.id,
      type:     "agent",
      position: a.position ?? { x: 80 + i * 280, y: 200 },
      data: {
        ...a,
        onOpen: () => router.push(`/dashboard/agent/${a.id}`),
      },
    })));

    const newEdges: Edge[] = [];
    for (const a of agents) {
      if (a.parentAgentId && agents.find(p => p.id === a.parentAgentId)) {
        const isActive = a.delegationStatus === "active";
        newEdges.push({
          id: `del_${a.parentAgentId}_${a.id}`,
          source: a.parentAgentId, target: a.id,
          type: "smoothstep", animated: isActive,
          label: a.delegationCap ? `${a.delegationCap} USDC` : undefined,
          labelStyle: { fill: TEXT2, fontSize: 10 },
          labelBgStyle: { fill: INK_1, fillOpacity: 0.9 },
          labelBgPadding: [6, 4] as [number, number],
          style: isActive
            ? { stroke: ACCENT, strokeWidth: 1.25, strokeDasharray: "3 7" }
            : { stroke: "rgba(244,241,234,0.16)", strokeWidth: 1, strokeDasharray: "2 4" },
        });
      }
    }
    setEdges(newEdges);
  }, [agents, router, setNodes, setEdges]);

  // ── Orchestrated run (A2A SSE) ──────────────────────────────────────────────
  function patchLive(patch: Partial<LiveState>) {
    liveRef.current = { ...liveRef.current, ...patch };
    setLive({ ...liveRef.current });
  }

  const runOrchestrated = useCallback(async () => {
    if (live.phase !== "idle") return;

    setTab("timeline");
    const now = Date.now();
    patchLive({ phase: "pending", thoughts: [], scoutDone: false, riskDone: false, execDone: false, packet: undefined, error: undefined, startedAt: now });

    const mm = metamaskStore.getState();

    try {
      const resp = await fetch(`/api/workflow/${workflowId}/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress:      mm.userAddress,
          permissionsContext: mm.permission?.permissionsContext,
          delegationManager:  mm.permission?.delegationManager,
        }),
      });

      if (!resp.ok || !resp.body) {
        patchLive({ phase: "failed", error: `HTTP ${resp.status}` });
        return;
      }

      const reader = resp.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buf = "";
      // SSE: track the event type from "event:" lines
      let pendingEvent = "";
      // Track redelegation target across events
      let lastRedelegatingFor: "risk" | "executor" = "risk";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          // SSE event name
          if (line.startsWith("event: ")) {
            pendingEvent = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;

          let ev: Record<string, unknown>;
          try { ev = JSON.parse(raw); } catch { continue; }

          // Use the SSE event name (set by "event:" line above)
          const type = pendingEvent || (ev.type as string) || "";
          pendingEvent = "";

          if (type === "orchestration-start") {
            patchLive({ phase: "scouting", packetId: ev.packetId as string, runId: ev.runId as string });

          } else if (type === "phase-start") {
            const phaseMap: Record<string, LivePhase> = {
              scouting:                "scouting",
              "risk-check":            "risk-check",
              executing:               "executing",
              "redelegating-risk":     "redelegating-risk",
              "redelegating-executor": "redelegating-executor",
            };
            const p = ev.phase as string;
            patchLive({ phase: phaseMap[p] ?? liveRef.current.phase });

          } else if (type === "thought") {
            // Backend emits role: "scout" | "risk" | "executor"
            const role = (ev.role as "scout" | "risk" | "executor") ?? "scout";
            const content = (ev.content as string) ?? "";
            const tool = ev.tool as string | undefined;
            patchLive({ thoughts: [...liveRef.current.thoughts, { agent: role, content, tool }] });

          } else if (type === "scout-complete") {
            // intelligence is sent as a nested object AND as individual fields
            const intelligence = (ev.intelligence as AgentHandoffPacket["intelligence"]) ?? {
              bestApy:     ev.bestApy as number ?? 0,
              recommended: ev.recommended as string ?? "",
              reason:      "",
              yields:      ev.yields as Record<string, { apy: number; tvl: string; risk: string }> ?? {},
              x402Cost:    ev.x402Cost as number ?? 0,
              fetchedAt:   Date.now(),
            };
            patchLive({
              scoutDone: true,
              phase: "redelegating-risk",
              packet: { ...(liveRef.current.packet ?? {} as AgentHandoffPacket), intelligence },
            });

          } else if (type === "redelegating") {
            const forTarget = (ev.for as "risk" | "executor") ?? "risk";
            lastRedelegatingFor = forTarget;
            const rPhase = forTarget === "risk" ? "redelegating-risk" : "redelegating-executor";
            patchLive({ phase: rPhase });

          } else if (type === "redelegation-complete") {
            // Use lastRedelegatingFor since backend doesn't echo it here
            if (lastRedelegatingFor === "risk") {
              patchLive({
                phase: "risk-check",
                packet: {
                  ...(liveRef.current.packet ?? {} as AgentHandoffPacket),
                  riskDelegationContext: ev.contextHash as string,
                },
              });
            } else {
              patchLive({
                phase: "executing",
                packet: {
                  ...(liveRef.current.packet ?? {} as AgentHandoffPacket),
                  executorDelegationContext: ev.contextHash as string,
                },
              });
            }

          } else if (type === "risk-complete") {
            patchLive({
              riskDone: true,
              phase: "redelegating-executor",
              packet: {
                ...(liveRef.current.packet ?? {} as AgentHandoffPacket),
                decision: ev.decision as AgentHandoffPacket["decision"],
              },
            });

          } else if (type === "execution-complete") {
            const execution: AgentHandoffPacket["execution"] = {
              txHash:         ev.txHash as string | undefined,
              protocol:       ev.protocol as string ?? "unknown",
              amount:         ev.amount as string ?? "0",
              success:        ev.success as boolean ?? false,
              via:            ev.via as string ?? "demo",
              basescanUrl:    ev.basescanUrl as string | undefined,
            };
            patchLive({
              execDone: true,
              packet: {
                ...(liveRef.current.packet ?? {} as AgentHandoffPacket),
                execution,
              },
            });

          } else if (type === "orchestration-complete") {
            patchLive({ phase: "complete" });
            await Promise.all([loadWorkflow(), loadHistory(), loadHandoffs()]);

          } else if (type === "orchestration-error") {
            patchLive({ phase: "failed", error: (ev.error as string) ?? "Unknown error" });

          } else if (type === "execution-skipped") {
            patchLive({
              phase: "complete",
              packet: {
                ...(liveRef.current.packet ?? {} as AgentHandoffPacket),
                execution: { protocol: "none", amount: "0", success: false, via: "risk-blocked", error: ev.reason as string },
              },
            });
            await Promise.all([loadWorkflow(), loadHistory(), loadHandoffs()]);
          }
        }
      }
    } catch (e) {
      patchLive({ phase: "failed", error: e instanceof Error ? e.message : String(e) });
    } finally {
      readerRef.current = null;
      // After a moment, allow re-running
      setTimeout(() => {
        setLive(prev => prev.phase === "complete" || prev.phase === "failed"
          ? { ...prev }
          : prev
        );
      }, 2000);
    }
  }, [live.phase, workflowId, loadWorkflow, loadHistory, loadHandoffs]);

  // Reset live state to allow new run
  const resetLive = () => {
    readerRef.current?.cancel();
    readerRef.current = null;
    liveRef.current = INIT_LIVE;
    setLive(INIT_LIVE);
  };

  // ── Team run — runs EVERY agent in dependency order, sequentially ───────────
  // Left→right by canvas position: scouts → analyzer → risk → executor. The
  // Fund Manager (orchestrator) is skipped — it holds the grant, it doesn't run a
  // reasoning loop. Agents coordinate through shared team memory between runs:
  // scouts write findings, the analyzer/risk/executor read them. Read-only scouts
  // (cap 0) run without a spending permission; only the executor transacts.
  const [running, setRunning] = useState<string | null>(null);
  const runSingle = useCallback(async () => {
    if (!workflow || agents.length === 0) return;
    const mm = metamaskStore.getState();
    const ordered = [...agents]
      .filter(a => a.name !== "Fund Manager")   // orchestrator holds the grant; doesn't run a loop
      .sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
    try {
      for (const a of ordered) {
        setRunning(a.id);
        try {
          const res = await fetch("/api/agent/run-stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentId:            a.id,
              walletAddress:      mm.userAddress,
              permissionsContext: mm.permission?.permissionsContext,
              delegationManager:  mm.permission?.delegationManager,
            }),
          });
          const reader = res.body?.getReader();
          if (reader) { while (true) { const { done } = await reader.read(); if (done) break; } }
        } catch { /* one agent failing shouldn't stop the team */ }
        await loadWorkflow(); // refresh run counts as each agent finishes
      }
    } finally {
      setRunning(null);
      await Promise.all([loadWorkflow(), loadHistory()]);
    }
  }, [agents, workflow, loadWorkflow, loadHistory]);

  // ── Fund Manager allocation (dynamic budget split) ──────────────────────────
  type AllocOut = { reasoning?: string; source?: string; totalUsdc?: number; error?: string;
    allocations?: { name: string; protocol: string; weight: number; capUsdc: number }[];
    findings?: { protocol: string; apy?: number; risk?: string }[] };
  const [allocResult, setAllocResult] = useState<AllocOut | null>(null);
  const [allocating, setAllocating]   = useState(false);
  // Per-protocol executors carry typeConfig.protocols — only then is a split possible.
  const canAllocate = agents.filter(a =>
    Array.isArray((a as { typeConfig?: { protocols?: string[] } }).typeConfig?.protocols) &&
    /executor/i.test(a.name)).length >= 2;

  const runAllocation = useCallback(async () => {
    setAllocating(true); setAllocResult(null);
    try {
      const mm = metamaskStore.getState();
      const res = await fetch(`/api/workflow/${workflowId}/allocate-budget`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: mm.userAddress, riskTolerance: "moderate" }),
      });
      setAllocResult(await res.json());
      await loadWorkflow();
    } catch (e) {
      setAllocResult({ error: e instanceof Error ? e.message : String(e) });
    } finally { setAllocating(false); }
  }, [workflowId, loadWorkflow]);

  const isOrchestrated = agents.length === 3; // 3-agent workflow = Scout/Risk/Executor
  const isLiveRunning  = live.phase !== "idle" && live.phase !== "complete" && live.phase !== "failed";
  const canRun         = isOrchestrated ? !isLiveRunning : !running && agents.length > 0;

  // Auto-start a run when arriving via "Run Team" (?run=1). A 3-agent team runs
  // the orchestrated A2A timeline; a solo/2-agent workflow runs the single-agent
  // path (calling runOrchestrated on a solo agent 400s). Fires once, then strips
  // the query param so a refresh doesn't re-trigger it.
  useEffect(() => {
    if (autoRunFired.current) return;
    if (searchParams.get("run") !== "1") return;
    if (agents.length === 0) return;
    if (live.phase !== "idle") return;
    autoRunFired.current = true;
    if (isOrchestrated) { setTab("timeline"); runOrchestrated(); }
    else                { runSingle(); }
    router.replace(`/dashboard/workflow/${workflowId}`);
  }, [searchParams, agents, live.phase, isOrchestrated, runOrchestrated, runSingle, router, workflowId]);

  if (!workflow) {
    return (
      <div style={{ background: INK, color: TEXT, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--sans)" }}>
        Loading workflow…
      </div>
    );
  }

  return (
    <div style={{
      background: INK, color: TEXT, height: "100vh", width: "100vw",
      display: "grid", gridTemplateRows: "56px 1fr",
      fontFamily: "var(--sans)", overflow: "hidden",
    }}>
      {/* ── Top bar ── */}
      <header style={{ display: "flex", alignItems: "center", padding: "0 18px", gap: 14, borderBottom: `1px solid ${LINE}` }}>
        <button
          onClick={() => router.push("/dashboard")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: TEXT2, cursor: "pointer", fontSize: 13, padding: "6px 8px" }}
        >
          <ArrowLeft size={14} /> Dashboard
        </button>
        <span style={{ color: MID, fontSize: 12 }}>/</span>
        <span style={{ fontSize: 14, fontWeight: 500, color: TEXT, letterSpacing: "-0.005em" }}>{workflow.name}</span>
        <span style={{ fontSize: 11.5, color: TEXT2, fontStyle: "italic", fontFamily: "var(--serif)" }}>
          &ldquo;{workflow.prompt.slice(0, 56)}{workflow.prompt.length > 56 ? "…" : ""}&rdquo;
        </span>

        <div style={{ flex: 1 }} />

        {/* Permission + budget */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: MID, letterSpacing: "0.04em" }}>
          <span style={{ color: workflow.permissionStatus === "active" ? ACCENT : MID }}>
            ● {workflow.permissionStatus}
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {workflow.totalSpentUsdc.toFixed(3)} / {workflow.budgetUsdc} USDC
          </span>
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", background: INK_1, borderRadius: 7, padding: 2, border: `1px solid ${LINE}` }}>
          {([
            ["canvas",   LayoutTemplate, 11],
            ["timeline", Zap,            11],
            ["history",  Clock,          11],
          ] as const).map(([t, Icon, sz]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "5px 11px", borderRadius: 5,
                background: tab === t ? "rgba(244,241,234,0.06)" : "transparent",
                border: "none", color: tab === t ? TEXT : MID,
                fontSize: 11.5, cursor: "pointer", letterSpacing: "-0.005em",
                display: "inline-flex", alignItems: "center", gap: 5,
                textTransform: "capitalize",
              }}
            >
              <Icon size={sz} /> {t}
              {t === "timeline" && isLiveRunning && (
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: SCOUT_CLR }} />
              )}
            </button>
          ))}
        </div>

        {/* Done / reset button when run completes */}
        {(live.phase === "complete" || live.phase === "failed") && (
          <button
            onClick={resetLive}
            style={{
              padding: "6px 12px", borderRadius: 7,
              background: "transparent", border: `1px solid ${LINE_MID}`,
              color: TEXT2, fontSize: 11.5, cursor: "pointer",
            }}
          >
            Reset
          </button>
        )}

        {/* Fund Manager allocation — dynamic budget split */}
        {canAllocate && (
          <button
            onClick={runAllocation}
            disabled={allocating}
            title="Fund Manager reads live yields and splits the budget into on-chain-capped slices per protocol"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 7,
              background: "rgba(139,107,255,0.12)", border: "1px solid rgba(139,107,255,0.4)",
              color: "#B9A8FF", fontWeight: 600, fontSize: 12,
              cursor: allocating ? "not-allowed" : "pointer", opacity: allocating ? 0.6 : 1,
            }}
          >
            ⚖️ {allocating ? "Allocating…" : "Allocate budget"}
          </button>
        )}

        {/* Run button */}
        {isOrchestrated ? (
          <button
            onClick={runOrchestrated}
            disabled={!canRun}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "6px 14px", borderRadius: 7,
              background: ACCENT, color: INK, border: "none",
              fontWeight: 700, fontSize: 12,
              cursor: canRun ? "pointer" : "not-allowed",
              opacity: canRun ? 1 : 0.55,
            }}
          >
            <Zap size={11} fill={INK} stroke="none" />
            {isLiveRunning ? "Running A2A…" : "Run Orchestrated"}
          </button>
        ) : (
          <button
            onClick={runSingle}
            disabled={!canRun}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "6px 14px", borderRadius: 7,
              background: ACCENT, color: INK, border: "none",
              fontWeight: 600, fontSize: 12.5,
              cursor: canRun ? "pointer" : "not-allowed",
              opacity: canRun ? 1 : 0.55,
            }}
          >
            <Play size={10} fill={INK} stroke="none" />
            {running ? "Running…" : "Run workflow"}
          </button>
        )}
      </header>

      {/* ── Body ── */}
      {tab === "canvas" && (
        <section style={{ position: "relative", overflow: "hidden" }}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            nodeTypes={NODE_TYPES}
            minZoom={0.3} maxZoom={2}
            proOptions={{ hideAttribution: true }}
            style={{ background: "transparent" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(244,241,234,0.06)" />
            <FitViewOnLoad nodeCount={nodes.length} />
          </ReactFlow>
          {agents.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: MID, fontSize: 13, fontStyle: "italic" }}>
              No agents in this workflow yet.
            </div>
          )}

          {/* Fund Manager allocation result — the dynamic-split decision */}
          {allocResult && (
            <div style={{
              position: "absolute", top: 16, right: 16, width: 320, zIndex: 20,
              background: INK_1, border: "1px solid rgba(139,107,255,0.4)", borderRadius: 12,
              padding: 16, boxShadow: "0 12px 40px -12px rgba(0,0,0,0.7)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#B9A8FF", fontWeight: 700 }}>⚖️ Fund Manager allocation</span>
                <button onClick={() => setAllocResult(null)} style={{ background: "none", border: "none", color: MID, cursor: "pointer", fontSize: 14 }}>×</button>
              </div>
              {allocResult.error ? (
                <div style={{ fontSize: 12.5, color: "#FF8A66" }}>{allocResult.error}</div>
              ) : (
                <>
                  <p style={{ fontSize: 12.5, lineHeight: 1.5, color: TEXT, margin: "0 0 12px" }}>{allocResult.reasoning}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(allocResult.allocations ?? []).map((a) => (
                      <div key={a.name}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: TEXT2, marginBottom: 3 }}>
                          <span style={{ textTransform: "capitalize" }}>{a.protocol}</span>
                          <span style={{ color: "#B9A8FF", fontWeight: 600 }}>{Math.round(a.weight * 100)}% · {a.capUsdc} USDC cap</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                          <div style={{ width: `${a.weight * 100}%`, height: "100%", background: "#8B6BFF" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10.5, color: MID, marginTop: 10 }}>
                    {allocResult.source === "venice" ? "Decided by Venice from live yields" : "Equal split (fallback)"} · each % is now an on-chain cap
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {tab === "timeline" && (
        <section style={{ overflowY: "auto", padding: "28px 40px", maxWidth: 720, width: "100%" }}>
          <AgentConversationTimeline live={live} history={handoffs} agents={agents} />
        </section>
      )}

      {tab === "history" && (
        <section style={{ overflowY: "auto", padding: "28px 40px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: MID, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 16 }}>
            <Clock size={11} /> Run history · {runs.length} run{runs.length !== 1 ? "s" : ""}
          </div>
          {runs.length === 0 ? (
            <div style={{ fontSize: 13, color: MID, fontStyle: "italic" }}>
              No runs yet. Click <span style={{ color: ACCENT }}>Run Orchestrated</span> to execute now, or set a schedule on the Executor agent.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {runs.map(r => (
                <div key={r.runId} style={{
                  padding: "14px 16px", borderRadius: 9,
                  background: INK_1, border: `1px solid ${LINE}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: r.success ? ACCENT : "#FF8A66" }} />
                      <span style={{ fontSize: 12.5, color: TEXT, fontWeight: 500 }}>{r.action.toUpperCase()}</span>
                      <span style={{ fontSize: 11, color: MID }}>·</span>
                      <span style={{ fontSize: 11, color: TEXT2 }}>{r.agentName}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: MID, fontVariantNumeric: "tabular-nums" }}>
                      {new Date(r.startedAt).toLocaleString()}
                    </div>
                  </div>
                  {r.insight && (
                    <div style={{ fontSize: 11.5, color: TEXT2, lineHeight: 1.5, marginTop: 6, fontFamily: "var(--serif)", fontStyle: "italic" }}>
                      {r.insight.slice(0, 200)}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 14, fontSize: 10, color: MID, marginTop: 8 }}>
                    <span>cost: {r.costPaid.toFixed(4)} USDC</span>
                    {r.txHash && (
                      <a href={`https://basescan.org/tx/${r.txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: ACCENT, textDecoration: "underline" }}>
                        tx {r.txHash.slice(0, 10)}… ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.45; transform: scale(1.35); }
        }
      `}</style>
    </div>
  );
}
