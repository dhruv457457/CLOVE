"use client";

import React, { useState, useRef, useEffect } from "react";
import { Play, Pause, Plus, Trash2, Settings, Zap } from "lucide-react";
import { BlueprintNode, BlueprintEdge } from "@/lib/aiCompiler";

interface BlueprintCanvasProps {
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  onNodesChange: (nodes: BlueprintNode[]) => void;
  onEdgesChange: (edges: BlueprintEdge[]) => void;
  isExecuting: boolean;
  activeNodeId: string | null;
}

export default function BlueprintCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  isExecuting,
  activeNodeId
}: BlueprintCanvasProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragStartOffset = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Animation state for the pulse along the lines
  const [pulseProgress, setPulseProgress] = useState(0);

  useEffect(() => {
    if (!isExecuting) {
      setPulseProgress(0);
      return;
    }
    const interval = setInterval(() => {
      setPulseProgress((prev) => (prev >= 1 ? 0 : prev + 0.015));
    }, 30);
    return () => clearInterval(interval);
  }, [isExecuting]);

  // Handle dragging
  const handleNodeMouseDown = (e: React.MouseEvent, node: BlueprintNode) => {
    if (draggingNodeId) return;
    e.stopPropagation();
    setSelectedNodeId(node.id);
    setDraggingNodeId(node.id);
    
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragStartOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!draggingNodeId || !containerRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - containerRect.left - dragStartOffset.current.x;
    const y = e.clientY - containerRect.top - dragStartOffset.current.y;
    
    // Grid snapping (12px grid)
    const snapGrid = (val: number) => Math.round(val / 12) * 12;

    onNodesChange(
      nodes.map((node) => {
        if (node.id === draggingNodeId) {
          return {
            ...node,
            x: Math.max(20, Math.min(containerRect.width - 240, snapGrid(x))),
            y: Math.max(20, Math.min(containerRect.height - 140, snapGrid(y)))
          };
        }
        return node;
      })
    );
  };

  const handleMouseUp = () => {
    setDraggingNodeId(null);
  };

  // Node coloring details based on type
  const getNodeStyles = (type: BlueprintNode["type"]) => {
    switch (type) {
      case "trigger":
        return {
          border: "border-[#edff70]/30 hover:border-[#edff70]/80",
          glow: "shadow-[0_0_15px_rgba(237,255,112,0.1)]",
          tagBg: "bg-[#edff70]/10 text-[#edff70]"
        };
      case "budget":
        return {
          border: "border-cyan-400/30 hover:border-cyan-400/80",
          glow: "shadow-[0_0_15px_rgba(34,211,238,0.1)]",
          tagBg: "bg-cyan-500/10 text-cyan-400"
        };
      case "intelligence":
        return {
          border: "border-[#f8286d]/30 hover:border-[#f8286d]/80",
          glow: "shadow-[0_0_15px_rgba(248,40,109,0.15)]",
          tagBg: "bg-[#f8286d]/10 text-[#f8286d]"
        };
      case "defi":
        return {
          border: "border-[#ff3ec5]/30 hover:border-[#ff3ec5]/80",
          glow: "shadow-[0_0_15px_rgba(255,62,197,0.15)]",
          tagBg: "bg-[#ff3ec5]/10 text-[#ff3ec5]"
        };
      case "notify":
        return {
          border: "border-amber-400/30 hover:border-amber-400/80",
          glow: "shadow-[0_0_15px_rgba(251,191,36,0.1)]",
          tagBg: "bg-amber-500/10 text-amber-400"
        };
    }
  };

  // Bezier curve calculations for SVG paths
  const getBezierPath = (x1: number, y1: number, x2: number, y2: number) => {
    const controlOffset = Math.max(60, Math.abs(x2 - x1) * 0.4);
    return `M ${x1} ${y1} C ${x1 + controlOffset} ${y1}, ${x2 - controlOffset} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div className="relative flex flex-col flex-1 min-h-[460px] select-none rounded-xl border border-glass-border bg-[#050505] overflow-hidden">
      
      {/* Handdrawn line warp SVG filter */}
      <svg style={{ position: "absolute", width: 0, height: 0 }} width="0" height="0">
        <defs>
          <filter id="blueprint-sketch" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      {/* Grid drafting board */}
      <div 
        ref={containerRef}
        className="absolute inset-0 blueprint-radial-grid opacity-75"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* SVG connection pathways */}
        <svg className="absolute inset-0 pointer-events-none w-full h-full">
          {edges.map((edge) => {
            const sourceNode = nodes.find((n) => n.id === edge.source);
            const targetNode = nodes.find((n) => n.id === edge.target);
            if (!sourceNode || !targetNode) return null;

            // Compute connection terminals
            const startX = sourceNode.x + 220; // right middle port
            const startY = sourceNode.y + 40;
            const endX = targetNode.x; // left middle port
            const endY = targetNode.y + 40;

            const path = getBezierPath(startX, startY, endX, endY);
            const isActive = isExecuting && 
              (activeNodeId === sourceNode.id || activeNodeId === targetNode.id);

            // Compute flow particle location
            let dotX = 0;
            let dotY = 0;
            if (isExecuting) {
              const t = pulseProgress;
              const ctrlX1 = startX + Math.max(60, Math.abs(endX - startX) * 0.4);
              const ctrlY1 = startY;
              const ctrlX2 = endX - Math.max(60, Math.abs(endX - startX) * 0.4);
              const ctrlY2 = endY;

              // Cubic Bezier curve formula
              dotX = (1 - t) ** 3 * startX + 3 * (1 - t) ** 2 * t * ctrlX1 + 3 * (1 - t) * t ** 2 * ctrlX2 + t ** 3 * endX;
              dotY = (1 - t) ** 3 * startY + 3 * (1 - t) ** 2 * t * ctrlY1 + 3 * (1 - t) * t ** 2 * ctrlY2 + t ** 3 * endY;
            }

            return (
              <g key={edge.id} filter="url(#blueprint-sketch)">
                {/* Background glow path */}
                <path
                  d={path}
                  fill="none"
                  stroke={isActive ? "#edff70" : "#ffffff"}
                  strokeWidth={isActive ? 3 : 1.5}
                  className={`transition-all duration-300 ${
                    isActive ? "stroke-opacity-80" : "stroke-opacity-10"
                  }`}
                />
                
                {/* Active flow signal dashes */}
                {isActive && (
                  <path
                    d={path}
                    fill="none"
                    stroke="#f8286d"
                    strokeWidth={3}
                    strokeDasharray="5, 10"
                    className="animate-flow-dash stroke-opacity-90"
                  />
                )}

                {/* Simulated travelling particle */}
                {isExecuting && (
                  <circle
                    cx={dotX}
                    cy={dotY}
                    r={5}
                    fill="#edff70"
                    className="shadow-lg filter drop-shadow-[0_0_6px_#edff70]"
                  />
                )}
              </g>
            );
          })}
        </svg>

        {/* Workflow Node Blocks */}
        {nodes.map((node) => {
          const styles = getNodeStyles(node.type);
          const isSelected = selectedNodeId === node.id;
          const isActive = activeNodeId === node.id;
          
          return (
            <div
              key={node.id}
              style={{
                left: `${node.x}px`,
                top: `${node.y}px`,
                position: "absolute"
              }}
              onMouseDown={(e) => handleNodeMouseDown(e, node)}
              className={`w-[220px] rounded-lg border bg-[#090909]/95 p-3.5 backdrop-blur-md cursor-grab active:cursor-grabbing transition-shadow duration-200 ${
                styles.border
              } ${styles.glow} ${
                isSelected ? "ring-1 ring-[#f8286d]" : ""
              } ${
                isActive ? "border-[#edff70] ring-1 ring-[#edff70]" : ""
              }`}
            >
              {/* Displacement filter on node borders */}
              <div 
                className="absolute inset-0 pointer-events-none rounded-lg border border-transparent"
                style={{ filter: "url(#blueprint-sketch)" }}
              />

              <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] uppercase tracking-widest font-mono font-bold px-1.5 py-0.5 rounded ${styles.tagBg}`}>
                  {node.type}
                </span>
                
                {isActive && (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#edff70] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#edff70]"></span>
                  </span>
                )}
              </div>

              <h3 className="text-sm font-semibold tracking-tight text-white mb-0.5 font-sans select-none">
                {node.label}
              </h3>
              <p className="text-[11px] leading-4 text-zinc-400 select-none">
                {node.description}
              </p>

              {/* Staggered connection terminal ports */}
              <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3 h-3 rounded-full border border-zinc-700 bg-black flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
              </div>
              <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 rounded-full border border-zinc-700 bg-black flex items-center justify-center">
                <div className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-[#edff70]" : "bg-zinc-600"}`} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Grid instructions overlay overlay */}
      <div className="absolute bottom-3 left-4 flex gap-4 text-[10px] font-mono text-zinc-500 pointer-events-none select-none z-10">
        <span>GRID: Snapped (12px)</span>
        <span>FILTER: Sketch active</span>
        <span>NODES: {nodes.length}</span>
      </div>

      {/* Node controller bar */}
      <div className="absolute top-3 right-4 flex gap-1.5 z-10">
        <button
          onClick={() => {
            const id = `custom-node-${nodes.length}`;
            const newNode: BlueprintNode = {
              id,
              type: "notify",
              label: "New Notification",
              description: "Custom trigger notification logs.",
              x: 100 + Math.random() * 80,
              y: 220 + Math.random() * 40,
              config: { channel: "Custom" }
            };
            onNodesChange([...nodes, newNode]);
            if (nodes.length > 0) {
              const lastNode = nodes[nodes.length - 1];
              onEdgesChange([...edges, { id: `e-custom-${edges.length}`, source: lastNode.id, target: id }]);
            }
          }}
          className="p-1.5 rounded-md border border-glass-border bg-glass-bg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          title="Add Node"
        >
          <Plus size={14} />
        </button>
        <button
          onClick={() => {
            if (selectedNodeId) {
              onNodesChange(nodes.filter(n => n.id !== selectedNodeId));
              onEdgesChange(edges.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId));
              setSelectedNodeId(null);
            }
          }}
          disabled={!selectedNodeId}
          className="p-1.5 rounded-md border border-glass-border bg-glass-bg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:hover:text-zinc-400 disabled:hover:bg-transparent transition-colors"
          title="Delete Selected Node"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
