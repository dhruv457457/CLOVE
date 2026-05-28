"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
} from "@xyflow/react";

/** Fits all thought nodes into view after async hydration from DB */
function FitViewOnLoad({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (nodeCount > 0) setTimeout(() => fitView({ padding: 0.3, duration: 400 }), 80);
  }, [nodeCount, fitView]);
  return null;
}
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Play, RefreshCw } from "lucide-react";
import AgentThoughtNode from "@/components/AgentThoughtNode";
import AgentIdentityCard from "@/components/AgentIdentityCard";
import { metamaskStore } from "@/lib/web3/metamaskStore";

const INK    = "#0B0C09";
const INK_1  = "#111210";
const ACCENT = "#C8FF3D";
const TEXT   = "#E8E5DA";
const TEXT2  = "#B5B2A5";
const MID    = "#6B6A60";
const LINE   = "rgba(244,241,234,0.06)";
const ACCENT_GLOW = "rgba(200,255,61,0.35)";

interface Agent {
  id:           string;
  name:         string;
  goal:         string;
  budgetUsdc:   string;
  mediaPolicy:  "off" | "milestones" | "daily" | "every-run";
  status:       string;
}

interface Thought {
  id:        string;
  agentId:   string;
  runId:     string;
  type:      "goal" | "plan" | "tool-call" | "tool-result" | "reflect" | "media";
  content:   Record<string, unknown>;
  parentId:  string | null;
  position:  { x: number; y: number };
}

const NODE_TYPES: NodeTypes = { "agent-thought": AgentThoughtNode };

export default function AgentInnerCanvasPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const agentId = params.id;

  const [agent, setAgent]       = useState<Agent | null>(null);
  const [running, setRunning]   = useState(false);
  const [phase, setPhase]       = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const esRef = useRef<EventSource | null>(null);

  // Load agent + replay last run's thoughts
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agent/${agentId}`);
        if (!res.ok) return;
        const data = (await res.json()) as { agent: Agent; thoughts: Thought[] };
        if (cancelled) return;
        setAgent(data.agent);
        hydrateCanvas(data.thoughts, setNodes, setEdges);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [agentId, setNodes, setEdges]);

  // Append a new thought to the canvas with the fade-in animation
  const appendThought = useCallback((t: Thought) => {
    setNodes((prev) => {
      if (prev.find((n) => n.id === t.id)) return prev;
      return [
        ...prev,
        {
          id:       t.id,
          type:     "agent-thought",
          position: t.position,
          data:     { type: t.type, content: t.content, fresh: true },
        },
      ];
    });
    if (t.parentId) {
      setEdges((prev) => {
        if (prev.find((e) => e.id === `e_${t.parentId}_${t.id}`)) return prev;
        return [...prev, {
          id:     `e_${t.parentId}_${t.id}`,
          source: t.parentId!,
          target: t.id,
          animated: t.type === "tool-call",
          style: t.type === "tool-call"
            ? { stroke: ACCENT, strokeWidth: 1.25, strokeDasharray: "3 7" }
            : { stroke: "rgba(244,241,234,0.16)", strokeWidth: 1 },
          type: "smoothstep",
        }];
      });
    }
  }, [setNodes, setEdges]);

  const startRun = useCallback(async () => {
    if (running) return;
    setNodes([{
      id: "run-start",
      type: "agent-thought",
      position: { x: 200, y: 100 },
      data: { type: "goal", content: { text: agent?.goal ?? "" }, fresh: true },
    }]);
    setEdges([]);
    setRunning(true);
    setPhase("planning");

    const mm = metamaskStore.getState();
    const body = {
      agentId,
      walletAddress:      mm.userAddress,
      permissionsContext: mm.permission?.permissionsContext,
      delegationManager:  mm.permission?.delegationManager,
      delegationId:       mm.permission?.delegationId,
    };

    try {
      // SSE doesn't support POST natively in EventSource — use fetch+ReadableStream
      const res = await fetch("/api/agent/run-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.body) throw new Error("No stream body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          const lines = block.split("\n");
          let evName = "message";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event:")) evName = line.slice(6).trim();
            if (line.startsWith("data:"))  dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(dataStr); } catch { continue; }
          handleSseEvent(evName, payload);
        }
      }
    } catch (e) {
      console.warn("[inner-canvas] stream error:", e);
    } finally {
      setRunning(false);
      setPhase("");
      setRefreshKey(k => k + 1);  // re-fetch stats
    }
  }, [agentId, running, setNodes, setEdges]);

  const handleSseEvent = useCallback((evName: string, payload: Record<string, unknown>) => {
    if (evName === "thought") {
      appendThought(payload as unknown as Thought);
    }
    if (evName === "status") {
      setPhase(String(payload.phase ?? ""));
    }
    if (evName === "done") {
      setPhase("done");
    }
  }, [appendThought]);

  useEffect(() => () => { esRef.current?.close(); }, []);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!agent) {
    return (
      <div style={{ background: INK, color: TEXT, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading agent…
      </div>
    );
  }

  return (
    <div
      style={{
        background: INK,
        color: TEXT,
        height: "100vh",
        width: "100vw",
        display: "grid",
        gridTemplateColumns: "1fr 320px",
        gridTemplateRows: "56px 1fr",
        gridTemplateAreas: `"top top" "canvas right"`,
        overflow: "hidden",
        fontFamily: "var(--sans)",
      }}
    >
      {/* Top bar */}
      <header
        style={{
          gridArea: "top",
          display: "flex",
          alignItems: "center",
          padding: "0 18px",
          gap: 14,
          borderBottom: `1px solid ${LINE}`,
        }}
      >
        <button
          onClick={() => router.push("/dashboard")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "transparent", border: "none", color: TEXT2,
            cursor: "pointer", fontSize: 13, padding: "6px 8px",
          }}
        >
          <ArrowLeft size={14} /> Agents
        </button>
        <span style={{ color: MID, fontSize: 12 }}>/</span>
        <span style={{ fontSize: 14, fontWeight: 500, color: TEXT, letterSpacing: "-0.005em" }}>
          {agent.name}
        </span>
        <span style={{ fontSize: 11.5, color: TEXT2, fontStyle: "italic", fontFamily: "var(--serif)" }}>
          &ldquo;{agent.goal.slice(0, 60)}{agent.goal.length > 60 ? "…" : ""}&rdquo;
        </span>

        <div style={{ flex: 1 }} />

        {phase && (
          <span style={{ fontSize: 11, color: ACCENT, letterSpacing: "0.06em", textTransform: "lowercase" }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: ACCENT, boxShadow: `0 0 8px ${ACCENT_GLOW}`, marginRight: 6 }} />
            {phase}
          </span>
        )}

        <button
          onClick={startRun}
          disabled={running}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "6px 14px", borderRadius: 7,
            background: ACCENT, color: INK,
            border: "none", fontWeight: 600, fontSize: 12.5,
            cursor: running ? "not-allowed" : "pointer",
            opacity: running ? 0.6 : 1,
            transition: "transform .15s",
          }}
        >
          {running
            ? <><RefreshCw size={11} className="animate-spin" /> Running</>
            : <><Play size={10} fill={INK} stroke="none" /> Run agent</>}
        </button>
      </header>

      {/* Canvas */}
      <section style={{ gridArea: "canvas", position: "relative", overflow: "hidden", borderRight: `1px solid ${LINE}` }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24} size={1}
            color="rgba(244,241,234,0.06)"
          />
          {/* Fit history nodes into view after async DB load */}
          <FitViewOnLoad nodeCount={nodes.length} />
        </ReactFlow>

        {/* Empty state */}
        {nodes.length === 0 && !running && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              pointerEvents: "none",
            }}
          >
            <div style={{ fontSize: 14, color: MID, letterSpacing: "0.04em", fontFamily: "var(--serif)", fontStyle: "italic" }}>
              The agent is at rest.
            </div>
            <div style={{ fontSize: 12, color: MID }}>
              Click <span style={{ color: ACCENT }}>Run agent</span> to watch it think.
            </div>
          </div>
        )}
      </section>

      {/* Right panel: identity card */}
      <aside
        style={{
          gridArea: "right",
          padding: "20px 22px 26px",
          overflowY: "auto",
          background: INK,
        }}
      >
        <AgentIdentityCard agentId={agentId} agent={agent} refreshKey={refreshKey} />
      </aside>
    </div>
  );
}

// ── Hydration ─────────────────────────────────────────────────────────────────

function hydrateCanvas(
  thoughts: Thought[],
  setNodes: (n: Node[]) => void,
  setEdges: (e: Edge[]) => void,
) {
  const nodes: Node[] = thoughts.map((t) => ({
    id:       t.id,
    type:     "agent-thought",
    position: t.position,
    data:     { type: t.type, content: t.content, fresh: false },
  }));
  const edges: Edge[] = thoughts
    .filter((t) => t.parentId)
    .map((t) => ({
      id:     `e_${t.parentId}_${t.id}`,
      source: t.parentId!,
      target: t.id,
      type:   "smoothstep",
      style:  { stroke: "rgba(244,241,234,0.16)", strokeWidth: 1 },
    }));
  setNodes(nodes);
  setEdges(edges);
}
