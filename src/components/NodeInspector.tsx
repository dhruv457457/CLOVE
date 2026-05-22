"use client";

import React from "react";
import { X, ExternalLink, Zap, DollarSign, Brain, TrendingUp, Bell } from "lucide-react";
import type { BlueprintNode } from "@/lib/aiCompiler";
import { PROTOCOL_METADATA } from "@/lib/protocols/actions";
import { UNISWAP_V3, MORPHO, LIDO, SKY, AERODROME } from "@/lib/protocols/addresses";

interface NodeInspectorProps {
  node: BlueprintNode;
  onClose: () => void;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  trigger:      <Zap       size={14} className="text-emerald-400" />,
  budget:       <DollarSign size={14} className="text-amber-400"   />,
  intelligence: <Brain      size={14} className="text-violet-400"  />,
  notify:       <Bell       size={14} className="text-blue-300"    />,
};

const PROTOCOL_CONTRACTS: Record<string, Record<string, string>> = {
  uniswap:   { "Swap Router": UNISWAP_V3.swapRouter[8453], "Quoter V2": UNISWAP_V3.quoter[8453] },
  morpho:    { "Morpho Blue": MORPHO.blue[8453], "Moonwell USDC Vault": MORPHO.vaults.MOONWELL_USDC },
  lido:      { "wstETH":      LIDO.wstETH[8453] },
  sky:       { "sUSDS":       SKY.sUSDS[8453]   },
  aerodrome: { "Router":      AERODROME.router[8453] },
};

export default function NodeInspector({ node, onClose }: NodeInspectorProps) {
  const protocolMeta = node.protocol ? PROTOCOL_METADATA[node.protocol] : null;
  const contracts = node.protocol ? PROTOCOL_CONTRACTS[node.protocol] : null;
  const icon = TYPE_ICONS[node.type] ?? <TrendingUp size={14} className="text-emerald-400" />;

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-[#0a0f0c] border-l border-[rgba(21,133,105,0.2)] z-20 flex flex-col shadow-2xl">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(21,133,105,0.15)] bg-[#080d0a]">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[12px] font-bold text-[#edfaf5]">{node.label}</span>
        </div>
        <button onClick={onClose} className="text-[#3d6655] hover:text-[#7aad97] transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Type + protocol badges */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[8px] font-mono font-bold px-2 py-0.5 rounded border border-[rgba(21,133,105,0.3)] text-[#1aad89] uppercase">{node.type}</span>
          {protocolMeta && (
            <span
              className="text-[8px] font-mono font-bold px-2 py-0.5 rounded uppercase"
              style={{ color: protocolMeta.color, background: `${protocolMeta.color}15`, border: `1px solid ${protocolMeta.color}30` }}
            >
              {protocolMeta.name}
            </span>
          )}
        </div>

        {/* Description */}
        <p className="text-[11px] text-[#7aad97] leading-5">{node.description}</p>

        {/* Config */}
        {Object.keys(node.config).length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[9px] uppercase font-mono text-[#3d6655] tracking-wider">Configuration</span>
            <div className="rounded-lg border border-[rgba(21,133,105,0.15)] bg-[rgba(0,0,0,0.4)] divide-y divide-[rgba(21,133,105,0.08)]">
              {Object.entries(node.config).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-3 py-2">
                  <span className="text-[9px] font-mono text-[#3d6655] capitalize">{k.replace(/_/g, " ")}</span>
                  <span className="text-[9px] font-mono text-[#c4c4e8] text-right max-w-[140px] truncate">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Protocol contracts */}
        {contracts && (
          <div className="space-y-1.5">
            <span className="text-[9px] uppercase font-mono text-[#3d6655] tracking-wider">Contracts (Base)</span>
            <div className="rounded-lg border border-[rgba(21,133,105,0.15)] bg-[rgba(0,0,0,0.4)] divide-y divide-[rgba(21,133,105,0.08)]">
              {Object.entries(contracts).map(([name, addr]) => (
                <div key={name} className="flex items-center justify-between px-3 py-2">
                  <span className="text-[9px] font-mono text-[#3d6655]">{name}</span>
                  <a
                    href={`https://basescan.org/address/${addr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[8px] font-mono text-[#7aad97]/60 hover:text-[#1aad89] transition-colors"
                  >
                    {addr.slice(0, 8)}…{addr.slice(-4)}
                    <ExternalLink size={7} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Protocol website */}
        {protocolMeta && (
          <a
            href={protocolMeta.website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[10px] font-mono text-[#3d6655] hover:text-[#1aad89] transition-colors"
          >
            <ExternalLink size={10} />
            {protocolMeta.website.replace("https://", "")}
          </a>
        )}
      </div>
    </div>
  );
}
