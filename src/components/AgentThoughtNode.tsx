"use client";

import React from "react";
import { Handle, Position } from "@xyflow/react";

const ACCENT  = "#C8FF3D";
const INK_1   = "#111210";
const CARD    = "#14160D";
const TEXT    = "#E8E5DA";
const TEXT2   = "#B5B2A5";
const MID     = "#6B6A60";
const LINE    = "rgba(244,241,234,0.10)";
const WARN    = "#FF8A66";
const PEND    = "#F2B85C";

export type ThoughtType = "goal" | "plan" | "tool-call" | "tool-result" | "reflect" | "media";

interface ThoughtNodeData {
  type:     ThoughtType;
  content:  Record<string, unknown>;
  fresh?:   boolean;
}

// ── Protocol & tool visual identity ─────────────────────────────────────────────

const PROTOCOL: Record<string, { label: string; color: string; glyph: string }> = {
  morpho:    { label: "Morpho",    color: "#3B82F6", glyph: "M" },
  aave:      { label: "Aave",      color: "#B6509E", glyph: "A" },
  uniswap:   { label: "Uniswap",   color: "#FF007A", glyph: "U" },
  aerodrome: { label: "Aerodrome", color: "#1DA1F2", glyph: "Ae" },
  lido:      { label: "Lido",      color: "#00A3FF", glyph: "L" },
};

const TOOL: Record<string, { label: string; icon: React.ReactNode; tint: string }> = {
  checkYields:           { label: "Scanning live yields",     icon: <IconChart />,  tint: ACCENT },
  checkRisk:             { label: "Assessing risk",           icon: <IconShield />, tint: PEND  },
  executeDefi:           { label: "Executing on-chain",       icon: <IconBolt />,   tint: ACCENT },
  rebalance:             { label: "Rebalancing position",     icon: <IconSwap />,   tint: ACCENT },
  notifyUser:            { label: "Sending Telegram",         icon: <IconSend />,   tint: "#229ED9" },
  checkWhaleTrades:      { label: "Tracking whale wallets",   icon: <IconWhale />,  tint: "#7C5CFF" },
  checkNarratives:      { label: "Reading market narrative", icon: <IconNews />,   tint: "#F2B85C" },
  addThought:            { label: "Thinking",                 icon: <IconSpark />,  tint: TEXT2 },
  revisePlan:            { label: "Revising plan",            icon: <IconSwap />,   tint: PEND  },
};

// ── Main node ────────────────────────────────────────────────────────────────────

export function AgentThoughtNode({ data, selected }: { data: ThoughtNodeData; selected?: boolean }) {
  const { type, content } = data;

  const accentFor: Record<ThoughtType, string> = {
    "goal": ACCENT, "plan": TEXT2, "tool-call": ACCENT,
    "tool-result": ACCENT, "reflect": ACCENT, "media": "#7C5CFF",
  };
  const stripe = accentFor[type] ?? MID;

  return (
    <div
      className={data.fresh ? "ag-node ag-in" : "ag-node"}
      style={{
        position: "relative",
        background: type === "goal" ? `linear-gradient(135deg, rgba(200,255,61,0.06), transparent 70%), ${CARD}` : CARD,
        border: `1px solid ${selected ? ACCENT : LINE}`,
        borderRadius: 12,
        minWidth: selected ? 210 : 150,
        maxWidth: selected ? 300 : 250,
        fontFamily: "var(--sans)",
        cursor: "pointer",
        boxShadow: selected
          ? `0 0 0 1px ${ACCENT}, 0 14px 30px -18px rgba(200,255,61,0.45)`
          : "0 8px 24px -20px rgba(0,0,0,0.8)",
        overflow: "hidden",
        transition: "border-color .15s, box-shadow .15s, transform .15s, min-width .15s",
      }}
    >
      {/* Left accent stripe */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: stripe, opacity: 0.85 }} />

      <Handle type="target" position={Position.Top} style={handleStyle(selected)} />
      {/* Compact by default — full detail only when the node is clicked (selected). */}
      <div style={{ padding: selected ? "11px 14px 12px 16px" : "9px 12px 9px 14px" }}>
        {selected ? renderByType(type, content) : <CompactNode type={type} content={content} />}
      </div>
      <Handle type="source" position={Position.Bottom} style={handleStyle(selected)} />

      <style jsx>{`
        :global(.ag-in) { animation: agIn .42s cubic-bezier(.2,.85,.25,1); }
        @keyframes agIn {
          from { opacity: 0; transform: translateY(-10px) scale(.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

function handleStyle(selected?: boolean): React.CSSProperties {
  return { background: selected ? ACCENT : "rgba(244,241,234,0.25)", width: 7, height: 7, border: "2px solid #0B0C09" };
}

function renderByType(type: ThoughtType, content: Record<string, unknown>) {
  switch (type) {
    case "goal":        return <GoalNode content={content} />;
    case "plan":        return <PlanNode content={content} />;
    case "tool-call":   return <ToolCallNode content={content} />;
    case "tool-result": return <ToolResultNode content={content} />;
    case "reflect":     return <ReflectNode content={content} />;
    case "media":       return <MediaNode content={content} />;
    default:            return <div style={{ fontSize: 11, color: TEXT2 }}>{JSON.stringify(content)}</div>;
  }
}

// ── Compact node (default) — icon + short label + protocol logo / key badge ───────
//    Full detail is shown only when the node is clicked (selected).

function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function MiniPill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 999, background: `${color}18`, border: `1px solid ${color}3a`, fontSize: 9.5, color, fontWeight: 700, letterSpacing: "0.03em", whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

interface CompactMeta { icon: React.ReactNode; label: string; tint: string; proto?: string; pill?: React.ReactNode; }

function compactMeta(type: ThoughtType, content: Record<string, unknown>): CompactMeta {
  const protoOf = (s: unknown) => String(s ?? "").toLowerCase();
  switch (type) {
    case "goal":
      return { icon: <IconTarget />, label: "Strategy goal", tint: ACCENT };
    case "plan": {
      const obs = typeof content.observation === "string" ? content.observation : null;
      if (obs) return { icon: <IconSpark />, label: truncate(obs, 34), tint: TEXT2 };
      return { icon: <IconMap />, label: "Plan", tint: TEXT2 };
    }
    case "tool-call": {
      const tool = String(content.tool ?? "");
      const t = TOOL[tool];
      const args = (content.args ?? {}) as Record<string, unknown>;
      return { icon: t?.icon ?? <IconSpark />, label: t?.label ?? tool, tint: t?.tint ?? TEXT2, proto: protoOf(args.protocol) };
    }
    case "tool-result": {
      const tool = String(content.tool ?? "");
      const t = TOOL[tool];
      const proto = protoOf(content.recommended ?? content.protocol);
      const receipt = (content.receiptToken && typeof content.receiptToken === "object")
        ? content.receiptToken as { symbol?: string } : undefined;
      let pill: React.ReactNode = null;
      if (content.txHash || content.submitted === true) pill = <MiniPill text={receipt?.symbol ? `→ ${receipt.symbol}` : "on-chain ✓"} color={ACCENT} />;
      else if (typeof content.bestApy === "number")      pill = <MiniPill text={`${(content.bestApy as number).toFixed(1)}% APY`} color={ACCENT} />;
      else if (typeof content.riskLevel === "string")    pill = <MiniPill text={`${content.riskLevel} RISK`} color={content.riskLevel === "HIGH" ? WARN : content.riskLevel === "MEDIUM" ? PEND : ACCENT} />;
      else if (content.sent === true)                    pill = <MiniPill text="sent" color="#229ED9" />;
      return { icon: t?.icon ?? <IconCheck />, label: t?.label ?? "Result", tint: t?.tint ?? ACCENT, proto, pill };
    }
    case "reflect": {
      const ok = content.didSucceed === true || content.goalAchieved === true;
      return { icon: <IconCheck />, label: ok ? "Goal achieved" : "Reflection", tint: ok ? ACCENT : TEXT2 };
    }
    case "media": {
      const isImg = content.service === "image" || !!content.imageUrl;
      return { icon: <IconSpark />, label: isImg ? "Strategy image" : "Voice note", tint: "#7C5CFF" };
    }
    default:
      return { icon: <IconSpark />, label: String(type), tint: MID };
  }
}

function CompactNode({ type, content }: { type: ThoughtType; content: Record<string, unknown> }) {
  const m = compactMeta(type, content);
  const p = m.proto ? PROTOCOL[m.proto] : undefined;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 24, height: 24, borderRadius: 7, background: `${m.tint}1A`, color: m.tint, flexShrink: 0,
      }}>
        {m.icon}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color: TEXT, letterSpacing: "-0.005em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {m.label}
      </span>
      {/* Protocol logo badge (Morpho / Aave / …) */}
      {p && (
        <span title={p.label} style={{ width: 18, height: 18, borderRadius: "50%", background: p.color, color: "#fff", fontSize: 8.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {p.glyph}
        </span>
      )}
      {m.pill}
    </div>
  );
}

// ── Node variants ─────────────────────────────────────────────────────────────────

function GoalNode({ content }: { content: Record<string, unknown> }) {
  return (
    <>
      <Header icon={<IconTarget />} label="Goal" tint={ACCENT} />
      <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 16, lineHeight: 1.35, color: TEXT, marginTop: 8, letterSpacing: "-0.01em" }}>
        {String(content.text ?? "(no goal)")}
      </div>
    </>
  );
}

function PlanNode({ content }: { content: Record<string, unknown> }) {
  const subgoals    = content.subgoals as Array<{ id: string; description: string }> | undefined;
  const isSubgoal   = typeof content.description === "string";
  const observation = content.observation as string | undefined;

  if (observation) {
    return (
      <>
        <Header icon={<IconSpark />} label="Thinking" tint={TEXT2} />
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: TEXT2, marginTop: 6 }}>{observation}</div>
      </>
    );
  }

  if (isSubgoal) {
    return (
      <>
        <Header icon={<IconStep />} label="Step" tint={ACCENT} active />
        <div style={{ fontSize: 13.5, fontWeight: 500, color: TEXT, marginTop: 6, lineHeight: 1.35, letterSpacing: "-0.01em" }}>
          {String(content.description)}
        </div>
      </>
    );
  }

  return (
    <>
      <Header icon={<IconMap />} label="Plan" tint={TEXT2} />
      <div style={{ fontSize: 12.5, color: TEXT2, marginTop: 6, lineHeight: 1.45 }}>
        {String(content.reasoning ?? "Plan generated.")}
      </div>
      {subgoals && subgoals.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {subgoals.slice(0, 5).map((sg, i) => (
            <div key={sg.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ flexShrink: 0, width: 16, height: 16, borderRadius: 5, background: "rgba(200,255,61,0.12)", color: ACCENT, fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{i + 1}</span>
              <span style={{ fontSize: 11.5, color: TEXT2, lineHeight: 1.4 }}>{sg.description}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ToolCallNode({ content }: { content: Record<string, unknown> }) {
  const toolName = String(content.tool ?? "?");
  const meta = TOOL[toolName] ?? { label: toolName, icon: <IconBolt />, tint: ACCENT };
  const args = (content.args ?? {}) as Record<string, unknown>;
  const proto = typeof args.protocol === "string" ? args.protocol.toLowerCase() : undefined;
  const amount = args.amount ?? args.sizeUsdc;

  return (
    <>
      <Header icon={meta.icon} label={meta.label} tint={meta.tint} active />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {proto && PROTOCOL[proto] && <ProtocolBadge proto={proto} />}
        {amount !== undefined && (
          <span style={{ fontSize: 12, color: TEXT, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            ${String(amount)} USDC
          </span>
        )}
      </div>
    </>
  );
}

function ToolResultNode({ content }: { content: Record<string, unknown> }) {
  const toolName  = String(content.tool ?? "?");
  const txHash    = typeof content.txHash === "string" ? content.txHash : undefined;
  const bestApy   = typeof content.bestApy === "number" ? content.bestApy : undefined;
  const recommended = typeof content.recommended === "string" ? content.recommended : undefined;
  const riskLevel = typeof content.riskLevel === "string" ? content.riskLevel : undefined;
  const sent      = typeof content.sent === "boolean" ? content.sent : undefined;
  const submitted = content.submitted === true;
  const proto     = recommended?.toLowerCase();
  const receipt   = (content.receiptToken && typeof content.receiptToken === "object")
    ? content.receiptToken as { symbol?: string; address?: string; name?: string }
    : undefined;
  const receivedAmount = typeof content.receivedAmount === "string" ? content.receivedAmount : undefined;

  return (
    <>
      <Header icon={<IconCheck />} label="Result" tint={ACCENT} />

      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {bestApy !== undefined && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {proto && PROTOCOL[proto] && <ProtocolBadge proto={proto} />}
            <span style={{ fontSize: 18, fontFamily: "var(--serif)", fontStyle: "italic", color: ACCENT, fontVariantNumeric: "tabular-nums" }}>
              {bestApy.toFixed(2)}%
            </span>
            <span style={{ fontSize: 10, color: MID, textTransform: "uppercase", letterSpacing: "0.08em" }}>APY</span>
          </div>
        )}

        {riskLevel && (
          <RiskPill level={riskLevel} />
        )}

        {(submitted || txHash) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 9px", borderRadius: 7, background: "rgba(200,255,61,0.08)", border: "1px solid rgba(200,255,61,0.22)" }}>
            <IconCheck size={12} />
            <span style={{ fontSize: 11.5, color: ACCENT, fontWeight: 600 }}>On-chain</span>
            {txHash && (
              <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                 style={{ marginLeft: "auto", fontSize: 10.5, color: ACCENT, textDecoration: "none", fontVariantNumeric: "tabular-nums", opacity: 0.9 }}>
                {txHash.slice(0, 8)}… ↗
              </a>
            )}
          </div>
        )}

        {/* Token received in the user's wallet after a deposit/swap */}
        {receipt?.symbol && (txHash || submitted) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 9px", borderRadius: 7, background: "rgba(124,92,255,0.08)", border: "1px solid rgba(124,92,255,0.22)" }}>
            <span style={{ fontSize: 10, color: MID, textTransform: "uppercase", letterSpacing: "0.08em" }}>Received in wallet</span>
            <span style={{ fontSize: 12.5, color: "#B9A8FF", fontWeight: 600 }}>
              {receivedAmount ? `${receivedAmount} ` : ""}{receipt.symbol}
              {receipt.name ? <span style={{ color: MID, fontWeight: 400 }}> · {receipt.name}</span> : null}
            </span>
            {receipt.address && (
              <a href={`https://basescan.org/token/${receipt.address}`} target="_blank" rel="noopener noreferrer"
                 style={{ fontSize: 10, color: "#B9A8FF", textDecoration: "none", fontVariantNumeric: "tabular-nums", opacity: 0.85 }}>
                {receipt.address.slice(0, 10)}…{receipt.address.slice(-6)} ↗
              </a>
            )}
          </div>
        )}

        {sent === true && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#229ED9" }}>
            <IconSend size={12} /> Telegram sent
          </div>
        )}

        {bestApy === undefined && !riskLevel && !txHash && !submitted && sent === undefined && (
          <span style={{ fontSize: 11.5, color: MID }}>{TOOL[toolName]?.label ?? toolName} done</span>
        )}
      </div>
    </>
  );
}

function ReflectNode({ content }: { content: Record<string, unknown> }) {
  const insight = String(content.insight ?? "");
  const didSucceed = content.didSucceed;
  return (
    <>
      <Header icon={<IconQuote />} label="Reflection" tint={ACCENT} />
      <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 13.5, lineHeight: 1.4, color: TEXT, marginTop: 8, paddingLeft: 2 }}>
        {insight}
      </div>
      {typeof didSucceed === "boolean" && (
        <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: didSucceed ? ACCENT : MID }}>
          {didSucceed ? <IconCheck size={11} /> : null}
          {didSucceed ? "Goal achieved" : "Held — no action"}
        </div>
      )}
    </>
  );
}

function MediaNode({ content }: { content: Record<string, unknown> }) {
  const imageUrl = typeof content.imageUrl === "string" ? content.imageUrl : undefined;
  return (
    <>
      <Header icon={<IconImage />} label="Generated art" tint="#7C5CFF" />
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="agent art" style={{ marginTop: 8, width: "100%", borderRadius: 8, border: `1px solid ${LINE}`, display: "block" }} />
      )}
      <div style={{ fontSize: 10, color: MID, marginTop: 6, letterSpacing: "0.04em" }}>via Venice</div>
    </>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────────

function Header({ icon, label, tint, active }: { icon: React.ReactNode; label: string; tint: string; active?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 22, height: 22, borderRadius: 7,
        background: `${tint}1A`, color: tint, flexShrink: 0,
      }}>
        {icon}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, color: TEXT2, letterSpacing: "0.02em" }}>{label}</span>
      {active && (
        <span className="ag-pulse" style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: tint }}>
          <style jsx>{`
            .ag-pulse { animation: agPulse 1.4s ease-in-out infinite; }
            @keyframes agPulse { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 ${tint}55; } 50% { opacity: .4; box-shadow: 0 0 0 4px ${tint}00; } }
          `}</style>
        </span>
      )}
    </div>
  );
}

function ProtocolBadge({ proto }: { proto: string }) {
  const p = PROTOCOL[proto];
  if (!p) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px 3px 4px", borderRadius: 999, background: `${p.color}1A`, border: `1px solid ${p.color}40` }}>
      <span style={{ width: 16, height: 16, borderRadius: "50%", background: p.color, color: "#fff", fontSize: 8.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{p.glyph}</span>
      <span style={{ fontSize: 11, color: TEXT, fontWeight: 600 }}>{p.label}</span>
    </span>
  );
}

function RiskPill({ level }: { level: string }) {
  const color = level === "HIGH" ? WARN : level === "MEDIUM" ? PEND : ACCENT;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, background: `${color}14`, border: `1px solid ${color}38`, fontSize: 10.5, color, fontWeight: 600, letterSpacing: "0.04em", width: "fit-content" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
      {level} RISK
    </span>
  );
}

// ── Inline icons (16px, stroke = currentColor) ──────────────────────────────────

function svg(children: React.ReactNode, size = 14) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function IconTarget()  { return svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.5" fill="currentColor" /></>); }
function IconMap()     { return svg(<><path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2z" /><path d="M9 4v14M15 6v14" /></>); }
function IconStep()    { return svg(<><path d="M5 12h14M13 6l6 6-6 6" /></>); }
function IconChart()   { return svg(<><path d="M4 19V5M4 19h16M8 16l3-4 3 2 4-6" /></>); }
function IconShield()  { return svg(<><path d="M12 3l7 3v5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z" /></>); }
function IconBolt()    { return svg(<><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" stroke="none" /></>); }
function IconSwap()    { return svg(<><path d="M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8" /></>); }
function IconSend({ size = 14 }: { size?: number }) { return svg(<><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></>, size); }
function IconWhale()   { return svg(<><path d="M3 12c4 4 14 4 18-1M3 12c0-3 3-5 6-4M21 7c0 3-1 4-1 4" /><circle cx="8" cy="9" r="0.5" fill="currentColor" /></>); }
function IconNews()    { return svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h6M7 13h10M7 17h7" /></>); }
function IconSpark()   { return svg(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" /></>); }
function IconQuote()   { return svg(<><path d="M7 8H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v-7zM17 8h-2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2V8z" /></>); }
function IconImage()   { return svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>); }
function IconCheck({ size = 14 }: { size?: number }) { return svg(<><path d="M20 6 9 17l-5-5" /></>, size); }

export default AgentThoughtNode;
