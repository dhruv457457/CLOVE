"use client";

import React, { useState, useRef, useEffect } from "react";
import { Zap, RefreshCw, ChevronDown } from "lucide-react";

const PRESETS = [
  {
    label: "Aave Compounder",
    prompt: "Every hour, check Aave USDC APY on Base. If above 8%, compound rewards back into supply. Notify via Telegram.",
  },
  {
    label: "Morpho Yield Scout",
    prompt: "Daily, scout Morpho vaults for highest USDC yield. Move funds to best-performing vault. Budget 50 USDC.",
  },
  {
    label: "ETH DCA Buyer",
    prompt: "Every day, use 10 USDC to buy ETH via Uniswap V3 on Base if ETH price drops below $3200. Notify before execution.",
  },
  {
    label: "Sky Savings",
    prompt: "Hourly, deposit idle USDC into Sky sUSDS savings vault for stablecoin yield. Budget 100 USDC/day.",
  },
  {
    label: "Lido Staking",
    prompt: "Weekly, wrap stETH to wstETH via Lido to capture non-rebasing yield. Alert me after each wrap.",
  },
];

interface StrategyPromptBarProps {
  onCompile: (prompt: string) => void;
  isCompiling: boolean;
}

export default function StrategyPromptBar({ onCompile, isCompiling }: StrategyPromptBarProps) {
  const [prompt, setPrompt] = useState("");
  const [showPresets, setShowPresets] = useState(false);
  const presetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (presetRef.current && !presetRef.current.contains(e.target as Node)) {
        setShowPresets(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) { onCompile(prompt.trim()); setShowPresets(false); }
  };

  const handlePreset = (p: string) => {
    setPrompt(p);
    setShowPresets(false);
    onCompile(p);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 rounded-xl border border-[rgba(21,133,105,0.2)] bg-[#0a0f0c] px-3 py-2"
    >
      {/* Prompt input */}
      <input
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Describe a new strategy… e.g. 'Scout highest Morpho yield daily, auto-compound'"
        className="flex-1 bg-transparent text-[12px] font-mono text-[#c4c4e8] placeholder-[#3d6655] focus:outline-none"
        disabled={isCompiling}
      />

      {/* Preset picker */}
      <div className="relative flex-shrink-0" ref={presetRef}>
        <button
          type="button"
          onClick={() => setShowPresets(v => !v)}
          className="flex items-center gap-1 text-[10px] font-mono text-[#3d6655] hover:text-[#7aad97] px-2 py-1 rounded border border-[rgba(21,133,105,0.15)] hover:border-[rgba(21,133,105,0.3)] transition-all"
        >
          Templates <ChevronDown size={9} />
        </button>

        {showPresets && (
          <div className="absolute right-0 top-full mt-1 w-64 bg-[#0a0f0c] border border-[rgba(21,133,105,0.25)] rounded-xl shadow-2xl z-50 overflow-hidden">
            {PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => handlePreset(p.prompt)}
                className="w-full text-left px-3 py-2.5 hover:bg-[rgba(21,133,105,0.08)] transition-colors border-b border-[rgba(21,133,105,0.08)] last:border-0"
              >
                <span className="block text-[11px] font-bold text-[#edfaf5]">{p.label}</span>
                <span className="block text-[9px] text-[#3d6655] mt-0.5 line-clamp-1">{p.prompt}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Compile button */}
      <button
        type="submit"
        disabled={isCompiling || !prompt.trim()}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#158569] hover:bg-[#1aad89] disabled:opacity-40 text-[10px] font-bold font-mono text-white transition-all flex-shrink-0"
      >
        {isCompiling
          ? <><RefreshCw size={10} className="animate-spin" /> Compiling…</>
          : <><Zap size={10} fill="white" /> Compile</>
        }
      </button>
    </form>
  );
}
