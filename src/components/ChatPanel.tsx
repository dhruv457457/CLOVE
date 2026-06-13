"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, ArrowUp, Plus } from "lucide-react";
import { metamaskStore } from "@/lib/web3/metamaskStore";

// ── Theme tokens (mirror dashboard/page.tsx — there is no shared NODE_STYLES) ──
const INK       = "#0B0C09";
const INK_1     = "#111210";
const ACCENT    = "#C8FF3D";
const TEXT      = "#E8E5DA";
const TEXT2     = "#B5B2A5";
const MID       = "#6B6A60";
const LINE      = "rgba(244,241,234,0.06)";
const LINE_MID  = "rgba(244,241,234,0.11)";
const ACCENT_SOFT = "rgba(200,255,61,0.18)";
const ACCENT_GLOW = "rgba(200,255,61,0.35)";

/** A create proposal attached to an assistant turn (Phase 2). */
interface Proposal {
  prompt:   string;                      // the user's original strategy prompt
  config:   Record<string, unknown>;     // prefilled fields Venice extracted
  missing:  number;                       // # of still-unanswered questions
}

interface Msg {
  role:      "user" | "assistant";
  content:   string;
  proposal?: Proposal;                    // present → render a confirmation card
  resolved?: boolean;                     // card acted on (confirmed/dismissed)
}

/**
 * Cheap client-side create-intent heuristic. Create messages route to the
 * questionnaire (`/api/agent/questions`, reliable JSON) and produce a confirm
 * card; everything else is Q&A via `/api/chat`. A false positive just shows a
 * dismissible card, so we lean slightly permissive.
 */
function isCreateIntent(text: string): boolean {
  const s = text.trim().toLowerCase();
  if (/^(what|how|why|which|who|when|where|is |are |do |does |can you explain|explain|tell me|help)\b/.test(s)) return false;
  const verb   = /\b(make|create|build|set ?up|spin ?up|launch|start|deploy|run|i want|i'd like|i would like|give me|set me up)\b/.test(s);
  const noun   = /\b(agent|team|bot|strateg|yield|copy|rebalanc|trade|trader|farm|deposit|stake|workflow|invest)\b/.test(s);
  const budget = /\$\s?\d|\d+\s?usdc|every\s+\d|\bdaily\b|\bweekly\b|\bhourly\b/.test(s);
  return (verb && noun) || (noun && budget);
}

/** Human-readable config lines for the confirmation card. */
function configLines(cfg: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const str = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));
  if (cfg.agentType)     out.push(["Type",     str(cfg.agentType)]);
  if (cfg.orchestration) out.push(["Setup",    str(cfg.orchestration)]);
  if (cfg.budget != null) out.push(["Budget",  `$${str(cfg.budget)} USDC / period`]);
  if (cfg.schedule)      out.push(["Runs",     str(cfg.schedule)]);
  if (cfg.protocols)     out.push(["Protocols", str(cfg.protocols)]);
  if (cfg.risk)          out.push(["Risk",     str(cfg.risk)]);
  if (cfg.notify)        out.push(["Reports",  str(cfg.notify)]);
  return out;
}

/**
 * Minimal inline markdown → React: renders **bold** and `code` spans. The Venice
 * models reply in light markdown; this keeps `**` / backticks from showing raw
 * without pulling in a full markdown dep. Paragraph breaks come from white-space.
 */
function renderContent(text: string): React.ReactNode[] {
  // Split on **bold** and `code`, keeping the delimiters' captured groups.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i} style={{ color: TEXT, fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code key={i} style={{ fontFamily: "var(--mono, monospace)", fontSize: "0.92em", background: "rgba(244,241,234,0.07)", padding: "1px 5px", borderRadius: 4 }}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

const SUGGESTIONS = [
  "What is CLOVE?",
  "What can I do here?",
  "How do agents stay within my budget?",
];

/**
 * Phase 1 chat surface — replaces the empty "Create your first workflow" state.
 * Pure client component: it only talks to `/api/chat` (all Venice/Mongo/memory
 * work stays server-side). Conversational create lands in Phase 2; for now this
 * is Q&A about CLOVE. `onCreate` keeps the existing New-workflow flow reachable.
 */
export default function ChatPanel({
  onCreate,
  onConfirmCreate,
  mode = "hero",
}: {
  onCreate: () => void;
  /** Runs the existing create pipeline (questions → modal/build) for a prompt. */
  onConfirmCreate: (prompt: string) => void;
  /** "hero" = centered front door (no agents); "docked" = left rail beside canvas. */
  mode?: "hero" | "docked";
}) {
  const [, setTick] = useState(0);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const docked = mode === "docked";

  // Re-render on wallet connect/disconnect.
  useEffect(() => {
    const u = metamaskStore.addListener(() => setTick(x => x + 1));
    return () => u();
  }, []);
  const wallet = metamaskStore.getState().userAddress;

  // Rehydrate the wallet's thread once per connected wallet.
  useEffect(() => {
    if (!wallet || loadedFor === wallet) return;
    let cancelled = false;
    fetch(`/api/chat?wallet=${encodeURIComponent(wallet)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { messages?: Msg[] } | null) => {
        if (cancelled) return;
        setMessages((d?.messages ?? []).map(m => ({ role: m.role, content: m.content })));
        setLoadedFor(wallet);
      })
      .catch(() => setLoadedFor(wallet));
    return () => { cancelled = true; };
  }, [wallet, loadedFor]);

  // Keep the thread pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || sending) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msg }]);
    setSending(true);
    try {
      if (isCreateIntent(msg)) {
        // Create intent → questionnaire route (reliable JSON) → confirmation card.
        const res = await fetch("/api/agent/questions", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ prompt: msg }),
        });
        const data = (await res.json()) as {
          summary?: string;
          prefilled?: Record<string, unknown>;
          questions?: unknown[];
        };
        setMessages(prev => [...prev, {
          role:    "assistant",
          content: data.summary ?? "Here's what I'll set up — confirm to build it.",
          proposal: {
            prompt:  msg,
            config:  data.prefilled ?? {},
            missing: Array.isArray(data.questions) ? data.questions.length : 0,
          },
        }]);
      } else {
        // Q&A → chat route.
        const res = await fetch("/api/chat", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ message: msg, walletAddress: wallet ?? "" }),
        });
        const data = (await res.json()) as { reply?: string; error?: string };
        setMessages(prev => [...prev, { role: "assistant", content: data.reply ?? data.error ?? "…" }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Network error — try again." }]);
    } finally {
      setSending(false);
    }
  }, [sending, wallet]);

  // Mark a proposal's card resolved (so it stops rendering buttons).
  const resolveProposal = useCallback((idx: number) => {
    setMessages(prev => prev.map((m, i) => (i === idx ? { ...m, resolved: true } : m)));
  }, []);

  const confirmProposal = useCallback((idx: number, prompt: string) => {
    resolveProposal(idx);
    setMessages(prev => [...prev, { role: "assistant", content: "Building it now — your canvas will appear in a moment." }]);
    onConfirmCreate(prompt);
  }, [resolveProposal, onConfirmCreate]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const empty = messages.length === 0;

  // Docked + collapsed → just a slim reopen tab so the canvas is unobstructed.
  if (docked && collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="Open CLOVE chat"
        style={{
          position: "absolute", top: 14, left: 0, zIndex: 6, pointerEvents: "auto",
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 12px", borderTopRightRadius: 10, borderBottomRightRadius: 10,
          background: INK_1, border: `1px solid ${LINE_MID}`, borderLeft: "none",
          color: ACCENT, fontSize: 12, cursor: "pointer",
        }}
      >
        <Sparkles size={13} /> Chat
      </button>
    );
  }

  return (
    <div
      style={
        docked
          ? {
              position: "absolute", top: 0, left: 0, bottom: 0, width: 360, zIndex: 5,
              display: "flex", flexDirection: "column", gap: 12, pointerEvents: "auto",
              background: INK, borderRight: `1px solid ${LINE_MID}`,
              padding: "14px 12px", boxShadow: "2px 0 24px -8px rgba(0,0,0,0.5)",
            }
          : {
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: empty ? "center" : "flex-end",
              padding: "24px 16px 28px", gap: 18, pointerEvents: "none",
            }
      }
    >
      {/* Docked header with collapse */}
      {docked && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 9px", borderBottom: `1px solid ${LINE}` }}>
          <Sparkles size={14} style={{ color: ACCENT }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>CLOVE chat</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse" aria-label="Collapse chat"
            style={{ background: "transparent", border: "none", color: MID, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}
          >
            ‹
          </button>
        </div>
      )}

      {/* Hero headline — non-docked, empty only */}
      {!docked && empty && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, maxWidth: "46ch", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: MID, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            <Sparkles size={14} style={{ color: ACCENT }} /> {wallet ? "Ask CLOVE anything" : "Wallet not connected"}
          </div>
          <div style={{ fontSize: 30, color: TEXT, fontFamily: "var(--serif)", fontStyle: "italic", letterSpacing: "-0.02em" }}>
            {wallet ? "What should we build today?" : "Connect a wallet to begin."}
          </div>
          <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.5 }}>
            {wallet
              ? "Ask what CLOVE is or what you can do — then describe a strategy and I'll help you assemble a team of autonomous agents."
              : "Click Connect in the top bar to grant CLOVE read access. You can still chat with me about what CLOVE does."}
          </div>
        </div>
      )}

      {/* Thread */}
      {(!empty || docked) && (
        <div
          ref={scrollRef}
          style={{
            pointerEvents: "auto", width: "100%", maxWidth: docked ? "100%" : 720, flex: 1,
            overflowY: "auto", display: "flex", flexDirection: "column", gap: 12,
            padding: "8px 4px",
          }}
        >
          {docked && empty && (
            <div style={{ fontSize: 12.5, color: MID, lineHeight: 1.5, padding: "4px 2px" }}>
              Ask me anything, or describe a new strategy to add another agent to your workspace.
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex", flexDirection: "column",
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                alignItems: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: m.proposal ? "92%" : "82%", gap: 8,
              }}
            >
              <div
                style={{
                  padding: "10px 13px", borderRadius: 12,
                  background: m.role === "user" ? "rgba(200,255,61,0.1)" : INK_1,
                  border: `1px solid ${m.role === "user" ? "rgba(200,255,61,0.22)" : LINE}`,
                  color: m.role === "user" ? TEXT : TEXT2,
                  fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap",
                }}
              >
                {m.role === "assistant" ? renderContent(m.content) : m.content}
              </div>

              {/* Phase 2: confirmation card */}
              {m.proposal && (
                <ProposalCard
                  proposal={m.proposal}
                  resolved={!!m.resolved}
                  connected={!!wallet}
                  onConfirm={() => confirmProposal(i, m.proposal!.prompt)}
                  onDismiss={() => resolveProposal(i)}
                />
              )}
            </div>
          ))}
          {sending && (
            <div style={{ alignSelf: "flex-start", padding: "10px 13px", borderRadius: 12, background: INK_1, border: `1px solid ${LINE}`, color: MID, fontSize: 13.5 }}>
              <span className="clove-typing">CLOVE is thinking…</span>
            </div>
          )}
        </div>
      )}

      {/* Suggestion chips (hero empty state only) */}
      {!docked && empty && (
        <div style={{ pointerEvents: "auto", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 560 }}>
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => void send(s)}
              style={{
                padding: "7px 12px", borderRadius: 999, background: "transparent",
                border: `1px solid ${LINE_MID}`, color: TEXT2, fontSize: 12, cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Prompt bar */}
      <div
        style={{
          pointerEvents: "auto", width: "100%", maxWidth: docked ? "100%" : 720,
          display: "flex", alignItems: "flex-end", gap: 8,
          background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 14,
          padding: "8px 8px 8px 14px",
        }}
      >
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={wallet ? "Ask about CLOVE, or describe a strategy…" : "Ask what CLOVE can do…"}
          style={{
            flex: 1, resize: "none", background: "transparent", border: "none", outline: "none",
            color: TEXT, fontSize: 14, lineHeight: 1.5, fontFamily: "inherit",
            maxHeight: 120, padding: "6px 0",
          }}
        />
        <button
          onClick={() => void send(input)}
          disabled={!input.trim() || sending}
          aria-label="Send"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 34, borderRadius: 9, border: "none",
            background: input.trim() && !sending ? ACCENT : LINE_MID,
            color: input.trim() && !sending ? INK : MID,
            cursor: input.trim() && !sending ? "pointer" : "not-allowed",
            boxShadow: input.trim() && !sending ? `0 4px 14px -6px ${ACCENT_GLOW}` : "none",
            transition: "background .15s",
          }}
        >
          <ArrowUp size={16} strokeWidth={2.5} />
        </button>
      </div>

      {/* Keep the explicit create path reachable */}
      {wallet && (
        <button
          onClick={onCreate}
          style={{
            pointerEvents: "auto", display: "inline-flex", alignItems: "center", gap: 7,
            padding: "6px 13px", borderRadius: 999, background: "transparent",
            border: `1px solid ${LINE_MID}`, color: TEXT2, fontSize: 12, cursor: "pointer",
          }}
        >
          <Plus size={13} strokeWidth={2.5} /> New workflow
        </button>
      )}
    </div>
  );
}

/** In-chat confirmation card: shows the proposed agent config + Confirm / Not now. */
function ProposalCard({
  proposal, resolved, connected, onConfirm, onDismiss,
}: {
  proposal:  Proposal;
  resolved:  boolean;
  connected: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const lines = configLines(proposal.config);
  return (
    <div
      style={{
        width: "100%", maxWidth: 420,
        background: "rgba(200,255,61,0.04)", border: `1px solid ${ACCENT_SOFT}`,
        borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: ACCENT, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        <Sparkles size={13} /> Proposed agent
      </div>

      {lines.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {lines.map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 8, fontSize: 12.5 }}>
              <span style={{ color: MID, minWidth: 64 }}>{k}</span>
              <span style={{ color: TEXT }}>{v}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: TEXT2 }}>I&apos;ll confirm the details with you before building.</div>
      )}

      {proposal.missing > 0 && (
        <div style={{ fontSize: 11.5, color: MID }}>
          {`+${proposal.missing} detail${proposal.missing !== 1 ? "s" : ""} I'll ask when you build.`}
        </div>
      )}

      {!resolved ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={onConfirm}
            disabled={!connected}
            title={connected ? undefined : "Connect your wallet first"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8, border: "none",
              background: connected ? ACCENT : LINE_MID, color: connected ? INK : MID,
              fontSize: 12.5, fontWeight: 600, cursor: connected ? "pointer" : "not-allowed",
            }}
          >
            {connected ? "Confirm & build →" : "Connect wallet to build"}
          </button>
          <button
            onClick={onDismiss}
            style={{
              padding: "7px 12px", borderRadius: 8, background: "transparent",
              border: `1px solid ${LINE_MID}`, color: TEXT2, fontSize: 12.5, cursor: "pointer",
            }}
          >
            Not now
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: MID }}>✓ Handled</div>
      )}
    </div>
  );
}
