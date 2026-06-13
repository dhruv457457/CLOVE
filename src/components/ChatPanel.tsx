"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, ArrowUp, Plus, Clock, X } from "lucide-react";
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

/** Clarifying question from /api/agent/questions (rendered inline, not in a modal). */
interface Question {
  id:       string;
  label:    string;
  hint?:    string;
  type:     "single" | "multi" | "slider" | "text";
  options?: string[];
  min?: number; max?: number; step?: number; defaultVal?: number; unit?: string;
}

/** A create proposal attached to an assistant turn (Phase 2). */
interface Proposal {
  prompt:    string;                      // the user's original strategy prompt
  questions: Question[];                  // still-missing fields, asked inline
  answers:   Record<string, unknown>;     // prefilled + live answers (the build payload)
}

interface Msg {
  role:      "user" | "assistant";
  content:   string;
  proposal?: Proposal;                    // present → render an inline questionnaire card
  resolved?: boolean;                     // card acted on (built/dismissed)
}

/** A past-chat entry for the history list. */
interface ThreadSummary {
  threadId:  string;
  title:     string;
  updatedAt: string;
  count:     number;
}

/** A live run-activity line (polled from /api/agent/memory/runs). */
interface RunEvent {
  runId:    string;
  text:     string;
  ts:       number;
  success:  boolean;
  txHash?:  string | null;
}

interface RawRun {
  runId?: string; timestamp?: string; success?: boolean;
  protocol?: string; action?: string; amount?: string;
  txHash?: string | null; veniceReason?: string;
}

function runToEvent(r: RawRun): RunEvent | null {
  if (!r.runId) return null;
  const act = r.action || "ran";
  const amt = r.amount && Number(r.amount) > 0 ? ` $${r.amount}` : "";
  const to  = r.protocol && r.protocol !== "unknown" ? ` → ${r.protocol}` : "";
  return {
    runId:   r.runId,
    text:    `${act}${amt}${to}`,
    ts:      r.timestamp ? Date.parse(r.timestamp) : Date.now(),
    success: r.success !== false,
    txHash:  r.txHash ?? null,
  };
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
  onConfirmCreate,
  mode = "hero",
  newChatNonce = 0,
  onClose,
}: {
  /** Builds the agent team directly from answers — NO modal (asked inline instead). */
  onConfirmCreate: (prompt: string, answers: Record<string, unknown>) => void;
  /** "hero" = centered front door (no agents); "docked" = left rail beside canvas. */
  mode?: "hero" | "docked";
  /** Bumped by the parent's "New workflow" → resets to a fresh thread. */
  newChatNonce?: number;
  /** When provided (new-workflow overlay), shows a close affordance. */
  onClose?: () => void;
}) {
  const [, setTick] = useState(0);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedFor = useRef<string | null>(null);
  const docked = mode === "docked";

  // Re-render on wallet connect/disconnect.
  useEffect(() => {
    const u = metamaskStore.addListener(() => setTick(x => x + 1));
    return () => u();
  }, []);
  const wallet = metamaskStore.getState().userAddress;
  const activeKey = wallet ? `clove_chat_active_${wallet.toLowerCase()}` : null;

  const newId = () =>
    globalThis.crypto?.randomUUID?.() ?? `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const loadThread = useCallback(async (w: string, id: string) => {
    try {
      const r = await fetch(`/api/chat?wallet=${encodeURIComponent(w)}&threadId=${encodeURIComponent(id)}`);
      const d = r.ok ? await r.json() : null;
      setMessages(((d?.messages ?? []) as Msg[]).map(m => ({ role: m.role, content: m.content })));
    } catch { setMessages([]); }
  }, []);

  const loadThreadList = useCallback(async (w: string) => {
    try {
      const r = await fetch(`/api/chat?wallet=${encodeURIComponent(w)}&list=1`);
      const d = r.ok ? await r.json() : null;
      setThreads((d?.threads ?? []) as ThreadSummary[]);
    } catch { /* ignore */ }
  }, []);

  // On wallet connect: restore the active thread (or start a fresh one) + history.
  useEffect(() => {
    if (!wallet || !activeKey || loadedFor.current === wallet) return;
    loadedFor.current = wallet;
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(activeKey) : null;
    const id = saved ?? newId();
    if (!saved && typeof localStorage !== "undefined") localStorage.setItem(activeKey, id);
    setThreadId(id);
    if (saved) void loadThread(wallet, id); else setMessages([]);
    void loadThreadList(wallet);
  }, [wallet, activeKey, loadThread, loadThreadList]);

  // Start a brand-new chat thread (used by New-chat button + parent New-workflow).
  const startNewChat = useCallback(() => {
    const id = newId();
    setThreadId(id);
    setMessages([]);
    setInput("");
    setShowHistory(false);
    if (activeKey && typeof localStorage !== "undefined") localStorage.setItem(activeKey, id);
    if (wallet) void loadThreadList(wallet);
  }, [activeKey, wallet, loadThreadList]);

  // Open an existing thread from history.
  const openThread = useCallback((id: string) => {
    setThreadId(id);
    setShowHistory(false);
    if (activeKey && typeof localStorage !== "undefined") localStorage.setItem(activeKey, id);
    if (wallet) void loadThread(wallet, id);
  }, [activeKey, wallet, loadThread]);

  // Parent "New workflow" bumps newChatNonce → reset to a fresh chat.
  const prevNonce = useRef(newChatNonce);
  useEffect(() => {
    if (newChatNonce !== prevNonce.current) {
      prevNonce.current = newChatNonce;
      startNewChat();
    }
  }, [newChatNonce, startNewChat]);

  // Keep the thread pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, events]);

  // Live run-activity feed (docked only): poll recent runs and surface them in
  // the chat. Agents run server-side on a schedule, so this is how the hub shows
  // what they did without leaving the page.
  useEffect(() => {
    if (!docked || !wallet) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/agent/memory/runs?wallet=${encodeURIComponent(wallet)}&n=8`);
        if (!r.ok) return;
        const d = (await r.json()) as { runs?: RawRun[] };
        const next = (d.runs ?? [])
          .map(runToEvent)
          .filter((e): e is RunEvent => e !== null)
          .sort((a, b) => a.ts - b.ts);
        if (alive) setEvents(next.slice(-12));
      } catch { /* ignore transient */ }
    };
    void poll();
    const id = setInterval(poll, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [docked, wallet]);

  const send = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || sending) return;
    // Ensure a thread id exists so this conversation persists under its own key.
    let tid = threadId;
    if (!tid) {
      tid = newId();
      setThreadId(tid);
      if (activeKey && typeof localStorage !== "undefined") localStorage.setItem(activeKey, tid);
    }
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: msg }]);
    setSending(true);
    try {
      if (isCreateIntent(msg)) {
        // Create intent → questionnaire route (reliable JSON). We render any
        // still-missing questions INLINE in the chat card (no modal popup).
        const res = await fetch("/api/agent/questions", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ prompt: msg }),
        });
        const data = (await res.json()) as {
          summary?: string;
          prefilled?: Record<string, unknown>;
          questions?: Question[];
        };
        const questions = Array.isArray(data.questions) ? data.questions : [];
        // Seed answers with what Venice already extracted + slider defaults.
        const answers: Record<string, unknown> = { ...(data.prefilled ?? {}) };
        for (const q of questions) {
          if (q.type === "slider" && answers[q.id] === undefined) answers[q.id] = q.defaultVal ?? q.min ?? 10;
        }
        const summary = data.summary ?? "Here's what I'll set up.";
        const tail = questions.length > 0
          ? " A couple of details below, then hit Build."
          : " Looks complete — hit Build when you're ready.";
        setMessages(prev => [...prev, {
          role:     "assistant",
          content:  summary + tail,
          proposal: { prompt: msg, questions, answers },
        }]);
      } else {
        // Q&A → chat route (persisted under this thread).
        const res = await fetch("/api/chat", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ message: msg, walletAddress: wallet ?? "", threadId: tid }),
        });
        const data = (await res.json()) as { reply?: string; error?: string };
        setMessages(prev => [...prev, { role: "assistant", content: data.reply ?? data.error ?? "…" }]);
      }
      if (wallet) void loadThreadList(wallet);   // refresh history (title set on first turn)
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Network error — try again." }]);
    } finally {
      setSending(false);
    }
  }, [sending, wallet, threadId, activeKey, loadThreadList]);

  // Mark a proposal's card resolved (so it stops rendering controls).
  const resolveProposal = useCallback((idx: number) => {
    setMessages(prev => prev.map((m, i) => (i === idx ? { ...m, resolved: true } : m)));
  }, []);

  // Update one inline answer on a proposal card.
  const updateAnswer = useCallback((idx: number, id: string, value: unknown) => {
    setMessages(prev => prev.map((m, i) =>
      i === idx && m.proposal
        ? { ...m, proposal: { ...m.proposal, answers: { ...m.proposal.answers, [id]: value } } }
        : m,
    ));
  }, []);

  const confirmProposal = useCallback((idx: number, p: Proposal) => {
    resolveProposal(idx);
    setMessages(prev => [...prev, { role: "assistant", content: "Building it now — your canvas will appear in a moment." }]);
    onConfirmCreate(p.prompt, p.answers);   // direct build — no questionnaire modal
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
      {/* Header toolbar: title · New chat · History · (close/collapse) */}
      {(docked || onClose) && (
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 9px", borderBottom: `1px solid ${LINE}` }}>
          <Sparkles size={14} style={{ color: ACCENT }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{onClose ? "New workflow" : "CLOVE chat"}</span>
          <div style={{ flex: 1 }} />
          <HeaderBtn title="New chat" onClick={startNewChat}><Plus size={14} /></HeaderBtn>
          <HeaderBtn title="Past chats" onClick={() => setShowHistory(v => !v)}><Clock size={14} /></HeaderBtn>
          {onClose
            ? <HeaderBtn title="Close" onClick={onClose}><X size={14} /></HeaderBtn>
            : <button onClick={() => setCollapsed(true)} title="Collapse" aria-label="Collapse chat" style={{ background: "transparent", border: "none", color: MID, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}>‹</button>}
          {showHistory && (
            <HistoryDropdown threads={threads} activeId={threadId} onPick={openThread} onClose={() => setShowHistory(false)} />
          )}
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

      {/* Phase 4: first-run onboarding (dismissible) — only on a brand-new wallet */}
      {!docked && !onClose && empty && wallet && threads.length === 0 && (
        <OnboardingCard wallet={wallet} />
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
              className="clove-msg-in"
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

              {/* Phase 2: inline questionnaire + build (no modal) */}
              {m.proposal && (
                <ProposalCard
                  proposal={m.proposal}
                  resolved={!!m.resolved}
                  connected={!!wallet}
                  onAnswer={(id, value) => updateAnswer(i, id, value)}
                  onConfirm={() => confirmProposal(i, m.proposal!)}
                  onDismiss={() => resolveProposal(i)}
                />
              )}
            </div>
          ))}
          {sending && (
            <div className="clove-fade-in" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 13px", borderRadius: 12, background: INK_1, border: `1px solid ${LINE}`, color: MID, fontSize: 13.5 }}>
              <Sparkles size={13} style={{ color: ACCENT }} />
              <span>CLOVE is thinking</span>
              <span className="clove-typing" aria-hidden>
                <span className="d">·</span><span className="d">·</span><span className="d">·</span>
              </span>
            </div>
          )}

          {/* Live run-activity feed (docked) */}
          {docked && events.length > 0 && (
            <div style={{ marginTop: 6, paddingTop: 8, borderTop: `1px solid ${LINE}`, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 10, color: MID, letterSpacing: "0.1em", textTransform: "uppercase" }}>Agent activity</div>
              {events.map(ev => (
                <div key={ev.runId} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                  <span style={{ color: ev.success ? ACCENT : "#FF8A66", fontSize: 10 }}>●</span>
                  <span style={{ color: TEXT2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.text}</span>
                  {ev.txHash && (
                    <a
                      href={`https://basescan.org/tx/${ev.txHash}`} target="_blank" rel="noopener noreferrer"
                      style={{ color: MID, fontSize: 11, textDecoration: "none" }}
                      title="View on Basescan"
                    >
                      ↗
                    </a>
                  )}
                </div>
              ))}
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

      {/* Hero-only footer: start a fresh chat once the thread has content */}
      {!docked && !onClose && messages.length > 0 && (
        <button
          onClick={startNewChat}
          style={{
            pointerEvents: "auto", display: "inline-flex", alignItems: "center", gap: 7,
            padding: "6px 13px", borderRadius: 999, background: "transparent",
            border: `1px solid ${LINE_MID}`, color: TEXT2, fontSize: 12, cursor: "pointer",
          }}
        >
          <Plus size={13} strokeWidth={2.5} /> New chat
        </button>
      )}
    </div>
  );
}

/** Small icon button used in the chat header toolbar. */
function HeaderBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick} title={title} aria-label={title}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, borderRadius: 7, background: "transparent",
        border: `1px solid ${LINE_MID}`, color: TEXT2, cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** Dropdown listing the wallet's past chat threads. */
function HistoryDropdown({
  threads, activeId, onPick, onClose,
}: {
  threads: ThreadSummary[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9 }} />
      <div
        style={{
          position: "absolute", top: "100%", right: 4, zIndex: 10, marginTop: 4,
          width: 240, maxHeight: 280, overflowY: "auto",
          background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 10,
          padding: 6, boxShadow: "0 12px 32px -10px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ fontSize: 10, color: MID, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 8px" }}>Past chats</div>
        {threads.length === 0 ? (
          <div style={{ fontSize: 12, color: MID, padding: "8px" }}>No previous chats yet.</div>
        ) : (
          threads.map(t => (
            <button
              key={t.threadId}
              onClick={() => onPick(t.threadId)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "7px 8px", borderRadius: 7, border: "none", cursor: "pointer",
                background: t.threadId === activeId ? "rgba(200,255,61,0.1)" : "transparent",
                color: t.threadId === activeId ? ACCENT : TEXT2, fontSize: 12.5,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {t.title || "New chat"}
            </button>
          ))
        )}
      </div>
    </>
  );
}

/**
 * First-run onboarding (Phase 4): a compact, dismissible checklist shown to a
 * brand-new wallet (no agents, no chat history). Walks: wallet ✓ → link Telegram
 * → describe a strategy. Self-contained: handles its own dismiss + Telegram link.
 */
function OnboardingCard({ wallet }: { wallet: string }) {
  const key = `clove_onboarded_${wallet.toLowerCase()}`;
  const [dismissed, setDismissed] = useState(
    typeof localStorage !== "undefined" && localStorage.getItem(key) === "1",
  );
  const [tgLinked, setTgLinked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/telegram/status?wallet=${encodeURIComponent(wallet)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { linked?: boolean } | null) => { if (!cancelled) setTgLinked(!!d?.linked); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [wallet]);

  const linkTelegram = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/telegram/link-token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet }),
      });
      const d = await res.json() as { deepLink?: string | null; token?: string };
      if (d.deepLink) window.open(d.deepLink, "_blank", "noopener,noreferrer");
      else if (d.token) await navigator.clipboard?.writeText(`/start ${d.token}`);
    } catch { /* non-fatal */ } finally { setBusy(false); }
  };

  const dismiss = () => {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, "1");
    setDismissed(true);
  };

  if (dismissed) return null;

  const Step = ({ done, n, children }: { done: boolean; n: number; children: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: done ? TEXT2 : TEXT }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 18, height: 18, borderRadius: 999, flexShrink: 0,
        background: done ? ACCENT : "transparent", color: done ? INK : MID,
        border: `1px solid ${done ? ACCENT : LINE_MID}`, fontSize: 11, fontWeight: 700,
      }}>{done ? "✓" : n}</span>
      <span>{children}</span>
    </div>
  );

  return (
    <div
      className="clove-fade-in"
      style={{
        pointerEvents: "auto", width: "100%", maxWidth: 420,
        background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 12,
        padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Sparkles size={14} style={{ color: ACCENT }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Welcome to CLOVE</span>
        <div style={{ flex: 1 }} />
        <button onClick={dismiss} title="Dismiss" aria-label="Dismiss onboarding"
          style={{ background: "transparent", border: "none", color: MID, cursor: "pointer", padding: 2 }}>
          <X size={14} />
        </button>
      </div>

      <Step done n={1}>Wallet connected</Step>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Step done={tgLinked} n={2}>
          {tgLinked ? "Telegram linked — control CLOVE from chat" : "Link Telegram for 1:1 control + reports"}
        </Step>
        {!tgLinked && (
          <button onClick={linkTelegram} disabled={busy}
            style={{
              marginLeft: "auto", padding: "5px 11px", borderRadius: 7, border: `1px solid ${ACCENT_SOFT}`,
              background: "rgba(200,255,61,0.1)", color: ACCENT, fontSize: 11.5,
              cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap",
            }}>
            {busy ? "…" : "Link"}
          </button>
        )}
      </div>
      <Step done={false} n={3}>Describe a strategy below — I&apos;ll build the agents</Step>
    </div>
  );
}

/**
 * In-chat questionnaire card (Phase 2, Issue 1): renders the still-missing
 * questions INLINE — no modal. Already-extracted config shows as read-only
 * context; the rest are answered right here, then Build fires onConfirm.
 */
function ProposalCard({
  proposal, resolved, connected, onAnswer, onConfirm, onDismiss,
}: {
  proposal:  Proposal;
  resolved:  boolean;
  connected: boolean;
  onAnswer:  (id: string, value: unknown) => void;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const { questions, answers } = proposal;
  const askedIds = new Set(questions.map(q => q.id));
  // Known config = answers Venice prefilled that we are NOT asking about.
  const known = configLines(
    Object.fromEntries(Object.entries(answers).filter(([k]) => !askedIds.has(k))),
  );

  const chip = (active: boolean): React.CSSProperties => ({
    padding: "6px 11px", borderRadius: 999, fontSize: 12, cursor: "pointer",
    background: active ? "rgba(200,255,61,0.14)" : "transparent",
    border: `1px solid ${active ? ACCENT_SOFT : LINE_MID}`,
    color: active ? ACCENT : TEXT2,
  });

  return (
    <div
      style={{
        width: "100%", maxWidth: 440,
        background: "rgba(200,255,61,0.04)", border: `1px solid ${ACCENT_SOFT}`,
        borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: ACCENT, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        <Sparkles size={13} /> Proposed agent
      </div>

      {known.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {known.map(([k, v]) => (
            <span key={k} style={{ fontSize: 11.5, color: TEXT2, background: INK_1, border: `1px solid ${LINE}`, borderRadius: 7, padding: "3px 8px" }}>
              <span style={{ color: MID }}>{k}: </span>{v}
            </span>
          ))}
        </div>
      )}

      {/* Inline questions — only while unresolved */}
      {!resolved && questions.map(q => {
        const val = answers[q.id];
        return (
          <div key={q.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12.5, color: TEXT, fontWeight: 500 }}>{q.label}</div>
            {q.hint && <div style={{ fontSize: 11, color: MID, marginTop: -2 }}>{q.hint}</div>}

            {(q.type === "single" || q.type === "multi") && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(q.options ?? []).map(opt => {
                  const arr = Array.isArray(val) ? (val as string[]) : [];
                  const active = q.type === "multi" ? arr.includes(opt) : val === opt;
                  return (
                    <button
                      key={opt}
                      style={chip(active)}
                      onClick={() => {
                        if (q.type === "multi") {
                          onAnswer(q.id, active ? arr.filter(o => o !== opt) : [...arr, opt]);
                        } else {
                          onAnswer(q.id, opt);
                        }
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === "slider" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="range"
                  min={q.min ?? 1} max={q.max ?? 500} step={q.step ?? 1}
                  value={Number(val ?? q.defaultVal ?? q.min ?? 10)}
                  onChange={e => onAnswer(q.id, Number(e.target.value))}
                  style={{ flex: 1, accentColor: ACCENT }}
                />
                <span style={{ fontSize: 12.5, color: ACCENT, fontVariantNumeric: "tabular-nums", minWidth: 64, textAlign: "right" }}>
                  {String(val ?? q.defaultVal ?? q.min ?? 10)} {q.unit ?? ""}
                </span>
              </div>
            )}

            {q.type === "text" && (
              <input
                type="text"
                value={String(val ?? "")}
                onChange={e => onAnswer(q.id, e.target.value)}
                placeholder="Type your answer…"
                style={{
                  background: INK_1, border: `1px solid ${LINE_MID}`, borderRadius: 8,
                  padding: "7px 10px", color: TEXT, fontSize: 13, outline: "none",
                }}
              />
            )}
          </div>
        );
      })}

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
            {connected ? "Build agent →" : "Connect wallet to build"}
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
