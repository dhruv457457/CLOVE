"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowRight, ArrowUpRight, Zap, Shield, Activity, RefreshCw, ChevronRight } from "lucide-react";

const Dither = dynamic(() => import("../components/Dither"), { ssr: false });

// #10B981 emerald → RGB normalized
const DITHER_COLOR: [number, number, number] = [0.067, 0.725, 0.506];

const PROTOCOLS = [
  { name: "Aave",      dot: "#b6509e" },
  { name: "Uniswap",   dot: "#FF007A" },
  { name: "Compound",  dot: "#00d395" },
  { name: "Chainlink", dot: "#375BD2" },
  { name: "Curve",     dot: "#ff7f00" },
  { name: "1inch",     dot: "#c3461b" },
  { name: "Balancer",  dot: "#6a7bff" },
  { name: "GMX",       dot: "#03d1cf" },
  { name: "Lido",      dot: "#00a3ff" },
  { name: "Spark",     dot: "#f8a12e" },
  { name: "Sky",       dot: "#a899f5" },
  { name: "Maker",     dot: "#4daa98" },
];

const PROMPT_EXAMPLE =
  "Continuously optimize my idle capital across Base. Scout yield opportunities, rebalance automatically, and notify me before every high-risk action.";

const STATS = [
  { value: "$4.2B", label: "Value Protected" },
  { value: "99.97%", label: "Uptime" },
  { value: "2.3M+", label: "Executions" },
  { value: "<200ms", label: "Median Latency" },
];

const FEATURES = [
  {
    icon: "⚡",
    title: "x402 Machine Payments",
    desc: "Agents pay for intelligence APIs at inference time. Per-call USDC micropayments. No subscriptions. No API keys.",
  },
  {
    icon: "🔐",
    title: "ERC-7715 Periodic Budgets",
    desc: "Grant one recurring permission. Your agent operates within cryptographic spending limits. Fully non-custodial.",
  },
  {
    icon: "🔄",
    title: "Gasless Execution",
    desc: "EIP-7710 delegated relayer handles gas. Your agent swaps, rebalances, and compounds without ETH in reserve.",
  },
  {
    icon: "🧠",
    title: "AI Strategy Engine",
    desc: "Natural language → deployed workflow. Describe your strategy in plain English. CLOVE compiles it to an autonomous agent.",
  },
];

export default function Home() {
  const router = useRouter();
  const [promptText, setPromptText] = useState(PROMPT_EXAMPLE);
  const [isCompiling, setIsCompiling] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const t = setInterval(() => setCursorVisible(v => !v), 530);
    return () => clearInterval(t);
  }, []);

  const handleCompile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptText.trim()) return;
    setIsCompiling(true);
    setTimeout(() => {
      localStorage.setItem("clove_imported_prompt", promptText);
      router.push("/dashboard");
    }, 1400);
  };

  return (
    <div className="bg-black min-h-screen text-white overflow-x-hidden" style={{ fontFamily: "var(--font-inter), sans-serif" }}>

      {/* ══ NAVBAR ══ */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-black/80 backdrop-blur-xl">
        <nav className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#10B981] flex items-center justify-center shadow-[0_0_12px_rgba(16,185,129,0.5)]">
              <Zap size={13} className="text-black" fill="black" />
            </div>
            <span className="font-bold text-sm tracking-wide text-white" style={{ fontFamily: "Satoshi, sans-serif" }}>CLOVE</span>
            <span className="text-[9px] font-semibold border border-[#10B981]/30 text-[#10B981] px-1.5 py-0.5 rounded-full bg-[#10B981]/8 uppercase tracking-wider">
              beta
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-[0.78rem] font-medium text-white/50">
            <a href="#" className="hover:text-white transition-colors">Product</a>
            <a href="/marketplace" className="hover:text-white transition-colors">Marketplace</a>
            <a href="#" className="hover:text-white transition-colors">Pricing</a>
            <a href="#" className="hover:text-white transition-colors">Docs</a>
          </div>

          <a
            href="/dashboard"
            className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full bg-[#F59E0B] text-black hover:bg-[#FBBF24] transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_28px_rgba(245,158,11,0.45)]"
          >
            Launch App <ArrowRight size={12} />
          </a>
        </nav>
      </header>

      {/* ══ HERO ══ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center text-center pt-14 overflow-hidden">

        {/* Dither background — window-level mouse listener, no pointer-events tricks needed */}
        {mounted && (
          <div className="absolute inset-0 z-0" style={{ pointerEvents: "none" }}>
            <Dither
              waveColor={DITHER_COLOR}
              waveAmplitude={0.4}
              waveFrequency={3}
              waveSpeed={0.5}
              colorNum={4}
              pixelSize={2}
              disableAnimation={false}
              enableMouseInteraction={true}
              mouseRadius={0.35}
            />
          </div>
        )}

        {/* Black overlay for text readability */}
        <div
          className="absolute inset-0 z-[1]"
          style={{
            background: "linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.48) 40%, rgba(0,0,0,0.82) 100%)",
            pointerEvents: "none",
          }}
        />

        {/* Hero content */}
        <div className="relative z-10 flex flex-col items-center gap-8 max-w-4xl mx-auto px-6">

          {/* Badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#10B981]/25 bg-[#10B981]/8 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] shadow-[0_0_6px_#10B981]" />
            <span className="text-[11px] font-medium text-[#10B981]">ERC-7715 · x402 · EIP-7710 · Non-custodial</span>
          </div>

          {/* Main headline */}
          <h1
            className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.0] text-white"
            style={{
              fontFamily: "Satoshi, sans-serif",
              textShadow: "0 2px 40px rgba(0,0,0,0.8)",
            }}
          >
            Autonomous
            <br />
            <span
              style={{
                background: "linear-gradient(90deg, #10B981 0%, #34D399 50%, #6EE7B7 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                filter: "drop-shadow(0 0 32px rgba(16,185,129,0.4))",
              }}
            >
              Capital Execution
            </span>
          </h1>

          {/* Sub */}
          <p className="text-lg leading-8 text-white/60 max-w-2xl" style={{ fontFamily: "var(--font-inter), sans-serif" }}>
            AI agents that research markets, pay for intelligence, and execute
            onchain strategies autonomously.{" "}
            <span className="text-white/85">One permission. No custody.</span>
          </p>

          {/* CTA row */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-2 text-sm font-bold px-7 py-3 rounded-full bg-[#F59E0B] text-black hover:bg-[#FBBF24] transition-all shadow-[0_0_24px_rgba(245,158,11,0.35)] hover:shadow-[0_0_36px_rgba(245,158,11,0.5)] active:scale-[0.97]"
            >
              Launch App <ArrowRight size={14} />
            </button>
            <button
              className="flex items-center gap-2 text-sm font-semibold px-7 py-3 rounded-full border border-white/15 bg-white/5 backdrop-blur-sm text-white hover:bg-white/10 hover:border-white/25 transition-all"
            >
              Read Docs <ArrowUpRight size={14} />
            </button>
          </div>

          {/* Prompt terminal */}
          <div
            className="w-full max-w-2xl rounded-2xl overflow-hidden"
            style={{
              background: "rgba(0,0,0,0.7)",
              border: "1px solid rgba(16,185,129,0.2)",
              backdropFilter: "blur(24px)",
              boxShadow: "0 0 60px rgba(16,185,129,0.07), inset 0 1px 0 rgba(16,185,129,0.1)",
            }}
          >
            {/* Terminal bar */}
            <div
              className="flex items-center gap-2 px-4 py-3 border-b"
              style={{ borderColor: "rgba(16,185,129,0.12)", background: "rgba(16,185,129,0.04)" }}
            >
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
              <span className="text-[10px] text-white/25 mx-auto" style={{ fontFamily: "var(--font-mono)" }}>clove agent · base mainnet</span>
            </div>
            <form onSubmit={handleCompile} className="p-5 space-y-4">
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-widest text-[#10B981]/60 block mb-2" style={{ fontFamily: "var(--font-mono)" }}>
                  &gt; Describe your autonomous strategy
                </label>
                <div className="relative">
                  <textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    rows={3}
                    className="w-full bg-transparent text-[13px] text-[#6EE7B7] placeholder-white/20 focus:outline-none resize-none leading-6"
                    style={{ fontFamily: "var(--font-mono)" }}
                    placeholder="e.g. Every hour, scout the best USDC yield on Base and auto-compound..."
                  />
                  {/* blinking cursor at end */}
                  <span
                    className="inline-block w-[7px] h-[14px] bg-[#10B981] align-middle ml-0.5"
                    style={{ opacity: cursorVisible ? 1 : 0, transition: "opacity 0.1s" }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  {["Aave Compounder", "ETH Dip Buyer", "Peg Arb"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        const map: Record<string, string> = {
                          "Aave Compounder": "Hourly, budget 25 USDC/day. Check Aave rewards, claim if >$10, re-supply. Notify Telegram on each run.",
                          "ETH Dip Buyer": "Watch ETH. If price drops below $3200, use up to 75 USDC to buy. Notify before execution.",
                          "Peg Arb": "Every hour, scan for stablecoin peg deviations >0.3%. Execute arb with up to 50 USDC. Log all trades.",
                        };
                        setPromptText(map[t]);
                      }}
                      className="text-[9px] font-semibold px-2.5 py-1 rounded-lg border border-white/8 text-white/40 hover:text-[#10B981] hover:border-[#10B981]/30 transition-all"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={isCompiling}
                  className="flex items-center gap-2 text-xs font-bold px-5 py-2 rounded-lg text-black transition-all disabled:opacity-60 active:scale-[0.97]"
                  style={{
                    background: isCompiling ? "rgba(16,185,129,0.5)" : "#10B981",
                    fontFamily: "var(--font-mono)",
                    boxShadow: "0 0 20px rgba(16,185,129,0.3)",
                  }}
                >
                  {isCompiling
                    ? <><RefreshCw size={11} className="animate-spin" /> Compiling...</>
                    : <>Deploy Agent <ArrowRight size={11} /></>
                  }
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Stats strip at bottom of hero */}
        <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-white/[0.06] bg-black/60 backdrop-blur-md">
          <div className="max-w-4xl mx-auto px-6 py-4 grid grid-cols-4 gap-4">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-lg font-black text-white" style={{ fontFamily: "Satoshi, sans-serif" }}>{s.value}</p>
                <p className="text-[10px] text-white/35 mt-0.5" style={{ fontFamily: "var(--font-mono)" }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ PROTOCOL STRIP ══ */}
      <section className="py-14 border-b border-white/[0.06] bg-black">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-white/20 mb-8" style={{ fontFamily: "var(--font-mono)" }}>
            Live across 12+ DeFi protocols
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {PROTOCOLS.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] hover:border-[#10B981]/30 hover:bg-[#10B981]/5 transition-all cursor-default"
              >
                <div className="w-3 h-3 rounded-full" style={{ background: p.dot }} />
                <span className="text-[11px] font-medium text-white/55 hover:text-white/80 transition-colors">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ HOW IT WORKS ══ */}
      <section className="py-28 max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#10B981] mb-4" style={{ fontFamily: "var(--font-mono)" }}>How it works</p>
          <h2
            className="text-4xl sm:text-5xl font-black tracking-tight text-white"
            style={{ fontFamily: "Satoshi, sans-serif" }}
          >
            One prompt.
            <br />
            <span className="text-white/40">Infinite execution.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { step: "01", title: "Describe your strategy", body: "Type a plain-English brief. CLOVE compiles it to a typed workflow with triggers, conditions, and onchain actions." },
            { step: "02", title: "Grant one ERC-7715 permission", body: "Sign a single recurring USDC budget. Your agent operates autonomously within this cryptographic spending limit." },
            { step: "03", title: "Agent executes 24/7", body: "The agent scouts yields via x402 APIs, executes swaps through the gasless relayer, and reports every action." },
          ].map((item) => (
            <div
              key={item.step}
              className="relative p-8 rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:border-[#10B981]/25 hover:bg-[#10B981]/[0.03] transition-all group"
            >
              <div
                className="text-[11px] font-bold mb-6 text-[#10B981]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {item.step}
              </div>
              <h3 className="text-lg font-bold text-white mb-3" style={{ fontFamily: "Satoshi, sans-serif" }}>
                {item.title}
              </h3>
              <p className="text-[13px] leading-6 text-white/45">{item.body}</p>
              <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#10B981]/0 to-transparent group-hover:via-[#10B981]/30 transition-all duration-500" />
            </div>
          ))}
        </div>
      </section>

      {/* ══ FEATURES GRID ══ */}
      <section className="py-20 border-t border-white/[0.06] bg-[#050505]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#10B981] mb-4" style={{ fontFamily: "var(--font-mono)" }}>Infrastructure</p>
            <h2 className="text-4xl font-black tracking-tight text-white" style={{ fontFamily: "Satoshi, sans-serif" }}>
              Built for the machine economy
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="p-7 rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:border-[#10B981]/20 transition-all group"
              >
                <div className="text-2xl mb-4">{f.icon}</div>
                <h3 className="text-base font-bold text-white mb-2" style={{ fontFamily: "Satoshi, sans-serif" }}>{f.title}</h3>
                <p className="text-[13px] leading-6 text-white/40">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ EXECUTION LOG SECTION ══ */}
      <section className="py-28 max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#10B981] mb-4" style={{ fontFamily: "var(--font-mono)" }}>Live execution</p>
            <h2 className="text-4xl font-black tracking-tight text-white mb-6" style={{ fontFamily: "Satoshi, sans-serif" }}>
              Every action is
              <br />
              <span style={{ color: "#10B981" }}>logged and auditable</span>
            </h2>
            <p className="text-[14px] leading-7 text-white/45 mb-8">
              Your agent writes an immutable trail of every decision — scout, price check, swap, compound. Full transparency without giving up custody.
            </p>
            <div className="flex gap-3">
              <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 text-sm font-bold px-6 py-2.5 rounded-full bg-[#F59E0B] text-black hover:bg-[#FBBF24] transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)]">
                Open Dashboard <ArrowRight size={13} />
              </button>
            </div>
          </div>

          {/* Terminal log */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "rgba(0,0,0,0.9)",
              border: "1px solid rgba(16,185,129,0.15)",
              boxShadow: "0 0 60px rgba(16,185,129,0.05)",
            }}
          >
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-[rgba(16,185,129,0.1)] bg-[rgba(16,185,129,0.03)]">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
              <span className="text-[10px] text-white/20 mx-auto" style={{ fontFamily: "var(--font-mono)" }}>agent-log · aave-compounder</span>
            </div>
            <div className="p-5 space-y-2.5" style={{ fontFamily: "var(--font-mono)" }}>
              {[
                { time: "14:03:01", type: "TRIGGER", msg: "Cron fired · schedule: */5 * * * *", col: "#10B981" },
                { time: "14:03:02", type: "SCOUT", msg: "x402 → yield.api · 0.008 USDC paid", col: "#F59E0B" },
                { time: "14:03:03", type: "CHECK", msg: "Aave USDC APY: 8.42% (↑ 0.3%)", col: "#60A5FA" },
                { time: "14:03:04", type: "ACTION", msg: "supply(USDC, 147.32) → Aave Base", col: "#10B981" },
                { time: "14:03:06", type: "CONFIRM", msg: "tx 0x7a3b…c9f2 · confirmed · 1 block", col: "#10B981" },
                { time: "14:08:01", type: "TRIGGER", msg: "Cron fired · schedule: */5 * * * *", col: "#10B981" },
                { time: "14:08:02", type: "SCOUT", msg: "x402 → yield.api · 0.008 USDC paid", col: "#F59E0B" },
                { time: "14:08:03", type: "CHECK", msg: "No rebalance needed · APY unchanged", col: "#60A5FA" },
              ].map((log, i) => (
                <div key={i} className="flex items-start gap-3 text-[11px]">
                  <span className="text-white/20 flex-shrink-0">{log.time}</span>
                  <span className="font-bold flex-shrink-0 w-14" style={{ color: log.col }}>{log.type}</span>
                  <span className="text-white/45">{log.msg}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-1 pt-3 border-t border-white/[0.05]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
                <span className="text-[11px] text-[#10B981]/60">Agent running · next execution in 4m 18s</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ MARKETPLACE CTA ══ */}
      <section className="py-24 border-t border-white/[0.06] bg-[#050505]">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#10B981] mb-4" style={{ fontFamily: "var(--font-mono)" }}>Workflow marketplace</p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-tight text-white mb-6" style={{ fontFamily: "Satoshi, sans-serif" }}>
            Publish once.
            <br />
            <span className="text-white/35">Earn per agent call.</span>
          </h2>
          <p className="text-[14px] text-white/40 max-w-xl mx-auto mb-10 leading-7">
            List your strategy as an x402-callable endpoint. Any AI agent can discover and execute your workflow, paying in USDC per call.
          </p>
          <div className="flex items-center justify-center gap-3">
            <a href="/marketplace" className="flex items-center gap-2 text-sm font-bold px-7 py-3 rounded-full bg-[#10B981] text-black hover:bg-[#34D399] transition-all shadow-[0_0_24px_rgba(16,185,129,0.3)]">
              Browse Marketplace <ArrowRight size={14} />
            </a>
            <a href="#" className="flex items-center gap-2 text-sm font-semibold px-7 py-3 rounded-full border border-white/12 bg-white/4 text-white/70 hover:text-white hover:border-white/20 transition-all">
              Submit Strategy <ChevronRight size={14} />
            </a>
          </div>
        </div>
      </section>

      {/* ══ FINAL CTA BANNER ══ */}
      <section className="relative py-28 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(16,185,129,0.12) 0%, rgba(0,0,0,0) 70%)",
          }}
        />
        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-5xl sm:text-6xl font-black tracking-tight text-white mb-6" style={{ fontFamily: "Satoshi, sans-serif", lineHeight: 1.05 }}>
            The operating system
            <br />
            <span style={{ color: "#10B981" }}>for autonomous finance.</span>
          </h2>
          <p className="text-[14px] text-white/40 mb-10 leading-7">
            No manual rebalancing. No missed opportunities. No custody risk.<br />
            Just capital working at machine speed.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-2 text-sm font-bold px-8 py-3.5 rounded-full bg-[#F59E0B] text-black hover:bg-[#FBBF24] transition-all shadow-[0_0_30px_rgba(245,158,11,0.4)] hover:shadow-[0_0_44px_rgba(245,158,11,0.55)]"
            >
              Launch App — It&apos;s Free <ArrowRight size={14} />
            </button>
          </div>
          <p className="text-[11px] text-white/20 mt-5" style={{ fontFamily: "var(--font-mono)" }}>
            Non-custodial · ERC-7715 · x402 · Base Mainnet
          </p>
        </div>
      </section>

      {/* ══ FOOTER ══ */}
      <footer className="border-t border-white/[0.06] py-10 bg-black">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-[#10B981] flex items-center justify-center">
              <Zap size={10} className="text-black" fill="black" />
            </div>
            <span className="text-[11px] font-bold text-white/50" style={{ fontFamily: "Satoshi, sans-serif" }}>CLOVE</span>
          </div>
          <p className="text-[10px] text-white/20" style={{ fontFamily: "var(--font-mono)" }}>
            © 2025 CLOVE · Autonomous DeFi Agent OS · Non-custodial
          </p>
          <div className="flex gap-6 text-[10px] text-white/25" style={{ fontFamily: "var(--font-mono)" }}>
            {["Docs", "GitHub", "Discord", "Twitter"].map(l => (
              <a key={l} href="#" className="hover:text-white/60 transition-colors">{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
