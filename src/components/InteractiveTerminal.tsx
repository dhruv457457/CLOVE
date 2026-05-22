"use client";

import React, { useEffect, useRef, useState } from "react";
import { Terminal, Shield, ChevronDown, ChevronUp, X } from "lucide-react";
import { TerminalLog } from "@/lib/walletEmulator";

interface InteractiveTerminalProps {
  logs: TerminalLog[];
  onClear: () => void;
}

export default function InteractiveTerminal({ logs, onClear }: InteractiveTerminalProps) {
  const bodyRef        = useRef<HTMLDivElement>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed]   = useState(false);
  const [height, setHeight]         = useState(220);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  // Auto-scroll to bottom on new log
  useEffect(() => {
    if (!collapsed && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs, collapsed]);

  // ── Drag-to-resize handle ──────────────────────────────────────────────────
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartH.current = height;
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const delta = dragStartY.current - e.clientY; // drag up = taller
      const next  = Math.max(100, Math.min(600, dragStartH.current + delta));
      setHeight(next);
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isDragging]);

  const getLogColors = (type: TerminalLog["type"]) => {
    switch (type) {
      case "success": return { text: "text-emerald-400 font-semibold", bg: "bg-emerald-500/10 border-emerald-500/20" };
      case "warning": return { text: "text-amber-400",                 bg: "bg-amber-500/5 border-amber-500/15"    };
      case "error":   return { text: "text-red-400 font-bold",         bg: "bg-red-500/10 border-red-500/20"       };
      case "code":    return { text: "text-purple-300 font-mono",      bg: "bg-[#090909] border-[#1a1a1a]"         };
      case "meta":    return { text: "text-[#edff70]/90 italic font-mono", bg: "bg-[#edff70]/5 border-[#edff70]/10" };
      default:        return { text: "text-zinc-300",                  bg: "bg-transparent border-transparent"     };
    }
  };

  return (
    <div ref={containerRef} className="flex flex-col flex-shrink-0 border border-glass-border bg-[#030303]/95 rounded-xl overflow-hidden font-mono text-[11.5px] leading-5" style={{ userSelect: isDragging ? "none" : undefined }}>

      {/* Drag handle — top edge, drag UP to expand */}
      <div
        onMouseDown={onDragStart}
        className="h-1.5 w-full cursor-ns-resize bg-transparent hover:bg-[rgba(21,133,105,0.3)] transition-colors flex-shrink-0"
        title="Drag to resize"
      />

      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#0a0a0a] border-b border-glass-border flex-shrink-0">
        <div className="flex items-center gap-2 text-zinc-400">
          <Terminal size={13} className="text-[#f8286d]" />
          <span className="font-bold tracking-tight text-zinc-300 uppercase text-[10px]">
            Clove Agent Core Logs
          </span>
          {logs.length > 0 && (
            <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-[rgba(21,133,105,0.15)] text-[#1aad89] font-mono">
              {logs.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 mr-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/30" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/30" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/30" />
          </div>

          <button
            onClick={onClear}
            className="text-[9px] px-2 py-0.5 rounded border border-glass-border text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            CLEAR LOGS
          </button>

          {/* Collapse / expand toggle */}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title={collapsed ? "Expand terminal" : "Collapse terminal"}
          >
            {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* Body — hidden when collapsed */}
      {!collapsed && (
        <div
          ref={bodyRef}
          className="overflow-y-auto p-3 space-y-1.5"
          style={{ height }}
        >
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2 py-6">
              <Shield size={22} className="text-zinc-700 animate-pulse" />
              <span className="italic text-[10px]">Agent offline. Compile a strategy and hit Run.</span>
            </div>
          ) : (
            logs.map((log) => {
              const styles  = getLogColors(log.type);
              const isPlain = log.type === "info";
              return (
                <div
                  key={log.id}
                  className={`px-2.5 py-1.5 rounded border flex items-start gap-2 transition-all ${styles.bg}`}
                >
                  {!isPlain && (
                    <span className="text-[9px] text-zinc-500 tracking-tight shrink-0 font-bold uppercase mt-0.5">
                      [{log.type}]
                    </span>
                  )}
                  <span className={`flex-1 break-all whitespace-pre-wrap text-[11px] ${styles.text}`}>
                    {log.message}
                  </span>
                  <span className="text-[9px] text-zinc-600 shrink-0 mt-0.5 select-none">
                    {log.timestamp}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
