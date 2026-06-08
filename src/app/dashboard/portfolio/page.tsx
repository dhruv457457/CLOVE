"use client";

import "./dash.css";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { metamaskStore } from "@/lib/web3/metamaskStore";

// ── Design tokens / colors ─────────────────────────────────────────────────────

function apyColor(apy: number, min = 4.5, max = 12.5) {
  const t = Math.max(0, Math.min(1, (apy - min) / (max - min)));
  const a = [0x5f, 0x8a, 0x5e], b = [0xc8, 0xff, 0x3d];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ── Animated counter ──────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 1500, decimals = 0) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let raf: number, started = false;
    const begin = () => {
      if (started) return;
      started = true;
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setVal(target * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) begin(); }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    const fb = setTimeout(() => { if (ref.current && !started) begin(); }, 600);
    return () => { cancelAnimationFrame(raf); obs.disconnect(); clearTimeout(fb); };
  }, [target, duration]);
  const shown = val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return [ref, shown] as const;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function DIcon({ name, size = 14 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid:   <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M16 12h3M3 9h18"/></>,
    layers: <><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/></>,
    shield: <><path d="M12 3l7 3v5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/></>,
    coin:   <><circle cx="12" cy="12" r="8"/><path d="M9 12h6M12 9v6"/></>,
    add:    <><path d="M12 5v14M5 12h14"/></>,
    play:   <><path d="M7 5l11 7-11 7z"/></>,
    pause:  <><path d="M8 5v14M16 5v14"/></>,
    revoke: <><circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/></>,
    arrow:  <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    book:   <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"/><path d="M5 17h14"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function CloverMark({ size = 16, color = "#C8FF3D" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 11 L16 21 M11 16 L21 16" stroke={color} strokeWidth="1.4" strokeLinecap="round" opacity="0.85"/>
      <circle cx="16" cy="8"  r="4.2" fill={color}/>
      <circle cx="16" cy="24" r="4.2" fill={color}/>
      <circle cx="8"  cy="16" r="4.2" fill={color}/>
      <circle cx="24" cy="16" r="4.2" fill={color}/>
      <circle cx="16" cy="16" r="2.2" fill="#0B0C09"/>
    </svg>
  );
}

// ── Status ─────────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  running:  { cls: "run",  label: "running" },
  active:   { cls: "run",  label: "active" },
  executing:{ cls: "run",  label: "executing" },
  executed: { cls: "run",  label: "executed" },
  watching: { cls: "run",  label: "watching" },
  planning: { cls: "run",  label: "planning" },
  pending:  { cls: "pend", label: "pending" },
  failed:   { cls: "fail", label: "failed" },
  revoked:  { cls: "fail", label: "revoked" },
  idle:     { cls: "idle", label: "idle" },
  none:     { cls: "idle", label: "no delegation" },
  blocked:  { cls: "idle", label: "blocked" },
};
function StatusDot({ status, beat = false }: { status: string; beat?: boolean }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.idle;
  return <span className={`sd ${s.cls}${beat && s.cls === "run" ? " beat" : ""}`} />;
}
function StatusText({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.idle;
  return <span className={`status-txt ${s.cls}`}>{s.label}</span>;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ points, color = "#C8FF3D", w = 160, h = 60 }: { points: number[]; color?: string; w?: number; h?: number }) {
  if (points.length < 2) points = [0, 0];
  const max = Math.max(...points), min = Math.min(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / span) * h).toFixed(1)}`).join(" ");
  const area = `${d} L ${w} ${h} L 0 ${h} Z`;
  const gid = `spk${Math.random().toString(36).slice(2, 7)}`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

// ── Donut chart ───────────────────────────────────────────────────────────────

function Donut({ segments, centerValue, centerLabel, size = 188, stroke = 22 }: {
  segments: { value: number; color: string }[];
  centerValue: string; centerLabel: string;
  size?: number; stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(244,241,234,0.05)" strokeWidth={stroke} />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const len = Math.max(0, frac * C - 3);
          const offset = -(acc / total) * C;
          acc += seg.value;
          return (
            <circle key={i} cx={size/2} cy={size/2} r={r} fill="none"
              stroke={seg.color} strokeWidth={stroke}
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={offset}
              strokeLinecap="butt"
            />
          );
        })}
      </svg>
      <div className="center">
        <span className="cv">{centerValue}</span>
        <span className="cl">{centerLabel}</span>
      </div>
    </div>
  );
}

// ── Types (mirror /api/portfolio) ───────────────────────────────────────────────

interface Holding { symbol: string; address: string; balance: number; priceUsd: number; valueUsd: number }
interface Position { protocol: string; amount: string; entryApy: number }
interface Run { protocol: string; action: string; amount: string; apy: number; txHash: string | null; success: boolean; timestamp: string; riskLevel?: string }
interface AgentCard {
  id: string; name: string; agentType: string; status: string; active: boolean;
  scheduleIntervalMs: number | null; totalRuns: number; totalExecuted: number;
  lastAction: string | null; budgetUsdc: string; budgetUsedUsdc: number; x402Total: number;
  workflowId: string | null; parentAgentId: string | null;
  delegationStatus: string; delegationCap: string | null; onChainAddress: string | null;
}
interface Portfolio {
  wallet: string;
  holdings: Holding[]; totalValueUsd: number;
  positions: Position[]; deployedUsd: number; estPnlUsd: number;
  runs: Run[]; agents: AgentCard[];
  spend: { x402Intel: number; x402Tts: number; x402Image: number; x402Total: number; oneShotFees: number; deployedUsd: number; total: number };
}
interface Permission { grantedTo?: string; budgetUsdc?: string; periodDays?: number; expiresAt?: number; delegationManager?: string }

// ── helpers ─────────────────────────────────────────────────────────────────────
const short = (a?: string | null) => (a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a ?? "—"));
const money = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
function ago(ts: string | number | null): string {
  if (!ts) return "—";
  const d = Date.now() - new Date(ts).getTime();
  const m = Math.floor(d / 60000); if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function blendedApy(positions: Position[]): number {
  const tot = positions.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  if (tot === 0) return 0;
  return positions.reduce((s, p) => s + (Number(p.amount) || 0) * p.entryApy, 0) / tot;
}

// ── Portfolio tab ────────────────────────────────────────────────────────────

function txIcon(status: string) {
  if (status === "executed") return <span className="sd run" />;
  if (status === "pending")  return <span className="sd pend beat" />;
  if (status === "idle")     return <span className="sd idle" />;
  return <span className="sd fail" />;
}

function PortfolioTab({ pf }: { pf: Portfolio }) {
  const [r1, v1] = useCountUp(pf.totalValueUsd, 1500, 2);
  const pnlUp = pf.estPnlUsd >= 0;
  const [r2, v2] = useCountUp(Math.abs(pf.estPnlUsd), 1500, 2);

  // Allocation = deployed positions (protocol), else non-USDC holdings.
  const alloc = pf.positions.length > 0
    ? pf.positions.map(p => ({ name: p.protocol, amount: Number(p.amount) || 0, apy: p.entryApy }))
    : pf.holdings.filter(h => h.symbol !== "USDC" && h.valueUsd > 0.01).map(h => ({ name: h.symbol, amount: +h.valueUsd.toFixed(2), apy: 0 }));
  const allocTotal = alloc.reduce((s, a) => s + a.amount, 0) || 1;
  const allocRows = alloc.map(a => ({ ...a, pct: Math.round((a.amount / allocTotal) * 100) }));
  const donutSegs = allocRows.map(a => ({ value: a.amount, color: a.apy > 0 ? apyColor(a.apy) : "#7FD4FF" }));
  const bApy = blendedApy(pf.positions);

  // value trajectory for the sparkline (cost basis → current value)
  const start = Math.max(0, pf.totalValueUsd - pf.estPnlUsd);
  const spark = Array.from({ length: 12 }, (_, i) => start + (pf.estPnlUsd) * (i / 11));

  const txs = pf.runs.map(r => {
    const status = r.action === "hold" ? "idle" : (r.success ? "executed" : "failed");
    return {
      status,
      main: r.action === "hold" ? `Held · ${r.protocol}` : `${r.protocol} ${r.action}`,
      amt: r.action === "hold" ? undefined : `$${r.amount}`,
      flag: !r.success && r.riskLevel === "HIGH" ? "risk HIGH" : undefined,
      hash: r.txHash ? short(r.txHash) : "—",
      txHash: r.txHash,
      time: ago(r.timestamp),
    };
  });

  const bestPos = [...pf.positions].sort((a, b) => b.entryApy - a.entryApy)[0];

  return (
    <div className="page">
      <div className="hero-row">
        <div className="hero-stat" ref={r1 as React.RefObject<HTMLDivElement>}>
          <span className="lab">Total portfolio value</span>
          <span className="big"><span className="pre">$</span>{v1}</span>
          <span className={`delta ${pnlUp ? "up" : "flat"}`}>
            {pnlUp ? "↗" : "↘"} est. P/L {pnlUp ? "+" : "−"}${money(Math.abs(pf.estPnlUsd))}
          </span>
          <Sparkline points={spark} color={pnlUp ? "#C8FF3D" : "#FF6B5E"} />
        </div>
        <div className="hero-stat" ref={r2 as React.RefObject<HTMLDivElement>}>
          <span className="lab">Total spent · x402 + 1Shot</span>
          <span className="big"><span className="pre">$</span>{money(pf.spend.total, 2)}</span>
          <span className="delta flat">x402 ${money(pf.spend.x402Total, 2)} · 1Shot ${money(pf.spend.oneShotFees, 3)}</span>
          <Sparkline points={[2,5,3,8,6,11,9,14,12,18,16,21]} color="#F2B85C" />
        </div>
      </div>

      <div className="card mb18">
        <div className="card-head">
          <span className="ct">Protocol allocation</span>
          <span className="ch-right">colored by entry APY · brighter = higher yield</span>
        </div>
        {allocRows.length === 0 ? (
          <div style={{ color: "var(--mid)", padding: 12, fontSize: 13 }}>No capital deployed yet — run an agent to build positions.</div>
        ) : (
          <div className="grid-2-13">
            <div className="donut-wrap">
              <Donut segments={donutSegs} centerValue={bApy > 0 ? `${bApy.toFixed(1)}%` : `$${money(pf.totalValueUsd, 0)}`} centerLabel={bApy > 0 ? "blended apy" : "total value"} />
            </div>
            <div className="alloc">
              <div className="alloc-head"><span/><span>Protocol</span><span>Value</span><span>Share</span><span>APY</span></div>
              {allocRows.map((a, i) => {
                const col = a.apy > 0 ? apyColor(a.apy) : "#7FD4FF";
                return (
                  <div className="alloc-row" key={a.name + i}>
                    <span className="sw" style={{ background: col }} />
                    <span className="nm">
                      {a.name}
                      <span className="bar"><i style={{ width: `${a.pct}%`, background: col, animationDelay: `${i * 90}ms` }} /></span>
                    </span>
                    <span className="aamt">${money(a.amount, 2)}</span>
                    <span className="pct">{a.pct}%</span>
                    <span className="rapy" style={{ color: col }}>{a.apy > 0 ? `${a.apy}%` : "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="card mb18">
        <div className="card-head">
          <span className="ct">Recent transactions</span>
          <span className="ch-right">{txs.length} on record</span>
        </div>
        {txs.length === 0 ? (
          <div style={{ color: "var(--mid)", padding: 12, fontSize: 13 }}>No transactions yet.</div>
        ) : txs.map((t, i) => (
          <div className="tx-row" key={i}>
            {txIcon(t.status)}
            <span className="tx-main">
              {t.main}{t.amt && <> <span className="tx-amt">{t.amt}</span></>}
            </span>
            {t.flag
              ? <span className="tx-flag risk">{t.flag}</span>
              : (t.txHash
                  ? <a className="tx-hash" href={`https://basescan.org/tx/${t.txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#C8FF3D", textDecoration: "none" }}>{t.hash} ↗</a>
                  : <span className="tx-hash">{t.hash}</span>)}
            <span className="tx-time">{t.time}</span>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><span className="ct">Holdings &amp; P/L</span></div>
          <div className="mini-big"><span className="pre">$</span>{money(pf.totalValueUsd, 2)}</div>
          <div style={{ fontSize: 11, color: "var(--mid)", marginBottom: 14, letterSpacing: "0.02em" }}>live on-chain value (DexScreener prices)</div>
          <div className="mini-row"><span className="k">Est. unrealized P/L</span><span className={`mv ${pnlUp ? "lime" : ""}`} style={{ color: pnlUp ? undefined : "#FF6B5E" }}>{pnlUp ? "+" : "−"}${money(Math.abs(pf.estPnlUsd))}</span></div>
          <div className="mini-row"><span className="k">Capital deployed</span><span className="mv">${money(pf.deployedUsd)}</span></div>
          {bestPos && <div className="mini-row"><span className="k">Best position · {bestPos.protocol}</span><span className="mv">{bestPos.entryApy}%</span></div>}
        </div>
        <div className="card">
          <div className="card-head"><span className="ct">x402 spend breakdown</span><span className="ch-right">${money(pf.spend.x402Total, 2)} total</span></div>
          <div className="mini-row"><span className="k">Intelligence (DeFiLlama + Venice)</span><span className="mv">${money(pf.spend.x402Intel, 4)}</span></div>
          <div className="mini-row"><span className="k">Text-to-speech (Venice TTS)</span><span className="mv">${money(pf.spend.x402Tts, 4)}</span></div>
          <div className="mini-row"><span className="k">Image generation</span><span className="mv">${money(pf.spend.x402Image, 4)}</span></div>
          <div className="mini-row"><span className="k" style={{ color: "var(--text-2)", fontWeight: 500 }}>1Shot relayer fees</span><span className="mv">${money(pf.spend.oneShotFees, 3)}</span></div>
        </div>
      </div>
    </div>
  );
}

// ── Fleet tab ────────────────────────────────────────────────────────────────

interface TreeAgent extends AgentCard { children: TreeAgent[] }
function buildTree(agents: AgentCard[]): TreeAgent[] {
  const byId = new Map<string, TreeAgent>();
  agents.forEach(a => byId.set(a.id, { ...a, children: [] }));
  const roots: TreeAgent[] = [];
  byId.forEach(node => {
    if (node.parentAgentId && byId.has(node.parentAgentId)) byId.get(node.parentAgentId)!.children.push(node);
    else roots.push(node);
  });
  return roots;
}

function FleetNodeComp({ node }: { node: TreeAgent }) {
  const status = node.active ? (node.status === "idle" ? "active" : node.status) : node.status;
  return (
    <div className="branch">
      <div className="tnode">
        <div className="tn-left">
          <StatusDot status={status} beat />
          <span className="tn-name">{node.name}</span>
          <span className="tn-type">{node.agentType}</span>
        </div>
        <div className="tn-mid">
          <StatusText status={status} />
          <span style={{ opacity: .4 }}>·</span>
          <span className="act">{node.lastAction ?? (node.scheduleIntervalMs ? "scheduled" : "—")}</span>
        </div>
        <div className="tn-right">
          <span className="tn-budget">${node.budgetUsdc}</span>
        </div>
      </div>
      {node.children.length > 0 && (
        <div className="children">{node.children.map(c => <FleetNodeComp key={c.id} node={c} />)}</div>
      )}
    </div>
  );
}

function FleetTab({ pf }: { pf: Portfolio }) {
  const tree = buildTree(pf.agents);
  const total = pf.agents.length;
  const active = pf.agents.filter(a => a.active).length;
  const byType = pf.agents.reduce<Record<string, number>>((m, a) => { m[a.agentType] = (m[a.agentType] ?? 0) + 1; return m; }, {});
  const failed = pf.agents.filter(a => a.status === "failed").length;
  const pending = pf.agents.filter(a => a.delegationStatus === "pending").length;
  const idle = pf.agents.filter(a => !a.active && a.status !== "failed").length;

  return (
    <div className="page">
      <div className="card">
        <div className="card-head">
          <span className="ct">Agent fleet</span>
          <span className="ch-right">
            <span style={{ color: "var(--text-2)" }}>{total} agents</span> · <span style={{ color: "var(--st-run)" }}>{active} active</span>
          </span>
        </div>
        {total === 0 ? (
          <div style={{ color: "var(--mid)", padding: 12, fontSize: 13 }}>No agents yet. Create one in the Builder.</div>
        ) : (
          <div className="tree">{tree.map(n => <FleetNodeComp key={n.id} node={n} />)}</div>
        )}
        <div className="action-bar">
          <Link href="/dashboard" className="pbtn primary" style={{ textDecoration: "none" }}><DIcon name="add" size={13} /> New agent</Link>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card-head"><span className="ct">By agent type</span></div>
          {Object.keys(byType).length === 0
            ? <div style={{ color: "var(--mid)", padding: 8, fontSize: 13 }}>—</div>
            : Object.entries(byType).map(([t, n]) => (
                <div className="mini-row" key={t}><span className="k" style={{ textTransform: "capitalize" }}>{t}</span><span className="mv">{n}</span></div>
              ))}
        </div>
        <div className="card">
          <div className="card-head"><span className="ct">Health</span></div>
          <div className="mini-row"><span className="k"><span className="sd run" style={{ marginRight: 8 }} />Active</span><span className="mv lime">{active}</span></div>
          <div className="mini-row"><span className="k"><span className="sd pend" style={{ marginRight: 8 }} />Pending delegation</span><span className="mv">{pending}</span></div>
          <div className="mini-row"><span className="k"><span className="sd fail" style={{ marginRight: 8 }} />Failed</span><span className="mv">{failed}</span></div>
          <div className="mini-row"><span className="k"><span className="sd idle" style={{ marginRight: 8 }} />Idle</span><span className="mv">{idle}</span></div>
        </div>
      </div>
    </div>
  );
}

// ── Delegation tab ─────────────────────────────────────────────────────────────

function DelegNodeComp({ node }: { node: TreeAgent }) {
  const revoked = node.delegationStatus === "revoked";
  const st = revoked ? "revoked" : (node.delegationStatus === "active" ? "active" : node.delegationStatus);
  return (
    <div className="branch">
      <div className={`tnode${revoked ? " revoked" : ""}`}>
        <div className="tn-left">
          <StatusDot status={st} />
          <span className="tn-name">{node.name}</span>
        </div>
        <div className="tn-mid"><StatusText status={st} /></div>
        <div className="tn-right">
          <span className="tn-budget">{node.delegationCap ? `$${node.delegationCap}` : "$0"}</span>
          <span className="tn-addr">{short(node.onChainAddress)}</span>
        </div>
      </div>
      {node.children.length > 0 && (
        <div className="children">{node.children.map(c => <DelegNodeComp key={c.id} node={c} />)}</div>
      )}
    </div>
  );
}

function DelegationTab({ pf, perm }: { pf: Portfolio; perm: Permission | null }) {
  const tree = buildTree(pf.agents);
  const budget = Number(perm?.budgetUsdc ?? 0);
  const used = pf.deployedUsd + pf.spend.total;
  const budgetPct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  const expires = perm?.expiresAt ? new Date(perm.expiresAt * 1000).toLocaleDateString() : "—";

  return (
    <div className="page">
      <div className="root-perm mb18">
        <div className="rp-top">
          <div style={{ flex: 1 }}>
            <div className="rp-title"><DIcon name="shield" size={16} /> Root permission</div>
            <div className="rp-std">ERC-7715 · MetaMask delegation</div>
          </div>
        </div>
        <div className="rp-grid">
          <div className="rp-cell"><span className="rl">Granted to</span><span className="rv mono">{short(perm?.grantedTo ?? perm?.delegationManager)}</span></div>
          <div className="rp-cell"><span className="rl">Period</span><span className="rv">{perm?.periodDays ?? "—"} days</span></div>
          <div className="rp-cell"><span className="rl">Expires</span><span className="rv">{expires}</span></div>
        </div>
        <div className="budget-meter">
          <div className="bm-head">
            <span className="bl">Budget · ${perm?.budgetUsdc ?? "0"} USDC / {perm?.periodDays ?? 30} days</span>
            <span className="bv">${money(used)} used <span className="bpct">{budgetPct}%</span></span>
          </div>
          <div className="track"><i style={{ width: `${budgetPct}%` }} /></div>
        </div>
      </div>

      <div className="card mb18">
        <div className="card-head">
          <span className="ct">Subdelegation tree</span>
          <span className="ch-right">Analyzer → Risk → Executor, capped per hop</span>
        </div>
        {pf.agents.length === 0
          ? <div style={{ color: "var(--mid)", padding: 12, fontSize: 13 }}>No delegations yet.</div>
          : <div className="tree">{tree.map(n => <DelegNodeComp key={n.id} node={n} />)}</div>}
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ page, setPage }: { page: string; setPage: (p: string) => void }) {
  const nav = [
    { id: "portfolio",  lbl: "Portfolio",  icon: "wallet" },
    { id: "fleet",      lbl: "Fleet",      icon: "layers" },
    { id: "delegation", lbl: "Delegation", icon: "shield" },
  ];
  return (
    <aside>
      <div className="brand">
        <div className="mark"><CloverMark color="#C8FF3D" /></div>
        <div className="bname">clove</div>
        <div className="bbeta">beta</div>
      </div>

      <Link href="/dashboard" className="new-flow"><DIcon name="add" size={14} /><span>New workflow</span></Link>

      <nav className="snav">
        <Link href="/dashboard" style={{ textDecoration: "none" }} className="snav-a">
          <span className="ico"><DIcon name="grid" /></span><span>Builder</span>
        </Link>
        {nav.map(n => (
          <button key={n.id} className={page === n.id ? "sactive" : ""} onClick={() => setPage(n.id)}>
            <span className="ico"><DIcon name={n.icon} /></span>
            <span>{n.lbl}</span>
          </button>
        ))}
      </nav>

      <div className="side-spacer" />

      <div className="side-foot">
        <a href="#">Docs</a>
        <a href="#">Discord</a>
        <a href="#">Status</a>
      </div>
    </aside>
  );
}

// ── Stat strip ────────────────────────────────────────────────────────────────

function StatStrip({ pf }: { pf: Portfolio }) {
  const active = pf.agents.filter(a => a.active).length;
  const bApy = blendedApy(pf.positions);
  const [r1, v1] = useCountUp(pf.totalValueUsd, 1400, 2);
  const [r2, v2] = useCountUp(pf.agents.length, 1100, 0);
  const [r3, v3] = useCountUp(active, 1000, 0);
  const [r4, v4] = useCountUp(pf.spend.x402Total, 1400, 2);
  const [r5, v5] = useCountUp(bApy, 1300, 1);
  return (
    <div className="stat-strip">
      <div className="stat-tile" ref={r1 as React.RefObject<HTMLDivElement>}>
        <span className="lab">Portfolio</span>
        <span className="v"><span className="pre">$</span>{v1}</span>
        <span className={`sub ${pf.estPnlUsd >= 0 ? "up" : ""}`}>{pf.estPnlUsd >= 0 ? "↗ +" : "↘ −"}${money(Math.abs(pf.estPnlUsd))} P/L</span>
      </div>
      <div className="stat-tile" ref={r2 as React.RefObject<HTMLDivElement>}>
        <span className="lab">Agents</span>
        <span className="v">{v2}</span>
        <span className="sub">{pf.positions.length} positions</span>
      </div>
      <div className="stat-tile" ref={r3 as React.RefObject<HTMLDivElement>}>
        <span className="lab">Active now</span>
        <span className="v lime">{v3}</span>
        <span className="sub">{pf.agents.length - active} idle</span>
      </div>
      <div className="stat-tile" ref={r4 as React.RefObject<HTMLDivElement>}>
        <span className="lab">x402 paid</span>
        <span className="v"><span className="pre">$</span>{v4}</span>
        <span className="sub">+ ${money(pf.spend.oneShotFees, 3)} 1Shot</span>
      </div>
      <div className="stat-tile" ref={r5 as React.RefObject<HTMLDivElement>}>
        <span className="lab">Blended yield</span>
        <span className="v lime">{v5}<span className="suf">%</span></span>
        <span className="sub">${money(pf.deployedUsd)} deployed</span>
      </div>
    </div>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────

const PAGE_ORDER = ["portfolio", "fleet", "delegation"];
const PAGE_LBL: Record<string, string> = { portfolio: "Portfolio", fleet: "Fleet", delegation: "Delegation" };

const EMPTY_PF: Portfolio = {
  wallet: "", holdings: [], totalValueUsd: 0, positions: [], deployedUsd: 0, estPnlUsd: 0,
  runs: [], agents: [], spend: { x402Intel: 0, x402Tts: 0, x402Image: 0, x402Total: 0, oneShotFees: 0, deployedUsd: 0, total: 0 },
};

export default function PortfolioDashboard() {
  const [page, setPage] = useState("portfolio");
  const [wallet, setWallet] = useState<string | null>(null);
  const [pf, setPf] = useState<Portfolio | null>(null);
  const [perm, setPerm] = useState<Permission | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setWallet(metamaskStore.getState().userAddress);
    const unsub = metamaskStore.addListener(() => setWallet(metamaskStore.getState().userAddress));
    return () => unsub?.();
  }, []);

  const load = useCallback(async () => {
    if (!wallet) { setLoading(false); return; }
    setLoading(true);
    try {
      const [pRes, permRes] = await Promise.all([
        fetch(`/api/portfolio?wallet=${encodeURIComponent(wallet)}`),
        fetch(`/api/permission?wallet=${encodeURIComponent(wallet)}`),
      ]);
      if (pRes.ok) setPf(await pRes.json() as Portfolio);
      if (permRes.ok) setPerm(((await permRes.json()) as { permission: Permission | null }).permission);
    } finally { setLoading(false); }
  }, [wallet]);

  useEffect(() => { load(); }, [load]);

  const data = pf ?? EMPTY_PF;
  const active = data.agents.filter(a => a.active).length;

  return (
    <div className="pdash">
      <Sidebar page={page} setPage={setPage} />
      <div className="dash-main">
        <div className="dash-head">
          <div className="crumb">
            <span>Dashboard</span>
            <span className="sep">/</span>
            <span className="here">{PAGE_LBL[page]}</span>
          </div>
          <div className="hgrow" />
          <button onClick={load} className="live-chip" style={{ cursor: "pointer", border: "none" }}>
            <span className="ld" /> {loading ? "loading…" : `${active} agents live`}
          </button>
          <span className="hwallet"><span className="wd" /> {wallet ? short(wallet) : "not connected"}</span>
        </div>

        <StatStrip pf={data} />

        <div className="tab-nav">
          {PAGE_ORDER.map(id => (
            <button key={id} className={page === id ? "ton" : ""} onClick={() => setPage(id)}>
              {PAGE_LBL[id]}
            </button>
          ))}
        </div>

        <div className="dash-scroll">
          {!wallet ? (
            <div className="page"><div className="card" style={{ textAlign: "center", color: "var(--mid)", padding: 40 }}>Connect your wallet to view your portfolio.</div></div>
          ) : (
            <>
              {page === "portfolio"  && <PortfolioTab  key="p" pf={data} />}
              {page === "fleet"      && <FleetTab      key="f" pf={data} />}
              {page === "delegation" && <DelegationTab key="d" pf={data} perm={perm} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
