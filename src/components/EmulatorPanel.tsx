"use client";

import React, { useState, useEffect } from "react";
import {
  Wallet, Shield, RefreshCw, Zap,
  XCircle, CheckCircle, Copy, ExternalLink, Unlock,
} from "lucide-react";
import { metamaskStore, type MetaMaskState } from "@/lib/web3/metamaskStore";

export default function PermissionPanel() {
  const [state, setState] = useState<MetaMaskState>(metamaskStore.getState());
  const [budgetInput, setBudgetInput] = useState("50");
  const [periodInput, setPeriodInput] = useState("30");
  const [requesting, setRequesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    metamaskStore.init();
    return metamaskStore.addListener(() => setState({ ...metamaskStore.getState() }));
  }, []);

  const { mode, userAddress, sessionAddress, permission, isRevoking } = state;

  const handleConnect = () => metamaskStore.connect();

  const handleGrant = async () => {
    setRequesting(true);
    await metamaskStore.requestPermission(
      budgetInput,
      parseInt(periodInput),
      `Authorise CLOVE to autonomously execute DeFi strategies up to ${budgetInput} USDC every ${periodInput} days.`
    );
    setRequesting(false);
  };

  const handleRevokeOnChain = () => metamaskStore.revokeOnChain();
  const handleClearLocal   = () => metamaskStore.clearLocalPermission();

  const copyContext = async () => {
    if (!permission) return;
    await navigator.clipboard.writeText(permission.permissionsContext);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-full border border-[rgba(21,133,105,0.2)] bg-[#0a0f0c] rounded-xl overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#080d0a] border-b border-[rgba(21,133,105,0.15)]">
        <div className="flex items-center gap-2">
          <Shield size={13} className="text-[#1aad89]" />
          <span className="text-[10px] font-bold uppercase tracking-wide text-[#7aad97]">
            ERC-7715 Permission
          </span>
        </div>
        {(mode === "flask" || mode === "connected") && (
          <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-[rgba(21,133,105,0.3)] text-[#1aad89] font-mono font-bold">MM</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Not connected ── */}
        {mode === "disconnected" || mode === "connecting" ? (
          <div className="space-y-3">
            <p className="text-[11px] text-[#3d6655] leading-5">
              Connect MetaMask to grant CLOVE a recurring USDC budget for autonomous strategy execution.
            </p>
            <button
              onClick={handleConnect}
              disabled={mode === "connecting"}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-[#158569] hover:bg-[#1aad89] disabled:opacity-50 text-xs font-bold text-white transition-all"
            >
              {mode === "connecting"
                ? <><RefreshCw size={11} className="animate-spin" /> Connecting…</>
                : <><Wallet size={11} /> Connect MetaMask</>
              }
            </button>
          </div>
        ) : (
          <>
            {/* Connected account */}
            <div className="space-y-2">
              <span className="text-[9px] uppercase font-mono text-[#3d6655]">Your Wallet</span>
              <div className="font-mono text-[10px] text-[#c4c4e8] bg-[rgba(0,0,0,0.5)] px-2 py-1.5 rounded border border-[rgba(21,133,105,0.15)] break-all select-all">
                {userAddress}
              </div>
            </div>

            {/* CLOVE session account */}
            {sessionAddress && (
              <div className="space-y-1">
                <span className="text-[9px] uppercase font-mono text-[#3d6655]">CLOVE Agent (1Shot)</span>
                <div className="font-mono text-[9px] text-[#7aad97] bg-[rgba(0,0,0,0.5)] px-2 py-1.5 rounded border border-[rgba(21,133,105,0.1)] break-all select-all">
                  {sessionAddress}
                </div>
                <p className="text-[8px] text-[#3d6655]">Grant permission TO this address ↑</p>
              </div>
            )}

            {/* ── Active permission ── */}
            {permission ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg border border-[rgba(21,133,105,0.3)] bg-[rgba(21,133,105,0.05)] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle size={11} className="text-[#1aad89]" />
                      <span className="text-[10px] font-bold text-[#1aad89] font-mono">ACTIVE</span>
                    </div>
                    <span className="text-[8px] text-[#3d6655] font-mono">
                      Expires {new Date(permission.expiresAt * 1000).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Budget */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded bg-[rgba(0,0,0,0.4)] border border-[rgba(21,133,105,0.12)]">
                      <span className="block text-[8px] uppercase font-mono text-[#3d6655] mb-0.5">Budget</span>
                      <span className="text-sm font-bold text-[#edfaf5] font-mono">{permission.budgetUsdc}</span>
                      <span className="text-[8px] text-[#3d6655] ml-1 font-mono">USDC</span>
                    </div>
                    <div className="p-2 rounded bg-[rgba(0,0,0,0.4)] border border-[rgba(21,133,105,0.12)]">
                      <span className="block text-[8px] uppercase font-mono text-[#3d6655] mb-0.5">Period</span>
                      <span className="text-sm font-bold text-[#edfaf5] font-mono">{permission.periodDays}</span>
                      <span className="text-[8px] text-[#3d6655] ml-1 font-mono">days</span>
                    </div>
                  </div>

                  {/* Permission context */}
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[8px] uppercase font-mono text-[#3d6655] flex-shrink-0">Context</span>
                      <button onClick={copyContext} className="flex items-center gap-1 text-[8px] text-[#3d6655] hover:text-[#1aad89] transition-colors flex-shrink-0">
                        <Copy size={9} />
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <div className="font-mono text-[8px] text-[#7aad97]/60 bg-[rgba(0,0,0,0.5)] px-2 py-1.5 rounded border border-[rgba(21,133,105,0.1)] overflow-hidden">
                      <span className="block truncate">{permission.permissionsContext.slice(0, 36)}…</span>
                    </div>
                  </div>

                  {/* Delegation manager */}
                  {permission.delegationManager && permission.delegationManager !== "0x" ? (
                    <div className="space-y-0.5 min-w-0">
                      <span className="text-[8px] uppercase font-mono text-[#3d6655]">DelegationManager</span>
                      <a
                        href={`https://sepolia.basescan.org/address/${permission.delegationManager}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-mono text-[8px] text-[#7aad97]/60 hover:text-[#1aad89] transition-colors min-w-0"
                      >
                        <span className="truncate">{permission.delegationManager.slice(0, 20)}…</span>
                        <ExternalLink size={8} className="flex-shrink-0" />
                      </a>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <span className="text-[8px] uppercase font-mono text-[#3d6655]">DelegationManager</span>
                      <span className="block text-[8px] font-mono text-[#3d6655]">Via MetaMask wallet</span>
                    </div>
                  )}

                  {/* 1Shot delegation ID */}
                  {permission.delegationId && (
                    <div className="space-y-0.5 min-w-0">
                      <span className="text-[8px] uppercase font-mono text-[#3d6655]">1Shot Delegation</span>
                      <span className="block font-mono text-[8px] text-[#7aad97]/60 truncate">{permission.delegationId}</span>
                    </div>
                  )}
                </div>

                {/* Revocation actions */}
                <div className="space-y-2">
                  <button
                    onClick={handleRevokeOnChain}
                    disabled={isRevoking}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 disabled:opacity-40 text-xs font-bold text-red-400 transition-all"
                  >
                    {isRevoking
                      ? <><RefreshCw size={11} className="animate-spin" /> Revoking on-chain…</>
                      : <><XCircle size={11} /> Revoke On-Chain</>
                    }
                  </button>
                  <button
                    onClick={handleClearLocal}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg border border-[rgba(255,255,255,0.07)] text-[9px] text-[#3d6655] hover:text-[#7aad97] hover:border-[rgba(255,255,255,0.12)] transition-all"
                  >
                    <Unlock size={9} />
                    Clear local only
                  </button>
                </div>
              </div>
            ) : (
              /* ── Grant permission form ── */
              <div className="space-y-3">
                <p className="text-[11px] text-[#3d6655] leading-5">
                  Grant CLOVE a recurring USDC budget to autonomously execute your strategy.
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[8px] uppercase font-mono text-[#3d6655] mb-1">Budget (USDC)</label>
                    <input
                      type="number"
                      value={budgetInput}
                      onChange={e => setBudgetInput(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-[rgba(21,133,105,0.2)] bg-[rgba(0,0,0,0.5)] text-xs font-mono text-[#c4c4e8] focus:outline-none focus:border-[rgba(21,133,105,0.5)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[8px] uppercase font-mono text-[#3d6655] mb-1">Period (days)</label>
                    <input
                      type="number"
                      value={periodInput}
                      onChange={e => setPeriodInput(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-[rgba(21,133,105,0.2)] bg-[rgba(0,0,0,0.5)] text-xs font-mono text-[#c4c4e8] focus:outline-none focus:border-[rgba(21,133,105,0.5)]"
                    />
                  </div>
                </div>

                <div className="p-2 rounded border border-[rgba(21,133,105,0.12)] bg-[rgba(21,133,105,0.03)] text-[9px] text-[#3d6655] font-mono space-y-0.5">
                  <div className="flex justify-between"><span>Type:</span><span className="text-[#7aad97]">ERC-20 Periodic</span></div>
                  <div className="flex justify-between"><span>Token:</span><span className="text-[#7aad97]">USDC (Base Sepolia)</span></div>
                  <div className="flex justify-between"><span>Delegate to:</span><span className="text-[#7aad97]">{sessionAddress ? `${sessionAddress.slice(0,8)}…` : "loading…"}</span></div>
                </div>

                <button
                  onClick={handleGrant}
                  disabled={requesting || !sessionAddress}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-[#158569] hover:bg-[#1aad89] disabled:opacity-40 text-xs font-bold text-white transition-all shadow-[0_0_16px_rgba(21,133,105,0.3)]"
                >
                  {requesting
                    ? <><RefreshCw size={11} className="animate-spin" /> Requesting in MetaMask…</>
                    : <><Zap size={11} fill="white" /> Grant ERC-7715 Permission</>
                  }
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
