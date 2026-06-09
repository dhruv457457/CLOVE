"use client";

/**
 * A2A OVERSPEND PROOF — live demo page for "Best A2A coordination".
 *
 * Self-contained and isolated from the working relayer flow:
 *   1. Connect MetaMask (Base).
 *   2. Grant ERC-7715 to CLOVE's Fund Manager (user → session account).
 *      The grant is kept in component state — NOT persisted to user_permissions,
 *      so the existing relayer grant is untouched.
 *   3. Fund the Fund Manager address with a little USDC.
 *   4. "Try to overspend" → builds user→session→worker→relayer scoped chain with
 *      an ERC20TransferAmountEnforcer cap, asks the 1Shot relayer to move MORE
 *      than the cap, and shows the on-chain revert.
 */

import { useEffect, useState } from "react";
import { connectWallet, requestFundManagerPermission, type GrantedPermission } from "@/lib/web3/permissions";

const INK = "#0E0F0C";
const PAPER = "#F7F6F1";
const ACCENT = "#C8FF3D";

interface ProofResult {
  proof: string;
  reverted?: boolean;
  isCapRevert?: boolean;
  workerAddress?: string;
  capUsdc?: number;
  attemptUsdc?: number;
  allowedTargets?: string[];
  relayer?: { taskId?: string; status?: string; txHash?: string | null; error?: string | null };
  note?: string;
  error?: string;
  hint?: string;
}

export default function ProofPage() {
  const [userAddr, setUserAddr]       = useState<`0x${string}` | null>(null);
  const [fmAddr, setFmAddr]           = useState<string | null>(null);
  const [grant, setGrant]             = useState<GrantedPermission | null>(null);
  const [cap, setCap]                 = useState("0.05");
  const [attempt, setAttempt]         = useState("1.0");
  const [busy, setBusy]               = useState<string | null>(null);
  const [result, setResult]           = useState<ProofResult | null>(null);
  const [err, setErr]                 = useState<string | null>(null);

  // Fetch the Fund Manager (session) address.
  useEffect(() => {
    fetch("/api/session/address?role=fund-manager")
      .then(r => r.json())
      .then(d => { if (d.address) setFmAddr(d.address); })
      .catch(() => {});
  }, []);

  async function doConnect() {
    setErr(null);
    try {
      const a = await connectWallet();
      if (a) setUserAddr(a);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function doGrant() {
    if (!fmAddr) { setErr("Fund Manager address not loaded"); return; }
    setBusy("Requesting grant — approve in MetaMask…"); setErr(null);
    try {
      const g = await requestFundManagerPermission(fmAddr as `0x${string}`, "2", 30);
      setGrant(g);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  async function doProof() {
    if (!userAddr) { setErr("Connect first"); return; }
    if (!grant)    { setErr("Grant to the Fund Manager first"); return; }
    setBusy("Building chain + submitting over-cap redemption to the relayer…");
    setErr(null); setResult(null);
    try {
      const res = await fetch("/api/proof/overspend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: userAddr,
          rootContext:   grant.permissionsContext,
          capUsdc:       Number(cap),
          attemptUsdc:   Number(attempt),
          chainId:       8453,
        }),
      });
      setResult(await res.json());
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  const pass = result?.proof?.startsWith("PASS");

  return (
    <div style={{ minHeight: "100vh", background: PAPER, color: INK, padding: "48px 24px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.18em", color: "#6B6A60", marginBottom: 8 }}>
          A2A · On-chain enforced caps
        </div>
        <h1 style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.03em", margin: "0 0 12px" }}>
          Overspend proof
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: "#2B2D27", maxWidth: "60ch" }}>
          A worker agent gets a budget enforced by a real <code>ERC20TransferAmountEnforcer</code> caveat,
          not by app logic. Below, a worker capped at <b>{cap} USDC</b> tries to move <b>{attempt} USDC</b> through
          the 1Shot relayer. If the cap is real, the transaction reverts on-chain.
        </p>

        {/* Steps */}
        <div style={{ marginTop: 32, display: "grid", gap: 16 }}>
          {/* 1. Connect */}
          <Card n="1" title="Connect MetaMask (Base)">
            {userAddr
              ? <Mono>{userAddr}</Mono>
              : <Btn onClick={doConnect}>Connect</Btn>}
          </Card>

          {/* 2. Grant */}
          <Card n="2" title="Grant to the Fund Manager">
            <div style={{ fontSize: 13, color: "#6B6A60", marginBottom: 10 }}>
              Fund Manager address (the delegator). No funding needed — the cap
              enforcer rejects the over-cap transfer before any balance check:
            </div>
            <Mono>{fmAddr ?? "loading…"}</Mono>
            <div style={{ marginTop: 12 }}>
              {grant
                ? <Tag ok>✓ Granted · {grant.budgetUsdc} USDC / {grant.periodDays}d</Tag>
                : <Btn onClick={doGrant} disabled={!userAddr || !fmAddr}>Grant to Fund Manager</Btn>}
            </div>
          </Card>

          {/* 3. Run proof */}
          <Card n="3" title="Try to overspend">
            <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
              <Field label="Worker cap (USDC)" value={cap} onChange={setCap} />
              <Field label="Attempt (USDC)" value={attempt} onChange={setAttempt} />
            </div>
            <Btn onClick={doProof} disabled={!grant || !!busy} accent>
              {busy ? "Running…" : "Try to overspend →"}
            </Btn>
          </Card>
        </div>

        {busy && <p style={{ marginTop: 20, fontSize: 13, color: "#6B6A60" }}>{busy}</p>}
        {err  && <p style={{ marginTop: 20, fontSize: 13, color: "#C0392B" }}>⚠ {err}</p>}

        {/* Result */}
        {result && (
          <div style={{
            marginTop: 28, padding: 24, borderRadius: 16,
            background: pass ? "rgba(40,160,60,0.08)" : "rgba(192,57,43,0.06)",
            border: `1px solid ${pass ? "rgba(40,160,60,0.4)" : "rgba(192,57,43,0.3)"}`,
          }}>
            <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 10 }}>
              {pass ? "✅ " : result.proof === "ERROR" ? "🛑 " : "⚠️ "}{result.proof}
            </div>
            {result.note && <p style={{ fontSize: 14, lineHeight: 1.55, margin: "0 0 14px", color: "#2B2D27" }}>{result.note}</p>}
            {result.hint && <p style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 14px", color: "#6B6A60" }}>{result.hint}</p>}
            {result.relayer?.error && (
              <div style={{ marginBottom: 12 }}>
                <Label>Relayer revert</Label>
                <Mono>{result.relayer.error}</Mono>
              </div>
            )}
            {result.workerAddress && (
              <div style={{ marginBottom: 12 }}>
                <Label>Worker smart account</Label>
                <Mono>{result.workerAddress}</Mono>
              </div>
            )}
            {result.relayer?.txHash && (
              <div style={{ marginBottom: 12 }}>
                <Label>Tx</Label>
                <a href={`https://basescan.org/tx/${result.relayer.txHash}`} target="_blank" rel="noreferrer"
                   style={{ color: "#0052FF", fontSize: 13, wordBreak: "break-all" }}>
                  {result.relayer.txHash}
                </a>
              </div>
            )}
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 12, color: "#6B6A60", cursor: "pointer" }}>Raw response</summary>
              <pre style={{ fontSize: 11, overflow: "auto", marginTop: 8, padding: 12, background: INK, color: PAPER, borderRadius: 8 }}>
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tiny presentational helpers ─────────────────────────────────────────────────
function Card({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 20, borderRadius: 14, background: "rgba(14,15,12,0.03)", border: "1px solid rgba(14,15,12,0.1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ width: 24, height: 24, borderRadius: 999, background: INK, color: PAPER, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>{n}</span>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}
function Btn({ children, onClick, disabled, accent }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        padding: "10px 18px", borderRadius: 10, border: "none", cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 14, fontWeight: 600, opacity: disabled ? 0.4 : 1,
        background: accent ? ACCENT : INK, color: accent ? INK : PAPER,
      }}>
      {children}
    </button>
  );
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ fontSize: 12, color: "#6B6A60" }}>
      {label}
      <input value={value} onChange={e => onChange(e.target.value)}
        style={{ display: "block", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(14,15,12,0.2)", fontSize: 14, width: 140, background: PAPER, color: INK }} />
    </label>
  );
}
function Mono({ children }: { children: React.ReactNode }) {
  return <code style={{ fontSize: 12.5, wordBreak: "break-all", color: INK }}>{children}</code>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6B6A60", marginBottom: 3 }}>{children}</div>;
}
function Tag({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return <span style={{ fontSize: 13, fontWeight: 600, color: ok ? "#1f8b3a" : INK }}>{children}</span>;
}
