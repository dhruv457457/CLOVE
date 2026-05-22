"use client";

import React from "react";
import { CheckCircle, XCircle, DollarSign, Clock, TrendingUp, X, Newspaper, Globe } from "lucide-react";

export interface ExecutionResult {
  timestamp: number;
  success: boolean;
  protocol?: string;
  action?: string;
  costUsdc?: number;
  bestApy?: number;
  recommended?: string;
  txHash?: string;
  calldata?: string;
  error?: string;
  // Enriched intelligence
  strategyImageUrl?: string;
  newsHeadline?: string;
  newsUrl?: string;
  tavilyAnswer?: string;
  sources?: Record<string, boolean>;
}

interface ExecutionSummaryProps {
  result: ExecutionResult;
  onClose: () => void;
}

export default function ExecutionSummary({ result, onClose }: ExecutionSummaryProps) {
  const timeStr = new Date(result.timestamp).toLocaleTimeString();

  return (
    <div className="rounded-xl border border-[rgba(21,133,105,0.25)] bg-[#0a0f0c] p-4 space-y-3 relative">
      <button onClick={onClose} className="absolute top-3 right-3 text-[#3d6655] hover:text-[#7aad97]">
        <X size={13} />
      </button>

      {/* Status header */}
      <div className="flex items-center gap-2">
        {result.success
          ? <CheckCircle size={14} className="text-[#1aad89]" />
          : <XCircle    size={14} className="text-red-400"    />
        }
        <span className={`text-[12px] font-bold ${result.success ? "text-[#1aad89]" : "text-red-400"}`}>
          {result.success ? "Cycle Complete" : "Execution Failed"}
        </span>
        <span className="text-[9px] font-mono text-[#3d6655] ml-auto flex items-center gap-1">
          <Clock size={9} /> {timeStr}
        </span>
      </div>

      {result.error && (
        <p className="text-[10px] text-red-400 bg-red-500/5 border border-red-500/15 rounded p-2 font-mono">{result.error}</p>
      )}

      {/* fal.ai strategy visualization */}
      {result.strategyImageUrl && (
        <div className="rounded-lg overflow-hidden border border-[rgba(21,133,105,0.2)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.strategyImageUrl}
            alt="AI-generated strategy visualization"
            className="w-full h-28 object-cover"
          />
          <div className="px-2 py-1 flex items-center gap-1 bg-[rgba(0,0,0,0.6)]">
            <span className="text-[7px] font-mono text-[#3d6655]">Strategy visualization by</span>
            <span className="text-[7px] font-mono font-bold text-[#f472b6]">fal.ai</span>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        {result.costUsdc !== undefined && (
          <div className="p-2 rounded bg-[rgba(0,0,0,0.4)] border border-[rgba(21,133,105,0.12)] text-center">
            <DollarSign size={10} className="text-amber-400 mx-auto mb-0.5" />
            <span className="block text-[10px] font-bold font-mono text-[#edfaf5]">${result.costUsdc.toFixed(3)}</span>
            <span className="block text-[8px] text-[#3d6655] font-mono">x402 paid</span>
          </div>
        )}
        {result.bestApy !== undefined && (
          <div className="p-2 rounded bg-[rgba(0,0,0,0.4)] border border-[rgba(21,133,105,0.12)] text-center">
            <TrendingUp size={10} className="text-[#1aad89] mx-auto mb-0.5" />
            <span className="block text-[10px] font-bold font-mono text-[#edfaf5]">{result.bestApy}%</span>
            <span className="block text-[8px] text-[#3d6655] font-mono">best APY</span>
          </div>
        )}
        {result.recommended && (
          <div className="p-2 rounded bg-[rgba(0,0,0,0.4)] border border-[rgba(21,133,105,0.12)] text-center">
            <span className="block text-[9px] font-bold font-mono text-[#edfaf5] capitalize truncate">{result.recommended}</span>
            <span className="block text-[8px] text-[#3d6655] font-mono mt-0.5">protocol</span>
          </div>
        )}
      </div>

      {/* Intelligence sources used */}
      {result.sources && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[8px] font-mono text-[#3d6655]">Intelligence via:</span>
          {result.sources.venice && <span className="text-[7px] font-mono px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-400">Venice AI</span>}
          {result.sources.tavily && <span className="text-[7px] font-mono px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">Tavily</span>}
          {result.sources.exa    && <span className="text-[7px] font-mono px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-400">Exa</span>}
        </div>
      )}

      {/* Tavily market intelligence */}
      {result.tavilyAnswer && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Globe size={9} className="text-cyan-400" />
            <span className="text-[8px] uppercase font-mono text-[#3d6655]">Market Intelligence (Tavily)</span>
          </div>
          <p className="text-[9px] text-[#7aad97] leading-relaxed bg-[rgba(6,182,212,0.04)] border border-cyan-500/10 rounded px-2 py-1.5">
            {result.tavilyAnswer.slice(0, 180)}{result.tavilyAnswer.length > 180 ? "…" : ""}
          </p>
        </div>
      )}

      {/* Crypto news headline */}
      {result.newsHeadline && (
        <div className="flex items-start gap-1.5">
          <Newspaper size={9} className="text-[#3d6655] mt-0.5 flex-shrink-0" />
          <a
            href={result.newsUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] text-[#3d6655] hover:text-[#7aad97] transition-colors leading-snug"
          >
            {result.newsHeadline}
          </a>
        </div>
      )}

      {/* Tx hash or prepared calldata */}
      {result.txHash ? (
        <div className="space-y-1">
          <span className="text-[8px] uppercase font-mono text-[#3d6655]">Transaction</span>
          <a
            href={`https://sepolia.basescan.org/tx/${result.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block font-mono text-[9px] text-[#1aad89] hover:underline break-all"
          >
            {result.txHash.slice(0, 24)}…
          </a>
        </div>
      ) : result.calldata ? (
        <div className="space-y-1">
          <span className="text-[8px] uppercase font-mono text-[#3d6655]">Prepared Calldata</span>
          <div className="font-mono text-[8px] text-[#7aad97]/50 bg-[rgba(0,0,0,0.5)] px-2 py-1.5 rounded border border-[rgba(21,133,105,0.1)] break-all">
            {result.calldata.slice(0, 48)}…
          </div>
        </div>
      ) : null}
    </div>
  );
}
