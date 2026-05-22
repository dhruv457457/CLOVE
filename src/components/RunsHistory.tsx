"use client";

import React from "react";
import { CheckCircle, XCircle, AlertTriangle, Clock, SkipForward } from "lucide-react";

export interface RunStep {
  nodeId:    string;
  nodeType:  string;
  label:     string;
  status:    "done" | "error" | "skipped" | "running" | "pending";
  error?:    string;
  durationMs: number;
  output?:   Record<string, unknown>;
}

export interface RunRecord {
  runId:     string;
  timestamp: number;
  success:   boolean;
  durationMs: number;
  steps:     RunStep[];
  error?:    string;
}

interface Props {
  runs: RunRecord[];
}

const STATUS_ICON = {
  done:    <CheckCircle  size={10} className="text-[#1aad89] flex-shrink-0" />,
  error:   <XCircle     size={10} className="text-red-400 flex-shrink-0"   />,
  skipped: <SkipForward size={10} className="text-[#3d6655] flex-shrink-0" />,
  running: <Clock       size={10} className="text-amber-400 flex-shrink-0" />,
  pending: <Clock       size={10} className="text-[#3d6655] flex-shrink-0" />,
};

export default function RunsHistory({ runs }: Props) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-[#3d6655]">
        <Clock size={18} />
        <p className="text-[10px] font-mono">No runs yet. Hit Run to start the agent.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      {runs.map(run => (
        <div
          key={run.runId}
          className="rounded-lg border border-[rgba(21,133,105,0.15)] bg-[rgba(0,0,0,0.3)] overflow-hidden"
        >
          {/* Run header */}
          <div className={`flex items-center justify-between px-3 py-2 border-b border-[rgba(21,133,105,0.1)] ${
            run.success ? "bg-[rgba(21,133,105,0.06)]" : "bg-[rgba(239,68,68,0.05)]"
          }`}>
            <div className="flex items-center gap-1.5">
              {run.success
                ? <CheckCircle size={11} className="text-[#1aad89]" />
                : <XCircle    size={11} className="text-red-400"    />
              }
              <span className={`text-[10px] font-bold font-mono ${run.success ? "text-[#1aad89]" : "text-red-400"}`}>
                {run.success ? "SUCCESS" : "FAILED"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[8px] font-mono text-[#3d6655]">
              <span>{run.durationMs}ms</span>
              <span>{new Date(run.timestamp).toLocaleTimeString()}</span>
            </div>
          </div>

          {/* Steps */}
          <div className="divide-y divide-[rgba(21,133,105,0.06)]">
            {run.steps.map(step => (
              <div key={step.nodeId} className="flex items-start gap-2 px-3 py-1.5">
                {STATUS_ICON[step.status]}
                <div className="flex-1 min-w-0">
                  <span className="text-[9px] font-mono text-[#7aad97] truncate block">{step.label}</span>
                  {step.error && (
                    <span className="text-[8px] font-mono text-red-400 block truncate">{step.error}</span>
                  )}
                  {step.status === "done" && step.nodeType === "intelligence" && (
                    <span className="text-[8px] font-mono text-[#3d6655] block">
                      APY: {(step.output as { bestApy?: number } | undefined)?.bestApy ?? "—"}% · ${(step.output as { costPaid?: number } | undefined)?.costPaid ?? "0.01"} USDC
                    </span>
                  )}
                  {step.status === "skipped" && (
                    <span className="text-[8px] font-mono text-[#3d6655] block truncate">
                      {(step.output as { reason?: string } | undefined)?.reason ?? "skipped"}
                    </span>
                  )}
                </div>
                <span className="text-[7px] font-mono text-[#3d6655] flex-shrink-0">{step.durationMs}ms</span>
              </div>
            ))}
          </div>

          {run.error && (
            <div className="px-3 py-1.5 bg-red-500/5 border-t border-red-500/10">
              <span className="text-[8px] font-mono text-red-400">{run.error}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
