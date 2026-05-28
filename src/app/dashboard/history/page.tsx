"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock, Workflow as WorkflowIcon } from "lucide-react";
import { metamaskStore } from "@/lib/web3/metamaskStore";

const INK       = "#0B0C09";
const INK_1     = "#111210";
const ACCENT    = "#C8FF3D";
const TEXT      = "#E8E5DA";
const TEXT2     = "#B5B2A5";
const MID       = "#6B6A60";
const LINE      = "rgba(244,241,234,0.06)";
const LINE_MID  = "rgba(244,241,234,0.11)";

interface Workflow {
  id:              string;
  name:            string;
  prompt:          string;
  createdAt:       string;
  status:          "active" | "paused" | "archived";
  permissionStatus: "active" | "pending" | "revoked" | "none";
  budgetUsdc:      string;
  agentIds:        string[];
  totalRuns:       number;
  totalExecuted:   number;
  totalSpentUsdc:  number;
  lastRunAt:       string | null;
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

export default function HistoryPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const wallet = metamaskStore.getState().userAddress;
    if (!wallet) return;
    try {
      const res = await fetch(`/api/workflow?wallet=${encodeURIComponent(wallet)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { workflows: Workflow[] };
      setWorkflows(data.workflows);
      if (data.workflows.length > 0 && !selectedId) {
        setSelectedId(data.workflows[0].id);
      }
    } catch { /* ignore */ }
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedId) { setRuns([]); return; }
    setLoading(true);
    fetch(`/api/workflow/${selectedId}/history`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.runs) setRuns(d.runs); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedId]);

  return (
    <div style={{
      background: INK, color: TEXT, minHeight: "100vh", width: "100vw",
      display: "grid", gridTemplateColumns: "320px 1fr",
      fontFamily: "var(--sans)",
    }}>
      {/* Sidebar — workflow list */}
      <aside style={{ borderRight: `1px solid ${LINE}`, padding: "18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <button
          onClick={() => router.push("/dashboard")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "transparent", border: "none", color: TEXT2,
            cursor: "pointer", fontSize: 12, padding: "4px 0",
          }}
        >
          <ArrowLeft size={14} /> Back to dashboard
        </button>

        <div style={{ fontSize: 11, color: MID, letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 8 }}>
          Workflows
        </div>

        {workflows.length === 0 && (
          <div style={{ fontSize: 12, color: MID, fontStyle: "italic", marginTop: 10 }}>
            No workflows yet. Create one from the dashboard.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {workflows.map(wf => {
            const sel = wf.id === selectedId;
            return (
              <button
                key={wf.id}
                onClick={() => setSelectedId(wf.id)}
                onDoubleClick={() => router.push(`/dashboard/workflow/${wf.id}`)}
                title="Click to view runs · double-click to open canvas"
                style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
                  padding: "10px 12px", borderRadius: 9,
                  background: sel ? "rgba(200,255,61,0.06)" : "transparent",
                  border: `1px solid ${sel ? "rgba(200,255,61,0.25)" : LINE_MID}`,
                  color: sel ? TEXT : TEXT2,
                  cursor: "pointer", textAlign: "left", fontFamily: "var(--sans)",
                  transition: "all .15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                  <WorkflowIcon size={11} style={{ color: sel ? ACCENT : MID }} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{wf.name}</span>
                  <span style={{ marginLeft: "auto", fontSize: 9.5, color: MID }}>
                    {wf.totalRuns} runs
                  </span>
                </div>
                <div style={{ fontSize: 10.5, color: MID, marginLeft: 17, fontFamily: "var(--serif)", fontStyle: "italic", letterSpacing: "-0.005em" }}>
                  &ldquo;{wf.prompt.slice(0, 50)}{wf.prompt.length > 50 ? "…" : ""}&rdquo;
                </div>
                <div style={{ fontSize: 9.5, color: MID, marginLeft: 17, display: "flex", gap: 8 }}>
                  <span style={{ color: wf.permissionStatus === "active" ? ACCENT : MID }}>● {wf.permissionStatus}</span>
                  <span>{wf.budgetUsdc} USDC</span>
                  <span>{wf.totalSpentUsdc.toFixed(3)} spent</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main — selected workflow's run history */}
      <main style={{ padding: "32px 40px", overflowY: "auto" }}>
        {!selectedId && (
          <div style={{ fontSize: 14, color: MID, marginTop: 80, textAlign: "center" }}>
            Select a workflow from the sidebar to view its run history.
          </div>
        )}

        {selectedId && (() => {
          const wf = workflows.find(w => w.id === selectedId);
          if (!wf) return null;
          return (
            <>
              <div style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18 }}>
                <div>
                  <div style={{ fontSize: 11, color: MID, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
                    Workflow
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", color: TEXT }}>{wf.name}</div>
                  <div style={{ fontSize: 13, color: TEXT2, marginTop: 6, fontFamily: "var(--serif)", fontStyle: "italic" }}>
                    &ldquo;{wf.prompt}&rdquo;
                  </div>
                  <div style={{ display: "flex", gap: 18, marginTop: 14, fontSize: 11, color: MID }}>
                    <span>{wf.agentIds.length} agents</span>
                    <span>{wf.totalRuns} runs · {wf.totalExecuted} executed</span>
                    <span style={{ color: ACCENT }}>{wf.totalSpentUsdc.toFixed(4)} USDC spent</span>
                    <span>Budget: {wf.budgetUsdc} USDC</span>
                  </div>
                </div>
                <button
                  onClick={() => router.push(`/dashboard/workflow/${wf.id}`)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "9px 16px", borderRadius: 8,
                    background: ACCENT, color: INK, border: "none",
                    fontWeight: 600, fontSize: 12.5, cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Open canvas →
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: MID, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>
                <Clock size={11} /> Run history
              </div>

              {loading && <div style={{ fontSize: 12, color: MID }}>Loading…</div>}

              {!loading && runs.length === 0 && (
                <div style={{ fontSize: 13, color: MID, fontStyle: "italic" }}>
                  No runs yet for this workflow. The agent hasn&apos;t executed.
                </div>
              )}

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
            </>
          );
        })()}
      </main>
    </div>
  );
}
