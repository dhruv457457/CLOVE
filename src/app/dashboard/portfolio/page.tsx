"use client";

import "./dash.css";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

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
  executed: { cls: "run",  label: "executed" },
  watching: { cls: "run",  label: "watching" },
  pending:  { cls: "pend", label: "pending" },
  failed:   { cls: "fail", label: "failed" },
  revoked:  { cls: "fail", label: "revoked" },
  idle:     { cls: "idle", label: "idle" },
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
  const total = segments.reduce((s, x) => s + x.value, 0);
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface AllocRow  { name: string; amount: number; pct: number; apy: number; }
interface TxRow     { status: string; main: string; amt?: string; flag?: string; hash: string; time: string; }
interface FleetNode { id: string; name: string; type: string; status: string; action: string; budget: string; children?: FleetNode[]; }
interface DelegNode { id: string; name: string; budget: string; status: string; addr: string; noRevoke?: boolean; children?: DelegNode[]; }
interface RevLog    { name: string; hash: string; time: string; fresh?: boolean; }

// ── Portfolio Page ────────────────────────────────────────────────────────────

const PF_ALLOC: AllocRow[] = [
  { name: "Morpho",    amount: 200, pct: 41, apy: 8.4 },
  { name: "Aave",      amount: 150, pct: 31, apy: 5.2 },
  { name: "Aerodrome", amount: 100, pct: 20, apy: 12.1 },
  { name: "Lido",      amount: 37,  pct:  8, apy: 4.8 },
];
const PF_TXS: TxRow[] = [
  { status: "executed", main: "Morpho deposit", amt: "$50",  hash: "0xabc…7f2", time: "2h ago" },
  { status: "executed", main: "Aave supply",    amt: "$30",  hash: "0xdef…1c9", time: "1d ago" },
  { status: "pending",  main: "Uniswap swap",               hash: "—",          time: "5m ago" },
  { status: "failed",   main: "Aerodrome LP",   flag: "risk HIGH", hash: "0x4a…b21", time: "3d ago" },
];
const PF_SPEND = [
  { k: "Intelligence (DeFiLlama + Venice)", v: "$0.23" },
  { k: "Text-to-speech (Venice TTS)",       v: "$0.15" },
  { k: "Image generation (Venice FLUX)",    v: "$0.09" },
];

function txIcon(status: string) {
  if (status === "executed") return <span className="sd run" />;
  if (status === "pending")  return <span className="sd pend beat" />;
  return <span className="sd fail" />;
}

function PortfolioPage() {
  const [r1, v1] = useCountUp(487.32, 1500, 2);
  const [r2, v2] = useCountUp(0.47,   1500, 2);
  const donutSegs = PF_ALLOC.map(a => ({ value: a.amount, color: apyColor(a.apy) }));
  return (
    <div className="page">
      <div className="hero-row">
        <div className="hero-stat" ref={r1 as React.RefObject<HTMLDivElement>}>
          <span className="lab">Total portfolio value</span>
          <span className="big"><span className="pre">$</span>{v1}</span>
          <span className="delta up">↗ +2.3% today · +$11.04</span>
          <Sparkline points={[418,430,425,441,438,452,460,455,470,476,481,487]} />
        </div>
        <div className="hero-stat" ref={r2 as React.RefObject<HTMLDivElement>}>
          <span className="lab">Total spent · x402</span>
          <span className="big"><span className="pre">$</span>{v2}</span>
          <span className="delta flat">this week · across 9 agent calls</span>
          <Sparkline points={[2,5,3,8,6,11,9,14,12,18,16,21]} color="#F2B85C" />
        </div>
      </div>

      <div className="card mb18">
        <div className="card-head">
          <span className="ct">Protocol allocation</span>
          <span className="ch-right">colored by live APY · brighter = higher yield</span>
        </div>
        <div className="grid-2-13">
          <div className="donut-wrap">
            <Donut segments={donutSegs} centerValue="7.2%" centerLabel="blended apy" />
          </div>
          <div className="alloc">
            <div className="alloc-head"><span/><span>Protocol</span><span>Value</span><span>Share</span><span>APY</span></div>
            {PF_ALLOC.map((a, i) => {
              const col = apyColor(a.apy);
              return (
                <div className="alloc-row" key={a.name}>
                  <span className="sw" style={{ background: col }} />
                  <span className="nm">
                    {a.name}
                    <span className="bar"><i style={{ width: `${a.pct}%`, background: col, animationDelay: `${i * 90}ms` }} /></span>
                  </span>
                  <span className="aamt">${a.amount}</span>
                  <span className="pct">{a.pct}%</span>
                  <span className="rapy" style={{ color: col }}>{a.apy}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card mb18">
        <div className="card-head">
          <span className="ct">Recent transactions</span>
          <span className="ch-right">last 7 days</span>
        </div>
        {PF_TXS.map((t, i) => (
          <div className="tx-row" key={i}>
            {txIcon(t.status)}
            <span className="tx-main">
              {t.main}{t.amt && <> <span className="tx-amt">{t.amt}</span></>}
            </span>
            {t.flag
              ? <span className="tx-flag risk">{t.flag}</span>
              : <span className="tx-hash">{t.hash}</span>}
            <span className="tx-time">{t.time}</span>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><span className="ct">Yield earned</span></div>
          <div className="mini-big"><span className="pre">$</span>12.47</div>
          <div style={{ fontSize: 11, color: "var(--mid)", marginBottom: 14, letterSpacing: "0.02em" }}>total realized + accrued</div>
          <div className="mini-row"><span className="k">This week</span><span className="mv lime">+$0.87</span></div>
          <div className="mini-row"><span className="k">Blended APY</span><span className="mv lime">7.2%</span></div>
          <div className="mini-row"><span className="k">Best position · Aerodrome</span><span className="mv">12.1%</span></div>
        </div>
        <div className="card">
          <div className="card-head"><span className="ct">x402 spend breakdown</span><span className="ch-right">$0.47 total</span></div>
          {PF_SPEND.map((s, i) => (
            <div className="mini-row" key={i}><span className="k">{s.k}</span><span className="mv">{s.v}</span></div>
          ))}
          <div className="mini-row">
            <span className="k" style={{ color: "var(--text-2)", fontWeight: 500 }}>Cost per $ deployed</span>
            <span className="mv">0.10%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Fleet Page ────────────────────────────────────────────────────────────────

const FLEET_INIT: FleetNode[] = [
  { id: "morpho-scout", name: "Morpho Scout",    type: "yield",      status: "running",  action: "scanning vaults",      budget: "$0.05 cap",
    children: [
      { id: "morpho-risk", name: "Risk Monitor",    type: "guard",      status: "idle",     action: "—", budget: "$0",
        children: [
          { id: "morpho-exec", name: "Morpho Executor", type: "execute", status: "executed", action: "executed 2h ago", budget: "$200" },
        ] },
    ] },
  { id: "aave-scout", name: "Aave Scout",       type: "yield",      status: "pending",  action: "needs permission",     budget: "$0.05 cap",
    children: [
      { id: "aave-risk", name: "Risk Monitor",    type: "guard",      status: "blocked",  action: "—", budget: "$0",
        children: [
          { id: "aave-exec", name: "Aave Executor",    type: "execute", status: "blocked",  action: "—", budget: "$150" },
        ] },
    ] },
  { id: "whale",  name: "Whale Watcher",    type: "copy-trade", status: "running",  action: "watching 3 wallets",   budget: "$0.02 cap",
    children: [
      { id: "copy-exec", name: "Copy Executor",    type: "execute", status: "executed", action: "executed 4h ago", budget: "$25" },
    ] },
  { id: "poly",   name: "Polymarket Scout", type: "prediction", status: "failed",   action: "edge < 8% threshold",  budget: "$0.03 cap" },
];

function countAgents(nodes: FleetNode[]): { total: number; active: number } {
  let total = 0, active = 0;
  const walk = (n: FleetNode) => {
    total++;
    if (n.status === "running" || n.status === "watching") active++;
    (n.children ?? []).forEach(walk);
  };
  nodes.forEach(walk);
  return { total, active };
}

function FleetNodeComp({ node }: { node: FleetNode }) {
  return (
    <div className="branch">
      <div className="tnode">
        <div className="tn-left">
          <StatusDot status={node.status} beat />
          <span className="tn-name">{node.name}</span>
          <span className="tn-type">{node.type}</span>
        </div>
        <div className="tn-mid">
          <StatusText status={node.status} />
          <span style={{ opacity: .4 }}>·</span>
          <span className="act">{node.action}</span>
        </div>
        <div className="tn-right">
          <span className="tn-budget">{node.budget}</span>
        </div>
      </div>
      {node.children && node.children.length > 0 && (
        <div className="children">
          {node.children.map(c => <FleetNodeComp key={c.id} node={c} />)}
        </div>
      )}
    </div>
  );
}

function FleetPage() {
  const [fleet, setFleet] = useState<FleetNode[]>(FLEET_INIT);
  const { total, active } = countAgents(fleet);

  const mapAll = useCallback((fn: (n: FleetNode) => Partial<FleetNode>) => {
    const walk = (n: FleetNode): FleetNode => ({ ...n, ...fn(n), children: (n.children ?? []).map(walk) });
    setFleet(f => f.map(walk));
  }, []);

  const pauseAll = () => mapAll(n =>
    (n.status === "running" || n.status === "watching") ? { status: "idle", action: "paused by operator" } : {}
  );
  const runAll = () => setFleet(FLEET_INIT);

  return (
    <div className="page">
      <div className="card">
        <div className="card-head">
          <span className="ct">Agent fleet</span>
          <span className="ch-right">
            <span style={{ color: "var(--text-2)" }}>{total} agents</span> · <span style={{ color: "var(--st-run)" }}>{active} active</span>
          </span>
        </div>
        <div className="tree">
          {fleet.map(n => <FleetNodeComp key={n.id} node={n} />)}
        </div>
        <div className="action-bar">
          <Link href="/dashboard" className="pbtn primary" style={{ textDecoration: "none" }}><DIcon name="add" size={13} /> New agent</Link>
          <button className="pbtn" onClick={runAll}><DIcon name="play" size={12} /> Run all</button>
          <button className="pbtn" onClick={pauseAll}><DIcon name="pause" size={12} /> Pause all</button>
          <button className="pbtn danger" style={{ marginLeft: "auto" }}><DIcon name="revoke" size={13} /> Revoke all</button>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card-head"><span className="ct">By workflow type</span></div>
          <div className="mini-row"><span className="k">Yield optimizers</span><span className="mv">2</span></div>
          <div className="mini-row"><span className="k">Copy-trade</span><span className="mv">1</span></div>
          <div className="mini-row"><span className="k">Prediction markets</span><span className="mv">1</span></div>
          <div className="mini-row"><span className="k">Risk monitors</span><span className="mv">2</span></div>
        </div>
        <div className="card">
          <div className="card-head"><span className="ct">Health</span></div>
          <div className="mini-row"><span className="k"><span className="sd run" style={{ marginRight: 8 }} />Healthy</span><span className="mv lime">{active}</span></div>
          <div className="mini-row"><span className="k"><span className="sd pend" style={{ marginRight: 8 }} />Awaiting permission</span><span className="mv">1</span></div>
          <div className="mini-row"><span className="k"><span className="sd fail" style={{ marginRight: 8 }} />Failed</span><span className="mv">1</span></div>
          <div className="mini-row"><span className="k"><span className="sd idle" style={{ marginRight: 8 }} />Idle / blocked</span><span className="mv">3</span></div>
        </div>
      </div>
    </div>
  );
}

// ── Delegation Page ───────────────────────────────────────────────────────────

const DELEG_INIT: DelegNode[] = [
  { id: "ms", name: "Morpho Scout", budget: "$0.05", status: "active", addr: "0x1a2b",
    children: [
      { id: "mr", name: "Risk Monitor", budget: "$0", status: "active", addr: "0x3c4d",
        children: [
          { id: "me", name: "Morpho Exec", budget: "$200", status: "active", addr: "0x5e6f" },
        ] },
    ] },
  { id: "as", name: "Aave Scout", budget: "$0.05", status: "active", addr: "0x7g8h",
    children: [
      { id: "ar", name: "Risk Monitor", budget: "$0", status: "active", addr: "0x9i0j",
        children: [
          { id: "ae", name: "Aave Exec", budget: "$150", status: "pending", addr: "needs grant", noRevoke: true },
        ] },
    ] },
  { id: "old", name: "Old Executor", budget: "$50", status: "revoked", addr: "0xdead" },
];

const REVLOG_INIT: RevLog[] = [
  { name: "Morpho Exec v1",  hash: "0xabc123", time: "2h ago" },
  { name: "Aerodrome Exec",  hash: "0xdef456", time: "1d ago" },
];

function DelegNodeComp({ node, onRevoke }: { node: DelegNode; onRevoke: (n: DelegNode) => void }) {
  const revoked = node.status === "revoked";
  return (
    <div className="branch">
      <div className={`tnode${revoked ? " revoked" : ""}`}>
        <div className="tn-left">
          <StatusDot status={revoked ? "revoked" : node.status} />
          <span className="tn-name">{node.name}</span>
        </div>
        <div className="tn-mid">
          <StatusText status={revoked ? "revoked" : node.status} />
        </div>
        <div className="tn-right">
          <span className="tn-budget">{node.budget}</span>
          {node.noRevoke
            ? <span className="needs-grant">{node.addr}</span>
            : <span className="tn-addr">{node.addr}</span>}
          <button
            className="x-btn"
            disabled={revoked || node.noRevoke}
            title={revoked ? "Already revoked" : "Revoke on-chain"}
            onClick={() => onRevoke(node)}
            aria-label="Revoke"
          >✕</button>
        </div>
      </div>
      {node.children && node.children.length > 0 && (
        <div className="children">
          {node.children.map(c => <DelegNodeComp key={c.id} node={c} onRevoke={onRevoke} />)}
        </div>
      )}
    </div>
  );
}

function DelegationPage() {
  const [tree, setTree] = useState<DelegNode[]>(DELEG_INIT);
  const [log, setLog] = useState<RevLog[]>(REVLOG_INIT);
  const [freshHash, setFreshHash] = useState<string | null>(null);
  const budgetPct = 97;

  const revoke = useCallback((target: DelegNode) => {
    const walk = (n: DelegNode): DelegNode => {
      if (n.id === target.id) {
        const kill = (m: DelegNode): DelegNode => ({ ...m, status: "revoked", children: (m.children ?? []).map(kill) });
        return kill(n);
      }
      return { ...n, children: (n.children ?? []).map(walk) };
    };
    setTree(t => t.map(walk));
    const hash = "0x" + Math.random().toString(16).slice(2, 8);
    setFreshHash(hash);
    setLog(l => [{ name: target.name, hash, time: "just now", fresh: true }, ...l]);
  }, []);

  return (
    <div className="page">
      <div className="root-perm mb18">
        <div className="rp-top">
          <div style={{ flex: 1 }}>
            <div className="rp-title"><DIcon name="shield" size={16} /> Root permission</div>
            <div className="rp-std">ERC-7715 · MetaMask delegation</div>
          </div>
          <button className="pbtn danger"><DIcon name="revoke" size={13} /> Revoke root</button>
        </div>
        <div className="rp-grid">
          <div className="rp-cell"><span className="rl">Granted to</span><span className="rv mono">0x7195…6716</span></div>
          <div className="rp-cell"><span className="rl">Duration</span><span className="rv">90 days</span></div>
          <div className="rp-cell"><span className="rl">Expires</span><span className="rv">Jul 14, 2026</span></div>
        </div>
        <div className="budget-meter">
          <div className="bm-head">
            <span className="bl">Budget · $500 USDC / 30 days</span>
            <span className="bv">$487 used <span className="bpct">{budgetPct}%</span></span>
          </div>
          <div className="track"><i style={{ width: `${budgetPct}%` }} /></div>
        </div>
      </div>

      <div className="card mb18">
        <div className="card-head">
          <span className="ct">Subdelegation tree</span>
          <span className="ch-right">tap ✕ to revoke a branch on-chain</span>
        </div>
        <div className="tree">
          {tree.map(n => <DelegNodeComp key={n.id} node={n} onRevoke={revoke} />)}
        </div>
      </div>

      <div className="card rev-log">
        <div className="card-head"><span className="ct">Revocation log</span></div>
        {log.map((r, i) => (
          <div className={`rev-row${r.fresh && r.hash === freshHash ? " fresh" : ""}`} key={i}>
            <span className="rev-name"><span className="tag-rev">revoked</span>{r.name}</span>
            <span className="rev-hash">{r.hash}</span>
            <span className="rev-time">{r.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ page, setPage }: { page: string; setPage: (p: string) => void }) {
  const nav = [
    { id: "portfolio",  lbl: "Portfolio",  icon: "wallet" },
    { id: "fleet",      lbl: "Fleet",      icon: "layers", count: "12" },
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
          <button
            key={n.id}
            className={page === n.id ? "sactive" : ""}
            onClick={() => setPage(n.id)}
          >
            <span className="ico"><DIcon name={n.icon} /></span>
            <span>{n.lbl}</span>
            {n.count && <span className="scount">{n.count}</span>}
          </button>
        ))}
        <button onClick={() => {}}>
          <span className="ico"><DIcon name="coin" /></span>
          <span>Earnings</span>
          <span className="scount">$48</span>
        </button>
        <button onClick={() => {}}>
          <span className="ico"><DIcon name="book" /></span>
          <span>Address book</span>
        </button>
      </nav>

      <div className="side-spacer" />

      <div className="ask-ai">
        <div className="ahead">
          <span className="albl">Ask clove</span>
          <span className="apl">⌘K</span>
        </div>
        <textarea placeholder="Ask about your portfolio…" rows={2} />
      </div>

      <div className="side-foot">
        <a href="#">Docs</a>
        <a href="#">Discord</a>
        <a href="#">Status</a>
      </div>
    </aside>
  );
}

// ── Stat strip ────────────────────────────────────────────────────────────────

function StatStrip() {
  const [r1, v1] = useCountUp(487,  1400, 0);
  const [r2, v2] = useCountUp(12,   1100, 0);
  const [r3, v3] = useCountUp(3,    1000, 0);
  const [r4, v4] = useCountUp(0.47, 1400, 2);
  const [r5, v5] = useCountUp(7.2,  1300, 1);
  return (
    <div className="stat-strip">
      <div className="stat-tile" ref={r1 as React.RefObject<HTMLDivElement>}>
        <span className="lab">Portfolio</span>
        <span className="v"><span className="pre">$</span>{v1}</span>
        <span className="sub up">↗ +2.3% today</span>
      </div>
      <div className="stat-tile" ref={r2 as React.RefObject<HTMLDivElement>}>
        <span className="lab">Agents</span>
        <span className="v">{v2}</span>
        <span className="sub">across 4 workflows</span>
      </div>
      <div className="stat-tile" ref={r3 as React.RefObject<HTMLDivElement>}>
        <span className="lab">Active now</span>
        <span className="v lime">{v3}</span>
        <span className="sub">3 running · 1 pending</span>
      </div>
      <div className="stat-tile" ref={r4 as React.RefObject<HTMLDivElement>}>
        <span className="lab">x402 paid</span>
        <span className="v"><span className="pre">$</span>{v4}</span>
        <span className="sub">this week</span>
      </div>
      <div className="stat-tile" ref={r5 as React.RefObject<HTMLDivElement>}>
        <span className="lab">Blended yield</span>
        <span className="v lime">{v5}<span className="suf">%</span></span>
        <span className="sub">$12.47 earned</span>
      </div>
    </div>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────

const PAGES: Record<string, { lbl: string; pill?: string; Comp: React.FC }> = {
  portfolio:  { lbl: "Portfolio",  Comp: PortfolioPage },
  fleet:      { lbl: "Fleet",      pill: "12", Comp: FleetPage },
  delegation: { lbl: "Delegation", Comp: DelegationPage },
};
const PAGE_ORDER = ["portfolio", "fleet", "delegation"];

export default function PortfolioDashboard() {
  const [page, setPage] = useState("portfolio");
  const { Comp } = PAGES[page];

  return (
    <div className="pdash">
      <Sidebar page={page} setPage={setPage} />
      <div className="dash-main">
        {/* header */}
        <div className="dash-head">
          <div className="crumb">
            <span>Dashboard</span>
            <span className="sep">/</span>
            <span className="here">{PAGES[page].lbl}</span>
          </div>
          <div className="hgrow" />
          <div className="live-chip"><span className="ld" /> 3 agents live</div>
          <button className="hwallet"><span className="wd" /> 0x7195…6716</button>
        </div>

        {/* KPI strip */}
        <StatStrip />

        {/* tab nav */}
        <div className="tab-nav">
          {PAGE_ORDER.map(id => (
            <button key={id} className={page === id ? "ton" : ""} onClick={() => setPage(id)}>
              {PAGES[id].lbl}
              {PAGES[id].pill && <span className="pill">{PAGES[id].pill}</span>}
            </button>
          ))}
        </div>

        {/* page content */}
        <div className="dash-scroll">
          <Comp key={page} />
        </div>
      </div>
    </div>
  );
}
