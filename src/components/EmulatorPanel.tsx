"use client";

import React, { useState, useEffect } from "react";
import { Shield, Check, Cpu, Layers } from "lucide-react";
import { EmulatorState } from "@/lib/walletEmulator";

interface EmulatorPanelProps {
  state: EmulatorState;
  onUpgrade: () => void;
  onDeposit: (amount: number) => void;
  onReset: () => void;
  pendingPermissionRequest: {
    to: string;
    tokenSymbol: string;
    amount: string;
    justification: string;
    onApprove: () => void;
    onReject: () => void;
  } | null;
}

export default function EmulatorPanel({
  state,
  onUpgrade,
  onDeposit,
  onReset,
  pendingPermissionRequest
}: EmulatorPanelProps) {
  const [depositAmount, setDepositAmount] = useState("100");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <div className="flex flex-col w-full border border-[rgba(21,133,105,0.2)] bg-[#0a0f0c] rounded-xl overflow-hidden">
      
      {/* Emulator Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#080d0a] border-b border-[rgba(21,133,105,0.15)]">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-[#1aad89]" />
          <span className="font-bold tracking-tight text-[10px] uppercase text-[#7aad97]">Agent Emulator</span>
        </div>
        <button
          onClick={onReset}
          className="text-[9px] px-2 py-0.5 rounded border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors"
        >
          RESET
        </button>
      </div>

      {/* Emulator Dashboard */}
      <div className="p-4 space-y-4 flex-1">
        
        {/* Connection state — defer to client to avoid hydration mismatch */}
        <div className="p-3.5 rounded-lg border border-[rgba(21,133,105,0.15)] bg-[rgba(7,7,15,0.5)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase font-mono text-[#3d6655]">Connected Account</span>
            {mounted && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                state.isUpgraded
                  ? "bg-[rgba(21,133,105,0.12)] text-[#1aad89]"
                  : "bg-[rgba(255,255,255,0.05)] text-[#3d6655]"
              }`}>
                {state.isUpgraded ? "SMART ACCOUNT" : "EOA WALLET"}
              </span>
            )}
          </div>

          <div className="font-mono text-xs text-[#c4c4e8] mb-3 bg-[rgba(0,0,0,0.5)] p-2 rounded break-all select-all border border-[rgba(21,133,105,0.15)]">
            {mounted ? (state.isUpgraded ? state.smartAccountAddress : state.ownerAddress) : state.ownerAddress}
          </div>

          {/* Balances Grid — client-only to avoid hydration mismatch with live state */}
          {mounted && (
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded bg-[rgba(0,0,0,0.4)] border border-[rgba(21,133,105,0.1)]">
                <span className="text-[9px] uppercase font-mono text-[#3d6655] block mb-0.5">USDC</span>
                <span className="text-sm font-bold text-[#edfaf5] font-mono">
                  ${state.usdcBalance.toFixed(2)}
                </span>
              </div>
              <div className="p-2.5 rounded bg-[rgba(0,0,0,0.4)] border border-[rgba(21,133,105,0.1)]">
                <span className="text-[9px] uppercase font-mono text-[#3d6655] block mb-0.5">ETH</span>
                <span className="text-sm font-bold text-[#edfaf5] font-mono">
                  {state.ethBalance.toFixed(3)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Emulator Actions */}
        <div className="space-y-2">
          <h4 className="text-[10px] font-mono uppercase text-[#3d6655] tracking-wider">Emulator Controls</h4>

          {/* EIP-7702 Upgrade — client-only to avoid hydration */}
          {mounted && (!state.isUpgraded ? (
            <button
              onClick={onUpgrade}
              className="w-full py-2 px-3 rounded-lg border border-dashed border-[rgba(21,133,105,0.4)] hover:border-[rgba(21,133,105,0.8)] bg-[rgba(21,133,105,0.05)] hover:bg-[rgba(21,133,105,0.04)] text-xs font-semibold text-[#1aad89] flex items-center justify-center gap-2 transition-all"
            >
              <Cpu size={12} />
              Upgrade to Smart Account (EIP-7702)
            </button>
          ) : (
            <div className="py-2 px-3 rounded-lg border border-[rgba(21,133,105,0.2)] bg-[rgba(21,133,105,0.08)] text-xs text-[#1aad89] flex items-center gap-2">
              <Check size={12} />
              Smart Account upgraded!
            </div>
          ))}

          {/* Deposit simulator */}
          <div className="flex gap-2">
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-lg border border-[rgba(21,133,105,0.2)] bg-[rgba(0,0,0,0.5)] text-xs font-mono text-[#c4c4e8] focus:outline-none focus:border-[rgba(21,133,105,0.5)] transition-colors"
              placeholder="Amount"
            />
            <button
              onClick={() => onDeposit(parseFloat(depositAmount) || 0)}
              className="px-3 py-1.5 rounded-lg bg-[rgba(21,133,105,0.2)] hover:bg-[rgba(21,133,105,0.35)] text-xs font-semibold text-[#1aad89] transition-colors border border-[rgba(21,133,105,0.3)]"
            >
              Deposit
            </button>
          </div>
        </div>

        {/* Active execution permissions */}
        <div className="space-y-2">
          <h4 className="text-[10px] font-mono uppercase text-[#3d6655] tracking-wider">Active Permissions</h4>
          {state.permissions.length === 0 ? (
            <div className="text-[10px] text-[#3d6655] italic font-mono bg-[rgba(0,0,0,0.2)] p-3 rounded border border-[rgba(21,133,105,0.1)]">
              No active permissions delegated.
            </div>
          ) : (
            state.permissions.map((perm) => (
              <div
                key={perm.contextId}
                className="p-3 rounded-lg border border-[rgba(21,133,105,0.2)] bg-[rgba(21,133,105,0.04)] flex flex-col gap-1 text-[11px]"
              >
                <div className="flex items-center justify-between text-[9px] uppercase font-mono text-[#1aad89] font-bold mb-0.5">
                  <span>Periodic Budget (ERC-7715)</span>
                  <span className="text-[#3d6655] font-normal">Active</span>
                </div>
                <div className="text-[#edfaf5] font-mono">
                  Limit: {perm.permission.data.periodAmount} {perm.permission.data.tokenSymbol} / day
                </div>
                <div className="text-[#3d6655] text-[10px] truncate">
                  Session to: {perm.to}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ERC-7715 POPUP OVERLAY */}
      {pendingPermissionRequest && (
        <div className="absolute inset-0 bg-[rgba(0,0,0,0.88)] flex flex-col justify-end p-4 z-50">
          <div className="w-full bg-[#0a0f0c] border border-[rgba(21,133,105,0.35)] rounded-xl p-4 shadow-2xl space-y-4">

            {/* Header */}
            <div className="flex items-center gap-3 border-b border-[rgba(21,133,105,0.15)] pb-3.5">
              <div className="w-9 h-9 rounded-full bg-[rgba(21,133,105,0.15)] flex items-center justify-center border border-[rgba(21,133,105,0.3)]">
                <Shield className="text-[#1aad89] w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-[#edfaf5] tracking-tight leading-4">Signature Request</h3>
                <span className="text-[10px] text-[#1aad89] font-mono font-bold tracking-wider uppercase">Grant ERC-7715 Permission</span>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-2 p-3 rounded-lg bg-[rgba(0,0,0,0.5)] border border-[rgba(21,133,105,0.15)] font-mono text-[11px] leading-5">
              <div className="flex justify-between">
                <span className="text-[#3d6655]">Permission:</span>
                <span className="text-[#1aad89] font-bold">ERC-20 Periodic Allowance</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#3d6655]">Allowance:</span>
                <span className="text-[#edfaf5] font-bold">{pendingPermissionRequest.amount} {pendingPermissionRequest.tokenSymbol} / day</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#3d6655]">Duration:</span>
                <span className="text-[#edfaf5] font-bold">7 Days (Auto-Expiry)</span>
              </div>
              <div className="flex flex-col pt-1 border-t border-[rgba(21,133,105,0.1)] mt-1">
                <span className="text-[#3d6655]">Justification:</span>
                <span className="text-[#7aad97] italic block mt-0.5 text-[10px]">"{pendingPermissionRequest.justification}"</span>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                onClick={pendingPermissionRequest.onReject}
                className="flex-1 py-2 px-3 rounded-lg border border-[rgba(255,255,255,0.1)] text-xs font-semibold text-[#7aad97] hover:text-[#edfaf5] hover:bg-[rgba(255,255,255,0.05)] transition-all"
              >
                Reject
              </button>
              <button
                onClick={pendingPermissionRequest.onApprove}
                className="flex-1 py-2 px-3 rounded-lg bg-[#158569] hover:bg-[#1aad89] text-xs font-bold text-white transition-all shadow-[0_0_20px_rgba(21,133,105,0.4)]"
              >
                Approve &amp; Sign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
