"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ReactFlow, Background, BackgroundVariant,
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge, type NodeTypes,
  Handle, Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Clock, Play, Shield } from "lucide-react";
import { metamaskStore } from "@/lib/web3/metamaskStore";

const INK       = "#0B0C09";
const INK_1     = "#111210";
const ACCENT    = "#C8FF3D";
const ACCENT_SOFT = "rgba(200,255,61,0.18)";
const ACCENT_GLOW = "rgba(200,255,61,0.35)";
const TEXT      = "#E8E5DA";
const TEXT2     = "#B5B2A5";
const MID       = "#6B6A60";
const LINE      = "rgba(244,241,234,0.06)";
const LINE_MID  = "rgba(244,241,234,0.11)";

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
        <span style={{ color: isReal ? ACCENT : MID }}>{isReal ? "● real" : "● demo"}</span>
      </div>
      <Handle type="source" position={Position.Right} style={{ width: 6, height: 6, background: border, right: -3 }} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { agent: AgentMiniNode };

export default function WorkflowDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const workflowId = params.id;

  const [tab, setTab] = useState<"canvas" | "history">("canvas");
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [agents, setAgents]     = useState<Agent[]>([]);
  const [runs, setRuns]         = useState<WorkflowRun[]>([]);
  const [running, setRunning]   = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

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

  useEffect(() => { loadWorkflow(); loadHistory(); }, [loadWorkflow, loadHistory]);

  // Build canvas from agents
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

  const runAll = useCallback(async () => {
    if (!workflow || agents.length === 0) return;
    // Find the agent that should be driven by cron (the one with scheduleIntervalMs)
    // or the last agent in the chain (Executor)
    const trigger = agents.find(a => a.scheduleIntervalMs) ?? agents[agents.length - 1];
    setRunning(trigger.id);
    try {
      const mm = metamaskStore.getState();
      await fetch("/api/agent/run-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId:            trigger.id,
          walletAddress:      mm.userAddress,
          permissionsContext: mm.permission?.permissionsContext,
          delegationManager:  mm.permission?.delegationManager,
        }),
      }).then(r => r.body?.getReader()).then(async (reader) => {
        if (!reader) return;
        while (true) { const { done } = await reader.read(); if (done) break; }
      });
      await Promise.all([loadWorkflow(), loadHistory()]);
    } finally { setRunning(null); }
  }, [agents, workflow, loadWorkflow, loadHistory]);

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
      {/* Top bar */}
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

        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: MID, letterSpacing: "0.04em" }}>
          <span style={{ color: workflow.permissionStatus === "active" ? ACCENT : MID }}>
            ● permission · {workflow.permissionStatus}
          </span>
          <span>{workflow.totalSpentUsdc.toFixed(3)} / {workflow.budgetUsdc} USDC</span>
        </div>

        <div style={{ display: "flex", background: INK_1, borderRadius: 7, padding: 2, border: `1px solid ${LINE}` }}>
          {(["canvas", "history"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "5px 12px", borderRadius: 5,
                background: tab === t ? "rgba(244,241,234,0.06)" : "transparent",
                border: "none", color: tab === t ? TEXT : MID,
                fontSize: 11.5, cursor: "pointer", letterSpacing: "-0.005em",
                textTransform: "capitalize",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <button
          onClick={runAll}
          disabled={!!running || agents.length === 0}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "6px 14px", borderRadius: 7,
            background: ACCENT, color: INK, border: "none",
            fontWeight: 600, fontSize: 12.5,
            cursor: running ? "not-allowed" : "pointer",
            opacity: running ? 0.6 : 1,
          }}
        >
          <Play size={10} fill={INK} stroke="none" />
          {running ? "Running…" : "Run workflow"}
        </button>
      </header>

      {/* Body */}
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
        </section>
      )}

      {tab === "history" && (
        <section style={{ overflowY: "auto", padding: "28px 40px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: MID, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 16 }}>
            <Clock size={11} /> Run history · {runs.length} run{runs.length !== 1 ? "s" : ""}
          </div>
          {runs.length === 0 ? (
            <div style={{ fontSize: 13, color: MID, fontStyle: "italic" }}>
              No runs yet. Click <span style={{ color: ACCENT }}>Run workflow</span> in the top bar to execute now, or set a schedule on the Executor agent.
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
    </div>
  );
}
