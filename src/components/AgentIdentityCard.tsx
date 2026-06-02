"use client";

import React, { useEffect, useState } from "react";

const ACCENT = "#C8FF3D";
const INK    = "#0B0C09";
const INK_1  = "#111210";
const TEXT   = "#E8E5DA";
const TEXT2  = "#B5B2A5";
const MID    = "#6B6A60";
const MID_2  = "#908E81";
const LINE   = "rgba(244,241,234,0.06)";
const LINE_MID = "rgba(244,241,234,0.11)";

interface AgentStats {
  address:             string;
  totalRuns:           number;
  totalExecuted:       number;
  totalX402SpentUsdc:  number;
  budgetUsdc:          string;
  budgetUsedUsdc:      number;
  budgetUtilization:   number;
  lastRunAt:           string | null;
  lastAction:          "hold" | "deposit" | "rebalance" | "withdraw" | "skip" | null;
  breakdown: {
    x402: { intel: number; tts: number; image: number };
    gas:  number;
    defi: number;
  };
}

interface Agent {
  id:                      string;
  name:                    string;
  goal:                    string;
  budgetUsdc:              string;
  mediaPolicy:             "off" | "milestones" | "daily" | "every-run";
  parentAgentId?:          string | null;
  delegationStatus?:       "active" | "revoked" | "pending" | "none";
  delegationCap?:          string;
  delegationContext?:      string | null;
  delegationHash?:         string | null;
  delegationManagerAddress?: string | null;
  revokedTxHash?:          string | null;
  registryId?:             string | null;
  registryTxHash?:         string | null;
}

export function AgentIdentityCard({
  agentId,
  agent,
  refreshKey = 0,
}: {
  agentId: string;
  agent:   Agent;
  /** Bump this whenever a run finishes so the card refetches stats. */
  refreshKey?: number;
}) {
  const [stats, setStats] = useState<AgentStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agent/${agentId}/stats`);
        if (!res.ok) return;
        const data = (await res.json()) as AgentStats;
        if (!cancelled) setStats(data);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [agentId, refreshKey]);

  const copy = (s: string) => {
    if (typeof navigator !== "undefined") navigator.clipboard?.writeText(s).catch(() => {});
  };

  const budgetN     = Number.parseFloat(agent.budgetUsdc) || 0;
  const x402Total   = stats?.totalX402SpentUsdc ?? 0;
  const defiAmount  = stats?.budgetUsedUsdc     ?? 0;
  const remaining   = Math.max(0, budgetN - defiAmount);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 10, letterSpacing: "0.08em", color: MID, textTransform: "lowercase" }}>
          agent activity
        </div>
        <div style={{ fontSize: 20, fontWeight: 500, color: TEXT, letterSpacing: "-0.02em", marginTop: 4 }}>
          {agent.name}
        </div>
      </div>

      {/* On-chain address */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 12, borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 10.5, color: MID, letterSpacing: "0.06em" }}>On-chain address</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: TEXT, fontVariantNumeric: "tabular-nums", wordBreak: "break-all", flex: 1 }}>
            {stats?.address ?? "—"}
          </span>
          <button
            onClick={() => stats?.address && copy(stats.address)}
            style={{ fontSize: 10, color: MID, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer", background: "none", border: "none", padding: 0 }}
          >
            Copy
          </button>
        </div>
        {stats?.address && (
          <a
            href={`https://basescan.org/address/${stats.address}`}
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 10.5, color: ACCENT, textDecoration: "underline", letterSpacing: "0.02em", marginTop: 2, alignSelf: "flex-start" }}
          >
            View on Basescan ↗
          </a>
        )}

        {/* ERC-8004 identity (QuickNode) */}
        {agent.registryId && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 10.5, color: MID, letterSpacing: "0.06em" }}>ERC-8004 Identity</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(200,255,61,0.10)", border: "1px solid rgba(200,255,61,0.25)", color: ACCENT, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>
                Registered
              </span>
              <span style={{ fontSize: 11, color: TEXT2, fontVariantNumeric: "tabular-nums" }}>
                {agent.registryId.slice(0, 10)}…
              </span>
            </div>
            <a
              href={`https://www.quicknode.com/agents/${agent.registryId}`}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 10.5, color: ACCENT, textDecoration: "underline" }}
            >
              View on QuickNode Agent Explorer ↗
            </a>
          </div>
        )}
      </div>

      {/* 4-stat grid — neutral counters only */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <Stat label="Total runs"     value={stats?.totalRuns ?? 0} />
        <Stat label="Total executed" value={stats?.totalExecuted ?? 0} borderLeft />
        <Stat label="x402 spent"     value={`${x402Total.toFixed(3)}`} unit="USDC" borderTop />
        <Stat label="Budget used"    value={`${(stats?.budgetUtilization ?? 0).toFixed(0)}`} unit="%" borderTop borderLeft />
      </div>

      {/* Last action chip */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 0", borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 10.5, color: MID, letterSpacing: "0.06em" }}>Last action</div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: lastActionColor(stats?.lastAction ?? null) }} />
          <span style={{ fontSize: 13.5, color: TEXT, fontFamily: "var(--serif)", fontStyle: "italic", letterSpacing: "-0.01em" }}>
            {lastActionText(stats?.lastAction ?? null)}
          </span>
        </div>
      </div>

      {/* Spending breakdown bar */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 10.5, color: MID, letterSpacing: "0.06em" }}>Spending breakdown</div>
        <SpendingBar budget={budgetN} x402={x402Total} defi={defiAmount} remaining={remaining} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: MID_2, fontVariantNumeric: "tabular-nums" }}>
          <span>x402 {x402Total.toFixed(3)}</span>
          <span>defi {defiAmount.toFixed(2)}</span>
          <span>remaining {remaining.toFixed(2)}</span>
        </div>
      </div>

      {/* Delegation chain */}
      <DelegationSection agent={agent} />

      {/* Media policy */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
        <div style={{ fontSize: 10.5, color: MID, letterSpacing: "0.06em" }}>Media policy</div>
        <div style={{ fontSize: 13, color: TEXT, letterSpacing: "-0.005em" }}>
          {agent.mediaPolicy === "off"        && "Off — text reports only"}
          {agent.mediaPolicy === "milestones" && "Milestones — voice + image only on state changes"}
          {agent.mediaPolicy === "daily"      && "Daily — one rich digest per day"}
          {agent.mediaPolicy === "every-run"  && "Every run — voice + image every cycle"}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Delegation section — shows the chain + Revoke button
// ─────────────────────────────────────────────────────────────────────────────

function DelegationSection({ agent }: { agent: Agent }) {
  const [parentName, setParentName] = useState<string | null>(null);
  const [revoking, setRevoking]     = useState(false);
  const [, setLocalTick]            = useState(0);

  useEffect(() => {
    if (!agent.parentAgentId) { setParentName(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agent/${agent.parentAgentId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setParentName(data?.agent?.name ?? null);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [agent.parentAgentId]);

  const revoke = async () => {
    if (!confirm(`Revoke ${agent.name}'s delegation? This will cascade to any sub-delegations.`)) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/agent/${agent.id}/revoke`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (j.via === "on-chain" && j.txHash) {
        alert(`Revoked on-chain. Tx: ${j.txHash.slice(0, 10)}…`);
      } else if (j.via === "fallback-state-only") {
        alert("Marked revoked in state (on-chain call failed — likely a demo delegation).");
      } else {
        alert("Delegation marked revoked.");
      }
      setLocalTick(x => x + 1);
    } catch (e) {
      alert("Revoke failed: " + (e instanceof Error ? e.message : String(e)));
    } finally { setRevoking(false); }
  };

  const status = agent.delegationStatus ?? "none";

  // A delegation is "real" (on-chain) only when:
  //  - status is "active" AND
  //  - context is a long hex blob (not a demo placeholder)
  //  - hash doesn't contain "demo" or "pending"
  const isRealDelegation =
    status === "active" &&
    !!agent.delegationContext &&
    agent.delegationContext !== "0xdemo" &&
    agent.delegationContext.length > 40 &&
    !agent.delegationHash?.includes("demo") &&
    agent.delegationHash !== "0xpending";

  const statusColor =
    status === "active"  ? (isRealDelegation ? ACCENT : MID_2) :
    status === "pending" ? MID_2 :
    status === "revoked" ? "#FF8A66" :
    MID;

  const statusLabel =
    status === "active"  ? (isRealDelegation ? "active · real on-chain" : "needs permission — grant to run") :
    status === "pending" ? "needs permission — grant ERC-7715 to activate" :
    status;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
      <div style={{ fontSize: 10.5, color: MID, letterSpacing: "0.06em" }}>Delegation chain</div>

      {/* Parent → this */}
      <div style={{ fontSize: 12.5, color: TEXT, lineHeight: 1.4 }}>
        {agent.parentAgentId ? (
          <>
            <span style={{ color: TEXT2 }}>{parentName ?? "parent agent"}</span>
            <span style={{ color: MID, margin: "0 6px" }}>↓</span>
            <span style={{ color: TEXT, fontWeight: 500 }}>{agent.name}</span>
          </>
        ) : (
          <>
            <span style={{ color: TEXT2, fontStyle: "italic", fontFamily: "var(--serif)" }}>user (ERC-7715)</span>
            <span style={{ color: MID, margin: "0 6px" }}>↓</span>
            <span style={{ color: TEXT, fontWeight: 500 }}>{agent.name}</span>
            <span style={{ color: MID, marginLeft: 6, fontSize: 11 }}>(root)</span>
          </>
        )}
      </div>

      {/* Status + cap */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: MID_2 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: statusColor, letterSpacing: "0.04em", textTransform: "lowercase" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor }} />
          {statusLabel}
        </span>
        {agent.delegationCap && (
          <span style={{ color: TEXT2, fontVariantNumeric: "tabular-nums" }}>cap {agent.delegationCap} USDC</span>
        )}
      </div>

      {/* "Pending" explanation — tell user to grant permission */}
      {status === "pending" && (
        <div style={{
          marginTop: 4, padding: "8px 10px", borderRadius: 7,
          background: "rgba(144,142,129,0.08)",
          border: "1px solid rgba(144,142,129,0.2)",
          fontSize: 11.5, color: MID_2, lineHeight: 1.5,
        }}>
          This agent was created without a real MetaMask permission.
          Click <strong style={{ color: TEXT }}>🔑 Grant ERC-7715</strong> in the top bar to activate real on-chain execution.
        </div>
      )}

      {/* Revoke button — ONLY for genuinely real on-chain delegations */}
      {isRealDelegation && (
        <button
          onClick={revoke}
          disabled={revoking}
          style={{
            marginTop: 4,
            padding: "8px 12px", borderRadius: 7,
            background: "transparent", border: "1px solid rgba(255,138,102,0.3)",
            color: "#FF8A66", fontSize: 12, fontWeight: 500,
            cursor: revoking ? "not-allowed" : "pointer",
            opacity: revoking ? 0.6 : 1,
            transition: "background .15s",
          }}
          onMouseEnter={(e) => { if (!revoking) e.currentTarget.style.background = "rgba(255,138,102,0.08)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          {revoking ? "Revoking…" : "Revoke delegation (on-chain)"}
        </button>
      )}
      {status === "revoked" && agent.revokedTxHash && (
        <a
          href={`https://basescan.org/tx/${agent.revokedTxHash}`}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, color: ACCENT, textDecoration: "underline", marginTop: 2 }}
        >
          View revocation tx ↗
        </a>
      )}
    </div>
  );
}

function Stat({ label, value, unit, borderTop, borderLeft }: { label: string; value: number | string; unit?: string; borderTop?: boolean; borderLeft?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "12px 0 12px 0",
        paddingLeft:  borderLeft ? 14 : 0,
        paddingRight: borderLeft ? 0  : 14,
        borderTop:    borderTop  ? `1px solid ${LINE}` : "none",
        borderLeft:   borderLeft ? `1px solid ${LINE}` : "none",
      }}
    >
      <span style={{ fontSize: 10.5, color: MID, letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.025em", color: TEXT, fontVariantNumeric: "tabular-nums" }}>
        {value}
        {unit && <span style={{ fontSize: 11, color: MID, fontWeight: 400, marginLeft: 4, letterSpacing: 0 }}>{unit}</span>}
      </span>
    </div>
  );
}

function SpendingBar({ budget, x402, defi, remaining }: { budget: number; x402: number; defi: number; remaining: number }) {
  const total = Math.max(budget, x402 + defi + remaining, 0.001);
  const x402Pct = (x402 / total) * 100;
  const defiPct = (defi / total) * 100;
  const remPct  = Math.max(0, 100 - x402Pct - defiPct);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${x402Pct}fr ${defiPct}fr ${remPct}fr`,
        height: 10,
        borderRadius: 4,
        overflow: "hidden",
        background: INK_1,
        border: `1px solid ${LINE_MID}`,
      }}
    >
      <div style={{ background: ACCENT,  opacity: 0.75 }} title={`x402: ${x402.toFixed(3)} USDC`} />
      <div style={{ background: TEXT2,   opacity: 0.55 }} title={`defi: ${defi.toFixed(3)} USDC`} />
      <div style={{ background: "transparent" }}        title={`remaining: ${remaining.toFixed(3)} USDC`} />
    </div>
  );
}

function lastActionText(la: AgentStats["lastAction"]): string {
  switch (la) {
    case "deposit":   return "Deposited into protocol";
    case "rebalance": return "Rebalanced position";
    case "withdraw":  return "Withdrew from protocol";
    case "hold":      return "Held in place — best position";
    case "skip":      return "Skipped — risk too high";
    default:          return "No runs yet";
  }
}

function lastActionColor(la: AgentStats["lastAction"]): string {
  if (!la || la === "skip") return MID;
  if (la === "hold") return MID_2;
  return ACCENT;
}

export default AgentIdentityCard;
