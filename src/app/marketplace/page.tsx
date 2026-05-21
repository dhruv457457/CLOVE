"use client";

import React, { useState } from "react";
import { ArrowRight, Zap, Filter, ShieldCheck, Heart, Search, BarChart2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface Strategy {
  id: string;
  name: string;
  creator: string;
  badge: string;
  badgeColor: string;
  description: string;
  tags: string[];
  nodesCount: number;
  likes: number;
  fee: string;
  prompt: string;
  runs: number;
}

const STRATEGIES: Strategy[] = [
  {
    id: "aave-vault-scout",
    name: "Aave V3 Health Factor Guardian",
    creator: "DeFiOracle.eth",
    badge: "Top rated",
    badgeColor: "#22d3ee",
    description: "Monitors Aave V3 lending pools hourly, harvests stablecoin interest, and compounds back automatically.",
    tags: ["Yield Farming", "Aave", "Auto-Harvest"],
    nodesCount: 5,
    likes: 312,
    fee: "0.01 USDC / execution",
    runs: 4182,
    prompt: "Hourly check, budget limit of 25.00 USDC, pay 0.01 USDC to premium intelligence API, execute yield supply to Aave, and send Telegram alert.",
  },
  {
    id: "safe-multisig-monitor",
    name: "Safe MultiSig Pending TX Decoder",
    creator: "Multisig.eth",
    badge: "Top used",
    badgeColor: "#e879f9",
    description: "Watches Safe wallets for pending transactions. Decodes call data, checks risk score, and notifies signers.",
    tags: ["Monitoring", "Safe", "Multisig"],
    nodesCount: 4,
    likes: 224,
    fee: "0.005 USDC / check",
    runs: 2890,
    prompt: "Hourly check, budget limit of 10 USDC, pay 0.005 USDC to Safe decoder API, check pending transactions, notify signers.",
  },
  {
    id: "multi-token-treasury",
    name: "Multi-Token Treasury Monitor",
    creator: "TreasuryDAO",
    badge: "Top rated",
    badgeColor: "#22d3ee",
    description: "Aggregates multi-token treasury balances, calculates 30d drift, auto-rebalances to target allocations.",
    tags: ["Treasury", "Multi-Token", "Rebalancing"],
    nodesCount: 6,
    likes: 421,
    fee: "0.02 USDC / rebalance",
    runs: 7632,
    prompt: "Daily check, budget 20 USDC, pay 0.02 USDC to treasury API, scan token balances, rebalance to target, notify.",
  },
  {
    id: "morpho-liquidation",
    name: "Morpho Liquidation Opportunity Scanner",
    creator: "QuantLabs",
    badge: "Free tier",
    badgeColor: "#1aad89",
    description: "Scans Morpho markets for liquidatable positions. Calculates profitability after gas, triggers flash-loan liquidation.",
    tags: ["Liquidation", "Morpho", "Flash Loans"],
    nodesCount: 5,
    likes: 189,
    fee: "Free (Profit-share)",
    runs: 1244,
    prompt: "Every 5 minutes, pay 0.01 USDC to morpho scanner, identify liquidation targets, execute gaslessly via 1Shot.",
  },
];

const FILTERS = ["All", "Yield", "Monitoring", "Arbitrage", "Liquidation"];

export default function Marketplace() {
  const router = useRouter();
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [likesState, setLikesState] = useState<Record<string, boolean>>({});

  const handleLike = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLikesState(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleDeploy = (prompt: string) => {
    localStorage.setItem("clove_imported_prompt", prompt);
    router.push("/dashboard");
  };

  const filtered = STRATEGIES.filter(s => {
    const matchFilter = filter === "All" || s.tags.some(t => t.toLowerCase().includes(filter.toLowerCase()));
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  return (
    <div className="min-h-screen bg-[#060a08] text-[#edfaf5] font-sans">

      {/* Navbar */}
      <header className="sticky top-0 z-50 border-b border-[rgba(21,133,105,0.15)] bg-[rgba(6,10,8,0.9)] backdrop-blur-md">
        <nav className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#158569] flex items-center justify-center">
              <Zap size={14} className="text-white" />
            </div>
            <span className="font-bold text-sm text-[#edfaf5]">CLOVE</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-[0.78rem] font-medium text-[#7aad97]">
            <a href="/" className="hover:text-[#edfaf5] transition-colors">Product</a>
            <a href="/marketplace" className="text-[#1aad89] border-b border-[#158569] pb-0.5">Marketplace</a>
            <a href="#" className="hover:text-[#edfaf5] transition-colors">Docs</a>
          </div>
          <a
            href="/dashboard"
            className="btn-violet text-xs px-4 py-1.5 rounded-full font-bold flex items-center gap-1.5"
          >
            Open App <ArrowRight size={11} />
          </a>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-14 space-y-10">

        {/* Hero */}
        <div className="space-y-3 max-w-2xl">
          <p className="section-label">WEB3 WORKFLOW TEMPLATES</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-[#edfaf5]">
            DeFi Agent{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(90deg, #1aad89, #22d3ee)" }}
            >
              Marketplace
            </span>
          </h1>
          <p className="text-sm leading-6 text-[#7aad97]">
            Browse community-scouted autonomous strategies. All blueprints are non-custodial and deploy in one click via ERC-7715 and x402.
          </p>
        </div>

        {/* Search + Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={13} className="text-[#1aad89]" />
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[11px] font-mono px-3 py-1.5 rounded-lg border transition-all ${
                  filter === f
                    ? "bg-[rgba(21,133,105,0.2)] border-[rgba(21,133,105,0.5)] text-[#1aad89]"
                    : "border-[rgba(255,255,255,0.07)] text-[#3d6655] hover:text-[#7aad97] hover:border-[rgba(255,255,255,0.12)]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3d6655]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="bg-[rgba(14,14,28,0.8)] border border-[rgba(21,133,105,0.2)] rounded-lg pl-8 pr-4 py-1.5 text-[11px] font-mono text-[#7aad97] placeholder-[#3d6655] focus:outline-none focus:border-[rgba(21,133,105,0.5)] w-52 transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-[rgba(21,133,105,0.1)] pb-4">
          <span className="text-[10px] font-mono text-[#3d6655]">
            Showing {filtered.length} verified strategy templates
          </span>
          <div className="flex items-center gap-2">
            <button className="text-[10px] font-mono px-3 py-1 rounded-lg bg-[rgba(21,133,105,0.15)] border border-[rgba(21,133,105,0.3)] text-[#1aad89]">
              Newest
            </button>
            <button className="text-[10px] font-mono px-3 py-1 rounded-lg border border-[rgba(255,255,255,0.07)] text-[#3d6655] hover:text-[#7aad97] transition-colors">
              Top used
            </button>
          </div>
        </div>

        {/* Strategy Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filtered.map((strategy) => {
            const isLiked = !!likesState[strategy.id];
            return (
              <div
                key={strategy.id}
                onClick={() => handleDeploy(strategy.prompt)}
                className="group relative flex flex-col justify-between border border-[rgba(21,133,105,0.18)] bg-[#0a0f0c] hover:border-[rgba(21,133,105,0.45)] rounded-xl p-6 cursor-pointer transition-all hover:shadow-[0_0_30px_rgba(21,133,105,0.1)] overflow-hidden"
              >
                {/* Top glow line on hover */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(21,133,105,0.5)] to-transparent scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />

                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[14px] font-bold text-[#edfaf5] group-hover:text-[#1aad89] transition-colors leading-snug">
                          {strategy.name}
                        </h3>
                      </div>
                      <p className="text-[10px] font-mono text-[#3d6655]">
                        by <span className="text-[#7aad97]">{strategy.creator}</span>
                      </p>
                    </div>
                    <span
                      className="flex-shrink-0 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border"
                      style={{
                        color: strategy.badgeColor,
                        borderColor: `${strategy.badgeColor}40`,
                        background: `${strategy.badgeColor}10`,
                      }}
                    >
                      {strategy.badge}
                    </span>
                  </div>

                  <p className="text-[12px] leading-5 text-[#7aad97]">{strategy.description}</p>

                  <div className="flex flex-wrap gap-1.5">
                    {strategy.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] font-mono text-[#3d6655] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-2 py-0.5 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-[rgba(21,133,105,0.1)] mt-5 pt-4">
                  <div className="flex items-center gap-3 text-[10px] font-mono text-[#3d6655]">
                    <span className="flex items-center gap-1">
                      <ShieldCheck size={11} className="text-[#22d3ee]" />
                      Audited
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <BarChart2 size={10} />
                      {strategy.runs.toLocaleString()} runs
                    </span>
                    <span>•</span>
                    <span>{strategy.nodesCount} nodes</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => handleLike(strategy.id, e)}
                      className={`p-1.5 rounded-lg border transition-colors ${
                        isLiked
                          ? "text-[#e879f9] border-[rgba(232,121,249,0.3)] bg-[rgba(232,121,249,0.08)]"
                          : "text-[#3d6655] border-[rgba(255,255,255,0.06)] hover:border-[rgba(232,121,249,0.2)]"
                          ? "text-[#1aad89] border-[rgba(21,133,105,0.3)] bg-[rgba(21,133,105,0.08)]"
                          : "text-[#3d6655] border-[rgba(255,255,255,0.06)] hover:border-[rgba(21,133,105,0.2)]"
                      }`}
                    >
                      <Heart size={12} fill={isLiked ? "currentColor" : "none"} />
                    </button>
                    <button
                      className="text-[10px] font-bold font-mono px-3 py-1.5 rounded-lg bg-[rgba(21,133,105,0.15)] border border-[rgba(21,133,105,0.3)] text-[#1aad89] hover:bg-[rgba(21,133,105,0.04)] flex items-center gap-1 transition-all group-hover:bg-[#158569] group-hover:text-white"
                    >
                      Deploy <ArrowRight size={10} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
