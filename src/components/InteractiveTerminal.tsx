"use client";

import React, { useEffect, useRef } from "react";
import { Terminal, Shield, CheckCircle, ChevronRight, XCircle } from "lucide-react";
import { TerminalLog } from "@/lib/walletEmulator";

interface InteractiveTerminalProps {
  logs: TerminalLog[];
  onClear: () => void;
}

export default function InteractiveTerminal({ logs, onClear }: InteractiveTerminalProps) {
  const containerEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerEndRef.current) {
      containerEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const getLogColors = (type: TerminalLog["type"]) => {
    switch (type) {
      case "success":
        return {
          text: "text-emerald-400 font-semibold",
          bg: "bg-emerald-500/10 border-emerald-500/20"
        };
      case "warning":
        return {
          text: "text-amber-400",
          bg: "bg-amber-500/5 border-amber-500/15"
        };
      case "error":
        return {
          text: "text-red-400 font-bold",
          bg: "bg-red-500/10 border-red-500/20"
        };
      case "code":
        return {
          text: "text-purple-300 font-mono",
          bg: "bg-[#090909] border-[#1a1a1a]"
        };
      case "meta":
        return {
          text: "text-[#edff70]/90 italic font-mono",
          bg: "bg-[#edff70]/5 border-[#edff70]/10"
        };
      default:
        return {
          text: "text-zinc-300",
          bg: "bg-transparent border-transparent"
        };
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-[300px] max-h-[500px] border border-glass-border bg-[#030303]/95 rounded-xl overflow-hidden font-mono text-[11.5px] leading-5">
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#0a0a0a] border-b border-glass-border">
        <div className="flex items-center gap-2 text-zinc-400">
          <Terminal size={14} className="text-[#f8286d]" />
          <span className="font-bold tracking-tight text-zinc-300 uppercase text-[10px]">Clove Agent Core Logs</span>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 mr-2">
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
        </div>
      </div>

      {/* Terminal Body Screen */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2">
            <Shield size={24} className="text-zinc-700 animate-pulse" />
            <span className="italic">Agent offline. Input strategy prompt or hit play to trigger automation.</span>
          </div>
        ) : (
          logs.map((log) => {
            const styles = getLogColors(log.type);
            const isPlain = log.type === "info";
            
            return (
              <div 
                key={log.id} 
                className={`p-2.5 rounded-md border flex flex-col gap-1 transition-all duration-200 ${styles.bg}`}
              >
                <div className="flex items-start gap-2">
                  {!isPlain && (
                    <span className="text-[10px] text-zinc-500 tracking-tight shrink-0 mt-0.5 font-bold uppercase">
                      [{log.type}]
                    </span>
                  )}
                  <div className={`flex-1 break-all whitespace-pre-wrap ${styles.text}`}>
                    {log.message}
                  </div>
                  <span className="text-[9px] text-zinc-600 self-start mt-0.5 select-none shrink-0 font-light">
                    {log.timestamp}
                  </span>
                </div>
                
                {log.details && (
                  <div className="mt-1 px-2.5 py-1.5 rounded border border-zinc-900 bg-black/40 text-[10.5px] leading-4 text-zinc-400 break-all select-all whitespace-pre">
                    {log.details}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={containerEndRef} />
      </div>
    </div>
  );
}
