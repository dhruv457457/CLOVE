"use client";

import React, { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type Connection,
  BackgroundVariant,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Zap, Brain, DollarSign, Bell, GitBranch, TrendingUp, Globe, Search, Image, AlertTriangle, BarChart2, Activity } from "lucide-react";
import type { BlueprintNode, BlueprintEdge } from "@/lib/aiCompiler";
import { PROTOCOL_METADATA } from "@/lib/protocols/actions";
import { PROTOCOL_LOGOS } from "@/lib/protocols/logos";

// ── Node colour + icon mapping ────────────────────────────────────────────────

const NODE_STYLES: Record<string, { border: string; glow: string; bg: string; icon: React.ReactNode }> = {
  trigger:              { border: "#10B981", glow: "rgba(16,185,129,0.35)",  bg: "#0a1a12", icon: <Zap       size={12} className="text-emerald-400" /> },
  budget:               { border: "#F59E0B", glow: "rgba(245,158,11,0.35)",  bg: "#1a1200", icon: <DollarSign size={12} className="text-amber-400"   /> },
  intelligence:         { border: "#8B5CF6", glow: "rgba(139,92,246,0.35)",  bg: "#100a1a", icon: <Brain      size={12} className="text-violet-400"  /> },
  "intelligence-tavily":{ border: "#06B6D4", glow: "rgba(6,182,212,0.35)",   bg: "#00101a", icon: <Globe      size={12} className="text-cyan-400"    /> },
  "intelligence-exa":   { border: "#A78BFA", glow: "rgba(167,139,250,0.35)", bg: "#0d0a1a", icon: <Search     size={12} className="text-purple-300"  /> },
  "intelligence-fal":   { border: "#F472B6", glow: "rgba(244,114,182,0.35)", bg: "#1a0010", icon: <Image         size={12} className="text-pink-300"    /> },
  "risk-check":         { border: "#EF4444", glow: "rgba(239,68,68,0.35)",   bg: "#1a0000", icon: <AlertTriangle  size={12} className="text-red-400"     /> },
  "compare-apy":        { border: "#34D399", glow: "rgba(52,211,153,0.35)",  bg: "#001a0f", icon: <BarChart2      size={12} className="text-emerald-300" /> },
  "sentiment-check":    { border: "#FBBF24", glow: "rgba(251,191,36,0.35)",  bg: "#1a1000", icon: <Activity       size={12} className="text-yellow-400"  /> },
  "defi-swap": { border: "#FF007A", glow: "rgba(255,0,122,0.35)",   bg: "#1a000a", icon: <TrendingUp size={12} className="text-pink-400"    /> },
  "defi-lend": { border: "#2470ff", glow: "rgba(36,112,255,0.35)",  bg: "#000a1a", icon: <TrendingUp size={12} className="text-blue-400"    /> },
  "defi-stake":{ border: "#00a3ff", glow: "rgba(0,163,255,0.35)",   bg: "#00080f", icon: <TrendingUp size={12} className="text-sky-400"     /> },
  "defi-save": { border: "#f4b731", glow: "rgba(244,183,49,0.35)",  bg: "#100800", icon: <TrendingUp size={12} className="text-yellow-400"  /> },
  "defi-lp":   { border: "#ff6b00", glow: "rgba(255,107,0,0.35)",   bg: "#100400", icon: <TrendingUp size={12} className="text-orange-400"  /> },
  defi:        { border: "#10B981", glow: "rgba(16,185,129,0.35)",  bg: "#0a1a12", icon: <TrendingUp size={12} className="text-emerald-400" /> },
  condition:   { border: "#EC4899", glow: "rgba(236,72,153,0.35)",  bg: "#1a0010", icon: <GitBranch  size={12} className="text-pink-400"    /> },
  notify:      { border: "#60A5FA", glow: "rgba(96,165,250,0.35)",  bg: "#000a1a", icon: <Bell       size={12} className="text-blue-300"    /> },
};
const DEFAULT_STYLE = NODE_STYLES.defi;

// ── Custom node component ─────────────────────────────────────────────────────

function WorkflowNode({ data, selected }: { data: BlueprintNode & { isActive: boolean }; selected?: boolean }) {
  const style = NODE_STYLES[data.type] ?? DEFAULT_STYLE;
  const isActive = data.isActive;
  const protocolMeta = data.protocol ? PROTOCOL_METADATA[data.protocol] : null;

  return (
    <div
      className="relative rounded-xl overflow-visible cursor-default"
      style={{
        minWidth: 170,
        maxWidth: 200,
        background: style.bg,
        border: `1.5px solid ${isActive || selected ? style.border : `${style.border}55`}`,
        boxShadow: isActive
          ? `0 0 22px ${style.glow}, 0 0 6px ${style.glow}`
          : selected ? `0 0 12px ${style.glow}` : "none",
        transition: "all 0.2s ease",
      }}
    >
      {isActive && (
        <div
          className="absolute inset-0 rounded-xl animate-ping pointer-events-none"
          style={{ border: `1px solid ${style.border}`, opacity: 0.35 }}
        />
      )}

      <Handle
        type="target"
        position={Position.Left}
        style={{ background: style.border, width: 8, height: 8, border: "2px solid #0a0f0c" }}
      />

      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ borderColor: `${style.border}33`, background: `${style.border}10` }}
      >
        <span className="flex-shrink-0">{style.icon}</span>
        <span className="text-[11px] font-bold leading-tight text-white/85 truncate">{data.label}</span>
      </div>

      <div className="px-3 py-2">
        <p className="text-[9px] leading-relaxed text-white/40 line-clamp-2">{data.description}</p>
        {protocolMeta && (
          <div
            className="mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider"
            style={{
              color: protocolMeta.color,
              background: `${protocolMeta.color}15`,
              border: `1px solid ${protocolMeta.color}30`,
            }}
          >
            {data.protocol && PROTOCOL_LOGOS[data.protocol] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={PROTOCOL_LOGOS[data.protocol]}
                alt={data.protocol}
                width={10}
                height={10}
                className="rounded-sm"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            )}
            {protocolMeta.name}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: style.border, width: 8, height: 8, border: "2px solid #0a0f0c" }}
      />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { workflow: WorkflowNode };

// ── Conversion helpers ────────────────────────────────────────────────────────

function toRfNode(n: BlueprintNode, activeId: string | null): Node {
  return {
    id: n.id,
    type: "workflow",
    position: { x: n.x, y: n.y },
    data: { ...n, isActive: n.id === activeId },
  };
}

function toRfEdge(e: BlueprintEdge, animated: boolean): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    animated,
    style: { stroke: "#1aad8966", strokeWidth: 1.5 },
    type: "smoothstep",
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface BlueprintCanvasProps {
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  onNodesChange?: (nodes: BlueprintNode[]) => void;
  onEdgesChange?: (edges: BlueprintEdge[]) => void;
  isExecuting: boolean;
  activeNodeId: string | null;
  onNodeClick?: (node: BlueprintNode) => void;
}

export default function BlueprintCanvas({
  nodes: cloveNodes,
  edges: cloveEdges,
  isExecuting,
  activeNodeId,
  onNodeClick,
}: BlueprintCanvasProps) {
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState(
    useMemo(() => cloveNodes.map((n) => toRfNode(n, activeNodeId)), [])  // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState(
    useMemo(() => cloveEdges.map((e) => toRfEdge(e, isExecuting)), [])  // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Sync from external prop changes (new workflow compiled)
  React.useEffect(() => {
    setRfNodes(cloveNodes.map((n) => toRfNode(n, activeNodeId)));
  }, [cloveNodes, activeNodeId, setRfNodes]);

  React.useEffect(() => {
    setRfEdges(cloveEdges.map((e) => toRfEdge(e, isExecuting)));
  }, [cloveEdges, isExecuting, setRfEdges]);

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onRfNodesChange>[0]) => {
      onRfNodesChange(changes);
    },
    [onRfNodesChange]
  );

  const onConnect = useCallback(
    (connection: Connection) =>
      setRfEdges((eds) =>
        addEdge({ ...connection, animated: isExecuting, style: { stroke: "#1aad8966", strokeWidth: 1.5 }, type: "smoothstep" }, eds)
      ),
    [isExecuting, setRfEdges]
  );

  return (
    <div className="w-full h-full" style={{ background: "#060a08" }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onRfEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => onNodeClick?.(node.data as unknown as BlueprintNode)}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1a2e22" />
        <Controls
          showInteractive={false}
          style={{ background: "#0a0f0c", border: "1px solid rgba(21,133,105,0.2)", borderRadius: 8 }}
        />
        <MiniMap
          nodeColor={(n) => (NODE_STYLES[(n.data as unknown as BlueprintNode)?.type ?? "defi"] ?? DEFAULT_STYLE).border}
          maskColor="rgba(6,10,8,0.85)"
          style={{ background: "#0a0f0c", border: "1px solid rgba(21,133,105,0.15)", borderRadius: 8 }}
        />
      </ReactFlow>
    </div>
  );
}
