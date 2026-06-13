"use client";

import React, { useEffect, useState } from "react";
import { BarChart2, ArrowRight, ExternalLink } from "lucide-react";
import { metamaskStore } from "@/lib/web3/metamaskStore";

// Theme tokens (mirror dashboard).
const INK_1 = "#111210";
const ACCENT = "#C8FF3D";
const TEXT = "#E8E5DA";
const TEXT2 = "#B5B2A5";
const MID = "#6B6A60";
const LINE = "rgba(244,241,234,0.06)";
const LINE_MID = "rgba(244,241,234,0.11)";

// Stable colour per protocol so the allocation bar + legend agree.
const PROTO_COLORS: Record<string, string> = {
  morpho: "#C8FF3D", aave: "#7CC4FF", lido: "#FF8A66",
  uniswap: "#FF6BD6", aerodrome: "#9D7CFF", sky: "#FFD166",
};
const colorFor = (p: string) => PROTO_COLORS[p?.toLowerCase()] ?? "#8A8A7E";

interface Position { protocol: string; amount: string; entryApy: number }
interface Run { runId?: string; timestamp?: string; action?: string; protocol?: string; amount?: string; apy?: number; txHash?: string | null; success?: boolean }
interface AuditRow { protocol: string; claimedUsdc: number; actualUsdc: number; drift: number; ok: boolean }
interface PortfolioData {
  positions?: Position[];
  runs?: Run[];
  totalValueUsd?: number;
  deployedUsd?: number;
  estPnlUsd?: number;
  audit?: AuditRow[];
}

const num = (v: unknown) => Number.parseFloat(String(v ?? 0)) || 0;

/**
 * #2 — portfolio behaviour for the agent panel. Shows the wallet's current
 * allocation (where capital sits + APY), recent moves (which protocol/token got
 * deposited/rebalanced/withdrawn, with tx links), and a claimed-vs-on-chain audit.
 * Especially meaningful for rebalancer agents, which move existing positions.
 */
export default function PortfolioPanel() {
  const [, setTick] = useState(0);
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const u = metamaskStore.addListener(() => setTick(x => x + 1));
    return () => u();
  }, []);
  const wallet = metamaskStore.getState().userAddress;

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/portfolio?wallet=${encodeURIComponent(wallet)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: PortfolioData | null) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [wallet]);

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: TEXT2, letterSpacing: "0.1em", textTransform: "uppercase" }}>
      <BarChart2 size={13} style={{ color: ACCENT }} /> Portfolio
    </div>
  );

  if (!wallet) return null;

  const positions = (data?.positions ?? []).filter(p => num(p.amount) > 0);
  const totalDeployed = positions.reduce((s, p) => s + num(p.amount), 0) || num(data?.deployedUsd);
  // Recent meaningful moves (skip holds), newest first.
  const moves = (data?.runs ?? [])
    .filter(r => r.action && r.action !== "hold")
    .slice(0, 6);

  return (
    <div style={{ background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      {header}

      {loading && <div style={{ fontSize: 12.5, color: MID }}>Reading on-chain positions…</div>}

      {!loading && (
        <>
          {/* Summary */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12 }}>
            <div><span style={{ color: MID }}>Value </span><span style={{ color: TEXT }}>${num(data?.totalValueUsd).toFixed(2)}</span></div>
            <div><span style={{ color: MID }}>Deployed </span><span style={{ color: TEXT }}>${totalDeployed.toFixed(2)}</span></div>
            {data?.estPnlUsd != null && (
              <div><span style={{ color: MID }}>Est P/L </span>
                <span style={{ color: num(data.estPnlUsd) >= 0 ? ACCENT : "#FF8A66" }}>
                  {num(data.estPnlUsd) >= 0 ? "+" : ""}${num(data.estPnlUsd).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Allocation bar + legend */}
          {positions.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", background: "rgba(244,241,234,0.05)" }}>
                {positions.map(p => (
                  <div key={p.protocol} title={`${p.protocol}: $${num(p.amount).toFixed(2)}`}
                    style={{ width: `${(num(p.amount) / (totalDeployed || 1)) * 100}%`, background: colorFor(p.protocol) }} />
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {positions.map(p => (
                  <div key={p.protocol} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: colorFor(p.protocol), flexShrink: 0 }} />
                    <span style={{ color: TEXT, textTransform: "capitalize", flex: 1 }}>{p.protocol}</span>
                    <span style={{ color: TEXT2 }}>${num(p.amount).toFixed(2)}</span>
                    {p.entryApy ? <span style={{ color: ACCENT }}>{p.entryApy}%</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: MID }}>No deployed positions yet.</div>
          )}

          {/* Recent moves — which protocol/token changed */}
          {moves.length > 0 && (
            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 10, color: MID, letterSpacing: "0.1em", textTransform: "uppercase" }}>Recent moves</div>
              {moves.map((m, i) => (
                <div key={m.runId ?? i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                  <span style={{ color: m.success === false ? "#FF8A66" : ACCENT, fontSize: 10 }}>●</span>
                  <span style={{ color: TEXT2, display: "inline-flex", alignItems: "center", gap: 5, flex: 1, overflow: "hidden" }}>
                    <span style={{ textTransform: "capitalize" }}>{m.action}</span>
                    {num(m.amount) > 0 && <span style={{ color: MID }}>${num(m.amount).toFixed(2)}</span>}
                    {m.protocol && m.protocol !== "unknown" && (
                      <>
                        <ArrowRight size={11} style={{ color: MID }} />
                        <span style={{ color: TEXT, textTransform: "capitalize" }}>{m.protocol}</span>
                      </>
                    )}
                    {m.apy ? <span style={{ color: ACCENT }}>{m.apy}%</span> : null}
                  </span>
                  {m.txHash && (
                    <a href={`https://basescan.org/tx/${m.txHash}`} target="_blank" rel="noopener noreferrer"
                      title="View on Basescan" style={{ color: MID }}>
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Audit — claimed vs on-chain (provable, catches silent failures) */}
          {data?.audit && data.audit.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {data.audit.map(a => (
                <span key={a.protocol} title={`claimed $${a.claimedUsdc} · on-chain $${a.actualUsdc}`}
                  style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 999,
                    background: a.ok ? "rgba(200,255,61,0.08)" : "rgba(255,138,102,0.1)",
                    border: `1px solid ${a.ok ? "rgba(200,255,61,0.2)" : "rgba(255,138,102,0.3)"}`,
                    color: a.ok ? ACCENT : "#FF8A66", textTransform: "capitalize",
                  }}>
                  {a.protocol} {a.ok ? "verified" : `drift $${a.drift}`}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
