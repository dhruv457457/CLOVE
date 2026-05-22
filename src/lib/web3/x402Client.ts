"use client";

import { GrantedPermission } from "./permissions";

export interface X402PaymentResult {
  success: boolean;
  data?: unknown;
  txHash?: string;
  error?: string;
  costUsdc?: number;
}

/**
 * Calls a server-side API route that handles x402 payment + redemption.
 * The server uses the CLOVE session key to redelegate and pay.
 */
export async function callX402Endpoint(
  endpoint: string,
  permission: GrantedPermission
): Promise<X402PaymentResult> {
  try {
    const res = await fetch("/api/x402/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint,
        permissionsContext: permission.permissionsContext,
        delegationManager: permission.delegationManager,
        // Pass 1Shot delegation ID if available (preferred path — 1Shot handles signing)
        ...(permission.delegationId ? { delegationId: permission.delegationId } : {}),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error ?? "Request failed" };
    }

    const data = await res.json();
    return { success: true, data, costUsdc: 0.01 };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

/** Simulated x402 call for demo mode (no MetaMask Flask required). */
export async function callX402EndpointDemo(
  endpoint: string
): Promise<X402PaymentResult> {
  await new Promise((r) => setTimeout(r, 800 + Math.random() * 400));
  return {
    success: true,
    costUsdc: 0.01,
    data: {
      yields: {
        aave: { usdc: 8.42 + Math.random() * 0.5 },
        compound: { usdc: 7.85 + Math.random() * 0.3 },
        morpho: { usdc: 9.12 + Math.random() * 0.6 },
        sky: { usdc: 8.91 + Math.random() * 0.4 },
      },
      recommended: "morpho",
      timestamp: Date.now(),
    },
  };
}
