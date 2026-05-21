/**
 * High-Fidelity MetaMask Smart Account, ERC-7715 Advanced Permissions,
 * ERC-7710 Delegations, and x402 Programmatic API Payments Emulator.
 *
 * Keeps state in localStorage to persist between refreshes, providing a seamless
 * developer testing surface for autonomous DeFi agent transactions.
 */

export interface Erc7715Permission {
  chainId: number;
  to: string; // session account
  expiry: number; // unix timestamp
  permission: {
    type: "erc20-token-periodic";
    data: {
      tokenAddress: string;
      tokenSymbol: string;
      periodAmount: string; // e.g. "10.00"
      periodDuration: number; // in seconds (e.g. 86400 = 1 day)
      justification: string;
    };
  };
  contextId: string; // Base64 permission context
}

export interface EmulatorState {
  ownerAddress: string;
  smartAccountAddress: string;
  isUpgraded: boolean; // EIP-7702 status
  usdcBalance: number; // simulated USDC balance
  ethBalance: number; // simulated ETH balance
  permissions: Erc7715Permission[];
  relayerTargetAddress: string; // 1Shot public relayer target
  feeCollectorAddress: string; // 1Shot fee collector
}

export interface TerminalLog {
  id: string;
  timestamp: string;
  type: "info" | "success" | "warning" | "error" | "code" | "meta";
  message: string;
  details?: string;
}

const DEFAULT_STATE: EmulatorState = {
  ownerAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  smartAccountAddress: "0xC104E948493d5c9e2F60d26f5321C6Af5E92402",
  isUpgraded: false,
  usdcBalance: 250.00,
  ethBalance: 0.15,
  permissions: [],
  relayerTargetAddress: "0x22221ShotRelayerTargetAddress84532",
  feeCollectorAddress: "0x11111ShotFeeCollectorAddress84532"
};

class WalletEmulatorStore {
  private state: EmulatorState;
  private logs: TerminalLog[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("clove_emulator_state");
      this.state = saved ? { ...DEFAULT_STATE, ...JSON.parse(saved) } : DEFAULT_STATE;
    } else {
      this.state = DEFAULT_STATE;
    }
  }

  public getState(): EmulatorState {
    return this.state;
  }

  public getLogs(): TerminalLog[] {
    return this.logs;
  }

  public addListener(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    if (typeof window !== "undefined") {
      localStorage.setItem("clove_emulator_state", JSON.stringify(this.state));
    }
    this.listeners.forEach((l) => l());
  }

  public reset() {
    this.state = { ...DEFAULT_STATE };
    this.logs = [];
    this.addLog("info", "Emulator state reset to default configurations.");
    this.notify();
  }

  public addLog(type: TerminalLog["type"], message: string, details?: string) {
    const log: TerminalLog = {
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      details
    };
    this.logs = [...this.logs, log].slice(-150); // Keep last 150 logs
    this.notify();
  }

  public clearLogs() {
    this.logs = [];
    this.notify();
  }

  /**
   * Simulates upgrading EOA to MetaMask Smart Account via EIP-7702
   */
  public triggerEip7702Upgrade() {
    if (this.state.isUpgraded) {
      this.addLog("info", "Account already upgraded to EIP-7702 Smart Account.");
      return;
    }

    this.addLog("info", "Initiating EIP-7702 Stateless Delegator upgrade signature request...");
    this.state.isUpgraded = true;
    this.addLog("success", `EIP-7702 Upgrade Confirmed! EOA ${this.state.ownerAddress} upgraded to MetaMask Smart Account.`);
    this.addLog("meta", `Implementation: EIP7702StatelessDelegatorImpl -> Smart Account: ${this.state.smartAccountAddress}`);
    this.notify();
  }

  /**
   * Simulates requesting ERC-7715 Advanced Execution Permissions
   */
  public requestPermissions(
    toSessionAddress: string,
    tokenAddress: string,
    tokenSymbol: string,
    periodAmount: string,
    justification: string
  ): Promise<Erc7715Permission> {
    return new Promise((resolve) => {
      this.addLog("info", `Requesting ERC-7715 execution permission for session: ${toSessionAddress.slice(0, 10)}...`);
      this.addLog("meta", `Details: Period Limit ${periodAmount} ${tokenSymbol}/day. Justification: "${justification}"`);

      // Upgrade in-flight if not already done
      if (!this.state.isUpgraded) {
        this.addLog("warning", "EIP-7702 Smart Account not detected. Upgrading account automatically in-flight...");
        this.state.isUpgraded = true;
        this.addLog("success", "EOA upgraded in-flight to Smart Account.");
      }

      const expiry = Math.floor(Date.now() / 1000) + 604800; // 1 week
      const contextId = btoa(JSON.stringify({
        chainId: 84532,
        to: toSessionAddress,
        expiry,
        tokenAddress,
        periodAmount
      }));

      const newPermission: Erc7715Permission = {
        chainId: 84532,
        to: toSessionAddress,
        expiry,
        permission: {
          type: "erc20-token-periodic",
          data: {
            tokenAddress,
            tokenSymbol,
            periodAmount,
            periodDuration: 86400, // 1 day
            justification
          }
        },
        contextId
      };

      // Add to list, replacing old permissions to same session
      this.state.permissions = [
        ...this.state.permissions.filter((p) => p.to.toLowerCase() !== toSessionAddress.toLowerCase()),
        newPermission
      ];

      this.addLog("success", `ERC-7715 Permission Granted! Context Hash: ${contextId.slice(0, 20)}...`);
      this.notify();
      resolve(newPermission);
    });
  }

  /**
   * Simulates executing a DeFi step via x402 payment and 1Shot relayer
   */
  public async executeAgentAction(
    actionName: string,
    usdcCost: number,
    workDescription: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    this.addLog("info", `[Agent Trigger] Initiating automated strategy: "${actionName}"`);

    // 1. Check ERC-7715 permissions
    if (this.state.permissions.length === 0) {
      this.addLog("error", "Execution Failed: No active ERC-7715 execution permission found. Agent unauthorized.");
      return { success: false, error: "Unauthorized" };
    }

    const perm = this.state.permissions[0];
    const maxDaily = parseFloat(perm.permission.data.periodAmount);
    
    this.addLog("info", `Verifying active ERC-7715 budget...`);
    this.addLog("meta", `USDC Budget Available: ${maxDaily.toFixed(2)} USDC/day. Requested: ${(usdcCost).toFixed(2)} USDC.`);

    if (usdcCost > maxDaily) {
      this.addLog("error", `Execution Failed: Requested amount (${usdcCost} USDC) exceeds daily approved budget (${maxDaily} USDC).`);
      return { success: false, error: "Budget Exceeded" };
    }

    if (this.state.usdcBalance < usdcCost) {
      this.addLog("error", `Execution Failed: Insufficient USDC balance in smart account. Current: ${this.state.usdcBalance.toFixed(2)} USDC.`);
      return { success: false, error: "Insufficient Balance" };
    }

    // 2. Simulate x402 Payment Challenge
    this.addLog("info", `GET /api/premium-yields-report -> HTTP 402 Payment Required`);
    this.addLog("warning", `Server challenge: x402-v2 required. Pay 0.01 USDC to ${this.state.ownerAddress}`);

    // 3. Create EIP-7710 Smart Account Delegation
    this.addLog("info", "Generating EIP-7710 Delegation chain signed by Smart Account...");
    const signedDelegation = {
      from: this.state.smartAccountAddress,
      to: this.state.relayerTargetAddress,
      scope: {
        type: "Erc20TransferAmount",
        tokenAddress: perm.permission.data.tokenAddress,
        maxAmount: "10000" // 0.01 USDC
      },
      caveats: [
        {
          type: "Redeemer",
          redeemers: [this.state.relayerTargetAddress]
        }
      ],
      signature: "0x7710aee4dcb89e835b375346b22b9b..."
    };

    const permissionContext = btoa(JSON.stringify([signedDelegation]));
    this.addLog("meta", `EIP-7710 Permission Context Encoded: ${permissionContext.slice(0, 32)}...`);

    // 4. Submit to 1Shot Relayer via relayer_send7710Transaction
    this.addLog("info", "Submitting gasless transaction bundle to 1Shot Public Relayer...");
    this.addLog("code", `JSON-RPC Call:\nrelayer_send7710Transaction({\n  chainId: 84532,\n  context: "${perm.contextId.slice(0, 16)}...",\n  transactions: [{\n    permissionContext: "${permissionContext.slice(0, 16)}...",\n    executions: [FeeTransfer, primaryAction]\n  }]\n})`);

    // Deduct cost and save
    this.state.usdcBalance -= usdcCost;
    this.notify();

    // Simulate relayer status updates
    await new Promise(r => setTimeout(r, 1000));
    this.addLog("info", "Relayer status: 110 (Submitted) -> Transaction broadcast to network.");
    
    const txHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    
    await new Promise(r => setTimeout(r, 1000));
    this.addLog("success", `Relayer status: 200 (Confirmed)! Gasless transaction successfully mined.`);
    this.addLog("meta", `TxHash: ${txHash.slice(0, 24)}...`);
    this.addLog("success", `Strategy Execution Completed successfully! ${workDescription}`);

    this.notify();
    return { success: true, txHash };
  }

  public depositUsdc(amount: number) {
    this.state.usdcBalance += amount;
    this.addLog("success", `Deposited ${amount.toFixed(2)} USDC to smart account.`);
    this.notify();
  }
}

export const walletEmulator = new WalletEmulatorStore();
export default walletEmulator;
