"use client";

import React, { useState, useEffect } from "react";
import { Search, Plus } from "lucide-react";
import { PROTOCOL_LOGOS } from "@/lib/protocols/logos";
import type { BlueprintNode, NodeType } from "@/lib/aiCompiler";

interface ProtocolCard {
  id:          string;
  name:        string;
  category:    "defi" | "intelligence" | "notify" | "system";
  description: string;
  nodeType:    NodeType;
  protocol?:   "morpho" | "uniswap" | "aerodrome" | "lido" | "sky";
  action?:     string;
  logoKey:     string;
  apy?:        number;
  color:       string;
}

const PROTOCOLS: ProtocolCard[] = [
  // DeFi
  { id: "morpho",    name: "Morpho",     category: "defi",         description: "Optimised USDC lending vault",   nodeType: "defi-lend",  protocol: "morpho",    action: "morpho-vault-deposit",          logoKey: "morpho",    color: "#2470ff" },
  { id: "uniswap",   name: "Uniswap V3", category: "defi",         description: "Token swap on Base DEX",         nodeType: "defi-swap",  protocol: "uniswap",   action: "uniswap-swap-exact-input",      logoKey: "uniswap",   color: "#FF007A" },
  { id: "aerodrome", name: "Aerodrome",  category: "defi",         description: "Base-native AMM liquidity",      nodeType: "defi-lp",    protocol: "aerodrome", action: "aerodrome-swap-exact-tokens",   logoKey: "aerodrome", color: "#ff6b00" },
  { id: "lido",      name: "Lido",       category: "defi",         description: "Wrap stETH → wstETH staking",   nodeType: "defi-stake", protocol: "lido",      action: "lido-wrap",                     logoKey: "lido",      color: "#00a3ff" },
  { id: "sky",       name: "Sky",        category: "defi",         description: "MakerDAO sUSDS savings rate",   nodeType: "defi-save",  protocol: "sky",       action: "sky-deposit",                   logoKey: "sky",       color: "#f4b731" },
  // Intelligence
  { id: "venice",    name: "Venice AI",  category: "intelligence", description: "AI yield reasoning via x402",   nodeType: "intelligence",         logoKey: "venice",   color: "#8B5CF6" },
  { id: "tavily",    name: "Tavily",     category: "intelligence", description: "Real-time web research",         nodeType: "intelligence-tavily",  logoKey: "tavily",   color: "#06B6D4" },
  { id: "exa",       name: "Exa",        category: "intelligence", description: "Semantic crypto search",         nodeType: "intelligence-exa",     logoKey: "exa",      color: "#A78BFA" },
  { id: "fal",       name: "fal.ai",     category: "intelligence", description: "AI image/video generation",     nodeType: "intelligence-fal",     logoKey: "fal",      color: "#F472B6" },
  // Notify
  { id: "telegram",  name: "Telegram",   category: "notify",       description: "Send strategy alerts to chat",  nodeType: "notify",               logoKey: "telegram", color: "#60A5FA" },
];

const CATEGORY_LABELS: Record<string, string> = {
  defi:         "WEB3 DEFI",
  intelligence: "INTELLIGENCE",
  notify:       "NOTIFICATIONS",
};

interface Props {
  onAddNode: (node: BlueprintNode) => void;
  liveApys?: Record<string, number>;
}

let nodeCounter = 1000;

function makeNode(card: ProtocolCard): BlueprintNode {
  nodeCounter++;
  return {
    id:          `${card.id}-${nodeCounter}`,
    type:        card.nodeType,
    label:       card.name,
    description: card.description,
    x:           300 + (nodeCounter % 5) * 220,
    y:           300,
    config:      { platform: card.name, action: card.action ?? "default" },
    protocol:    card.protocol,
    action:      card.action,
  };
}

export default function ProtocolSidebar({ onAddNode, liveApys = {} }: Props) {
  const [search, setSearch]   = useState("");
  const [added, setAdded]     = useState<Set<string>>(new Set());

  const filtered = PROTOCOLS.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description.toLowerCase().includes(search.toLowerCase())
  );

  const categories = ["defi", "intelligence", "notify"] as const;

  const handleAdd = (card: ProtocolCard) => {
    onAddNode(makeNode(card));
    setAdded(prev => new Set([...prev, card.id]));
    setTimeout(() => setAdded(prev => { const n = new Set(prev); n.delete(card.id); return n; }), 1500);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-[rgba(21,133,105,0.15)] flex-shrink-0">
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3d6655]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search actions..."
            className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-[rgba(21,133,105,0.2)] bg-[rgba(0,0,0,0.4)] text-[10px] font-mono text-[#7aad97] placeholder-[#3d6655] focus:outline-none focus:border-[rgba(21,133,105,0.5)]"
          />
        </div>
      </div>

      {/* Protocol grid */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {categories.map(cat => {
          const items = filtered.filter(p => p.category === cat);
          if (!items.length) return null;
          return (
            <div key={cat}>
              <p className="text-[8px] uppercase font-mono font-bold text-[#3d6655] tracking-widest mb-2 px-0.5">
                {CATEGORY_LABELS[cat]}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {items.map(card => {
                  const apy      = liveApys[card.id] ?? card.apy;
                  const isAdded  = added.has(card.id);
                  const logoUrl  = PROTOCOL_LOGOS[card.logoKey];
                  return (
                    <div
                      key={card.id}
                      className="flex flex-col gap-2 p-2.5 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(0,0,0,0.3)] hover:border-[rgba(21,133,105,0.3)] hover:bg-[rgba(21,133,105,0.04)] transition-all"
                    >
                      {/* Logo + Name */}
                      <div className="flex items-center gap-2">
                        {logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logoUrl}
                            alt={card.name}
                            width={20}
                            height={20}
                            className="rounded-md flex-shrink-0"
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                          />
                        ) : (
                          <div
                            className="w-5 h-5 rounded-md flex-shrink-0"
                            style={{ background: `${card.color}30`, border: `1px solid ${card.color}50` }}
                          />
                        )}
                        <span className="text-[10px] font-bold text-[#edfaf5] leading-tight truncate">{card.name}</span>
                      </div>

                      {/* APY badge */}
                      {apy && (
                        <span
                          className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded w-fit"
                          style={{ color: card.color, background: `${card.color}15`, border: `1px solid ${card.color}30` }}
                        >
                          {apy}% APY
                        </span>
                      )}

                      {/* Description */}
                      <p className="text-[8px] text-[#3d6655] leading-relaxed line-clamp-2">{card.description}</p>

                      {/* Add button */}
                      <button
                        onClick={() => handleAdd(card)}
                        className={`w-full flex items-center justify-center gap-1 py-1 rounded text-[9px] font-mono font-bold transition-all ${
                          isAdded
                            ? "bg-[rgba(21,133,105,0.2)] text-[#1aad89] border border-[rgba(21,133,105,0.4)]"
                            : "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-[#3d6655] hover:text-[#1aad89] hover:border-[rgba(21,133,105,0.3)]"
                        }`}
                      >
                        {isAdded ? <>✓ Added</> : <><Plus size={9} /> Add</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
