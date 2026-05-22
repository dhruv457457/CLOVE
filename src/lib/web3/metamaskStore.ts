"use client";

import {
  connectWallet,
  getConnectedAccounts,
  requestUsdcPermission,
  revokePermissionOnChain,
  savePermission,
  loadPermission,
  clearPermission,
  type GrantedPermission,
  type RevocationResult,
} from "./permissions";
import { terminalStore } from "@/lib/walletEmulator";

export type MetaMaskMode = "disconnected" | "connecting" | "connected" | "flask";

export interface MetaMaskState {
  mode: MetaMaskMode;
  isFlask: boolean; // kept for compat but always true — MM v12+ supports ERC-7715 natively
  userAddress: `0x${string}` | null;
  sessionAddress: `0x${string}` | null;
  permission: GrantedPermission | null;
  isRevoking: boolean;
}

type Listener = () => void;

class MetaMaskStore {
  private state: MetaMaskState = {
    mode: "disconnected",
    isFlask: true,
    userAddress: null,
    sessionAddress: null,
    permission: loadPermission(),
    isRevoking: false,
  };

  private listeners = new Set<Listener>();

  getState() { return this.state; }

  addListener(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() { this.listeners.forEach(fn => fn()); }

  private log(type: Parameters<typeof terminalStore.addLog>[0], message: string) {
    terminalStore.addLog(type, message);
  }

  async init() {
    const accounts = await getConnectedAccounts();
    const userAddress = accounts[0] ?? null;

    this.state = {
      ...this.state,
      isFlask: true,
      userAddress,
      mode: userAddress ? "connected" : "disconnected",
    };
    this.notify();

    if (userAddress) await this.fetchSessionAddress();
  }

  async connect() {
    this.state = { ...this.state, mode: "connecting" };
    this.notify();

    try {
      const address = await connectWallet();
      if (!address) throw new Error("No account selected");

      this.state = {
        ...this.state,
        userAddress: address,
        isFlask: true,
        mode: "connected",
      };
      this.notify();
      this.log("success", `Connected: ${address}`);
      await this.fetchSessionAddress();
    } catch (e) {
      this.log("error", `Connection failed: ${e instanceof Error ? e.message : e}`);
      this.state = { ...this.state, mode: "disconnected" };
      this.notify();
    }
  }

  private async fetchSessionAddress() {
    try {
      const res = await fetch("/api/session/address");
      if (!res.ok) return;
      const { address, source } = await res.json();
      this.state = { ...this.state, sessionAddress: address };
      this.notify();
      this.log("info", `CLOVE session account (${source}): ${address}`);
    } catch { /* non-fatal */ }
  }

  async requestPermission(budgetUsdc: string, periodDays: number, justification: string) {
    if (!this.state.userAddress || !this.state.sessionAddress) {
      this.log("error", "Connect MetaMask first.");
      return;
    }

    this.log("info", `Requesting ERC-7715 permission: ${budgetUsdc} USDC / ${periodDays}-day period`);

    try {
      const permission = await requestUsdcPermission(
        this.state.sessionAddress,
        budgetUsdc,
        periodDays,
        justification
      );

      savePermission(permission);
      this.state = { ...this.state, permission };
      this.notify();

      this.log("success", `ERC-7715 permission granted!`);
      this.log("meta", `Context: ${permission.permissionsContext.slice(0, 32)}…`);
      this.log("meta", `DelegationManager: ${permission.delegationManager}`);
      this.log("meta", `Expires: ${new Date(permission.expiresAt * 1000).toLocaleDateString()}`);

      // Store in 1Shot API (best-effort)
      fetch("/api/x402/store-delegation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permissionsContext: permission.permissionsContext,
          expiresAt: permission.expiresAt,
        }),
      })
        .then(r => r.json())
        .then(d => {
          if (d.delegationId) {
            this.log("meta", `Stored in 1Shot: ${d.delegationId}`);
            const updated = { ...permission, delegationId: d.delegationId };
            savePermission(updated);
            this.state = { ...this.state, permission: updated };
            this.notify();
          }
        })
        .catch(() => {});
    } catch (e) {
      this.log("error", `Permission request failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async revokeOnChain(): Promise<RevocationResult | null> {
    const { permission, userAddress } = this.state;
    if (!permission) { this.log("error", "No active permission to revoke."); return null; }
    if (!userAddress) { this.log("error", "Connect MetaMask first."); return null; }

    this.state = { ...this.state, isRevoking: true };
    this.notify();
    this.log("warning", "Initiating on-chain revocation — MetaMask will prompt for approval…");

    try {
      const result = await revokePermissionOnChain(permission, userAddress);
      clearPermission();
      this.state = { ...this.state, permission: null, isRevoking: false };
      this.notify();
      this.log("success", `Delegation revoked on-chain ✓`);
      this.log("meta", `TxHash: ${result.txHash}`);
      this.log("meta", `DelegationHash: ${result.delegationHash}`);
      return result;
    } catch (e) {
      this.state = { ...this.state, isRevoking: false };
      this.notify();
      this.log("error", `Revocation failed: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  clearLocalPermission() {
    clearPermission();
    this.state = { ...this.state, permission: null };
    this.log("warning", "Permission cleared locally (not revoked on-chain).");
    this.notify();
  }

  disconnect() {
    clearPermission();
    this.state = {
      mode: "disconnected",
      isFlask: true,
      userAddress: null,
      sessionAddress: null,
      permission: null,
      isRevoking: false,
    };
    this.notify();
  }
}

export const metamaskStore = new MetaMaskStore();
