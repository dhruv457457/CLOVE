"use client";

import React from "react";
import { Handle, Position } from "@xyflow/react";

const ACCENT  = "#C8FF3D";
const INK     = "#0B0C09";
const INK_1   = "#111210";
const TEXT    = "#E8E5DA";
const TEXT2   = "#B5B2A5";
const MID     = "#6B6A60";
const MID_2   = "#908E81";
const LINE    = "rgba(244,241,234,0.11)";

export type ThoughtType = "goal" | "plan" | "tool-call" | "tool-result" | "reflect" | "media";

interface ThoughtNodeData {
  type:     ThoughtType;
  content:  Record<string, unknown>;
  fresh?:   boolean; // for fade-in animation
}

/**
 * Generic agent thought node — renders by type. The agent's inner canvas uses
 * a single React Flow node-type (`agent-thought`) and switches on `data.type`.
 */
export function AgentThoughtNode({ data, selected }: { data: ThoughtNodeData; selected?: boolean }) {
  const { type, content } = data;

  const borderColor = selected ? ACCENT : LINE;
  const baseStyle: React.CSSProperties = {
    background:   INK_1,
    border:       `1px solid ${borderColor}`,
    borderRadius: 10,
    padding:      "12px 14px",
    color:        TEXT,
    minWidth:     180,
    maxWidth:     280,
    fontFamily:   "var(--sans)",
    boxShadow:    selected ? `0 0 0 1px ${ACCENT}, 0 12px 28px -16px rgba(200,255,61,0.35)` : "none",
    transition:   "border-color .15s, box-shadow .15s",
  };

  return (
    <div style={baseStyle} className={data.fresh ? "agent-thought-in" : ""}>
      <Handle type="target" position={Position.Top}    style={{ background: borderColor, width: 6, height: 6, top: -3, border: "1px solid #0B0C09" }} />
      {renderByType(type, content)}
      <Handle type="source" position={Position.Bottom} style={{ background: borderColor, width: 6, height: 6, bottom: -3, border: "1px solid #0B0C09" }} />

      <style jsx>{`
        :global(.agent-thought-in) {
          animation: agent-thought-in 0.4s cubic-bezier(.2,.8,.2,1);
        }
        @keyframes agent-thought-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
      `}</style>
    </div>
  );
}

function renderByType(type: ThoughtType, content: Record<string, unknown>) {
  switch (type) {
    case "goal":          return <GoalNode  content={content} />;
    case "plan":          return <PlanNode  content={content} />;
    case "tool-call":     return <ToolCallNode    content={content} />;
    case "tool-result":   return <ToolResultNode  content={content} />;
    case "reflect":       return <ReflectNode     content={content} />;
    case "media":         return <MediaNode       content={content} />;
    default:              return <pre style={{ fontSize: 11, color: TEXT2 }}>{JSON.stringify(content)}</pre>;
  }
}

// ── Node variants ─────────────────────────────────────────────────────────────

function GoalNode({ content }: { content: Record<string, unknown> }) {
  return (
    <>
      <KindRow label="goal" />
      <div
        style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17, lineHeight: 1.3, color: TEXT, marginTop: 4, letterSpacing: "-0.01em" }}
      >
        &ldquo;{String(content.text ?? "(no goal)")}&rdquo;
      </div>
    </>
  );
}

function PlanNode({ content }: { content: Record<string, unknown> }) {
  // Two variants — a top-level plan summary OR a single subgoal active card
  const subgoals  = content.subgoals as Array<{ id: string; description: string; tools: string[] }> | undefined;
  const isSubgoal = typeof content.description === "string";
  const observation = content.observation as string | undefined;

  if (observation) {
    // addThought emission
    return (
      <>
        <KindRow label="observation" />
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: TEXT2, marginTop: 4 }}>
          {observation}
        </div>
      </>
    );
  }

  if (isSubgoal) {
    return (
      <>
        <KindRow label="subgoal" active />
        <div style={{ fontSize: 13.5, fontWeight: 500, color: TEXT, marginTop: 4, letterSpacing: "-0.01em", lineHeight: 1.3 }}>
          {String(content.description)}
        </div>
        {Array.isArray(content.tools) && content.tools.length > 0 && (
          <div style={{ fontSize: 10.5, color: MID, marginTop: 6, letterSpacing: "0.04em", textTransform: "lowercase" }}>
            uses: {(content.tools as string[]).join(", ")}
          </div>
        )}
      </>
    );
  }

  // Full plan summary
  return (
    <>
      <KindRow label="plan" />
      <div style={{ fontSize: 13, color: TEXT, marginTop: 4, lineHeight: 1.35 }}>
        {String(content.reasoning ?? "Plan generated.")}
      </div>
      {subgoals && subgoals.length > 0 && (
        <ol style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11.5, color: TEXT2, lineHeight: 1.45 }}>
          {subgoals.slice(0, 5).map((sg) => (
            <li key={sg.id} style={{ marginBottom: 2 }}>{sg.description}</li>
          ))}
        </ol>
      )}
    </>
  );
}

function ToolCallNode({ content }: { content: Record<string, unknown> }) {
  const tool = String(content.tool ?? "?");
  const args = (content.args ?? {}) as Record<string, unknown>;
  const arg1 = Object.entries(args).find(([k]) => k !== "reasoning")?.[1];

  return (
    <>
      <KindRow label="tool · running" active />
      <div style={{ fontSize: 13.5, fontWeight: 500, color: ACCENT, marginTop: 4, fontFamily: "var(--mono, ui-monospace)" }}>
        {tool}()
      </div>
      {arg1 !== undefined && (
        <div style={{ fontSize: 11, color: MID_2, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
          {String(arg1).slice(0, 60)}
        </div>
      )}
    </>
  );
}

function ToolResultNode({ content }: { content: Record<string, unknown> }) {
  const tool   = String(content.tool ?? "?");
  const txHash = typeof content.txHash === "string" ? content.txHash : undefined;
  const cost   = typeof content.cost   === "number" ? content.cost   : undefined;
  const bestApy = typeof content.bestApy === "number" ? content.bestApy : undefined;
  const riskLevel = typeof content.riskLevel === "string" ? content.riskLevel : undefined;
  const sent = typeof content.sent === "boolean" ? content.sent : undefined;

  return (
    <>
      <KindRow label="tool · result" />
      <div style={{ fontSize: 12, color: TEXT, marginTop: 4, lineHeight: 1.45 }}>
        {bestApy !== undefined && <>Best APY: <strong style={{ color: ACCENT }}>{bestApy.toFixed(2)}%</strong> · </>}
        {riskLevel && <>Risk: <strong style={{ color: riskLevel === "HIGH" ? "#FF8A66" : ACCENT }}>{riskLevel}</strong></>}
        {txHash && (
          <a
            href={`https://basescan.org/tx/${txHash}`}
            target="_blank" rel="noopener noreferrer"
            style={{ color: ACCENT, textDecoration: "underline", fontFamily: "var(--mono, ui-monospace)", fontSize: 11 }}
          >
            tx {txHash.slice(0, 10)}…
          </a>
        )}
        {sent !== undefined && <>Sent: {sent ? "✓" : "✗"}</>}
        {!bestApy && !riskLevel && !txHash && sent === undefined && <span style={{ color: MID }}>{tool} ✓</span>}
      </div>
      {cost !== undefined && cost > 0 && (
        <div style={{ fontSize: 10, color: MID, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
          x402 cost: {cost.toFixed(3)} USDC
        </div>
      )}
    </>
  );
}

function ReflectNode({ content }: { content: Record<string, unknown> }) {
  const insight = String(content.insight ?? "");
  const tags    = Array.isArray(content.tags) ? content.tags as string[] : [];
  return (
    <>
      <KindRow label="reflection" />
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 14,
          lineHeight: 1.35,
          color: TEXT,
          marginTop: 4,
          letterSpacing: "-0.01em",
          borderLeft: `2px solid ${ACCENT}`,
          paddingLeft: 8,
        }}
      >
        {insight}
      </div>
      {tags.length > 0 && (
        <div style={{ fontSize: 9.5, color: MID, marginTop: 8, letterSpacing: "0.08em", textTransform: "lowercase" }}>
          {tags.map(t => `#${t}`).join(" ")}
        </div>
      )}
    </>
  );
}

function MediaNode({ content }: { content: Record<string, unknown> }) {
  const voiceUrl = typeof content.voiceUrl === "string" ? content.voiceUrl : undefined;
  const imageUrl = typeof content.imageUrl === "string" ? content.imageUrl : undefined;
  return (
    <>
      <KindRow label="media · x402" />
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="performance art"
          style={{ marginTop: 6, width: "100%", borderRadius: 6, border: `1px solid ${LINE}` }}
        />
      )}
      {voiceUrl && (
        <div style={{ marginTop: 6, fontSize: 11, color: MID_2 }}>
          🔊 Voice note generated
        </div>
      )}
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function KindRow({ label, active }: { label: string; active?: boolean }) {
  return (
    <div
      style={{
        display:        "flex",
        alignItems:     "center",
        gap:            6,
        fontSize:       10,
        color:          active ? TEXT2 : MID,
        letterSpacing:  "0.06em",
        textTransform:  "lowercase",
      }}
    >
      <span
        style={{
          width:      4, height: 4, borderRadius: "50%",
          background: active ? ACCENT : MID,
          boxShadow:  active ? "0 0 0 3px rgba(200,255,61,0.18)" : "none",
        }}
      />
      {label}
    </div>
  );
}

export default AgentThoughtNode;
