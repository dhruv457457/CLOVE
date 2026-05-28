"use client";

import React from "react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const ACCENT = "#C8FF3D";
const PAPER  = "#F4F1EA";
const INK    = "#0B0C09";

const PROTOCOLS: { name: string; color: string; logo: React.ReactNode }[] = [
  { name: "Morpho",    color: "#3B5BFF", logo: <MorphoLogo /> },
  { name: "Uniswap",   color: "#FF007A", logo: <UniswapLogo /> },
  { name: "Aerodrome", color: "#0F62FE", logo: <AerodromeLogo /> },
  { name: "Lido",      color: "#00A3FF", logo: <LidoLogo /> },
  { name: "Sky",       color: "#4A90D9", logo: <SkyLogo /> },
  { name: "Venice AI", color: "#8B6BFF", logo: <VeniceLogo /> },
  { name: "Tavily",    color: "#22C55E", logo: <TavilyLogo /> },
  { name: "Base",      color: "#0052FF", logo: <BaseLogo /> },
  { name: "MetaMask",  color: "#F6851B", logo: <MetaMaskLogo /> },
  { name: "1Shot",     color: "#C8FF3D", logo: <OneShotLogo /> },
];

const TYPED_PHRASES = [
  "Watch USDC yields on Base, deposit into the safest vault above 8%, hold otherwise, alert me on Telegram.",
  "Daily DCA 0.5 USDC into ETH via Uniswap. Skip if gas > 2 gwei or BTC drops more than 5% in 24h.",
  "Rebalance to highest-APY stablecoin protocol every 6h. Risk cap: LOW. Budget: 5 USDC / 30 days.",
];

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const heroRef  = useRef<HTMLDivElement>(null);
  const bloomRef = useRef<HTMLDivElement>(null);

  // Force paper background on this page
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.style.background = PAPER;
      document.body.style.background = PAPER;
      document.body.style.color = INK;
    }
    return () => {
      // Restore ink for dashboard etc.
      if (typeof document !== "undefined") {
        document.documentElement.style.background = "";
        document.body.style.background = "";
        document.body.style.color = "";
      }
    };
  }, []);

  // Nav scroll state
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Cursor-tracked bloom (ref-based, no state re-renders)
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (bloomRef.current) {
        bloomRef.current.style.transform = `translate(${x - 340}px, ${y - 340}px)`;
      }
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div style={{ background: PAPER, color: INK, minHeight: "100vh" }}>
      {/* ───────── NAV ───────── */}
      <nav
        className="fixed inset-x-0 top-0 z-50"
        style={{
          padding: scrolled ? "12px 0" : "18px 0",
          background: "color-mix(in oklab, #F4F1EA 78%, transparent)",
          backdropFilter: "blur(14px) saturate(1.1)",
          WebkitBackdropFilter: "blur(14px) saturate(1.1)",
          borderBottom: `1px solid ${scrolled ? "rgba(14,15,12,0.12)" : "transparent"}`,
          transition: "border-color .3s ease, padding .3s ease",
        }}
      >
        <div className="mx-auto flex max-w-[1320px] items-center justify-between px-7">
          <Link href="/" className="flex items-center gap-2.5 text-[18px] font-semibold tracking-[-0.01em]">
            <CloverMark />
            <span>CLOVE</span>
            <span
              className="ml-1 rounded-full border px-1.5 py-[3px] text-[10px] font-medium uppercase tracking-[0.15em]"
              style={{ borderColor: "rgba(14,15,12,0.12)", color: "#6B6A60" }}
            >
              Beta
            </span>
          </Link>
          <ul className="hidden md:flex gap-[34px] m-0 p-0 list-none">
            {["Agent", "Memory", "Builder"].map((x) => (
              <li key={x}>
                <a className="text-[14px] opacity-70 hover:opacity-100 transition" href={`#${x.toLowerCase()}`}>{x}</a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3.5">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2.5 rounded-full px-[18px] py-[11px] text-[14px] font-medium"
              style={{
                background: ACCENT,
                color: INK,
                transition: "transform .25s cubic-bezier(.2,.8,.2,1), box-shadow .25s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 12px 30px -10px rgba(200,255,61,0.45)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              Launch agent <span aria-hidden>↗</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* ───────── HERO ───────── */}
      <section ref={heroRef} className="relative overflow-hidden px-7 pt-[200px] pb-[80px]">
        <div className="mx-auto max-w-[1320px] relative">
          {/* grid bg */}
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              backgroundImage:
                "linear-gradient(rgba(14,15,12,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(14,15,12,0.06) 1px,transparent 1px)",
              backgroundSize: "64px 64px",
              maskImage: "radial-gradient(ellipse at center 40%, #000 0%, transparent 70%)",
              WebkitMaskImage: "radial-gradient(ellipse at center 40%, #000 0%, transparent 70%)",
            }}
          />
          {/* cursor-tracked bloom */}
          <div
            ref={bloomRef}
            className="pointer-events-none absolute"
            style={{
              top: 0,
              left: 0,
              width: 680,
              height: 680,
              borderRadius: "50%",
              background: "radial-gradient(circle at center, rgba(200,255,61,0.45), transparent 60%)",
              filter: "blur(40px)",
              opacity: 0.55,
              mixBlendMode: "multiply",
              transition: "transform 280ms ease-out",
              willChange: "transform",
            }}
          />

          <div
            className="mb-9 inline-flex items-center gap-3.5 rounded-full border py-1.5 pl-2 pr-3.5 text-[12px] tracking-[0.04em]"
            style={{ borderColor: "rgba(14,15,12,0.12)", background: "color-mix(in oklab, #F4F1EA 90%, #0B0C09)", color: "#6B6A60" }}
          >
            <span
              className="rounded-full px-2 py-[3px] text-[10px] font-medium uppercase tracking-[0.15em]"
              style={{ background: INK, color: PAPER }}
            >
              Live
            </span>
            <span>x402 · ERC-7715 · 1Shot · Base mainnet</span>
            <span className="h-2.5 w-px" style={{ background: "rgba(14,15,12,0.12)" }} />
            <span>Network active · 24/7</span>
          </div>

          {/* Word-by-word reveal H1 */}
          <h1 className="m-0 max-w-[14ch] text-[clamp(56px,9vw,148px)] font-medium leading-[0.92] tracking-[-0.045em] mb-7 reveal-h1">
            <RevealWord delay={0.05}>Autonomous</RevealWord>{" "}
            <RevealWord delay={0.18}>capital,</RevealWord>{" "}
            <RevealWord delay={0.32} serif>quietly.</RevealWord>
          </h1>

          <p className="max-w-[54ch] text-[20px] leading-[1.45] mb-11" style={{ color: "#2B2D27" }}>
            CLOVE is the autonomous DeFi agent OS. Describe a strategy in plain English, grant one ERC-7715 budget,
            and an AI agent{" "}
            <strong style={{ background: `linear-gradient(transparent 62%, ${ACCENT} 62%)`, padding: "0 3px", fontWeight: 500 }}>
              researches, decides, and executes
            </strong>
            {" "}— pays for market intel via x402, deposits via 1Shot, reports back. Fully non-custodial.
          </p>

          <div className="flex flex-wrap items-center gap-3.5">
            <Link
              href="/dashboard"
              className="group inline-flex items-center gap-2.5 rounded-full px-[18px] py-[11px] text-[14px] font-medium"
              style={{ background: ACCENT, color: INK, transition: "transform .25s cubic-bezier(.2,.8,.2,1), box-shadow .25s" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 12px 30px -10px rgba(200,255,61,0.45)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              Start a workflow <span aria-hidden className="transition group-hover:translate-x-1">→</span>
            </Link>
            <Link
              href="/marketplace"
              className="inline-flex items-center gap-2.5 rounded-full border px-[18px] py-[11px] text-[14px] font-medium"
              style={{ borderColor: "rgba(14,15,12,0.12)", transition: "border-color .25s" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = INK; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(14,15,12,0.12)"; }}
            >
              Explore strategies
            </Link>
            <span className="ml-2.5 inline-flex items-center gap-2.5 text-[13px]" style={{ color: "#6B6A60" }}>
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: ACCENT, boxShadow: "0 0 0 4px rgba(200,255,61,0.45)" }}
              />
              No keys held. Revocable in one click.
            </span>
          </div>

          {/* Hero canvas figure */}
          <div className="relative mt-[90px]">
            <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />
            <div
              className="grid h-[520px] grid-cols-1 md:grid-cols-[1.1fr_1fr] border"
              style={{ background: "#ECE8DE", borderColor: INK }}
            >
              <div className="flex flex-col justify-between border-r p-9" style={{ borderColor: INK }}>
                <div className="text-[22px] leading-[1.35] tracking-[-0.01em] max-w-[36ch]">
                  &ldquo;<TypedPrompt phrases={TYPED_PHRASES} />&rdquo;
                </div>
                <div className="mt-6 flex flex-wrap gap-4 text-[12px] uppercase tracking-[0.06em]" style={{ color: "#6B6A60" }}>
                  <Meta num="6" label="nodes" />
                  <Meta num="2" label="protocols" />
                  <Meta num="9.3%" label="best apy" />
                  <Meta num="0.01" label="x402 cost" />
                </div>
              </div>
              <div className="relative overflow-hidden">
                <StrategyCanvas />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── MARQUEE ───────── */}
      <section className="border-y py-[60px]" style={{ background: PAPER, borderColor: "rgba(14,15,12,0.12)" }}>
        <div className="mb-[34px] text-center text-[11px] uppercase tracking-[0.18em]" style={{ color: "#6B6A60" }}>
          Composed from
        </div>
        <div
          className="flex overflow-hidden"
          style={{
            maskImage: "linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)",
            WebkitMaskImage: "linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)",
          }}
        >
          <div className="marquee-track flex shrink-0 gap-14 pr-14">
            {[...PROTOCOLS, ...PROTOCOLS].map((p, i) => (
              <div key={i} className="flex items-center gap-3 whitespace-nowrap text-[22px] font-medium tracking-[-0.02em]">
                <span
                  className="flex items-center justify-center rounded-full flex-shrink-0"
                  style={{ width: 34, height: 34, background: p.color === "#C8FF3D" ? "#0B0C09" : p.color, boxShadow: `0 0 0 2px ${p.color}22` }}
                >
                  {p.logo}
                </span>
                {p.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── API INTEGRATIONS ───────── */}
      <section className="px-7 py-[56px] border-b" style={{ background: PAPER, borderColor: "rgba(14,15,12,0.08)" }}>
        <div className="mx-auto max-w-[1320px]">
          <div className="text-center text-[10px] uppercase tracking-[0.2em] mb-9" style={{ color: "#6B6A60" }}>
            Powered by
          </div>
          <div className="flex flex-wrap justify-center gap-6">
            {[
              { name: "Venice AI",  desc: "Private LLM inference",  color: "#8B6BFF", logo: <VeniceLogo /> },
              { name: "1Shot API",  desc: "ERC-7715 redemption",     color: "#C8FF3D", logo: <OneShotLogo />, dark: true },
              { name: "Tavily",     desc: "Real-time web search",    color: "#22C55E", logo: <TavilyLogo /> },
              { name: "Base",       desc: "L2 execution layer",      color: "#0052FF", logo: <BaseLogo /> },
              { name: "MetaMask",   desc: "ERC-7715 permissions",    color: "#F6851B", logo: <MetaMaskLogo /> },
              { name: "x402",       desc: "HTTP payment protocol",   color: "#C8FF3D", logo: <X402Logo />,   dark: true },
            ].map((api) => (
              <div
                key={api.name}
                className="flex items-center gap-3 rounded-xl px-5 py-3.5 border"
                style={{
                  borderColor: "rgba(14,15,12,0.1)",
                  background: "rgba(14,15,12,0.03)",
                  transition: "border-color .2s, box-shadow .2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = api.color + "55";
                  e.currentTarget.style.boxShadow   = `0 4px 18px -8px ${api.color}33`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(14,15,12,0.1)";
                  e.currentTarget.style.boxShadow   = "none";
                }}
              >
                <span
                  className="flex items-center justify-center rounded-full flex-shrink-0"
                  style={{ width: 36, height: 36, background: api.dark ? "#0B0C09" : api.color, boxShadow: `0 0 0 2px ${api.color}22` }}
                >
                  {api.logo}
                </span>
                <div>
                  <div className="text-[13px] font-medium tracking-[-0.01em]" style={{ color: INK }}>
                    {api.name}
                  </div>
                  <div className="text-[11px]" style={{ color: "#6B6A60" }}>
                    {api.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── AGENT ───────── */}
      <section id="agent" className="px-7 py-[140px]">
        <div className="mx-auto max-w-[1320px]">
          <div className="text-[11px] uppercase tracking-[0.18em] mb-3" style={{ color: "#6B6A60" }}>
            The agent loop
          </div>
          <h2 className="m-0 mb-[60px] max-w-[18ch] text-[clamp(40px,5.4vw,84px)] font-medium leading-[0.96] tracking-[-0.035em]">
            It thinks{" "}
            <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontWeight: 400 }}>before</span>{" "}
            it spends.
          </h2>

          <div
            className="grid grid-cols-1 md:grid-cols-3 gap-px border-y"
            style={{ background: "rgba(14,15,12,0.12)", borderColor: "rgba(14,15,12,0.12)" }}
          >
            {[
              { num: "01", title: "Scout",   body: "Pays Venice AI 0.01 USDC via x402 to fetch live yields, market news, and risk signals across Base." },
              { num: "02", title: "Reason",  body: "Compares against memory: current position, last-5 runs, 7-day APY trends. Decides to deposit, hold, or rebalance." },
              { num: "03", title: "Execute", body: "1Shot redeems your ERC-7715 delegation, signs a UserOp, broadcasts on Base mainnet. Reports the txHash on Telegram." },
            ].map((s) => (
              <div key={s.num} className="relative flex min-h-[380px] flex-col px-9 py-12" style={{ background: PAPER }}>
                <div
                  className="mb-auto text-[84px] leading-[1] tracking-[-0.04em]"
                  style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}
                >
                  {s.num}
                </div>
                <h3 className="m-0 mt-6 mb-2.5 text-[26px] font-medium tracking-[-0.02em]">{s.title}</h3>
                <p className="m-0 max-w-[36ch] text-[15px] leading-[1.55]" style={{ color: "#2B2D27" }}>
                  {s.body}
                </p>
                <span className="absolute right-7 top-6 text-[11px] uppercase tracking-[0.12em]" style={{ color: "#6B6A60" }}>
                  Stage / {s.num}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── AGENT SCROLLYTELLING ORB ───────── */}
      <AgentOrbSection />

      {/* ───────── MEMORY ───────── */}
      <section id="memory" className="px-7 pt-[120px] pb-[60px]">
        <div className="mx-auto grid max-w-[1320px] grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-[60px] items-start">
          <div className="flex flex-col gap-9">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] mb-3" style={{ color: "#6B6A60" }}>
                Persistent memory
              </div>
              <h2 className="m-0 max-w-[14ch] text-[clamp(40px,5.4vw,72px)] font-medium leading-[0.96] tracking-[-0.035em]">
                Every agent{" "}
                <span style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>remembers</span>.
              </h2>
            </div>
            <ul className="list-none m-0 p-0">
              {[
                { t: "Cross-run context", d: "Knows what protocol you're in, when you entered, and what's changed since." },
                { t: "APY history",       d: "7-day rolling trend per protocol — rebalances only when it's a real signal, not noise." },
                { t: "Decision rationale",d: "Records the Venice reasoning behind every action so you can audit later." },
              ].map((x, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[14px_1fr] gap-4 py-[18px] items-start border-b first:border-t"
                  style={{ borderColor: "rgba(14,15,12,0.12)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full mt-2" style={{ background: INK }} />
                  <div>
                    <strong className="text-[18px] font-medium tracking-[-0.015em] block mb-1">{x.t}</strong>
                    <span className="text-[14px] leading-[1.5] block max-w-[42ch]" style={{ color: "#2B2D27" }}>
                      {x.d}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Memory feed */}
          <div className="rounded-[14px] border overflow-hidden" style={{ borderColor: INK, background: "#ECE8DE" }}>
            <div
              className="flex items-center gap-2.5 px-[22px] py-3.5 text-[11px] tracking-[0.06em] border-b"
              style={{ background: PAPER, color: "#6B6A60", borderColor: "rgba(14,15,12,0.12)" }}
            >
              <span
                className="w-[7px] h-[7px] rounded-full"
                style={{ background: ACCENT, boxShadow: "0 0 0 4px rgba(200,255,61,0.45)" }}
              />
              <span className="text-[12px]" style={{ color: "#2B2D27", letterSpacing: "-0.005em", fontWeight: 500 }}>
                Agent memory · 0x4fd5…a5dd
              </span>
              <span className="ml-auto text-[11px]" style={{ color: "#6B6A60" }}>Live</span>
            </div>
            <ul className="list-none m-0 p-0">
              {[
                { d: "Today",      k: "decision", txt: "HOLD — already in best position (Morpho 9.31%)" },
                { d: "Yesterday",  k: "execute",  txt: "Deposited 0.1 USDC → Morpho @ 9.11%" },
                { d: "3 days ago", k: "scout",    txt: "Sky APY dropped to 6.1% — flagged for rebalance review" },
                { d: "4 days ago", k: "observe",  txt: "Tavily news: no exploits or protocol pauses on Base" },
              ].map((r, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[76px_110px_1fr] gap-[18px] items-start px-[22px] py-[18px] text-[13.5px] leading-[1.5] relative border-b last:border-b-0"
                  style={{ borderColor: "rgba(14,15,12,0.12)" }}
                >
                  <span aria-hidden className="absolute left-0 top-[18px] bottom-[18px] w-0.5" style={{ background: ACCENT }} />
                  <span
                    className="text-[18px] leading-[1.2] tracking-[-0.01em]"
                    style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}
                  >
                    {r.d}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.14em] pt-1.5" style={{ color: "#6B6A60" }}>
                    {r.k}
                  </span>
                  <span style={{ color: "#2B2D27" }}>{r.txt}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ───────── DASHBOARD PREVIEW ───────── */}
      <section
        id="builder"
        className="px-7 pt-[140px] pb-[160px] mt-[60px] relative overflow-hidden"
        style={{ background: INK, color: PAPER, borderRadius: "32px 32px 0 0" }}
      >
        <div className="mx-auto max-w-[1320px]">
          <div className="text-[11px] uppercase tracking-[0.18em] mb-3" style={{ color: "#A8A89A" }}>
            Workflow Builder
          </div>
          <h2 className="m-0 max-w-[18ch] text-[clamp(40px,5.4vw,84px)] font-medium leading-[0.96] tracking-[-0.035em]">
            A canvas for{" "}
            <span style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>capital</span>.
          </h2>
          <p className="mt-6 text-[18px] leading-[1.55] max-w-[60ch]" style={{ color: "#B8B6A8" }}>
            Visual node graph for every strategy. Watch your agent reason, pay, and execute — without ever seeing a terminal.
          </p>

          {/* 3D-tilted dashboard with flowing edges */}
          <DashBoard />

          <div className="grid grid-cols-2 md:grid-cols-4 mt-[60px] border-y" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
            <MetricBlock value={9.31}    decimals={2} unit="%"    label="Best APY on Base"   arrow="↑" first />
            <MetricBlock value={0.03}    decimals={2} unit="USDC" label="x402 fees / month" />
            <MetricBlock value={3}       decimals={0} unit=""     label="Active runs" />
            <MetricBlock value={Infinity} decimals={0} unit=""    label="Memory depth"      last />
          </div>

          <div className="mt-[60px] flex justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2.5 rounded-full px-[22px] py-[13px] text-[14px] font-medium"
              style={{ background: ACCENT, color: INK, transition: "transform .25s cubic-bezier(.2,.8,.2,1), box-shadow .25s" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 12px 30px -10px rgba(200,255,61,0.45)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              Open builder <span aria-hidden>↗</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ───────── CLOSING ───────── */}
      <section className="text-center px-7 py-[140px] relative overflow-hidden" style={{ background: PAPER }}>
        <h2 className="mx-auto m-0 mb-7 max-w-[14ch] text-[clamp(56px,9vw,140px)] font-medium leading-[0.93] tracking-[-0.045em]">
          Quiet capital{" "}
          <span style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>begins</span>.
        </h2>
        <p className="mx-auto mb-11 max-w-[48ch] text-[18px] leading-[1.5]" style={{ color: "#2B2D27" }}>
          One delegation. Zero keys held. The agent does the rest.
        </p>
        <div className="flex justify-center gap-3.5">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2.5 rounded-full px-[20px] py-[12px] text-[14px] font-medium"
            style={{ background: INK, color: PAPER }}
          >
            Launch agent <span aria-hidden>↗</span>
          </Link>
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-2.5 rounded-full border px-[20px] py-[12px] text-[14px] font-medium"
            style={{ borderColor: "rgba(14,15,12,0.12)" }}
          >
            Browse marketplace
          </Link>
        </div>
      </section>

      {/* ───────── FOOTER ───────── */}
      <footer className="border-t px-7 py-[60px]" style={{ background: PAPER, borderColor: "rgba(14,15,12,0.12)" }}>
        <div className="mx-auto max-w-[1320px] flex flex-wrap justify-between gap-10">
          <div>
            <div className="flex items-center gap-2.5 text-[18px] font-semibold tracking-[-0.01em]">
              <CloverMark /> CLOVE
            </div>
            <p className="text-[13px] max-w-[32ch] leading-[1.55] mt-3" style={{ color: "#6B6A60" }}>
              Autonomous DeFi agent OS. Built on Base. Powered by Venice AI, x402, ERC-7715, 1Shot.
            </p>
          </div>
          <div className="flex flex-wrap gap-[60px]">
            {[
              { h: "Product",   items: ["Dashboard", "Marketplace", "Pricing"] },
              { h: "Resources", items: ["Documentation", "Manifesto", "Status"] },
              { h: "Company",   items: ["Twitter", "Discord", "Contact"] },
            ].map((col) => (
              <div key={col.h}>
                <h6 className="m-0 mb-3.5 text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: "#6B6A60" }}>
                  {col.h}
                </h6>
                {col.items.map((a) => (
                  <a key={a} className="block py-1 text-[14px] opacity-80 hover:opacity-100" href="#">
                    {a}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div
          className="mx-auto mt-12 flex max-w-[1320px] items-center justify-between border-t pt-7 text-[12px] tracking-[0.04em]"
          style={{ borderColor: "rgba(14,15,12,0.12)", color: "#6B6A60" }}
        >
          <span>© CLOVE 2026 — Autonomous capital, quietly.</span>
          <span>v0.1 · Base mainnet</span>
        </div>
      </footer>

      {/* Page-local keyframes for motion */}
      <style jsx global>{`
        @keyframes clove-rise   { from { transform: translateY(110%); } to { transform: translateY(0); } }
        @keyframes clove-blink  { 50% { opacity: 0; } }
        @keyframes clove-slide  { from { transform: translateX(0); } to { transform: translateX(-100%); } }
        @keyframes clove-pulse  { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.4); opacity: .6 } }
        @keyframes clove-flow   { to { stroke-dashoffset: -24; } }

        .reveal-h1 .reveal { display: inline-block; overflow: hidden; vertical-align: bottom; }
        .reveal-h1 .reveal > span {
          display: inline-block;
          transform: translateY(110%);
          animation: clove-rise 1.1s cubic-bezier(.2,.8,.2,1) forwards;
        }

        .marquee-track { animation: clove-slide 38s linear infinite; }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Reveal word
// ─────────────────────────────────────────────────────────
function RevealWord({ children, delay, serif }: { children: React.ReactNode; delay: number; serif?: boolean }) {
  return (
    <span className="reveal">
      <span
        style={{
          animationDelay: `${delay}s`,
          fontFamily: serif ? "var(--serif)" : undefined,
          fontStyle:  serif ? "italic"      : undefined,
          fontWeight: serif ? 400           : undefined,
          letterSpacing: serif ? "-0.02em"  : undefined,
        }}
      >
        {children}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────
// Typed prompt
// ─────────────────────────────────────────────────────────
function TypedPrompt({ phrases, speed = 38, hold = 1600 }: { phrases: string[]; speed?: number; hold?: number }) {
  const [text, setText]         = useState("");
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [phase, setPhase]       = useState<"typing" | "holding" | "deleting">("typing");

  useEffect(() => {
    const current = phrases[phraseIdx];
    let t: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      if (text.length < current.length) t = setTimeout(() => setText(current.slice(0, text.length + 1)), speed);
      else t = setTimeout(() => setPhase("holding"), 80);
    } else if (phase === "holding") {
      t = setTimeout(() => setPhase("deleting"), hold);
    } else {
      if (text.length > 0) t = setTimeout(() => setText(text.slice(0, -1)), 18);
      else { setPhraseIdx((phraseIdx + 1) % phrases.length); setPhase("typing"); }
    }
    return () => clearTimeout(t);
  }, [text, phase, phraseIdx, phrases, speed, hold]);

  return (
    <>
      <span>{text}</span>
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 22,
          background: INK,
          marginLeft: 2,
          verticalAlign: "-3px",
          animation: "clove-blink 1s steps(2) infinite",
        }}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────
// Strategy Canvas — rotating active node
// ─────────────────────────────────────────────────────────
function StrategyCanvas() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive(a => (a + 1) % 4), 1800);
    return () => clearInterval(id);
  }, []);

  const nodes = [
    { l: 20,  t: 60,  k: "trigger",       v: "Daily / 09:00" },
    { l: 220, t: 170, k: "reason · x402", v: "Best APY scan" },
    { l: 390, t: 290, k: "compare",       v: "Morpho vs Sky" },
    { l: 470, t: 410, k: "execute",       v: "Morpho deposit" },
  ];

  const edges = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 2, to: 3 },
  ];

  // edge active if EITHER endpoint is active (gives "feed" feel)
  const isEdgeActive = (e: { from: number; to: number }) => e.to === active || e.from === active;

  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 600 520" preserveAspectRatio="none" className="absolute inset-0 h-full w-full pointer-events-none">
        {edges.map((e, i) => {
          const a = nodes[e.from], b = nodes[e.to];
          const x1 = a.l + 130, y1 = a.t + 22;
          const x2 = b.l, y2 = b.t + 22;
          const mx = (x1 + x2) / 2;
          const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
          const live = isEdgeActive(e);
          return (
            <path
              key={i}
              d={d}
              stroke={live ? INK : "rgba(14,15,12,0.18)"}
              strokeWidth={live ? 1.2 : 0.8}
              fill="none"
              strokeDasharray={live ? undefined : "4 6"}
              style={{ transition: "stroke .4s, stroke-width .4s" }}
            />
          );
        })}
      </svg>
      {nodes.map((n, i) => {
        const isActive = i === active;
        return (
          <div
            key={i}
            className="absolute flex items-start gap-2 border px-3.5 py-2.5 text-[13px] font-medium tracking-[-0.005em]"
            style={{
              left: n.l, top: n.t,
              background: isActive ? ACCENT : PAPER,
              borderColor: INK,
              color: INK,
              transition: "background .35s cubic-bezier(.2,.8,.2,1), transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s",
              transform: isActive ? "translateY(-3px)" : "translateY(0)",
              boxShadow: isActive ? "0 14px 30px -14px rgba(200,255,61,0.7)" : "none",
            }}
          >
            <span
              className="mt-1.5 h-[7px] w-[7px] rounded-full flex-shrink-0"
              style={{
                background: isActive ? INK : "#6B6A60",
                animation: isActive ? "clove-pulse 1.4s ease-in-out infinite" : "none",
              }}
            />
            <div>
              <small
                className="block text-[10px] uppercase tracking-[0.1em] font-medium mb-0.5"
                style={{ color: isActive ? "#2B2D27" : "#6B6A60" }}
              >
                {n.k}
              </small>
              {n.v}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Count-up metric (IntersectionObserver + RAF)
// ─────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 1800) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isFinite(target)) { setVal(target); return; }
    let raf = 0;
    let started = false;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started) {
        started = true;
        const startTime = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - startTime) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setVal(target * eased);
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => { cancelAnimationFrame(raf); obs.disconnect(); };
  }, [target, duration]);
  return [ref, val] as const;
}

function MetricBlock({ value, decimals, unit, label, arrow, first, last }: {
  value: number; decimals: number; unit: string; label: string; arrow?: string; first?: boolean; last?: boolean;
}) {
  const [ref, current] = useCountUp(value);
  const display = isFinite(value) ? current.toFixed(decimals) : "∞";
  return (
    <div
      ref={ref}
      className="px-[22px] py-7"
      style={{
        borderRight: last ? "none" : "1px solid rgba(255,255,255,0.08)",
        borderLeft:  first ? "none" : "transparent",
      }}
    >
      <div className="text-[42px] leading-[1] tracking-[-0.035em] font-medium tickup">
        {display}
        {unit && <span className="text-[18px] ml-1.5" style={{ color: "#A8A89A", fontWeight: 400 }}>{unit}</span>}
      </div>
      <div className="mt-3.5 text-[11px] uppercase tracking-[0.14em]" style={{ color: "#A8A89A" }}>
        {label}
        {arrow && <span className="ml-2" style={{ color: ACCENT }}>{arrow}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Small primitives
// ─────────────────────────────────────────────────────────
function CloverMark() {
  return (
    <span
      className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg"
      style={{ background: INK }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="8"  cy="8"  r="3.5" fill={ACCENT} />
        <circle cx="16" cy="8"  r="3.5" fill={ACCENT} opacity="0.85" />
        <circle cx="8"  cy="16" r="3.5" fill={ACCENT} opacity="0.85" />
        <circle cx="16" cy="16" r="3.5" fill={ACCENT} opacity="0.7" />
      </svg>
    </span>
  );
}

function Corner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const style: React.CSSProperties = {
    position: "absolute",
    width: 14, height: 14,
    border: `1px solid ${INK}`,
    background: PAPER,
    zIndex: 2,
  };
  if (pos === "tl") { style.top = -8; style.left = -8; }
  if (pos === "tr") { style.top = -8; style.right = -8; }
  if (pos === "bl") { style.bottom = -8; style.left = -8; }
  if (pos === "br") { style.bottom = -8; style.right = -8; }
  return <span style={style} />;
}

// ─────────────────────────────────────────────────────────
// Agent scrollytelling orb (5-stage sticky section)
// ─────────────────────────────────────────────────────────
type OrbState = "rest" | "scout" | "reason" | "execute" | "report";

const ORB_STAGES: Array<{ id: OrbState; eyebrow: string; title: React.ReactNode; body: string }> = [
  {
    id: "rest",
    eyebrow: "Stage 00 · idle",
    title: <>A patient <span style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>witness</span>.</>,
    body: "The agent waits for a trigger. Between cycles it breathes — no on-chain calls, no spend, no noise.",
  },
  {
    id: "scout",
    eyebrow: "Stage 01 · scout",
    title: <>It pays for what it <span style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>needs</span>.</>,
    body: "0.01 USDC flows via x402 to Venice AI. Live APYs, market news, risk signals — all in one paid call.",
  },
  {
    id: "reason",
    eyebrow: "Stage 02 · reason",
    title: <>It thinks <span style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>against</span> memory.</>,
    body: "Cross-checks the scout output against your last 5 runs and 7-day APY trends. Decides: deposit, hold, or rebalance.",
  },
  {
    id: "execute",
    eyebrow: "Stage 03 · execute",
    title: <>It moves the <span style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>capital</span>.</>,
    body: "1Shot redeems your ERC-7715 delegation, signs a UserOp, broadcasts on Base mainnet. Gasless on your side.",
  },
  {
    id: "report",
    eyebrow: "Stage 04 · report",
    title: <>It writes the <span style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>memory</span>.</>,
    body: "The tx hash, reasoning, and APY snapshot persist to MongoDB. Telegram pings you. The agent goes quiet.",
  },
];

function AgentOrbSection() {
  const [active, setActive] = useState<OrbState>("rest");
  const refs = useRef<Record<string, HTMLLIElement | null>>({});

  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting);
      if (!visible.length) return;
      const center = window.innerHeight / 2;
      let best = visible[0], bestDist = Infinity;
      for (const e of visible) {
        const r = e.boundingClientRect;
        const mid = r.top + r.height / 2;
        const d = Math.abs(mid - center);
        if (d < bestDist) { bestDist = d; best = e; }
      }
      const id = best.target.getAttribute("data-stage") as OrbState | null;
      if (id) setActive(id);
    }, { threshold: [0.3, 0.55, 0.8], rootMargin: "-20% 0px -20% 0px" });

    Object.values(refs.current).forEach((el) => { if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  return (
    <section className="px-7 pt-[40px] pb-[60px]" style={{ background: PAPER }}>
      <div className="mx-auto max-w-[1320px]">
        <div className="text-[11px] uppercase tracking-[0.18em] mb-3" style={{ color: "#6B6A60" }}>
          The agent loop · in motion
        </div>
        <h2 className="m-0 max-w-[14ch] text-[clamp(40px,5.4vw,72px)] font-medium leading-[0.96] tracking-[-0.035em] mb-10">
          Watch it <span style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>work</span>.
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-[60px] items-start">
          {/* Sticky orb */}
          <div
            className="hidden lg:flex items-center justify-center"
            style={{
              position: "sticky",
              top: 140,
              height: "calc(100vh - 200px)",
              minHeight: 560,
            }}
          >
            <AgentOrb state={active} />
          </div>

          {/* Mobile orb (non-sticky, smaller) */}
          <div className="lg:hidden flex items-center justify-center py-10">
            <AgentOrb state={active} />
          </div>

          {/* Stages list */}
          <ul className="list-none m-0 p-0">
            {ORB_STAGES.map((s, i) => (
              <li
                key={s.id}
                data-stage={s.id}
                ref={(el) => { refs.current[s.id] = el; }}
                className="relative"
                style={{
                  padding: "80px 0",
                  borderBottom: i === ORB_STAGES.length - 1 ? "none" : "1px solid rgba(14,15,12,0.12)",
                  borderTop:    i === 0 ? "1px solid rgba(14,15,12,0.12)" : undefined,
                  opacity: active === s.id ? 1 : 0.32,
                  transition: "opacity .6s ease",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    content: "''",
                    position: "absolute",
                    left: 0,
                    top: 80,
                    width: 2,
                    height: active === s.id ? 60 : 0,
                    background: ACCENT,
                    transition: "height .5s ease",
                  }}
                />
                <div className="text-[11px] uppercase tracking-[0.14em] font-medium pl-4 mb-4" style={{ color: "#6B6A60" }}>
                  {s.eyebrow}
                </div>
                <h3 className="m-0 mb-4 pl-4 max-w-[18ch] text-[clamp(28px,3.4vw,44px)] font-medium leading-[1.05] tracking-[-0.025em]">
                  {s.title}
                </h3>
                <p className="m-0 pl-4 max-w-[42ch] text-[16.5px] leading-[1.55]" style={{ color: "#2B2D27" }}>
                  {s.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function AgentOrb({ state }: { state: OrbState }) {
  return (
    <div className={`agent-orb state-${state}`}>
      {/* Rings */}
      <div className="ring r1" />
      <div className="ring r2" />
      <div className="ring r3" />

      {/* Orbiting motes */}
      <div className="orbit o1"><span className="mote" /></div>
      <div className="orbit o2"><span className="mote" /></div>
      <div className="orbit o3"><span className="mote" /></div>
      <div className="orbit o4"><span className="mote" /></div>

      {/* Core — SVG clover */}
      <svg className="core" width="200" height="200" viewBox="0 0 200 200">
        {/* halo */}
        <circle className="halo" cx="100" cy="100" r="60" fill="none" stroke={ACCENT} strokeWidth="1" opacity="0" />
        {/* petals */}
        <circle className="petal" cx="70"  cy="70"  r="22" />
        <circle className="petal" cx="130" cy="70"  r="22" />
        <circle className="petal" cx="70"  cy="130" r="22" />
        <circle className="petal" cx="130" cy="130" r="22" />
        {/* link cross */}
        <line className="link" x1="70"  y1="70"  x2="130" y2="130" stroke={INK} strokeWidth="1" opacity="0.4" />
        <line className="link" x1="130" y1="70"  x2="70"  y2="130" stroke={INK} strokeWidth="1" opacity="0.4" />
        {/* hub */}
        <circle className="hub" cx="100" cy="100" r="14" />
      </svg>

      {/* Legend */}
      <div className="orb-legend">
        <span className="ld" />
        {state === "rest"    && "Idle"}
        {state === "scout"   && "Paying Venice via x402"}
        {state === "reason"  && "Reasoning against memory"}
        {state === "execute" && "Submitting UserOp"}
        {state === "report"  && "Writing memory"}
      </div>

      <style jsx>{`
        .agent-orb {
          position: relative;
          width: 380px;
          height: 380px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
        }
        @media (max-width: 600px) {
          .agent-orb { width: 280px; height: 280px; }
        }

        .ring {
          position: absolute;
          border-radius: 50%;
          border: 1px solid rgba(14,15,12,0.12);
          transition: transform 1.2s cubic-bezier(.2,.8,.2,1), border-color .8s, opacity .8s;
        }
        .r1 { inset: 0;    animation: spin-cw 60s linear infinite; }
        .r2 { inset: 30px; border-style: dashed; border-color: rgba(14,15,12,0.08); animation: spin-ccw 90s linear infinite; }
        .r3 { inset: 60px; border-color: rgba(14,15,12,0.15); }

        @keyframes spin-cw  { to { transform: rotate(360deg); } }
        @keyframes spin-ccw { to { transform: rotate(-360deg); } }

        .orbit {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          pointer-events: none;
        }
        .mote {
          width: 8px; height: 8px; border-radius: 50%;
          background: ${INK};
          margin-top: -4px;
          transition: background .5s, transform .5s, box-shadow .5s;
        }
        .o1 { animation: orbit-a 14s linear infinite; }
        .o2 { animation: orbit-a 18s linear infinite reverse; animation-delay: -6s; }
        .o3 { animation: orbit-a 22s linear infinite; animation-delay: -13s; }
        .o4 { animation: orbit-a 26s linear infinite reverse; animation-delay: -4s; }
        @keyframes orbit-a { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .core { position: relative; z-index: 2; transition: transform .8s cubic-bezier(.2,.8,.2,1); }
        .core :global(.halo)  { opacity: 0; transition: opacity .8s; }
        .core :global(.petal) {
          fill: ${INK};
          transition: fill .5s, transform .8s cubic-bezier(.2,.8,.2,1);
          transform-origin: 100px 100px;
        }
        .core :global(.hub) {
          fill: ${PAPER};
          stroke: ${INK};
          stroke-width: 1.5;
          transition: fill .5s, stroke .5s, r .5s;
        }
        .core :global(.link) { transition: stroke .5s, opacity .5s; }

        /* STATE: rest */
        .state-rest .core :global(.petal) { animation: breathe 5s ease-in-out infinite; }
        @keyframes breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }

        /* STATE: scout */
        .state-scout .mote { background: ${ACCENT}; box-shadow: 0 0 12px rgba(200,255,61,0.45); transform: scale(1.4); }
        .state-scout .r2   { border-color: rgba(200,255,61,0.35); }
        .state-scout .core { transform: scale(1.02); }

        /* STATE: reason */
        .state-reason .core :global(.hub)   { fill: ${ACCENT}; stroke: ${ACCENT}; r: 18; }
        .state-reason .core :global(.halo)  { opacity: 0.95; }
        .state-reason .core :global(.link)  { stroke: ${ACCENT}; opacity: 0.8; }
        .state-reason .core { transform: scale(1.03); }
        .state-reason .core :global(.petal) { transform: scale(0.94); }
        .state-reason .r3 { border-color: ${ACCENT}; box-shadow: 0 0 24px rgba(200,255,61,0.45) inset; }

        /* STATE: execute */
        .state-execute .core :global(.petal) { fill: ${ACCENT}; animation: exec-pulse 1.1s ease-in-out infinite; }
        .state-execute .core :global(.hub)   { fill: ${INK}; stroke: ${INK}; }
        .state-execute .core :global(.link)  { stroke: ${INK}; opacity: 1; }
        .state-execute .r1   { border-color: rgba(200,255,61,0.5); transform: scale(1.04); }
        .state-execute .mote { background: ${ACCENT}; box-shadow: 0 0 16px rgba(200,255,61,0.45); }
        @keyframes exec-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }

        /* STATE: report */
        .state-report .core :global(.petal) { fill: ${INK}; }
        .state-report .core :global(.hub)   { fill: ${PAPER}; stroke: ${INK}; r: 14; }
        .state-report .o1 .mote             { background: ${ACCENT}; box-shadow: 0 0 24px rgba(200,255,61,0.45); transform: scale(2.2); }

        .orb-legend {
          position: absolute;
          bottom: -6px;
          left: 50%;
          transform: translateX(-50%);
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 7px 14px;
          border-radius: 999px;
          border: 1px solid rgba(14,15,12,0.12);
          background: ${PAPER};
          font-size: 12px;
          color: #2B2D27;
          white-space: nowrap;
        }
        .orb-legend .ld {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${ACCENT};
          box-shadow: 0 0 0 4px rgba(200,255,61,0.45);
        }
        .state-rest .orb-legend .ld { background: #6B6A60; box-shadow: none; }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 3D-tilted dashboard board with flowing edges
// ─────────────────────────────────────────────────────────
function DashBoard() {
  const NODE_W = 200;
  const NODE_H = 84;
  const VIEW_W = 1100;
  const VIEW_H = 580;

  const nodes = [
    { id: "trigger",  tag: "trigger",   title: "Daily 09:00",   body: "Cron / Vercel scheduler",  pos: { x: 50,  y: 70  } },
    { id: "budget",   tag: "permission",title: "ERC-7715 Budget",body: "50 USDC · 30 d remaining", pos: { x: 50,  y: 250 } },
    { id: "scout",    tag: "scout",     title: "Venice AI · x402",body: "Pay 0.01 USDC for yields", pos: { x: 360, y: 70  } },
    { id: "reason",   tag: "reason",    title: "Compare APY",   body: "morpho > sky > aave",      pos: { x: 360, y: 250, live: true } },
    { id: "execute",  tag: "execute",   title: "Morpho Deposit",body: "0.1 USDC → vault",         pos: { x: 720, y: 160 } },
    { id: "notify",   tag: "notify",    title: "Telegram alert",body: "tx 0x4a8b…",               pos: { x: 720, y: 360 } },
  ] as const;

  const edges: Array<[number, number]> = [
    [0, 2], // trigger → scout
    [1, 3], // budget → reason
    [2, 3], // scout → reason
    [3, 4], // reason → execute
    [3, 5], // reason → notify
    [4, 5], // execute → notify
  ];

  const [flowIdx, setFlowIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFlowIdx(i => (i + 1) % edges.length), 1300);
    return () => clearInterval(id);
  }, [edges.length]);

  // Edge path: bezier from right of source → left of target
  const edgePath = (aIdx: number, bIdx: number) => {
    const a = nodes[aIdx].pos;
    const b = nodes[bIdx].pos;
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div
      className="mt-[80px] relative"
      style={{ perspective: 1800 }}
    >
      <div
        className="relative rounded-[18px] overflow-hidden"
        style={{
          height: 640,
          background: "#16170F",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 80px 120px -40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
          transform: "rotateX(8deg) rotateY(-6deg) rotateZ(-1deg)",
          transformStyle: "preserve-3d",
          transition: "transform .8s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* Chrome */}
        <div
          className="flex items-center gap-3.5 px-[22px] py-3.5"
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background: "linear-gradient(180deg, rgba(255,255,255,0.03), transparent)",
          }}
        >
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3F4538" }} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3F4538" }} />
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3F4538" }} />
          </div>
          <div className="flex gap-1.5 ml-3">
            <span className="text-[11px] tracking-[0.06em] px-3 py-1.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: PAPER }}>
              Canvas
            </span>
            <span className="text-[11px] tracking-[0.06em] px-3 py-1.5 rounded" style={{ color: "#B8B6A8" }}>
              Code
            </span>
            <span className="text-[11px] tracking-[0.06em] px-3 py-1.5 rounded" style={{ color: "#B8B6A8" }}>
              Runs
            </span>
          </div>
          <div className="ml-auto text-[12px] tracking-[0.04em]" style={{ color: "#7F7E72" }}>
            workspace / Stable Ladder · v4
          </div>
          <div className="ml-3 flex items-center gap-2 text-[11px] tracking-[0.1em] uppercase" style={{ color: ACCENT }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT, boxShadow: `0 0 12px ${ACCENT}` }} />
            live
          </div>
        </div>

        {/* Canvas */}
        <div className="relative" style={{ height: "calc(100% - 50px)" }}>
          {/* dotted grid */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.035) 1px,transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />

          {/* edges */}
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            {edges.map(([a, b], i) => {
              const isFlow = i === flowIdx;
              return (
                <path
                  key={i}
                  d={edgePath(a, b)}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth={isFlow ? 1.5 : 1.25}
                  strokeDasharray={isFlow ? "4 8" : undefined}
                  opacity={isFlow ? 1 : 0.4}
                  style={{
                    filter: isFlow ? `drop-shadow(0 0 6px rgba(200,255,61,0.45))` : "none",
                    animation: isFlow ? "flow-anim 1.6s linear infinite" : undefined,
                    transition: "opacity .35s, stroke-width .35s",
                  }}
                />
              );
            })}
          </svg>

          {/* Nodes (positioned in same coordinate system as SVG viewBox via percent) */}
          {nodes.map((n) => {
            const live = "live" in n.pos && n.pos.live;
            return (
              <div
                key={n.id}
                className="absolute rounded-[12px]"
                style={{
                  left:  `${(n.pos.x / VIEW_W) * 100}%`,
                  top:   `${(n.pos.y / VIEW_H) * 100}%`,
                  width: `${(NODE_W / VIEW_W) * 100}%`,
                  background: live ? "#1F2A14" : "#1E2118",
                  border: `1px solid ${live ? "rgba(200,255,61,0.35)" : "rgba(255,255,255,0.08)"}`,
                  padding: "14px 16px",
                  color: PAPER,
                  boxShadow: live ? `0 0 0 1px rgba(200,255,61,0.15), 0 12px 30px -8px ${ACCENT}` : "none",
                  transition: "border-color .3s, box-shadow .3s",
                }}
              >
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] mb-1.5" style={{ color: "#7F7E72" }}>
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background: live ? ACCENT : "#3F4538",
                      boxShadow: live ? `0 0 8px rgba(200,255,61,0.45)` : "none",
                    }}
                  />
                  {n.tag}
                </div>
                <div className="text-[15px] font-medium tracking-[-0.01em] mb-2.5" style={{ color: PAPER }}>
                  {n.title}
                </div>
                <div className="text-[12px] leading-[1.45]" style={{ color: "#B8B6A8" }}>
                  {n.body}
                </div>
              </div>
            );
          })}

          {/* Side panel */}
          <div
            className="absolute top-[18px] right-[18px] w-[220px] rounded-[10px] px-4 py-3.5"
            style={{
              background: "rgba(20,22,16,0.85)",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <h5 className="m-0 mb-3 text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: "#7F7E72" }}>
              Live state
            </h5>
            {[
              ["Best APY", "9.31%", "up"],
              ["Position", "Morpho", ""],
              ["Used",     "12.4 USDC", ""],
              ["Remaining","37.6 USDC", "up"],
            ].map(([lab, val, kind]) => (
              <div
                key={lab}
                className="flex justify-between items-center py-[7px] text-[12px]"
                style={{ borderBottom: "1px dashed rgba(255,255,255,0.06)" }}
              >
                <span style={{ color: "#B8B6A8" }}>{lab}</span>
                <span className="tickup" style={{ color: kind === "up" ? ACCENT : PAPER }}>{val}</span>
              </div>
            ))}
          </div>

          {/* Bottom pills */}
          <div
            className="absolute left-[18px] bottom-[18px] flex gap-2.5 items-center text-[11px] uppercase tracking-[0.08em]"
            style={{ color: "#7F7E72" }}
          >
            <span
              className="px-2.5 py-[5px] rounded-full"
              style={{ background: "rgba(200,255,61,0.05)", border: `1px solid rgba(200,255,61,0.3)`, color: ACCENT }}
            >
              Agent running
            </span>
            <span
              className="px-2.5 py-[5px] rounded-full"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              0.01 USDC / cycle
            </span>
            <span
              className="px-2.5 py-[5px] rounded-full"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Base mainnet
            </span>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes flow-anim { to { stroke-dashoffset: -24; } }
      `}</style>
    </div>
  );
}

function Meta({ num, label }: { num: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="text-[30px] tracking-[-0.02em]"
        style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: INK, textTransform: "none" }}
      >
        {num}
      </span>
      <span style={{ color: "#6B6A60" }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Protocol & API Logo Marks — inline SVG, 18×18 viewBox
// ─────────────────────────────────────────────────────────

function MorphoLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* Morpho pill / lens mark */}
      <ellipse cx="9" cy="9" rx="5" ry="8" stroke="white" strokeWidth="1.6" fill="none" />
      <ellipse cx="9" cy="9" rx="8" ry="5" stroke="white" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

function UniswapLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* Simplified unicorn / diamond */}
      <path d="M9 2L15 9L9 16L3 9Z" fill="white" opacity="0.9" />
      <circle cx="9" cy="9" r="2" fill="#FF007A" />
    </svg>
  );
}

function AerodromeLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* Stylized A / aerodrome wing */}
      <path d="M9 2L16 14H12L9 8L6 14H2L9 2Z" fill="white" opacity="0.9" />
      <rect x="5.5" y="11" width="7" height="1.5" fill="white" opacity="0.5" />
    </svg>
  );
}

function LidoLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* Shield */}
      <path d="M9 2L15 5V10C15 13.5 12 16 9 16C6 16 3 13.5 3 10V5L9 2Z" fill="none" stroke="white" strokeWidth="1.5" />
      <path d="M9 6L12 8V10.5C12 12 10.7 13 9 13C7.3 13 6 12 6 10.5V8L9 6Z" fill="white" opacity="0.8" />
    </svg>
  );
}

function SkyLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* Sky / DAI S */}
      <text x="4" y="14" fontSize="13" fontWeight="700" fill="white" fontFamily="sans-serif">S</text>
    </svg>
  );
}

function VeniceLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* V mark */}
      <path d="M2 3L9 15L16 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function TavilyLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* Search / compass T */}
      <circle cx="8.5" cy="8.5" r="5.5" stroke="white" strokeWidth="1.6" fill="none" />
      <path d="M12.5 12.5L16 16" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BaseLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* Base blue circle B */}
      <circle cx="9" cy="9" r="7" fill="white" opacity="0.1" stroke="white" strokeWidth="1.4" />
      <path d="M7 5.5H10C11.4 5.5 12.5 6.4 12.5 7.6C12.5 8.5 11.8 9.2 10.9 9.5C12 9.7 12.8 10.5 12.8 11.5C12.8 12.8 11.6 13.5 10 13.5H7V5.5Z" fill="white" opacity="0.9" />
    </svg>
  );
}

function MetaMaskLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* Fox ears / trapezoid */}
      <path d="M2 13L5 6L9 10L13 6L16 13H11.5L9 10.5L6.5 13H2Z" fill="white" opacity="0.9" />
      <path d="M5 6L9 3L13 6" fill="white" opacity="0.6" />
    </svg>
  );
}

function OneShotLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* Bullet / arrow mark for 1Shot */}
      <circle cx="9" cy="9" r="5" fill="#C8FF3D" />
      <path d="M7 9H13M13 9L10 6M13 9L10 12" stroke="#0B0C09" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function X402Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      {/* HTTP 402 payment mark */}
      <text x="2" y="11" fontSize="9" fontWeight="700" fill="#C8FF3D" fontFamily="monospace">402</text>
      <path d="M2 13H16" stroke="#C8FF3D" strokeWidth="1.2" strokeDasharray="2 2" />
    </svg>
  );
}
