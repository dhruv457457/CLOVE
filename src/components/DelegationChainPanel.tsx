"use client";

import React, { useEffect, useState } from "react";
import { ShieldCheck, ArrowRight, ExternalLink } from "lucide-react";

// Theme tokens (mirror dashboard).
const INK_1     = "#111210";
const ACCENT    = "#C8FF3D";
const TEXT      = "#E8E5DA";
const TEXT2     = "#B5B2A5";
const MID       = "#6B6A60";
const LINE      = "rgba(244,241,234,0.06)";
const LINE_MID  = "rgba(244,241,234,0.11)";
const ACCENT_SOFT = "rgba(200,255,61,0.18)";

interface Hop { delegator: string; delegate: string }
interface ChainData {
  hasChain: boolean;
  hops?: Hop[];
  cap?: string;
  scopedHash?: string | null;
  relayerTarget?: string | null;
  isCustodian?: boolean;
  reason?: string;
}

const short = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "—");

/**
 * #5 — renders an agent's real ERC-7710 delegation chain (user → session →
 * THIS AGENT, capped → 1Shot relayer), proving the agent is on-chain. Data
 * comes from /api/agent/[id]/delegation (server-side decodeDelegations).
 */
export default function DelegationChainPanel({ agentId }: { agentId: string }) {
  const [data, setData] = useState<ChainData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/agent/${agentId}/delegation`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: ChainData | null) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [agentId]);

  const wrap = (children: React.ReactNode) => (
    <div style={{ background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: TEXT2, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        <ShieldCheck size={13} style={{ color: ACCENT }} /> On-chain delegation
      </div>
      {children}
    </div>
  );

  if (loading) return wrap(<div style={{ fontSize: 12.5, color: MID }}>Decoding chain…</div>);

  if (data?.isCustodian) {
    return wrap(
      <div style={{ fontSize: 12.5, color: TEXT2, lineHeight: 1.5 }}>
        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: ACCENT_SOFT, color: ACCENT, fontSize: 11, marginRight: 6 }}>Custodian</span>
        Holds the grant and splits the budget into on-chain-capped slices for the workers. It never trades, so it doesn&apos;t run.
      </div>,
    );
  }

  if (!data?.hasChain || !data.hops?.length) {
    return wrap(<div style={{ fontSize: 12.5, color: MID, lineHeight: 1.5 }}>{data?.reason ?? "No on-chain delegation yet."}</div>);
  }

  // Address sequence root → leaf: first delegator, then each delegate.
  const addrs = [data.hops[0].delegator, ...data.hops.map(h => h.delegate)];
  const relayer = (data.relayerTarget ?? "").toLowerCase();
  const label = (addr: string, i: number): string => {
    if (addr.toLowerCase() === relayer) return "1Shot relayer";
    if (i === 0) return "Your session";
    // The hop just before the relayer is this agent's capped signer.
    const isAgentHop = i === addrs.length - 2;
    return isAgentHop ? "This agent" : "Sub-delegate";
  };

  return wrap(
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {addrs.map((addr, i) => {
          const isRelayer = addr.toLowerCase() === relayer;
          const isAgent = i === addrs.length - 2 && !isRelayer;
          return (
            <React.Fragment key={`${addr}-${i}`}>
              <div style={{
                display: "flex", flexDirection: "column", gap: 1, padding: "6px 9px", borderRadius: 8,
                background: isAgent ? "rgba(200,255,61,0.08)" : "transparent",
                border: `1px solid ${isAgent ? ACCENT_SOFT : LINE}`,
              }}>
                <span style={{ fontSize: 9.5, color: isRelayer ? ACCENT : MID, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label(addr, i)}</span>
                <a href={`https://basescan.org/address/${addr}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11.5, color: TEXT, fontFamily: "var(--mono, monospace)", textDecoration: "none" }}>
                  {short(addr)}
                </a>
              </div>
              {i < addrs.length - 1 && <ArrowRight size={13} style={{ color: MID, flexShrink: 0 }} />}
            </React.Fragment>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12 }}>
        {data.cap && (
          <div><span style={{ color: MID }}>On-chain cap: </span><span style={{ color: ACCENT }}>{data.cap} USDC</span></div>
        )}
        {data.scopedHash && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: MID }}>Scoped hash: </span>
            <span style={{ color: TEXT2, fontFamily: "var(--mono, monospace)" }}>{short(data.scopedHash)}</span>
            <ExternalLink size={11} style={{ color: MID }} />
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: MID, lineHeight: 1.5 }}>
        Gas is sponsored in USDC by the relayer; this agent&apos;s spend is capped on-chain against its own address.
      </div>
    </>,
  );
}
