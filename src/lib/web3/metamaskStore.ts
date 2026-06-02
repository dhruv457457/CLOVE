"use client";

import {
  connectWallet,
  getConnectedAccounts,
  requestRelayerPermission,
  revokePermissionOnChain,
  type GrantedPermission,
  type RevocationResult,
} from "./permissions";

const terminalStore = {
  addLog(_type: "info" | "success" | "warning" | "error" | "meta", message: string) {
    if (typeof console !== "undefined") console.log(`[mm:${_type}]`, message);
  },
};

// "flask" mode removed — ERC-7715 is supported by MetaMask v12+ without Flask.
export type MetaMaskMode = "disconnected" | "connecting" | "connected";

export interface MetaMaskState {
  mode:           MetaMaskMode;
  userAddress:    `0x${string}` | null;
  sessionAddress: `0x${string}` | null;
  permission:     GrantedPermission | null;
  isRevoking:     boolean;
}

type Listener = () => void;

class MetaMaskStore {
  private state: MetaMaskState = {
    mode:           "disconnected",
    userAddress:    null,
    sessionAddress: null,
    permission:     null,   // loaded async from MongoDB after wallet connects
    isRevoking:     false,
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
      userAddress,
      mode: userAddress ? "connected" : "disconnected",
    };
    this.notify();

    if (userAddress) {
      await Promise.all([
        this.fetchSessionAddress(),
        this.fetchPermissionFromDb(userAddress),
      ]);
    }
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
        mode: "connected",
      };
      this.notify();
      this.log("success", `Connected: ${address}`);
      await Promise.all([
        this.fetchSessionAddress(),
        this.fetchPermissionFromDb(address),
      ]);
    } catch (e) {
      this.log("error", `Connection failed: ${e instanceof Error ? e.message : e}`);
      this.state = { ...this.state, mode: "disconnected" };
      this.notify();
    }
  }

  /** Load the stored ERC-7715 permission from MongoDB for the given wallet. */
  private async fetchPermissionFromDb(walletAddress: `0x${string}`) {
    try {
      const res = await fetch(`/api/permission?wallet=${encodeURIComponent(walletAddress)}`);
      if (!res.ok) return;
      const data = await res.json() as { permission: GrantedPermission | null };
      if (data.permission) {
        this.state = { ...this.state, permission: data.permission };
        this.notify();
        this.log("info", `Permission loaded from DB (${data.permission.budgetUsdc} USDC)`);
      }
    } catch { /* non-fatal */ }
  }

  /** Persist permission to MongoDB (server-side). */
  private async persistPermissionToDb(permission: GrantedPermission) {
    const wallet = this.state.userAddress;
    if (!wallet) return;
    try {
      await fetch("/api/permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet, permission }),
      });
    } catch { /* non-fatal */ }
  }

  /** Delete permission from MongoDB. */
  private async deletePermissionFromDb() {
    const wallet = this.state.userAddress;
    if (!wallet) return;
    try {
      await fetch(`/api/permission?wallet=${encodeURIComponent(wallet)}`, { method: "DELETE" });
    } catch { /* non-fatal */ }
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

    this.log("info", `Requesting DeFi delegation: ${budgetUsdc} USDC / ${periodDays}-day period`);

    try {
      // FunctionCall-scoped delegation → relayer can call approve + supply/deposit/swap.
      // This is what enables REAL protocol deposits (not just transfers).
      const permission = await requestRelayerPermission(budgetUsdc, periodDays);

      // Persist to MongoDB first (authoritative store)
      await this.persistPermissionToDb(permission);
      this.state = { ...this.state, permission };
      this.notify();

      this.log("success", `ERC-7715 permission granted!`);
      this.log("meta", `Context (${permission.permissionsContext.length} chars): ${permission.permissionsContext.slice(0, 18)}…${permission.permissionsContext.slice(-16)}`);
      this.log("meta", `DelegationManager: ${permission.delegationManager}`);
      this.log("meta", `Expires: ${new Date(permission.expiresAt * 1000).toLocaleDateString()}`);

      // Store in 1Shot API (best-effort) — update DB if we get a delegationId back
      fetch("/api/x402/store-delegation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permissionsContext: permission.permissionsContext,
          expiresAt:          permission.expiresAt,
        }),
      })
        .then(r => r.json())
        .then(async d => {
          if (d.delegationId) {
            this.log("meta", `Stored in 1Shot: ${d.delegationId}`);
            const updated = { ...permission, delegationId: d.delegationId };
            await this.persistPermissionToDb(updated);
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
      await this.deletePermissionFromDb();
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
    void this.deletePermissionFromDb();
    this.state = { ...this.state, permission: null };
    this.log("warning", "Permission cleared (removed from DB, not revoked on-chain).");
    this.notify();
  }

  disconnect() {
    this.state = {
      mode:           "disconnected",
      userAddress:    null,
      sessionAddress: null,
      permission:     null,
      isRevoking:     false,
    };
    this.notify();
  }
}

export const metamaskStore = new MetaMaskStore();
