"use client";

import { useEffect } from "react";
import { metamaskStore } from "@/lib/web3/metamaskStore";

/**
 * Silently re-connects the wallet on every page load by calling
 * MetaMask's `eth_accounts` (non-prompting).  Placed in the root
 * layout so it runs on every route without re-mounting.
 */
export function WalletAutoInit() {
  useEffect(() => {
    // Only attempt if MetaMask is present in the browser
    if (typeof window !== "undefined" && window.ethereum) {
      metamaskStore.init();
    }
  }, []);

  return null;
}
