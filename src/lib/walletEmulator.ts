/**
 * Minimal terminal log store.
 * All wallet/permission state is now in src/lib/web3/metamaskStore.ts.
 */

export interface TerminalLog {
  id: string;
  timestamp: string;
  type: "info" | "success" | "warning" | "error" | "code" | "meta";
  message: string;
  details?: string;
}

type Listener = () => void;

class TerminalLogStore {
  private logs: TerminalLog[] = [];
  private listeners = new Set<Listener>();

  getLogs() { return this.logs; }

  addListener(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() { this.listeners.forEach(fn => fn()); }

  addLog(type: TerminalLog["type"], message: string, details?: string) {
    const log: TerminalLog = {
      id: Math.random().toString(36).slice(2),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      details,
    };
    this.logs = [...this.logs.slice(-200), log];
    this.notify();
  }

  clearLogs() { this.logs = []; this.notify(); }
}

export const terminalStore = new TerminalLogStore();

// Re-export under old name so imports still compile during transition
export const walletEmulator = terminalStore;
