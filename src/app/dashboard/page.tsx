"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus, LayoutDashboard, Workflow as WorkflowIcon, BarChart2,
  DollarSign, BookUser, Sparkles, Shield, ChevronDown, X, Clock,
} from "lucide-react";
import { metamaskStore } from "@/lib/web3/metamaskStore";
import type { MediaPolicy } from "@/lib/agent/agents";

// ─────────────────────────────────────────────────────────────────────────────
//  Design tokens
// ─────────────────────────────────────────────────────────────────────────────

const INK       = "#0B0C09";
const INK_1     = "#111210";
const ACCENT    = "#C8FF3D";
const TEXT      = "#E8E5DA";
const TEXT2     = "#B5B2A5";
const MID       = "#6B6A60";
const MID_2     = "#908E81";
const LINE      = "rgba(244,241,234,0.06)";
const LINE_MID  = "rgba(244,241,234,0.11)";
const ACCENT_SOFT = "rgba(200,255,61,0.18)";
const ACCENT_GLOW = "rgba(200,255,61,0.35)";

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

interface Agent {
  id:                    string;
  name:                  string;
  goal:                  string;
  status:                "idle" | "planning" | "executing" | "reflecting";
  budgetUsdc:            string;
  budgetUsedUsdc?:       string;
  lastAction:            "hold" | "deposit" | "rebalance" | "withdraw" | "skip" | null;
  totalRuns:             number;
  position?:             { x: number; y: number };
  parentAgentId?:        string | null;
  delegationStatus?:     "active" | "revoked" | "pending" | "none";
  delegationCap?:        string;
  delegationContext?:    string | null;
  delegationHash?:       string | null;
  delegationManagerAddress?: string | null;
  scheduleIntervalMs?:   number;
  lastRunAt?:            string | null;
  x402SpentUsdc?:        number;
  thoughts?:             Array<{ step: string; content: string; ts?: string; txHash?: string; cost?: number }>;
}

/** Human-readable schedule label from ms */
function scheduleLabel(ms?: number): string | null {
  if (!ms) return null;
  const h = ms / (60 * 60 * 1000);
  if (h < 1)  return "manual";
  if (h <= 1) return "hourly";
  if (h <= 6) return "6h";
  if (h <= 24) return "daily";
  if (h <= 168) return "weekly";
  return `${Math.round(h)}h`;
}

interface SecurityFinding {
  severity: "critical" | "high" | "medium" | "info";
  agentName: string;
  issue: string;
  fix: string;
}

interface Question {
  id: string;
  label: string;
  hint?: string;
  type: "single" | "multi" | "slider" | "text";
  options?: string[];
  min?: number; max?: number; step?: number; defaultVal?: number; unit?: string;
}

interface Questionnaire {
  summary: string;
  questions: Question[];
  originalPrompt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function detectProtocols(goal: string): string[] {
  const lower = goal.toLowerCase();
  const tags: string[] = [];
  if (lower.includes("morpho"))    tags.push("Morpho");
  if (lower.includes("aave"))      tags.push("Aave");
  if (lower.includes("uniswap"))   tags.push("Uniswap");
  if (lower.includes("aerodrome")) tags.push("Aerodrome");
  if (lower.includes("lido"))      tags.push("Lido");
  if (lower.includes("sky") || lower.includes("dai") || lower.includes("susds")) tags.push("Sky");
  if (lower.includes("compound"))  tags.push("Compound");
  if (lower.includes("usdc") || lower.includes("base")) tags.push("Base");
  return tags.slice(0, 3);
}

const PROTOCOL_DOT_COLORS: Record<string, string> = {
  Morpho:    "#3B5BFF",
  Aave:      "#B6509E",
  Uniswap:   "#FF007A",
  Aerodrome: "#0F62FE",
  Lido:      "#00A3FF",
  Sky:       "#4A90D9",
  Compound:  "#00D395",
  Base:      "#0052FF",
};

function lastActionColor(la: Agent["lastAction"]): string {
  if (!la || la === "skip") return MID;
  if (la === "hold") return MID_2;
  return ACCENT;
}

function hasRealDelegation(a: Agent): boolean {
  return (
    a.delegationStatus === "active" &&
    !!a.delegationContext &&
    a.delegationContext !== "0xdemo" &&
    a.delegationContext.length > 20 &&
    !a.delegationHash?.includes("demo")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fix 1: FitViewOnLoad
// ─────────────────────────────────────────────────────────────────────────────

function FitViewOnLoad({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (nodeCount > 0) {
      setTimeout(() => fitView({ padding: 0.4, duration: 400 }), 80);
    }
  }, [nodeCount, fitView]);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  AgentNode
// ─────────────────────────────────────────────────────────────────────────────

function AgentNode({
  data,
  selected,
}: {
  data: Agent & { onSelect: () => void; onOpen: () => void; onDelegate: () => void; onDelete: () => void; onSchedule: () => void };
  selected?: boolean;
}) {
  const status  = data.status;
  const isLive  = status === "planning" || status === "executing" || status === "reflecting";
  const border  = selected ? ACCENT : isLive ? "rgba(200,255,61,0.4)" : LINE_MID;
  const shadow  = selected
    ? `0 0 0 1px ${ACCENT}, 0 12px 28px -16px ${ACCENT_GLOW}`
    : isLive
    ? `0 0 0 1px rgba(200,255,61,0.25), 0 8px 18px -10px ${ACCENT_GLOW}`
    : "none";

  const protocols = detectProtocols(data.goal);
  const isReal    = hasRealDelegation(data);

  return (
    <div
      onClick={() => data.onSelect()}
      onDoubleClick={() => data.onOpen()}
      style={{
        width: 252,
        background: INK_1,
        border: `1px solid ${border}`,
        borderRadius: 12,
        padding: "14px 16px",
        color: TEXT,
        boxShadow: shadow,
        cursor: "pointer",
        transition: "border-color .15s, box-shadow .15s",
        fontFamily: "var(--sans)",
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ width: 6, height: 6, background: border, left: -3 }} />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-flex", width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 5, background: "rgba(200,255,61,0.10)", border: "1px solid rgba(200,255,61,0.2)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24">
              <circle cx="8"  cy="8"  r="3.5" fill={ACCENT} />
              <circle cx="16" cy="8"  r="3.5" fill={ACCENT} opacity="0.85" />
              <circle cx="8"  cy="16" r="3.5" fill={ACCENT} opacity="0.85" />
              <circle cx="16" cy="16" r="3.5" fill={ACCENT} opacity="0.7" />
            </svg>
          </span>
          <span style={{ fontSize: 9.5, color: MID, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            AI Agent
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, color: isLive ? ACCENT : MID, letterSpacing: "0.06em", textTransform: "lowercase" }}>
          <span style={{
            width: 5, height: 5, borderRadius: "50%",
            background: isLive ? ACCENT : MID,
            boxShadow: isLive ? `0 0 0 3px ${ACCENT_SOFT}` : "none",
          }} />
          {status}
        </div>
      </div>

      {/* Agent name */}
      <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, letterSpacing: "-0.015em", lineHeight: 1.2 }}>
        {data.name}
      </div>

      {/* Goal excerpt */}
      <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 6, lineHeight: 1.4, fontStyle: "italic", fontFamily: "var(--serif)" }}>
        &ldquo;{data.goal.slice(0, 72)}{data.goal.length > 72 ? "…" : ""}&rdquo;
      </div>

      {/* Protocol badges */}
      {protocols.length > 0 && (
        <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
          {protocols.map(p => (
            <span key={p} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 7px", borderRadius: 4,
              background: "rgba(244,241,234,0.05)",
              border: `1px solid ${PROTOCOL_DOT_COLORS[p] ?? MID}33`,
              fontSize: 9.5, color: TEXT2, letterSpacing: "0.04em", textTransform: "lowercase",
            }}>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: PROTOCOL_DOT_COLORS[p] ?? MID }} />
              {p.toLowerCase()}
            </span>
          ))}
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 7px", borderRadius: 4,
            background: "rgba(200,255,61,0.06)",
            border: "1px solid rgba(200,255,61,0.18)",
            fontSize: 9.5, color: ACCENT, letterSpacing: "0.04em", textTransform: "lowercase",
          }}>
            <span style={{ fontSize: 8 }}>x402</span> · venice
          </span>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 9, borderTop: `1px solid ${LINE}`, fontSize: 9.5, color: MID, letterSpacing: "0.04em", textTransform: "lowercase", fontVariantNumeric: "tabular-nums" }}>
        <span>{data.totalRuns} run{data.totalRuns !== 1 ? "s" : ""}</span>
        <span>{data.budgetUsdc} USDC</span>
        <span style={{ color: lastActionColor(data.lastAction) }}>{data.lastAction ?? "—"}</span>
      </div>

      {/* UX-3: Budget consumption bar */}
      {data.budgetUsedUsdc !== undefined && parseFloat(data.budgetUsdc) > 0 && (() => {
        const pct = Math.min(100, (parseFloat(String(data.budgetUsedUsdc ?? 0)) / parseFloat(data.budgetUsdc)) * 100);
        const barColor = pct > 90 ? "#FF8A66" : pct > 70 ? "#FFD166" : ACCENT;
        return (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ height: 2, background: LINE_MID, borderRadius: 1, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 1, transition: "width .4s" }} />
            </div>
            <div style={{ fontSize: 8.5, color: MID, fontVariantNumeric: "tabular-nums" }}>
              {parseFloat(String(data.budgetUsedUsdc ?? 0)).toFixed(3)} / {data.budgetUsdc} USDC used ({pct.toFixed(0)}%)
            </div>
          </div>
        );
      })()}

      {/* Schedule chip — clickable, opens schedule picker */}
      <div
        onClick={(e) => { e.stopPropagation(); data.onSchedule(); }}
        style={{
          marginTop: 5, display: "flex", alignItems: "center", gap: 5,
          fontSize: 9.5, letterSpacing: "0.04em", cursor: "pointer",
          color: scheduleLabel(data.scheduleIntervalMs) ? ACCENT : MID,
        }}
        title="Set agent schedule"
      >
        {scheduleLabel(data.scheduleIntervalMs) ? (
          <>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: ACCENT, boxShadow: `0 0 0 2px ${ACCENT_SOFT}` }} />
            autonomous · {scheduleLabel(data.scheduleIntervalMs)} · edit
          </>
        ) : (
          <>
            <Clock size={9} /> set schedule →
          </>
        )}
      </div>

      {/* UX-2 + UX-8: Delegation badge with pending/demo distinction + action CTA */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 5, fontSize: 9.5, color: MID, letterSpacing: "0.04em", textTransform: "lowercase" }}>
        <span>
          {data.delegationStatus === "active" && isReal && (
            <span style={{ color: ACCENT }}>● real on-chain{data.delegationCap ? ` · ${data.delegationCap}` : ""}</span>
          )}
          {data.delegationStatus === "active" && !isReal && (
            <button
              onClick={(e) => { e.stopPropagation(); data.onDelegate(); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: TEXT2, fontSize: 9.5, padding: 0, letterSpacing: "0.04em" }}
              title="No real permission — click to grant ERC-7715 permission"
            >
              ● needs permission · grant to run →
            </button>
          )}
          {data.delegationStatus === "pending" && (
            <button
              onClick={(e) => { e.stopPropagation(); data.onDelegate(); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "#FFD166", fontSize: 9.5, padding: 0, letterSpacing: "0.04em" }}
              title="Sub-delegation pending — click to re-grant permission"
            >
              ● pending · re-grant →
            </button>
          )}
          {data.delegationStatus === "revoked" && <span style={{ color: MID }}>● revoked</span>}
          {(!data.delegationStatus || data.delegationStatus === "none") && (
            <button
              onClick={(e) => { e.stopPropagation(); data.onDelegate(); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: MID, fontSize: 9.5, padding: 0, letterSpacing: "0.04em" }}
            >
              no permission · grant →
            </button>
          )}
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={(e) => { e.stopPropagation(); data.onDelegate(); }}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: TEXT2, fontSize: 9.5, letterSpacing: "0.04em", textTransform: "lowercase", padding: 0 }}
          >
            delegate →
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); data.onOpen(); }}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: ACCENT, fontSize: 9.5, letterSpacing: "0.04em", textTransform: "lowercase", padding: 0 }}
          >
            open →
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); data.onDelete(); }}
            title="Delete agent"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "rgba(255,69,69,0.5)", fontSize: 11, padding: 0,
              lineHeight: 1, transition: "color .15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#FF4545"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,69,69,0.5)"; }}
          >
            ✕
          </button>
        </div>
      </div>

      <Handle type="source" position={Position.Right} style={{ width: 6, height: 6, background: border, right: -3 }} />
    </div>
  );
}

// NODE_TYPES must be defined outside component for performance
const NODE_TYPES: NodeTypes = { agent: AgentNode };

// ─────────────────────────────────────────────────────────────────────────────
//  Fix 4: Security scanner
// ─────────────────────────────────────────────────────────────────────────────

async function runSecurityScanAsync(agents: Agent[]): Promise<SecurityFinding[]> {
  // Check Telegram config server-side (env var is not visible to client)
  let telegramConfigured = false;
  try {
    const r = await fetch("/api/notify/telegram/status");
    if (r.ok) telegramConfigured = ((await r.json()) as { configured: boolean }).configured;
  } catch { /* non-fatal */ }

  return runSecurityScan(agents, telegramConfigured);
}

function runSecurityScan(agents: Agent[], telegramConfigured = false): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Build id->agent map for chain walking
  const byId = new Map<string, Agent>(agents.map(a => [a.id, a]));

  for (const a of agents) {
    // 1. Demo delegation
    if (a.delegationStatus !== "active" || a.delegationHash?.includes("demo")) {
      findings.push({
        severity: "medium",
        agentName: a.name,
        issue: "Agent runs in demo mode — no real on-chain delegation.",
        fix: "Grant ERC-7715 permission via MetaMask on this agent.",
      });
    }

    // 2. Root agent with no delegation context
    if (!a.parentAgentId && !a.delegationContext) {
      findings.push({
        severity: "high",
        agentName: a.name,
        issue: "Root agent has no permission context. Cannot execute real transactions.",
        fix: "Open the agent, click 'Grant ERC-7715 permission', approve in MetaMask.",
      });
    }

    // 3. Over-budget cap
    if (a.delegationCap) {
      const cap    = parseFloat(a.delegationCap);
      const budget = parseFloat(a.budgetUsdc);
      if (!isNaN(cap) && !isNaN(budget) && cap > budget * 1.1) {
        findings.push({
          severity: "critical",
          agentName: a.name,
          issue: `Delegation cap (${a.delegationCap} USDC) exceeds agent budget by >10%.`,
          fix: "Lower the delegation cap to match or be below the agent budget.",
        });
      }
    }

    // 4. Revoked delegation
    if (a.delegationStatus === "revoked") {
      findings.push({
        severity: "info",
        agentName: a.name,
        issue: "Agent delegation was revoked. It cannot execute until re-delegated.",
        fix: "Re-grant ERC-7715 permission or remove this agent.",
      });
    }

    // 5. Deep delegation chain
    let depth = 0;
    let cur = a;
    const visited = new Set<string>();
    while (cur.parentAgentId && !visited.has(cur.id)) {
      visited.add(cur.id);
      depth++;
      const parent = byId.get(cur.parentAgentId);
      if (!parent) break;
      cur = parent;
    }
    if (depth > 3) {
      findings.push({
        severity: "medium",
        agentName: a.name,
        issue: `Delegation chain depth ${depth}. Each hop reduces ERC-7710 redemption reliability.`,
        fix: "Flatten the delegation hierarchy to 3 levels or fewer.",
      });
    }

    // 6. Budget >90% used
    if (a.budgetUsedUsdc && a.budgetUsdc) {
      const used   = parseFloat(a.budgetUsedUsdc);
      const budget = parseFloat(a.budgetUsdc);
      if (!isNaN(used) && !isNaN(budget) && budget > 0 && used / budget > 0.9) {
        findings.push({
          severity: "high",
          agentName: a.name,
          issue: `Budget ${Math.round((used / budget) * 100)}% utilized. Agent may fail on next execution attempt.`,
          fix: "Top up the agent's USDC budget or reduce its cap.",
        });
      }
    }
  }

  // 7. Telegram — only warn if NOT configured
  if (!telegramConfigured) {
    findings.push({
      severity: "high",
      agentName: "Global",
      issue: "TELEGRAM_BOT_TOKEN not set — agents cannot send reports.",
      fix: "Add TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to your .env.local and restart.",
    });
  }

  return findings;
}

const SEVERITY_COLOR: Record<SecurityFinding["severity"], string> = {
  critical: "#FF4545",
  high:     "#FF8A66",
  medium:   "#FFD166",
  info:     MID,
};

// ─────────────────────────────────────────────────────────────────────────────
//  Dashboard page
// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();

  const [agents,       setAgents]       = useState<Agent[]>([]);
  const [nodes,        setNodes,        onNodesChange] = useNodesState<Node>([]);
  const [edges,        setEdges,        onEdgesChange] = useEdgesState<Edge>([]);
  const [creating,     setCreating]     = useState(false);
  const [delegateFrom, setDelegateFrom] = useState<Agent | null>(null);
  const [mmTick,       setMmTick]       = useState(0);

  // Fix 3C: selected agent for right drawer
  const [selectedAgentId,    setSelectedAgentId]    = useState<string | null>(null);
  const [selectedAgentData,  setSelectedAgentData]  = useState<Agent | null>(null);
  const [drawerOpen,         setDrawerOpen]         = useState(false);

  // Fix 4: security scanner
  const [scanFindings,  setScanFindings]  = useState<SecurityFinding[] | null>(null);
  const [scanOpen,      setScanOpen]      = useState(false);
  const [scanning,      setScanning]      = useState(false);

  // Fix 3A: floating prompt bar
  const [nlPrompt,     setNlPrompt]     = useState("");
  const [nlSubmitting, setNlSubmitting] = useState(false);

  // Questionnaire state
  const [questionnaire,    setQuestionnaire]    = useState<Questionnaire | null>(null);
  const [answers,          setAnswers]          = useState<Record<string, unknown>>({});
  const [qSubmitting,      setQSubmitting]      = useState(false);

  const [permGrantOpen,          setPermGrantOpen]          = useState(false);
  // UX-5: after agent creation, if no real permission exists → auto-open Step 3
  const [postCreatePermOpen,     setPostCreatePermOpen]     = useState(false);
  const [postCreateAgentCount,   setPostCreateAgentCount]   = useState(0);

  // Schedule modal — opened from agent card clock chip
  const [scheduleAgent,    setScheduleAgent]    = useState<Agent | null>(null);

  // New Workflow modal — the primary creation flow
  const [newWorkflowOpen,  setNewWorkflowOpen]  = useState(false);

  // UX-1: In-UI toast system — replaces all alert()/confirm() calls
  const [toasts, setToasts] = useState<Array<{ id: string; msg: string; type: "success"|"error"|"info" }>>([]);
  const toast = useCallback((msg: string, type: "success"|"error"|"info" = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  // UX-1: Confirm dialog state (replaces browser confirm())
  const [confirmState, setConfirmState] = useState<{ msg: string; onOk: () => void } | null>(null);

  // Subscribe to metamask store changes
  useEffect(() => {
    const unsub = metamaskStore.addListener(() => setMmTick(x => x + 1));
    return () => unsub();
  }, []);

const loadAgents = useCallback(async () => {
    const wallet = metamaskStore.getState().userAddress;
    if (!wallet) {
      setAgents([]);
      setNodes([]);
      return;
    }
    try {
      const res = await fetch(`/api/agent?wallet=${encodeURIComponent(wallet)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { agents: Agent[] };
      setAgents(data.agents);
    } catch { /* ignore */ }
  }, [setNodes]);

  // Reload agents whenever wallet connects/disconnects
  useEffect(() => { loadAgents(); }, [loadAgents, mmTick]);

  // Load selected agent's detail (thoughts) — map DB AgentThought[] → display format
  useEffect(() => {
    if (!selectedAgentId) { setSelectedAgentData(null); return; }
    const found = agents.find(a => a.id === selectedAgentId);
    if (found) setSelectedAgentData(found);
    fetch(`/api/agent/${selectedAgentId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.agent) return;
        const rawThoughts = (d.thoughts ?? []) as Array<{
          type: string; content: Record<string, unknown>; createdAt?: string;
        }>;
        // UX-4 fix: extract txHash + cost from raw content so drawer can show
        // Basescan links and per-run x402 cost without a separate API call.
        const thoughts = rawThoughts.slice(-8).reverse().map(t => ({
          step:    t.type,
          content: typeof t.content?.text === "string"    ? t.content.text
                 : typeof t.content?.insight === "string" ? t.content.insight
                 : typeof t.content?.tool === "string"    ? `${t.content.tool}()`
                 : typeof t.content?.description === "string" ? t.content.description
                 : JSON.stringify(t.content).slice(0, 180),
          ts:      t.createdAt,
          txHash:  typeof t.content?.txHash === "string" ? t.content.txHash : undefined,
          cost:    typeof t.content?.cost   === "number" ? t.content.cost   : undefined,
        }));
        setSelectedAgentData({ ...(d.agent as Agent), thoughts });
      })
      .catch(() => {});
  }, [selectedAgentId, agents]);

  // Build canvas nodes from agents
  useEffect(() => {
    setNodes(agents.map((a, i) => ({
      id:       a.id,
      type:     "agent",
      position: a.position ?? { x: 80 + (i % 3) * 320, y: 80 + Math.floor(i / 3) * 220 },
      data: {
        ...a,
        onSelect:   () => { setSelectedAgentId(a.id); setDrawerOpen(true); },
        onOpen:     () => router.push(`/dashboard/agent/${a.id}`),
        onDelegate: () => openDelegate(a),
        onDelete:   () => deleteAgent(a.id, a.name),
        onSchedule: () => setScheduleAgent(a),
      },
    })));

    // Build delegation edges
    const newEdges: Edge[] = [];
    for (const a of agents) {
      if (a.parentAgentId) {
        const isActive = a.delegationStatus === "active";
        newEdges.push({
          id:     `del_${a.parentAgentId}_${a.id}`,
          source: a.parentAgentId,
          target: a.id,
          type:   "smoothstep",
          animated: isActive,
          label: a.delegationCap ? `${a.delegationCap} USDC` : undefined,
          labelStyle: { fill: TEXT2, fontSize: 10, letterSpacing: "0.04em" },
          labelBgStyle: { fill: INK_1, fillOpacity: 0.9 },
          labelBgPadding: [6, 4] as [number, number],
          labelBgBorderRadius: 4,
          style: isActive
            ? { stroke: ACCENT, strokeWidth: 1.25, strokeDasharray: "3 7" }
            : { stroke: "rgba(244,241,234,0.16)", strokeWidth: 1, strokeDasharray: "2 4" },
        });
      }
    }
    setEdges(newEdges);
  }, [agents, router, setNodes, setEdges]);

  // Fix 2: open delegate modal — bind user permission first if needed
  const openDelegate = useCallback(async (parent: Agent) => {
    const mmState = metamaskStore.getState();
    const perm    = mmState.permission;

    // If parent has no real delegation, try binding the user's MetaMask permission first
    if (!hasRealDelegation(parent) && perm && perm.permissionsContext) {
      try {
        await fetch(`/api/agent/${parent.id}/delegate-from-user`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            permissionsContext:        perm.permissionsContext,
            delegationManagerAddress:  perm.delegationManager,
            delegationHash:            "0xpending",
            capUsdc:                   parent.budgetUsdc,
          }),
        });
        await loadAgents();
        // Re-fetch the parent with updated delegation
        const updatedRes  = await fetch(`/api/agent/${parent.id}`);
        const updatedJson = updatedRes.ok ? await updatedRes.json() : null;
        const updatedParent: Agent = updatedJson?.agent ?? parent;
        setDelegateFrom(updatedParent);
      } catch {
        setDelegateFrom(parent);
      }
    } else {
      setDelegateFrom(parent);
    }
  }, [loadAgents]);

  // Delete an agent — with in-UI confirm dialog (UX-1)
  const deleteAgent = useCallback(async (id: string, name: string) => {
    setConfirmState({
      msg: `Delete "${name}"? This removes the agent and all its thoughts.`,
      onOk: async () => {
        setConfirmState(null);
        try {
          const wallet = metamaskStore.getState().userAddress ?? "";
          await fetch(`/api/agent/${id}?wallet=${encodeURIComponent(wallet)}`, { method: "DELETE" });
          if (selectedAgentId === id) { setSelectedAgentId(null); setDrawerOpen(false); }
          await loadAgents();
          toast(`Deleted "${name}"`, "success");
        } catch (e) {
          toast("Delete failed: " + (e instanceof Error ? e.message : String(e)), "error");
        }
      },
    });
  }, [loadAgents, selectedAgentId, toast]);

  /**
   * After granting ERC-7715 permission, auto-bind it to every agent that has
   * delegationStatus "pending" or "none" — so users never need to manually
   * delegate to each agent one by one.
   *
   * This is the missing link between "Grant permission" and "agents go live":
   * previously onGranted just called loadAgents() leaving all agents as "pending".
   */
  const bindPermissionToPendingAgents = useCallback(async () => {
    const perm = metamaskStore.getState().permission;
    if (!perm?.permissionsContext) return;

    // Always use the latest agents list (caller may have just created new ones)
    const wallet = metamaskStore.getState().userAddress;
    let latestAgents = agents;
    if (wallet) {
      try {
        const r = await fetch(`/api/agent?wallet=${encodeURIComponent(wallet)}`);
        if (r.ok) {
          const d = await r.json() as { agents: typeof agents };
          latestAgents = d.agents;
        }
      } catch { /* use existing agents list */ }
    }

    const pendingAgents = latestAgents.filter(
      a => a.delegationStatus === "pending" || a.delegationStatus === "none" || !a.delegationStatus
    );
    if (pendingAgents.length === 0) return;

    let bound = 0;
    for (const a of pendingAgents) {
      try {
        const res = await fetch(`/api/agent/${a.id}/delegate-from-user`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            permissionsContext:        perm.permissionsContext,
            delegationManagerAddress:  perm.delegationManager ?? "0x",
            delegationHash:            "0xpending",
            capUsdc:                   a.budgetUsdc,
          }),
        });
        if (res.ok) bound++;
      } catch { /* non-fatal per agent */ }
    }
    if (bound > 0) {
      await loadAgents();
      toast(`${bound} agent${bound > 1 ? "s are" : " is"} now live with real permission ✓`, "success");
    }
  }, [agents, loadAgents, toast]);

  // Fix 4: run scan (async — checks Telegram status server-side)
  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const findings = await runSecurityScanAsync(agents);
      setScanFindings(findings);
      setScanOpen(true);
    } finally {
      setScanning(false);
    }
  }, [agents]);

  // Fix: NL prompt now opens questionnaire first (Claude Design style)
  const submitNlPrompt = useCallback(async () => {
    const wallet = metamaskStore.getState().userAddress;
    if (!wallet || !nlPrompt.trim()) return;
    setNlSubmitting(true);
    try {
      const res = await fetch("/api/agent/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: nlPrompt.trim() }),
      });
      if (!res.ok) throw new Error("Questions API failed");
      const data = await res.json() as { summary: string; questions: Question[] };
      // Pre-fill slider defaults
      const defaultAnswers: Record<string, unknown> = {};
      for (const q of data.questions) {
        if (q.type === "slider") defaultAnswers[q.id] = q.defaultVal ?? q.min ?? 10;
      }
      setAnswers(defaultAnswers);
      setQuestionnaire({ ...data, originalPrompt: nlPrompt.trim() });
      setNlPrompt("");
    } catch {
      // Fallback: create agent directly
      const wallet2 = metamaskStore.getState().userAddress;
      if (wallet2) {
        await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: wallet2, name: "Strategy Agent", goal: nlPrompt.trim(), budgetUsdc: "10" }),
        });
        await loadAgents();
        setNlPrompt("");
      }
    } finally {
      setNlSubmitting(false);
    }
  }, [nlPrompt, loadAgents]);

  // Submit questionnaire answers → create agent(s) + auto-wire
  const submitQuestionnaire = useCallback(async () => {
    if (!questionnaire) return;
    const wallet = metamaskStore.getState().userAddress;
    if (!wallet) return;
    setQSubmitting(true);
    try {
      const mm = metamaskStore.getState();
      const res = await fetch("/api/agent/from-answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:             questionnaire.originalPrompt,
          walletAddress:      wallet,
          answers,
          permissionsContext: mm.permission?.permissionsContext,
          delegationManager:  mm.permission?.delegationManager,
        }),
      });
      if (!res.ok) throw new Error("from-answers failed");
      const data = await res.json() as { agents: unknown[]; wired: boolean; chain?: string };
      setQuestionnaire(null);
      setAnswers({});
      await loadAgents();

      const agentCount = (data.agents as unknown[]).length;

      // UX-5: check if user has a real permission AFTER creation.
      // If not → automatically open Step 3 "Grant permission" so users don't
      // land on a canvas full of "● demo" with no explanation.
      const freshPerm = metamaskStore.getState().permission;
      const hasFreshRealPerm = !!(
        freshPerm?.permissionsContext &&
        freshPerm.permissionsContext.length > 40 &&
        !freshPerm.permissionsContext.includes("demo") &&
        freshPerm.permissionsContext.startsWith("0x")
      );

      if (!hasFreshRealPerm) {
        setPostCreateAgentCount(agentCount);
        setPostCreatePermOpen(true);   // triggers Step 3 modal
      } else {
        // Permission exists — auto-bind to any newly created pending agents right now.
        // This runs silently in the background so the user never has to open Scan.
        await bindPermissionToPendingAgents();
        if (data.wired && data.chain) {
          toast(`Team live: ${data.chain} ✓`, "success");
        } else {
          toast("Agent created and activated ✓", "success");
        }
      }
    } catch (e) {
      toast("Failed to create agent: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setQSubmitting(false);
    }
  }, [questionnaire, answers, loadAgents]);

  const savedPerm = metamaskStore.getState().permission;
  const hasRealPermission = !!(
    savedPerm?.permissionsContext &&
    savedPerm.permissionsContext.length > 40 &&
    !savedPerm.permissionsContext.includes("demo") &&
    savedPerm.permissionsContext.startsWith("0x")
  );
  const hasPermission = hasRealPermission;

  // IMP-3: Permission expiry countdown
  const permExpiresAt = savedPerm?.expiresAt ?? null;
  const permDaysLeft  = permExpiresAt
    ? Math.max(0, Math.floor((permExpiresAt - Date.now() / 1000) / 86400))
    : null;
  const permExpirySoon = permDaysLeft !== null && permDaysLeft < 14;

  // Scan badge counts
  const critHighCount = scanFindings
    ? scanFindings.filter(f => f.severity === "critical" || f.severity === "high").length
    : 0;

  return (
    <div
      style={{
        background: INK,
        color: TEXT,
        height: "100vh",
        width: "100vw",
        display: "grid",
        gridTemplateColumns: "232px 1fr",
        gridTemplateRows: "48px 1fr",
        gridTemplateAreas: `"side top" "side canvas"`,
        overflow: "hidden",
        fontFamily: "var(--sans)",
      }}
    >
      {/* ── Sidebar ── */}
      <aside style={{ gridArea: "side", borderRight: `1px solid ${LINE}`, padding: "18px 14px", display: "flex", flexDirection: "column", gap: 24 }}>
        <Brand />

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            onClick={() => setNewWorkflowOpen(true)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
              padding: "10px 12px", borderRadius: 9,
              background: ACCENT, color: INK,
              border: "none",
              fontWeight: 600, fontSize: 13, letterSpacing: "-0.005em",
              cursor: "pointer",
              transition: "transform .2s, box-shadow .2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = `0 6px 16px -4px ${ACCENT_GLOW}`; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)";    e.currentTarget.style.boxShadow = "none"; }}
          >
            <Plus size={14} strokeWidth={2.5} /> New workflow
          </button>
          <button
            onClick={() => setCreating(true)}
            style={{
              padding: "7px 12px", borderRadius: 7,
              background: "transparent", color: TEXT2,
              border: `1px solid ${LINE_MID}`,
              fontSize: 11.5, cursor: "pointer", letterSpacing: "-0.005em",
            }}
          >
            + Solo agent (no workflow)
          </button>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <NavItem icon={LayoutDashboard} label="Hub"          active />
          <NavItem icon={WorkflowIcon}    label="Agents"       count={agents.length} />
          <NavItem
            icon={Clock}
            label="History"
            onClick={() => router.push("/dashboard/history")}
          />
          <NavItem icon={BarChart2}       label="Analytics"  />
          <NavItem icon={BookUser}        label="Address book" />
        </nav>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", gap: 14, padding: "0 6px", fontSize: 11, color: MID, letterSpacing: "0.04em" }}>
          <a href="#">Docs</a><a href="#">Discord</a><a href="#">Status</a>
        </div>
      </aside>

      {/* ── Top bar ── */}
      <header style={{ gridArea: "top", display: "flex", alignItems: "center", borderBottom: `1px solid ${LINE}`, padding: "0 16px", gap: 14 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: TEXT }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: ACCENT }} />
          Workspace
        </span>
        <span style={{ color: MID, fontSize: 12, opacity: 0.5 }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>Agents</span>
        <span style={{ fontSize: 11, color: MID, letterSpacing: "0.06em" }}>· {agents.length} active</span>
        <div style={{ flex: 1 }} />

        {/* Fix 4: Scan button */}
        <button
          onClick={runScan}
          disabled={scanning}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 10px", borderRadius: 6,
            background: critHighCount > 0 ? "rgba(255,69,69,0.1)" : "rgba(244,241,234,0.05)",
            border: `1px solid ${critHighCount > 0 ? "rgba(255,69,69,0.3)" : LINE_MID}`,
            color: critHighCount > 0 ? "#FF4545" : TEXT2,
            fontSize: 11.5, cursor: scanning ? "not-allowed" : "pointer",
            opacity: scanning ? 0.6 : 1,
          }}
        >
          <Shield size={12} />
          {scanFindings && critHighCount > 0
            ? `${critHighCount} issue${critHighCount !== 1 ? "s" : ""}`
            : "Scan"}
        </button>

        {/* Permission button — ALWAYS visible (IMP-3: shows expiry countdown) */}
        <button
          onClick={() => setPermGrantOpen(true)}
          title={permDaysLeft !== null ? `Permission expires in ${permDaysLeft} days` : undefined}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "5px 12px", borderRadius: 6,
            background: !hasPermission ? "rgba(200,255,61,0.12)"
              : permDaysLeft === 0   ? "rgba(255,69,69,0.12)"
              : permExpirySoon       ? "rgba(255,210,60,0.1)"
              :                        "rgba(200,255,61,0.06)",
            border: `1px solid ${!hasPermission ? "rgba(200,255,61,0.3)"
              : permDaysLeft === 0   ? "rgba(255,69,69,0.4)"
              : permExpirySoon       ? "rgba(255,210,60,0.3)"
              :                        "rgba(200,255,61,0.18)"}`,
            color: !hasPermission    ? ACCENT
              : permDaysLeft === 0   ? "#FF8A66"
              : permExpirySoon       ? "#FFD166"
              :                        TEXT2,
            fontSize: 11.5, cursor: "pointer",
            letterSpacing: "0.02em", fontWeight: 500,
          }}
        >
          {!hasPermission      ? "🔑 Grant ERC-7715"
          : permDaysLeft === 0 ? "🔑 Permission expired"
          : permExpirySoon     ? `🔑 ${permDaysLeft}d left`
          :                      `🔑 ${permDaysLeft !== null ? `${permDaysLeft}d` : "active"}`}
        </button>
        <SessionAddressChip />
        <ConnectChip />
      </header>

      {/* ── Canvas ── */}
      <section style={{ gridArea: "canvas", position: "relative", overflow: "hidden" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          minZoom={0.4}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(244,241,234,0.06)" />
          {/* Fix 1: FitViewOnLoad fires after async load */}
          <FitViewOnLoad nodeCount={nodes.length} />
        </ReactFlow>

        {agents.length === 0 && (
          <EmptyState onCreate={() => setNewWorkflowOpen(true)} />
        )}

        {/* Floating NL prompt bar — only show when canvas has agents
            (empty state has its own prominent CTA, no need to duplicate) */}
        {agents.length > 0 && (
          <FloatingPromptBar
            value={nlPrompt}
            onChange={setNlPrompt}
            onSubmit={submitNlPrompt}
            submitting={nlSubmitting}
          />
        )}

        {/* Fix 3C: Right history drawer */}
        {drawerOpen && selectedAgentData && (
          <HistoryDrawer
            agent={selectedAgentData}
            onClose={() => { setDrawerOpen(false); setSelectedAgentId(null); }}
            onRefresh={() => {
              if (selectedAgentId) {
                fetch(`/api/agent/${selectedAgentId}`)
                  .then(r => r.ok ? r.json() : null)
                  .then(d => {
                    if (!d?.agent) return;
                    // Map AgentThought[] from DB into the display format
                    const rawThoughts = (d.thoughts ?? []) as Array<{
                      type: string; content: Record<string, unknown>; createdAt?: string;
                    }>;
                    const thoughts = rawThoughts.slice(-5).reverse().map(t => ({
                      step:    t.type,
                      content: typeof t.content?.text === "string"  ? t.content.text
                             : typeof t.content?.insight === "string" ? t.content.insight
                             : typeof t.content?.tool === "string"    ? `${t.content.tool}()`
                             : JSON.stringify(t.content).slice(0, 120),
                      ts: t.createdAt,
                    }));
                    setSelectedAgentData({ ...(d.agent as Agent), thoughts });
                  })
                  .catch(() => {});
              }
            }}
          />
        )}
      </section>

      {/* ── Modals ── */}
      {creating && (
        <CreateAgentModal
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); await loadAgents(); }}
        />
      )}

      {delegateFrom && (
        <DelegateModal
          parent={delegateFrom}
          candidates={agents.filter(a => a.id !== delegateFrom.id && a.parentAgentId !== delegateFrom.id)}
          onClose={() => setDelegateFrom(null)}
          onDone={async () => { setDelegateFrom(null); await loadAgents(); }}
        />
      )}

      {/* Fix 4: Security scan modal */}
      {scanOpen && scanFindings && (
        <SecurityScanModal
          findings={scanFindings}
          agents={agents}
          onClose={() => setScanOpen(false)}
          onRefresh={async () => { await loadAgents(); setScanOpen(false); }}
        />
      )}

      {/* Questionnaire modal */}
      {questionnaire && (
        <QuestionnaireModal
          questionnaire={questionnaire}
          answers={answers}
          setAnswers={setAnswers}
          onSubmit={submitQuestionnaire}
          onClose={() => { setQuestionnaire(null); setAnswers({}); }}
          submitting={qSubmitting}
        />
      )}

      {/* Permission grant modal (from top bar button OR Step 3 flow) */}
      {permGrantOpen && (
        <PermGrantModal
          onClose={() => setPermGrantOpen(false)}
          onGranted={async () => {
            setPermGrantOpen(false);
            // Auto-bind to every pending agent so they go live immediately —
            // no manual "delegate →" click required per agent
            await bindPermissionToPendingAgents();
            // bindPermissionToPendingAgents already calls loadAgents() + toast
            // but call once more in case there were no pending agents
            await loadAgents();
          }}
        />
      )}

      {/* UX-5: Step 3 / 3 — Grant Permission (auto-opens after agent creation when no real permission) */}
      {postCreatePermOpen && (
        <Step3PermissionModal
          agentCount={postCreateAgentCount}
          onClose={() => {
            setPostCreatePermOpen(false);
            toast("Grant an ERC-7715 permission before creating agents to enable real on-chain execution.", "info");
          }}
          onGranted={() => {
            // Close Step 3 and open the real PermGrantModal immediately
            setPostCreatePermOpen(false);
            setPermGrantOpen(true);
          }}
        />
      )}

      {/* Schedule modal */}
      {scheduleAgent && (
        <ScheduleModal
          agent={scheduleAgent}
          onClose={() => setScheduleAgent(null)}
          onSaved={async () => { setScheduleAgent(null); await loadAgents(); }}
        />
      )}

      {/* New Workflow modal — primary creation flow */}
      {newWorkflowOpen && (
        <NewWorkflowModal
          onClose={() => setNewWorkflowOpen(false)}
          onSubmit={async (prompt: string) => {
            // Reuse existing questionnaire flow — same path the floating bar takes
            const wallet = metamaskStore.getState().userAddress;
            if (!wallet || !prompt.trim()) return;
            setQSubmitting(false);
            try {
              const res = await fetch("/api/agent/questions", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ prompt: prompt.trim() }),
              });
              if (!res.ok) throw new Error("questions failed");
              const data = await res.json() as { summary: string; questions: Question[] };
              const defaultAnswers: Record<string, unknown> = {};
              for (const q of data.questions) {
                if (q.type === "slider") defaultAnswers[q.id] = q.defaultVal ?? q.min ?? 10;
              }
              setAnswers(defaultAnswers);
              setQuestionnaire({ ...data, originalPrompt: prompt.trim() });
              setNewWorkflowOpen(false);
            } catch (e) {
              toast("Failed to generate questions: " + (e instanceof Error ? e.message : String(e)), "error");
            }
          }}
        />
      )}

      {/* UX-1: Toast notifications — replaces all alert() calls */}
      <div style={{ position: "fixed", bottom: 80, right: 20, zIndex: 500, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: "10px 16px", borderRadius: 8, fontSize: 12.5,
            background: t.type === "success" ? "rgba(200,255,61,0.15)"
                      : t.type === "error"   ? "rgba(255,69,69,0.15)"
                      :                        "rgba(244,241,234,0.1)",
            border: `1px solid ${t.type === "success" ? "rgba(200,255,61,0.3)" : t.type === "error" ? "rgba(255,69,69,0.3)" : LINE_MID}`,
            color: t.type === "success" ? ACCENT : t.type === "error" ? "#FF8A66" : TEXT,
            backdropFilter: "blur(8px)",
            boxShadow: "0 4px 16px -4px rgba(0,0,0,0.5)",
            maxWidth: 360, lineHeight: 1.4,
            animation: "fadeInUp 0.2s ease",
          }}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* UX-1: In-UI confirm dialog — replaces browser confirm() */}
      {confirmState && (
        <div
          onClick={() => setConfirmState(null)}
          style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(11,12,9,0.7)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 12, padding: "24px 28px", width: 360, color: TEXT, display: "flex", flexDirection: "column", gap: 16 }}
          >
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>{confirmState.msg}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmState(null)} style={{ padding: "8px 14px", borderRadius: 7, background: "transparent", border: `1px solid ${LINE_MID}`, color: TEXT2, fontSize: 12.5, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={confirmState.onOk} style={{ padding: "8px 16px", borderRadius: 7, background: "rgba(255,69,69,0.15)", border: "1px solid rgba(255,69,69,0.4)", color: "#FF8A66", fontSize: 12.5, cursor: "pointer", fontWeight: 600 }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Schedule Modal — sets/clears scheduleIntervalMs on an agent
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
//  New Workflow Modal — the primary creation flow
// ─────────────────────────────────────────────────────────────────────────────

function NewWorkflowModal({
  onClose, onSubmit,
}: {
  onClose:  () => void;
  onSubmit: (prompt: string) => Promise<void> | void;
}) {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    try { await onSubmit(prompt); }
    finally { setSubmitting(false); }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(11,12,9,0.85)", backdropFilter: "blur(14px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 18,
          width: 720, maxWidth: "100%", maxHeight: "88vh",
          color: TEXT, display: "flex", flexDirection: "column",
          fontFamily: "var(--sans)", overflow: "hidden",
          boxShadow: "0 20px 80px -20px rgba(0,0,0,0.7)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "26px 32px 20px", borderBottom: `1px solid ${LINE}` }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ display: "inline-flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 7, background: "rgba(200,255,61,0.12)", border: "1px solid rgba(200,255,61,0.25)" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24">
                    <circle cx="8" cy="8" r="3.5" fill={ACCENT} />
                    <circle cx="16" cy="8" r="3.5" fill={ACCENT} opacity="0.85" />
                    <circle cx="8" cy="16" r="3.5" fill={ACCENT} opacity="0.85" />
                    <circle cx="16" cy="16" r="3.5" fill={ACCENT} opacity="0.7" />
                  </svg>
                </span>
                <span style={{ fontSize: 10.5, color: MID, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                  Step 1 / 3 · Describe your goal
                </span>
              </div>
              <div style={{ fontSize: 30, fontWeight: 500, fontFamily: "var(--serif)", fontStyle: "italic", letterSpacing: "-0.025em", lineHeight: 1.1 }}>
                What should your workflow do?
              </div>
              <div style={{ fontSize: 13, color: TEXT2, marginTop: 8, lineHeight: 1.5, maxWidth: "52ch" }}>
                A workflow is a team of AI agents with a shared budget, schedule, and on-chain identity. Describe what you want in plain English — CLOVE will ask follow-up questions and build the team for you.
              </div>
            </div>
            <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: MID, marginTop: 4 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Main body: textarea + examples grid */}
        <div style={{ padding: "20px 32px", flex: 1, overflowY: "auto" }}>
          {/* Prompt textarea */}
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
            placeholder="Find the highest safe yield on Base above 8% APY. Skip risky protocols. Notify me on Telegram daily."
            rows={4}
            style={{
              width: "100%", background: "rgba(244,241,234,0.04)",
              border: `1px solid ${LINE_MID}`, borderRadius: 11,
              color: TEXT, fontSize: 15, padding: "14px 16px",
              outline: "none", resize: "none", lineHeight: 1.5,
              fontFamily: "var(--sans)", letterSpacing: "-0.005em",
              transition: "border-color .15s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = ACCENT; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = LINE_MID; }}
          />

          <div style={{ fontSize: 10.5, color: MID, marginTop: 6 }}>
            ⌘+Enter to submit · Examples below
          </div>

          {/* Categorized examples */}
          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 10.5, color: MID, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>
              Or pick a starting point
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {NL_PRESET_GROUPS.flatMap(group =>
                group.examples.slice(0, 1).map((ex) => ({ icon: group.icon, category: group.category, text: ex }))
              ).map((p, i) => (
                <button
                  key={i}
                  onClick={() => setPrompt(p.text)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6,
                    padding: "12px 14px", borderRadius: 9,
                    background: "rgba(244,241,234,0.03)",
                    border: `1px solid ${LINE_MID}`,
                    color: TEXT2, fontSize: 12, lineHeight: 1.4,
                    cursor: "pointer", textAlign: "left",
                    fontFamily: "var(--sans)",
                    transition: "all .15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = TEXT; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = LINE_MID; e.currentTarget.style.color = TEXT2; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: ACCENT, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    <span style={{ fontSize: 13 }}>{p.icon}</span> {p.category}
                  </div>
                  <div style={{ fontSize: 12.5, letterSpacing: "-0.005em" }}>{p.text}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 32px", borderTop: `1px solid ${LINE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 11, color: MID, lineHeight: 1.5 }}>
            Next: clarify with 6 questions, then auto-wire your agent team.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onClose}
              style={{ padding: "10px 16px", borderRadius: 8, background: "transparent", border: `1px solid ${LINE_MID}`, color: TEXT2, fontSize: 13, cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting || !prompt.trim()}
              style={{
                padding: "10px 22px", borderRadius: 8,
                background: ACCENT, color: INK,
                border: "none", fontWeight: 600, fontSize: 13,
                cursor: submitting || !prompt.trim() ? "not-allowed" : "pointer",
                opacity: submitting || !prompt.trim() ? 0.5 : 1,
                display: "inline-flex", alignItems: "center", gap: 7,
              }}
            >
              {submitting ? "Analyzing…" : "Next — clarify →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const SCHEDULE_OPTIONS: Array<{ label: string; ms: number | null; desc: string }> = [
  { label: "Off",          ms: null,                       desc: "Manual only — no autonomous runs" },
  { label: "Every hour",   ms: 60 * 60 * 1000,             desc: "High-frequency · best for active trading" },
  { label: "Every 6 hours",ms: 6 * 60 * 60 * 1000,         desc: "Balanced · good for most strategies" },
  { label: "Daily",        ms: 24 * 60 * 60 * 1000,        desc: "Default · low x402 spend" },
  { label: "Weekly",       ms: 7 * 24 * 60 * 60 * 1000,    desc: "Maintenance only" },
];

function ScheduleModal({
  agent, onClose, onSaved,
}: {
  agent:   Agent;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const current = agent.scheduleIntervalMs ?? null;
  const [picked, setPicked] = useState<number | null>(current);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/agent/${agent.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ scheduleIntervalMs: picked }),
      });
      await onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(11,12,9,0.82)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 16, padding: "26px 30px", width: 500, maxWidth: "100%", color: TEXT, display: "flex", flexDirection: "column", gap: 18 }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 10, color: MID, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>Schedule</div>
            <div style={{ fontSize: 20, fontWeight: 500, fontFamily: "var(--serif)", fontStyle: "italic", letterSpacing: "-0.015em" }}>
              When should {agent.name} run?
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: MID }}><X size={16} /></button>
        </div>

        <div style={{ fontSize: 12, color: TEXT2, lineHeight: 1.55 }}>
          The CLOVE cron service runs every hour. When picked schedule elapses, the agent runs its full plan→execute→reflect→telegram loop automatically.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {SCHEDULE_OPTIONS.map(opt => {
            const sel = picked === opt.ms;
            return (
              <button
                key={String(opt.ms)}
                onClick={() => setPicked(opt.ms)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "11px 14px", borderRadius: 9,
                  background: sel ? "rgba(200,255,61,0.12)" : "transparent",
                  border: `1px solid ${sel ? ACCENT : LINE_MID}`,
                  color: sel ? TEXT : TEXT2,
                  cursor: "pointer", textAlign: "left",
                  transition: "all .15s",
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{opt.label}</div>
                  <div style={{ fontSize: 10.5, color: MID, marginTop: 2 }}>{opt.desc}</div>
                </div>
                {sel && <span style={{ color: ACCENT, fontSize: 14 }}>✓</span>}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "9px 14px", borderRadius: 7, background: "transparent", border: `1px solid ${LINE_MID}`, color: TEXT2, fontSize: 12.5, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving} style={{ padding: "9px 18px", borderRadius: 7, background: ACCENT, color: INK, border: "none", fontWeight: 600, fontSize: 12.5, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fix 3A: Floating NL prompt bar
// ─────────────────────────────────────────────────────────────────────────────

// Curated examples — clustered by intent so users discover the full range
const NL_PRESET_GROUPS: Array<{ category: string; icon: string; examples: string[] }> = [
  {
    category: "Yield",
    icon: "💰",
    examples: [
      "Deposit my USDC into Morpho when APY > 8%, hold otherwise",
      "Find the highest safe yield on Base above 6% APY",
      "Move my idle USDC into the best stablecoin vault weekly",
    ],
  },
  {
    category: "DCA",
    icon: "🔁",
    examples: [
      "DCA $5 into ETH every Monday via Uniswap, skip if gas > 2 gwei",
      "Buy $10 of WETH daily for 30 days, alert if price drops 5%",
    ],
  },
  {
    category: "Rebalancing",
    icon: "⚖",
    examples: [
      "Rebalance my USDC/ETH to 60/40 monthly on Aerodrome",
      "Keep my Morpho position above 8% APY — rebalance to Sky if it drops",
    ],
  },
  {
    category: "Risk monitoring",
    icon: "🛡",
    examples: [
      "Watch my Morpho deposit, withdraw if any HIGH risk signal",
      "Monitor Lido stETH peg — alert if depeg > 0.5%",
    ],
  },
  {
    category: "Multi-agent",
    icon: "🤖",
    examples: [
      "Create a 3-agent team: scout, risk monitor, executor on Base",
      "Build agents that vote in Compound governance on my behalf",
    ],
  },
];

const NL_PRESETS = NL_PRESET_GROUPS.flatMap(g => g.examples);

function FloatingPromptBar({
  value, onChange, onSubmit, submitting,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const [showPresets, setShowPresets] = useState(false);
  const connected = metamaskStore.getState().userAddress;

  if (!connected) return null;

  return (
    <div
      style={{
        position: "absolute", bottom: 20, left: 20, right: 20, zIndex: 10,
        display: "flex", gap: 8, alignItems: "flex-end",
      }}
    >
      <div style={{ flex: 1, position: "relative" }}>
        {showPresets && (
          <div style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0,
            background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 10,
            overflow: "hidden", zIndex: 20, maxHeight: 380, overflowY: "auto",
            boxShadow: "0 10px 32px -8px rgba(0,0,0,0.6)",
          }}>
            <div style={{ padding: "10px 14px 6px", fontSize: 9.5, color: MID, letterSpacing: "0.12em", textTransform: "uppercase", borderBottom: `1px solid ${LINE}` }}>
              Examples — click to use
            </div>
            {NL_PRESET_GROUPS.map((group, gi) => (
              <div key={gi}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px 4px", fontSize: 10, color: MID, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>
                  <span style={{ fontSize: 12 }}>{group.icon}</span> {group.category}
                </div>
                {group.examples.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => { onChange(p); setShowPresets(false); }}
                    style={{
                      width: "100%", textAlign: "left", padding: "8px 14px 8px 32px",
                      background: "transparent", border: "none", color: TEXT2,
                      fontSize: 12.5, cursor: "pointer", fontFamily: "var(--sans)",
                      lineHeight: 1.4, letterSpacing: "-0.005em",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(244,241,234,0.05)"; e.currentTarget.style.color = TEXT; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = TEXT2; }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 10,
          padding: "10px 12px",
          backdropFilter: "blur(12px)",
          boxShadow: "0 8px 32px -8px rgba(0,0,0,0.6)",
        }}>
          <span style={{ fontSize: 14 }}>🤖</span>
          <textarea
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
            placeholder="Describe your agent's goal…"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: TEXT, fontSize: 13, fontFamily: "var(--sans)", resize: "none",
              lineHeight: 1.4, letterSpacing: "-0.005em",
            }}
          />
          <button
            onClick={() => setShowPresets(x => !x)}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: MID, fontSize: 11, padding: "2px 6px", borderRadius: 4,
              display: "flex", alignItems: "center", gap: 3,
            }}
          >
            Examples <ChevronDown size={10} />
          </button>
        </div>
      </div>
      <button
        onClick={onSubmit}
        disabled={submitting || !value.trim()}
        style={{
          padding: "10px 16px", borderRadius: 10,
          background: ACCENT, color: INK, border: "none",
          fontWeight: 600, fontSize: 13, cursor: submitting ? "not-allowed" : "pointer",
          opacity: submitting || !value.trim() ? 0.5 : 1,
          whiteSpace: "nowrap",
          boxShadow: `0 4px 12px -4px ${ACCENT_GLOW}`,
        }}
      >
        {submitting ? "Creating…" : "Create agent →"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fix 3C: Right history drawer
// ─────────────────────────────────────────────────────────────────────────────

function HistoryDrawer({
  agent, onClose, onRefresh,
}: {
  agent: Agent;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const thoughts = agent.thoughts ?? [];

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, bottom: 0, width: 280,
      background: INK_1, borderLeft: `1px solid ${LINE_MID}`, zIndex: 15,
      display: "flex", flexDirection: "column",
      boxShadow: "-8px 0 32px -8px rgba(0,0,0,0.5)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${LINE}` }}>
        <div>
          <div style={{ fontSize: 10, color: MID, letterSpacing: "0.12em", textTransform: "uppercase" }}>Canvas history</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginTop: 2 }}>{agent.name}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={onRefresh}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: MID, fontSize: 11, padding: "3px 6px" }}
          >
            ↺ Refresh
          </button>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: MID }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Agent meta — UX-4: added lastRunAt, x402SpentUsdc, txHash */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 11.5, color: TEXT2, lineHeight: 1.5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: MID }}>Status</span>
            <span style={{ color: agent.status === "executing" || agent.status === "planning" ? ACCENT : TEXT2 }}>
              {agent.status}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: MID }}>Budget used</span>
            <span>
              {parseFloat(String(agent.budgetUsedUsdc ?? 0)).toFixed(3)}
              <span style={{ color: MID }}> / {agent.budgetUsdc} USDC</span>
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: MID }}>x402 spent</span>
            <span style={{ color: (agent.x402SpentUsdc ?? 0) > 0 ? ACCENT : MID }}>
              ${(agent.x402SpentUsdc ?? 0).toFixed(3)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: MID }}>Runs</span>
            <span>{agent.totalRuns}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: MID }}>Last action</span>
            <span style={{ color: lastActionColor(agent.lastAction) }}>{agent.lastAction ?? "—"}</span>
          </div>
          {agent.lastRunAt && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: MID }}>Last run</span>
              <span style={{ fontSize: 10.5 }}>
                {new Date(agent.lastRunAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Thoughts — UX-4: Basescan links + cost chips */}
      <div style={{ padding: "12px 16px", flex: 1, overflowY: "auto" }}>
        <div style={{ fontSize: 10, color: MID, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <Clock size={10} /> Recent thoughts
        </div>
        {thoughts.length === 0 ? (
          <div style={{ fontSize: 12, color: MID, fontStyle: "italic" }}>No thought history yet. Run the agent to see its reasoning.</div>
        ) : (
          thoughts.map((t, i) => (
            <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < thoughts.length - 1 ? `1px solid ${LINE}` : "none" }}>
              {/* thought type badge */}
              <div style={{ fontSize: 9.5, color: ACCENT, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{t.step}</div>

              {/* thought content */}
              <div style={{ fontSize: 11, color: TEXT2, lineHeight: 1.5, fontFamily: t.step === "reflect" ? "var(--serif)" : "var(--sans)", fontStyle: t.step === "reflect" ? "italic" : "normal" }}>
                {t.content.slice(0, 400)}{t.content.length > 400 ? "…" : ""}
              </div>

              {/* UX-4: txHash → Basescan link */}
              {t.txHash && (
                <a
                  href={`https://basescan.org/tx/${t.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4, marginTop: 5,
                    fontSize: 9.5, color: ACCENT, textDecoration: "none",
                    background: "rgba(200,255,61,0.08)", border: "1px solid rgba(200,255,61,0.2)",
                    padding: "2px 7px", borderRadius: 4,
                  }}
                >
                  ↗ {t.txHash.slice(0, 10)}…{t.txHash.slice(-6)} · Basescan
                </a>
              )}

              {/* UX-4: x402 cost chip */}
              {t.cost !== undefined && t.cost > 0 && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4, marginTop: 5, marginLeft: t.txHash ? 4 : 0,
                  fontSize: 9.5, color: MID,
                  background: "rgba(244,241,234,0.04)", border: `1px solid ${LINE}`,
                  padding: "2px 6px", borderRadius: 4,
                }}>
                  x402 ${t.cost.toFixed(4)}
                </span>
              )}

              {/* timestamp */}
              {t.ts && (
                <div style={{ fontSize: 9, color: MID, marginTop: 4, opacity: 0.7 }}>
                  {new Date(t.ts).toLocaleTimeString()}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fix 4: Security Scan Modal
// ─────────────────────────────────────────────────────────────────────────────

function SecurityScanModal({
  findings, onClose, agents, onRefresh,
}: {
  findings: SecurityFinding[];
  onClose: () => void;
  agents: Agent[];
  onRefresh: () => void;
}) {
  const [fixing, setFixing] = React.useState(false);
  const [fixLog, setFixLog] = React.useState<string[]>([]);

  const sortOrder: Record<SecurityFinding["severity"], number> = { critical: 0, high: 1, medium: 2, info: 3 };
  const sorted = [...findings].sort((a, b) => sortOrder[a.severity] - sortOrder[b.severity]);

  const counts = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Count agents that need permission
  const agentsNeedingPermission = agents.filter(a => !hasRealDelegation(a));

  const handleGrantAll = async () => {
    const mm = metamaskStore.getState();
    if (!mm.permission?.permissionsContext) {
      // UX-7 fix: use the MAX budget across all unprotected agents, not a hardcoded "10"
      const maxBudget = agentsNeedingPermission.reduce(
        (max, a) => Math.max(max, parseFloat(a.budgetUsdc) || 0), 0
      );
      const budget = String(Math.max(10, maxBudget));
      await metamaskStore.requestPermission(budget, 90, "CLOVE bulk agent authorization");
    }
    const perm = metamaskStore.getState().permission;
    if (!perm) { setFixLog(["❌ No permission granted — open MetaMask and try again."]); return; }

    setFixing(true);
    const log: string[] = [];
    for (const a of agentsNeedingPermission) {
      try {
        const res = await fetch(`/api/agent/${a.id}/delegate-from-user`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            permissionsContext:       perm.permissionsContext,
            delegationManagerAddress: perm.delegationManager,
            delegationHash:           "0xpending",
            capUsdc:                  a.budgetUsdc,
          }),
        });
        log.push(res.ok ? `✅ ${a.name}` : `❌ ${a.name} (${res.status})`);
      } catch {
        log.push(`❌ ${a.name} (network error)`);
      }
    }
    setFixLog(log);
    setFixing(false);
    await onRefresh();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(11,12,9,0.75)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 14,
          padding: "28px 32px", width: 580, maxWidth: "100%", maxHeight: "82vh",
          color: TEXT, display: "flex", flexDirection: "column", gap: 16,
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, color: MID, letterSpacing: "0.14em", textTransform: "uppercase" }}>Security scan</div>
            <div style={{ fontSize: 22, fontWeight: 500, marginTop: 6, fontFamily: "var(--serif)", fontStyle: "italic", letterSpacing: "-0.015em" }}>
              {findings.length} finding{findings.length !== 1 ? "s" : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: MID, marginTop: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Summary chips */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["critical","high","medium","info"] as const).map(sev => (
            counts[sev] ? (
              <span key={sev} style={{
                padding: "3px 10px", borderRadius: 999, fontSize: 11,
                background: `${SEVERITY_COLOR[sev]}18`,
                border: `1px solid ${SEVERITY_COLOR[sev]}44`,
                color: SEVERITY_COLOR[sev],
              }}>
                {counts[sev]} {sev}
              </span>
            ) : null
          ))}
        </div>

        {/* Fix All action — grant ERC-7715 to all unprotected agents */}
        {agentsNeedingPermission.length > 0 && (
          <div style={{
            padding: "14px 16px", borderRadius: 10,
            background: "rgba(200,255,61,0.05)",
            border: "1px solid rgba(200,255,61,0.2)",
          }}>
            <div style={{ fontSize: 12, color: TEXT2, lineHeight: 1.5, marginBottom: 10 }}>
              <strong style={{ color: TEXT }}>{agentsNeedingPermission.length} agent{agentsNeedingPermission.length !== 1 ? "s" : ""}</strong> {" "}
              have no real ERC-7715 delegation. Granting permission will bind your MetaMask ERC-7715 context to all of them at once.
            </div>
            {fixLog.length > 0 && (
              <div style={{ fontSize: 11, fontFamily: "monospace", color: TEXT2, marginBottom: 10, lineHeight: 1.8 }}>
                {fixLog.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
            <button
              onClick={handleGrantAll}
              disabled={fixing}
              style={{
                padding: "8px 16px", borderRadius: 7,
                background: ACCENT, color: INK,
                border: "none", fontWeight: 600, fontSize: 12.5,
                cursor: fixing ? "not-allowed" : "pointer",
                opacity: fixing ? 0.6 : 1,
              }}
            >
              {fixing ? "Granting…" : `⚡ Grant ERC-7715 to all ${agentsNeedingPermission.length} agents`}
            </button>
          </div>
        )}

        {agentsNeedingPermission.length === 0 && findings.filter(f => f.severity !== "info").length === 0 && (
          <div style={{ textAlign: "center", padding: "20px 0", fontSize: 14, color: ACCENT }}>
            ✅ No critical issues — all agents have real delegations.
          </div>
        )}

        {/* Findings list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((f, i) => (
            <div key={i} style={{
              padding: "11px 13px", borderRadius: 9,
              background: `${SEVERITY_COLOR[f.severity]}06`,
              border: `1px solid ${SEVERITY_COLOR[f.severity]}22`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span style={{
                  fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
                  color: SEVERITY_COLOR[f.severity], fontWeight: 600,
                }}>
                  {f.severity}
                </span>
                <span style={{ fontSize: 10, color: MID }}>· {f.agentName}</span>
              </div>
              <div style={{ fontSize: 12.5, color: TEXT, lineHeight: 1.4, marginBottom: 3 }}>{f.issue}</div>
              <div style={{ fontSize: 11, color: MID_2, lineHeight: 1.4 }}>Fix: {f.fix}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  SessionAddressChip
// ─────────────────────────────────────────────────────────────────────────────

function SessionAddressChip() {
  const [show, setShow] = useState(false);
  // Read address client-side only to avoid SSR/client hydration mismatch
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    const update = () => {
      const a = process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS
             ?? metamaskStore.getState().sessionAddress
             ?? null;
      setAddr(a);
    };
    update();
    const u = metamaskStore.addListener(update);
    return () => u();
  }, []);
  if (!addr) return null;
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setShow(s => !s)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 8px", borderRadius: 5,
          background: "transparent", border: "none",
          color: MID_2, fontSize: 10.5, cursor: "pointer",
          letterSpacing: "0.04em", fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: ACCENT }} />
        {addr.slice(0, 6)}…{addr.slice(-4)}
      </button>
      {show && (
        <div
          onClick={() => setShow(false)}
          style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50,
            width: 300, padding: "14px 16px", borderRadius: 10,
            background: INK_1, border: `1px solid ${LINE_MID}`,
            boxShadow: "0 8px 32px -8px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ fontSize: 10, color: MID, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            CLOVE Agent Wallet (1Shot)
          </div>
          <div style={{ fontSize: 11, color: TEXT2, lineHeight: 1.6 }}>
            This is CLOVE&apos;s server wallet on <strong style={{ color: TEXT }}>Base mainnet</strong>.
            Your MetaMask wallet grants an ERC-7715 permission <em>to</em> this address —
            your USDC only moves when you approve the delegation.
            CLOVE never holds your keys.
          </div>
          <div style={{ marginTop: 10, fontSize: 10.5, color: ACCENT, fontFamily: "monospace", wordBreak: "break-all" }}>
            {addr}
          </div>
          <a
            href={`https://basescan.org/address/${addr}`}
            target="_blank" rel="noopener noreferrer"
            style={{ display: "block", marginTop: 8, fontSize: 10.5, color: ACCENT, textDecoration: "underline" }}
          >
            View on Basescan ↗
          </a>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Questionnaire Modal — Claude Design style
// ─────────────────────────────────────────────────────────────────────────────

function QuestionnaireModal({
  questionnaire, answers, setAnswers, onSubmit, onClose, submitting,
}: {
  questionnaire: Questionnaire;
  answers:       Record<string, unknown>;
  setAnswers:    React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  onSubmit:      () => void;
  onClose:       () => void;
  submitting:    boolean;
}) {
  const toggle = (qId: string, val: string) => {
    setAnswers(prev => {
      const cur = (prev[qId] as string[] | undefined) ?? [];
      return { ...prev, [qId]: cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val] };
    });
  };

  const setSingle = (qId: string, val: string) =>
    setAnswers(prev => ({ ...prev, [qId]: val }));

  const setSlider = (qId: string, val: number) =>
    setAnswers(prev => ({ ...prev, [qId]: val }));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(11,12,9,0.82)", backdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 16,
          width: 640, maxWidth: "100%", maxHeight: "88vh",
          color: TEXT, display: "flex", flexDirection: "column",
          fontFamily: "var(--sans)", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "24px 28px 0", borderBottom: `1px solid ${LINE}`, paddingBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ display: "inline-flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 6, background: "rgba(200,255,61,0.12)", border: "1px solid rgba(200,255,61,0.25)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24">
                    <circle cx="8" cy="8" r="3.5" fill={ACCENT} />
                    <circle cx="16" cy="8" r="3.5" fill={ACCENT} opacity="0.85" />
                    <circle cx="8" cy="16" r="3.5" fill={ACCENT} opacity="0.85" />
                    <circle cx="16" cy="16" r="3.5" fill={ACCENT} opacity="0.7" />
                  </svg>
                </span>
                <span style={{ fontSize: 10.5, color: MID, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  Step 2 / 3 · Clarify your strategy
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: TEXT2, lineHeight: 1.5, maxWidth: "48ch" }}>
                {questionnaire.summary}
              </div>
            </div>
            <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: MID }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Questions */}
        <div style={{ overflowY: "auto", padding: "20px 28px", display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
          {questionnaire.questions.map((q) => (
            <div key={q.id}>
              <div style={{ fontSize: 14, fontWeight: 500, color: TEXT, marginBottom: q.hint ? 4 : 10 }}>
                {q.label}
              </div>
              {q.hint && (
                <div style={{ fontSize: 11, color: MID, marginBottom: 10, letterSpacing: "0.02em" }}>
                  {q.hint}
                </div>
              )}

              {/* Single select */}
              {q.type === "single" && q.options && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {q.options.map(opt => {
                    const selected = answers[q.id] === opt;
                    return (
                      <button
                        key={opt}
                        onClick={() => setSingle(q.id, opt)}
                        style={{
                          padding: "7px 14px", borderRadius: 999, fontSize: 12.5,
                          background: selected ? ACCENT : "transparent",
                          border: `1px solid ${selected ? ACCENT : LINE_MID}`,
                          color: selected ? INK : TEXT2,
                          cursor: "pointer", fontWeight: selected ? 600 : 400,
                          transition: "all .15s",
                        }}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Multi select */}
              {q.type === "multi" && q.options && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {q.options.map(opt => {
                    const sel = ((answers[q.id] as string[] | undefined) ?? []).includes(opt);
                    return (
                      <button
                        key={opt}
                        onClick={() => toggle(q.id, opt)}
                        style={{
                          padding: "7px 14px", borderRadius: 999, fontSize: 12.5,
                          background: sel ? "rgba(200,255,61,0.15)" : "transparent",
                          border: `1px solid ${sel ? ACCENT : LINE_MID}`,
                          color: sel ? ACCENT : TEXT2,
                          cursor: "pointer", transition: "all .15s",
                        }}
                      >
                        {sel ? "✓ " : ""}{opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Slider */}
              {q.type === "slider" && (
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <input
                    type="range"
                    min={q.min ?? 1} max={q.max ?? 100} step={q.step ?? 1}
                    value={(answers[q.id] as number | undefined) ?? q.defaultVal ?? q.min ?? 10}
                    onChange={e => setSlider(q.id, Number(e.target.value))}
                    style={{ flex: 1, accentColor: ACCENT }}
                  />
                  <span style={{ fontSize: 16, fontWeight: 600, color: ACCENT, minWidth: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {String(answers[q.id] ?? q.defaultVal ?? q.min ?? 10)}
                    {q.unit ? ` ${q.unit}` : ""}
                  </span>
                </div>
              )}

              {/* Text */}
              {q.type === "text" && (
                <input
                  type="text"
                  value={(answers[q.id] as string | undefined) ?? ""}
                  onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                  placeholder="Your answer…"
                  style={{
                    width: "100%", background: "rgba(244,241,234,0.04)",
                    border: `1px solid ${LINE_MID}`, color: TEXT,
                    fontSize: 13, padding: "9px 11px", borderRadius: 7, outline: "none",
                    fontFamily: "var(--sans)",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 28px", borderTop: `1px solid ${LINE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: MID }}>
            {(answers.orchestration as string | undefined)?.includes("Multi") ? "⚡ Will create Scout → Risk Monitor → Executor team" : ""}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onClose}
              style={{ padding: "9px 14px", borderRadius: 7, background: "transparent", border: `1px solid ${LINE_MID}`, color: TEXT2, fontSize: 12.5, cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={submitting}
              style={{
                padding: "9px 18px", borderRadius: 7,
                background: ACCENT, color: INK,
                border: "none", fontWeight: 600, fontSize: 12.5,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "Creating agents…" : "Create agent →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  UX-5: Step 3 / 3 — Grant Permission (auto-opens after agent creation)
// ─────────────────────────────────────────────────────────────────────────────

function Step3PermissionModal({
  agentCount, onClose, onGranted,
}: {
  agentCount: number;
  onClose:    () => void;
  onGranted:  () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(11,12,9,0.88)", backdropFilter: "blur(16px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 18,
          width: 560, maxWidth: "100%",
          color: TEXT, fontFamily: "var(--sans)",
          boxShadow: "0 20px 80px -20px rgba(0,0,0,0.8)",
          overflow: "hidden",
        }}
      >
        {/* Step indicator bar */}
        <div style={{ display: "flex", height: 3 }}>
          <div style={{ flex: 1, background: ACCENT, opacity: 0.4 }} />
          <div style={{ flex: 1, background: ACCENT, opacity: 0.4 }} />
          <div style={{ flex: 1, background: ACCENT }} />
        </div>

        <div style={{ padding: "28px 32px 32px" }}>
          {/* Eyebrow */}
          <div style={{ fontSize: 10.5, color: MID, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>
            Step 3 / 3 · Grant permission
          </div>

          {/* Headline */}
          <div style={{ fontSize: 26, fontWeight: 500, fontFamily: "var(--serif)", fontStyle: "italic", letterSpacing: "-0.02em", lineHeight: 1.15, marginBottom: 10 }}>
            One permission to make it real.
          </div>

          {/* Explanation */}
          <p style={{ fontSize: 13.5, color: TEXT2, lineHeight: 1.6, marginBottom: 22, maxWidth: "46ch" }}>
            Your {agentCount === 1 ? "agent was" : `${agentCount} agents were`} created but
            {" "}<strong style={{ color: TEXT }}>can't execute real transactions yet</strong> — grant an ERC-7715 permission first.
            Grant an ERC-7715 USDC budget below and they'll go live immediately.
          </p>

          {/* What this does */}
          <div style={{
            background: "rgba(200,255,61,0.04)", border: "1px solid rgba(200,255,61,0.14)",
            borderRadius: 10, padding: "14px 16px", marginBottom: 22,
            fontSize: 12, color: TEXT2, lineHeight: 1.65,
          }}>
            <div style={{ color: ACCENT, fontWeight: 600, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
              What granting does
            </div>
            {[
              "Signs a non-custodial ERC-7715 permission in MetaMask — no key transfer",
              "Sets a USDC budget cap your agent cannot exceed",
              "Revocable at any time in one click from the dashboard",
              "Your wallet stays in full control",
            ].map((line, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: i < 3 ? 5 : 0 }}>
                <span style={{ color: ACCENT, flexShrink: 0, marginTop: 1 }}>✓</span>
                <span>{line}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
            <button
              onClick={onClose}
              style={{
                padding: "10px 16px", borderRadius: 8,
                background: "transparent", border: `1px solid ${LINE_MID}`,
                color: MID, fontSize: 12.5, cursor: "pointer",
              }}
            >
              Skip for now
            </button>
            <button
              onClick={onGranted}
              style={{
                padding: "11px 24px", borderRadius: 8,
                background: ACCENT, color: INK, border: "none",
                fontWeight: 700, fontSize: 13, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 8,
                boxShadow: `0 4px 18px -6px ${ACCENT_GLOW}`,
              }}
            >
              🔑 Grant ERC-7715 permission →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Permission Grant Modal
// ─────────────────────────────────────────────────────────────────────────────

function PermGrantModal({ onClose, onGranted }: { onClose: () => void; onGranted: () => void }) {
  const [budget,    setBudget]    = useState("50");
  const [days,      setDays]      = useState(30);
  const [granting,  setGranting]  = useState(false);
  const [revoking,  setRevoking]  = useState(false);
  const [done,      setDone]      = useState(false);
  const [tick,      setTick]      = useState(0);

  // Re-read permission state reactively
  useEffect(() => {
    const u = metamaskStore.addListener(() => setTick(x => x + 1));
    return () => u();
  }, []);

  const existingPerm = metamaskStore.getState().permission;
  // suppress lint warning — tick is used to force re-read
  void tick;

  const hasExisting = !!(
    existingPerm?.permissionsContext &&
    existingPerm.permissionsContext.length > 40 &&
    !existingPerm.permissionsContext.includes("demo") &&
    existingPerm.permissionsContext.startsWith("0x")
  );

  const grant = async () => {
    setGranting(true);
    try {
      await metamaskStore.requestPermission(budget, days, `CLOVE agent budget — ${budget} USDC / ${days} days`);
      setDone(true);
      setTimeout(onGranted, 800);
    } catch {
      setGranting(false);
    }
  };

  const clearLocal = () => {
    metamaskStore.clearLocalPermission();
    setDone(false);
  };

  const revokeOnChain = async () => {
    setRevoking(true);
    try {
      await metamaskStore.revokeOnChain();
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(11,12,9,0.82)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 16, padding: "28px 32px", width: 480, maxWidth: "100%", color: TEXT, display: "flex", flexDirection: "column", gap: 18 }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, color: ACCENT, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>ERC-7715 Permission</div>
            <div style={{ fontSize: 22, fontWeight: 500, fontFamily: "var(--serif)", fontStyle: "italic", letterSpacing: "-0.015em" }}>
              {hasExisting ? "Permission active" : "Grant agent budget"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: MID }}><X size={16} /></button>
        </div>

        {/* Current permission status banner */}
        {hasExisting && (
          <div style={{ padding: "12px 14px", borderRadius: 9, background: "rgba(200,255,61,0.08)", border: "1px solid rgba(200,255,61,0.25)", fontSize: 12, color: TEXT2, lineHeight: 1.6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: ACCENT, boxShadow: `0 0 0 3px rgba(200,255,61,0.2)` }} />
              <span style={{ color: ACCENT, fontWeight: 600, fontSize: 11.5 }}>ERC-7715 permission stored locally</span>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 10, color: MID, wordBreak: "break-all", marginBottom: 8 }}>
              {existingPerm!.permissionsContext.slice(0, 22)}…{existingPerm!.permissionsContext.slice(-10)}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={clearLocal}
                style={{ padding: "5px 10px", borderRadius: 5, background: "transparent", border: `1px solid ${LINE_MID}`, color: TEXT2, fontSize: 11, cursor: "pointer" }}
              >
                Clear local (keep on-chain)
              </button>
              <button
                onClick={revokeOnChain}
                disabled={revoking}
                style={{ padding: "5px 10px", borderRadius: 5, background: "rgba(255,69,69,0.08)", border: "1px solid rgba(255,69,69,0.3)", color: "#FF8A66", fontSize: 11, cursor: revoking ? "not-allowed" : "pointer", opacity: revoking ? 0.6 : 1 }}
              >
                {revoking ? "Revoking…" : "Revoke on-chain"}
              </button>
            </div>
          </div>
        )}

        <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.6 }}>
          {hasExisting
            ? "You can grant a new permission below to replace the current one, or use the buttons above to clear / revoke it."
            : <>This creates an <strong style={{ color: TEXT }}>ERC-7715 periodic permission</strong> from your MetaMask wallet to CLOVE&apos;s 1Shot server wallet. Your USDC only moves when an agent executes — revocable anytime.</>
          }
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 10.5, color: MID, letterSpacing: "0.06em" }}>Budget cap (USDC)</span>
            <input
              type="number" min="1" max="10000" value={budget}
              onChange={e => setBudget(e.target.value)}
              style={{ background: "rgba(244,241,234,0.04)", border: `1px solid ${LINE_MID}`, color: TEXT, fontSize: 15, fontWeight: 600, padding: "9px 11px", borderRadius: 7, outline: "none" }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Bug 3 fix: "Period (days)" was confusing — users thought it was the
                expiry. It's the BUDGET RESET interval, not how long the permission lasts.
                The permission itself always lasts 90 days (hardcoded in permissions.ts). */}
            <span style={{ fontSize: 10.5, color: MID, letterSpacing: "0.06em" }}>Budget resets every</span>
            <input
              type="number" min="1" max="365" value={days}
              onChange={e => setDays(Number(e.target.value))}
              style={{ background: "rgba(244,241,234,0.04)", border: `1px solid ${LINE_MID}`, color: TEXT, fontSize: 15, fontWeight: 600, padding: "9px 11px", borderRadius: 7, outline: "none" }}
            />
          </div>
        </div>

        <div style={{ padding: "12px 14px", borderRadius: 9, background: "rgba(200,255,61,0.06)", border: "1px solid rgba(200,255,61,0.15)", fontSize: 11.5, color: TEXT2, lineHeight: 1.5 }}>
          {/* Bug 3 fix: explicitly distinguish budget period from permission expiry */}
          Agent can spend up to <strong style={{ color: ACCENT }}>{budget} USDC every {days} days</strong>.
          {" "}Permission valid for <strong style={{ color: TEXT }}>90 days</strong> (shown in top bar as days remaining).
          {" "}Gas is sponsored by 1Shot — you pay zero ETH.
        </div>

        <button
          onClick={grant}
          disabled={granting || done}
          style={{
            padding: "12px 18px", borderRadius: 9,
            background: done ? "rgba(200,255,61,0.2)" : ACCENT,
            color: done ? ACCENT : INK,
            border: done ? `1px solid ${ACCENT}` : "none",
            fontWeight: 600, fontSize: 14,
            cursor: (granting || done) ? "not-allowed" : "pointer",
            opacity: granting ? 0.7 : 1, transition: "all .2s",
          }}
        >
          {done ? "✅ Permission granted!" : granting ? "Waiting for MetaMask…" : hasExisting ? "Re-grant via MetaMask →" : "Grant via MetaMask →"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Bits: Brand, NavItem, ConnectChip, EmptyState
// ─────────────────────────────────────────────────────────────────────────────

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px" }}>
      <span style={{ display: "inline-flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 7, background: INK_1 }}>
        <svg width="16" height="16" viewBox="0 0 24 24">
          <circle cx="8"  cy="8"  r="3.5" fill={ACCENT} />
          <circle cx="16" cy="8"  r="3.5" fill={ACCENT} opacity="0.85" />
          <circle cx="8"  cy="16" r="3.5" fill={ACCENT} opacity="0.85" />
          <circle cx="16" cy="16" r="3.5" fill={ACCENT} opacity="0.7" />
        </svg>
      </span>
      <span style={{ fontSize: 17, fontWeight: 600, color: TEXT, letterSpacing: "-0.015em" }}>clove</span>
      <span style={{ marginLeft: "auto", fontSize: 9, color: MID, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 500 }}>Beta</span>
    </div>
  );
}

function NavItem({ icon: Icon, label, active, count, onClick }: { icon: React.ComponentType<{ size?: number }>; label: string; active?: boolean; count?: number | string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "a";
  return (
    <Tag
      onClick={onClick}
      href={onClick ? undefined : "#"}
      style={{
        display: "flex", alignItems: "center", gap: 11,
        padding: "8px 11px", borderRadius: 7,
        background: active ? "rgba(244,241,234,0.06)" : "transparent",
        color: active ? TEXT : TEXT2,
        fontSize: 13, letterSpacing: "-0.005em",
        textDecoration: "none", textAlign: "left",
        border: "none", cursor: onClick ? "pointer" : "default",
        fontFamily: "inherit",
        transition: "background .15s, color .15s",
      }}
    >
      <Icon size={14} />
      <span>{label}</span>
      {count !== undefined && (
        <span style={{ marginLeft: "auto", fontSize: 11, color: MID, fontVariantNumeric: "tabular-nums" }}>{count}</span>
      )}
    </Tag>
  );
}

function ConnectChip() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const u = metamaskStore.addListener(() => setTick(x => x + 1));
    return () => u();
  }, []);
  const addr = metamaskStore.getState().userAddress;
  return (
    <button
      onClick={() => { if (!addr) void metamaskStore.connect(); }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        padding: "5px 9px", borderRadius: 6,
        background: "transparent", border: "none",
        color: MID_2, fontSize: 11.5, letterSpacing: "0.02em",
        fontVariantNumeric: "tabular-nums",
        cursor: "pointer",
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: addr ? ACCENT : MID }} />
      {addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "Connect"}
    </button>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const u = metamaskStore.addListener(() => setTick(x => x + 1));
    return () => u();
  }, []);
  const connected = metamaskStore.getState().userAddress;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, pointerEvents: "none", paddingBottom: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: MID, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        <Sparkles size={14} style={{ color: ACCENT }} /> {connected ? "No workflows yet" : "Wallet not connected"}
      </div>
      <div style={{ fontSize: 30, color: TEXT, fontFamily: "var(--serif)", fontStyle: "italic", letterSpacing: "-0.02em", textAlign: "center" }}>
        {connected ? "Create your first workflow." : "Connect a wallet to begin."}
      </div>
      <div style={{ fontSize: 13, color: TEXT2, maxWidth: "44ch", textAlign: "center", lineHeight: 1.5 }}>
        {connected
          ? "Describe what you want in plain English. CLOVE will ask clarifying questions and assemble a team of agents to do it autonomously."
          : "Click Connect in the top bar to grant CLOVE access to your wallet (read-only until you grant a permission)."}
      </div>
      {connected && (
        <button
          onClick={onCreate}
          style={{
            pointerEvents: "auto",
            display: "inline-flex", alignItems: "center", gap: 9,
            padding: "11px 20px", borderRadius: 999,
            background: ACCENT, color: INK,
            border: "none", fontWeight: 600, fontSize: 13.5, cursor: "pointer",
            marginTop: 4,
            boxShadow: `0 8px 28px -10px ${ACCENT_GLOW}`,
          }}
        >
          <Plus size={14} strokeWidth={2.5} /> New workflow
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Create Agent Modal (Fix 3B: ERC-7715 grant section)
// ─────────────────────────────────────────────────────────────────────────────

function CreateAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> | void }) {
  const [name,        setName]        = useState("Yield Hunter");
  const [goal,        setGoal]        = useState("Deposit my USDC into the safest Base protocol above 8% APY. Hold otherwise. Notify me on Telegram.");
  const [budget,      setBudget]      = useState("10");
  const [mediaPolicy, setMediaPolicy] = useState<MediaPolicy>("milestones");
  const [submitting,  setSubmitting]  = useState(false);

  // Fix 3B: permission grant state
  const [grantOpen,    setGrantOpen]    = useState(false);
  const [granting,     setGranting]     = useState(false);
  const [grantedPerm,  setGrantedPerm]  = useState(() => metamaskStore.getState().permission);
  const [, setPermTick] = useState(0);

  useEffect(() => {
    const u = metamaskStore.addListener(() => {
      setPermTick(x => x + 1);
      setGrantedPerm(metamaskStore.getState().permission);
    });
    return () => u();
  }, []);

  const grantPermission = async () => {
    setGranting(true);
    try {
      await metamaskStore.requestPermission(budget, 30, goal.slice(0, 60));
      setGrantedPerm(metamaskStore.getState().permission);
    } finally {
      setGranting(false);
    }
  };

  const submit = async () => {
    const wallet = metamaskStore.getState().userAddress;
    if (!wallet) { onClose(); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet, name, goal, budgetUsdc: budget, mediaPolicy }),
      });
      if (res.ok) {
        const created = (await res.json()) as { agent: Agent };
        const newId = created.agent?.id;

        // Fix 3B: if permission was granted, bind it immediately
        const perm = metamaskStore.getState().permission;
        if (newId && perm && perm.permissionsContext) {
          await fetch(`/api/agent/${newId}/delegate-from-user`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              permissionsContext:        perm.permissionsContext,
              delegationManagerAddress:  perm.delegationManager,
              delegationHash:            "0xpending",
              capUsdc:                   budget,
            }),
          }).catch(() => {});
        }
      }
      await onCreated();
    } finally { setSubmitting(false); }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(11,12,9,0.7)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 14,
          padding: "28px 32px", width: 480, maxWidth: "100%", color: TEXT,
          display: "flex", flexDirection: "column", gap: 18,
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: MID, letterSpacing: "0.14em", textTransform: "uppercase" }}>New agent</div>
          <div style={{ fontSize: 22, fontWeight: 500, marginTop: 6, fontFamily: "var(--serif)", fontStyle: "italic", letterSpacing: "-0.015em" }}>
            Give it a goal.
          </div>
        </div>

        <Field label="Name">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle()} />
        </Field>

        <Field label="Goal (plain English)">
          <textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} style={{ ...inputStyle(), resize: "none", lineHeight: 1.45 }} />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Budget (USDC)">
            <input type="text" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="Media policy">
            <select value={mediaPolicy} onChange={(e) => setMediaPolicy(e.target.value as MediaPolicy)} style={inputStyle()}>
              <option value="off">Off</option>
              <option value="milestones">Milestones (recommended)</option>
              <option value="daily">Daily digest</option>
              <option value="every-run">Every run</option>
            </select>
          </Field>
        </div>

        {/* Fix 3B: ERC-7715 grant section */}
        <div style={{ borderRadius: 9, border: `1px solid ${LINE_MID}`, overflow: "hidden" }}>
          <button
            onClick={() => setGrantOpen(x => !x)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 14px", background: "rgba(244,241,234,0.03)", border: "none", cursor: "pointer",
              color: TEXT2, fontSize: 12.5, fontFamily: "var(--sans)", textAlign: "left",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Shield size={12} style={{ color: grantedPerm ? ACCENT : MID }} />
              Grant ERC-7715 delegation <span style={{ fontSize: 10.5, color: MID }}>(optional — enables real execution)</span>
            </span>
            <ChevronDown size={12} style={{ transform: grantOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .15s" }} />
          </button>

          {grantOpen && (
            <div style={{ padding: "14px 16px", borderTop: `1px solid ${LINE}`, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12.5, color: TEXT2, lineHeight: 1.5 }}>
                Grant MetaMask permission: <strong style={{ color: TEXT }}>{budget} USDC / 30 days</strong>
                <br />
                This lets CLOVE spend on your behalf, on-chain, with revocation rights.
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={grantPermission}
                  disabled={granting || !!grantedPerm}
                  style={{
                    padding: "8px 14px", borderRadius: 7,
                    background: grantedPerm ? ACCENT_SOFT : ACCENT, color: grantedPerm ? ACCENT : INK,
                    border: grantedPerm ? `1px solid ${ACCENT}44` : "none",
                    fontSize: 12.5, fontWeight: 600, cursor: granting || grantedPerm ? "not-allowed" : "pointer",
                    opacity: granting ? 0.6 : 1,
                  }}
                >
                  {granting ? "Requesting…" : grantedPerm ? "✓ Permission granted" : "Grant via MetaMask"}
                </button>
                <span style={{ fontSize: 10.5, color: grantedPerm ? ACCENT : MID }}>
                  {grantedPerm
                    ? `● Active · expires ${new Date(grantedPerm.expiresAt * 1000).toLocaleDateString()}`
                    : "● Not granted"}
                </span>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
          <button
            onClick={onClose}
            style={{ padding: "9px 14px", borderRadius: 7, background: "transparent", border: `1px solid ${LINE_MID}`, color: TEXT2, fontSize: 12.5, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !name.trim() || !goal.trim()}
            style={{
              padding: "9px 16px", borderRadius: 7,
              background: ACCENT, color: INK, border: "none",
              fontSize: 12.5, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "Creating…" : "Create agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Delegate Modal (Fix 2: real delegation step 0)
// ─────────────────────────────────────────────────────────────────────────────

function DelegateModal({
  parent, candidates, onClose, onDone,
}: {
  parent:     Agent;
  candidates: Agent[];
  onClose:    () => void;
  onDone:     () => Promise<void> | void;
}) {
  const [childId,     setChildId]     = useState(candidates[0]?.id ?? "");
  const [cap,         setCap]         = useState("1");
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // Fix 2: step 0 — grant permission if parent has no real delegation
  const [granting,    setGranting]    = useState(false);
  const [localPerm,   setLocalPerm]   = useState(() => metamaskStore.getState().permission);
  const parentIsReal  = hasRealDelegation(parent);

  useEffect(() => {
    const u = metamaskStore.addListener(() => setLocalPerm(metamaskStore.getState().permission));
    return () => u();
  }, []);

  const parentCap = Number.parseFloat(parent.delegationCap ?? parent.budgetUsdc) || 0;

  const grantAndBind = async () => {
    setGranting(true);
    try {
      await metamaskStore.requestPermission(parent.budgetUsdc, 30, parent.goal.slice(0, 60));
      const perm = metamaskStore.getState().permission;
      if (perm) {
        await fetch(`/api/agent/${parent.id}/delegate-from-user`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            permissionsContext:        perm.permissionsContext,
            delegationManagerAddress:  perm.delegationManager,
            delegationHash:            "0xpending",
            capUsdc:                   parent.budgetUsdc,
          }),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGranting(false);
    }
  };

  const submit = async () => {
    if (!childId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/${parent.id}/delegate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childAgentId: childId, capUsdc: cap }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
      } else {
        await onDone();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSubmitting(false); }
  };

  const delegationBadge = parentIsReal || (localPerm && localPerm.permissionsContext)
    ? { label: "● real on-chain", color: ACCENT }
    : { label: "● needs permission — grant first", color: MID };

  if (candidates.length === 0) {
    return (
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(11,12,9,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 14, padding: "28px 32px", width: 440, color: TEXT, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div style={{ fontSize: 22, fontWeight: 500, fontFamily: "var(--serif)", fontStyle: "italic" }}>No agents to delegate to.</div>
          <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.5 }}>
            Create another agent first, then come back here to grant it a sub-delegation of <strong>{parent.name}</strong>&apos;s budget.
          </div>
          <button onClick={onClose} style={{ marginTop: 12, padding: "9px 14px", borderRadius: 7, background: ACCENT, color: INK, border: "none", fontWeight: 600, cursor: "pointer" }}>
            Got it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(11,12,9,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 14,
          padding: "28px 32px", width: 520, maxWidth: "100%", color: TEXT,
          display: "flex", flexDirection: "column", gap: 18,
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 11, color: MID, letterSpacing: "0.14em", textTransform: "uppercase" }}>Agent-to-agent delegation</div>
            <span style={{ fontSize: 10, color: delegationBadge.color, letterSpacing: "0.04em" }}>{delegationBadge.label}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, marginTop: 6, fontFamily: "var(--serif)", fontStyle: "italic", letterSpacing: "-0.015em" }}>
            {parent.name} delegates to…
          </div>
          <div style={{ fontSize: 12, color: TEXT2, marginTop: 4 }}>
            Sub-delegates a slice of {parent.name}&apos;s {parentCap} USDC budget to a child agent.
          </div>
        </div>

        {/* Fix 2: Step 0 — if no real context, offer grant */}
        {!parentIsReal && (
          <div style={{
            padding: "12px 14px", borderRadius: 9, background: "rgba(200,255,61,0.06)",
            border: `1px solid rgba(200,255,61,0.18)`,
          }}>
            <div style={{ fontSize: 12, color: TEXT2, marginBottom: 10, lineHeight: 1.5 }}>
              Parent agent needs a real delegation. Grant ERC-7715 permission first to enable on-chain sub-delegation.
            </div>
            <button
              onClick={grantAndBind}
              disabled={granting || !!localPerm}
              style={{
                padding: "7px 14px", borderRadius: 7,
                background: localPerm ? ACCENT_SOFT : ACCENT,
                color: localPerm ? ACCENT : INK,
                border: localPerm ? `1px solid ${ACCENT}44` : "none",
                fontSize: 12, fontWeight: 600, cursor: granting || localPerm ? "not-allowed" : "pointer",
                opacity: granting ? 0.6 : 1,
              }}
            >
              {granting ? "Requesting…" : localPerm ? "✓ Permission granted" : "Grant permission"}
            </button>
          </div>
        )}

        <Field label="Child agent">
          <select value={childId} onChange={(e) => setChildId(e.target.value)} style={inputStyle()}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.delegationStatus === "active" ? "(already delegated)" : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label={`Cap (max ${parentCap} USDC)`}>
          <input type="text" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} style={inputStyle()} />
        </Field>

        {error && (
          <div style={{ fontSize: 12, color: "#FF8A66", padding: "8px 12px", border: "1px solid rgba(255,138,102,0.3)", borderRadius: 7, background: "rgba(255,138,102,0.06)" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
          <div style={{ fontSize: 11, color: MID, letterSpacing: "0.04em" }}>via 1Shot redelegate · revocable on-chain</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onClose}
              style={{ padding: "9px 14px", borderRadius: 7, background: "transparent", border: `1px solid ${LINE_MID}`, color: TEXT2, fontSize: 12.5, cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting || !childId || !cap}
              style={{
                padding: "9px 16px", borderRadius: 7, background: ACCENT, color: INK, border: "none",
                fontSize: 12.5, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "Delegating…" : "Delegate"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared form helpers
// ─────────────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 10.5, color: MID, letterSpacing: "0.06em" }}>{label}</span>
      {children}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    background: "rgba(244,241,234,0.04)",
    border: `1px solid ${LINE_MID}`,
    color: TEXT,
    fontSize: 13,
    padding: "9px 11px",
    borderRadius: 7,
    outline: "none",
    fontFamily: "var(--sans)",
    letterSpacing: "-0.005em",
  };
}
