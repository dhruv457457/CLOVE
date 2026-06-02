"use client";

import { useState, useEffect } from "react";
import { detectWalletCapability, type WalletCapability } from "@/lib/web3/permissions";

/**
 * MetaMaskGate — wraps any component that needs ERC-7715 support.
 *
 * Shows a friendly blocking modal when:
 *   - MetaMask is not installed
 *   - MetaMask is installed but doesn't support ERC-7715 (not Flask / not v12+)
 *
 * Renders children immediately when capability is confirmed.
 */
export function MetaMaskGate({ children }: { children: React.ReactNode }) {
  const [cap, setCap] = useState<WalletCapability | null>(null);
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    detectWalletCapability().then(({ capability, version: v }) => {
      setCap(capability);
      setVersion(v);
      setChecking(false);
    });
  }, []);

  if (checking) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0B0C09", color: "#6F6E63", fontFamily: "system-ui", fontSize: 13 }}>
        Detecting wallet…
      </div>
    );
  }

  // MetaMask v12+ supports ERC-7715 Advanced Permissions without Flask.
  // Only show the install modal when MetaMask is completely absent.
  if (cap === "none") {
    return <FlaskRequiredModal installed={false} version={version} />;
  }

  return <>{children}</>;
}

/**
 * Inline badge shown next to the "Grant Permission" button.
 * Green check if ERC-7715 is available; amber warning if not.
 */
export function ERC7715Badge() {
  const [cap, setCap] = useState<WalletCapability | null>(null);

  useEffect(() => {
    detectWalletCapability().then(({ capability }) => setCap(capability));
  }, []);

  if (!cap) return null;

  const ok = cap !== "none" && cap !== null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, padding: "2px 8px", borderRadius: 999,
      background: ok ? "rgba(200,255,61,0.1)" : "rgba(242,184,92,0.12)",
      color: ok ? "#C8FF3D" : "#F2B85C",
      border: `1px solid ${ok ? "rgba(200,255,61,0.25)" : "rgba(242,184,92,0.3)"}`,
      fontFamily: "system-ui",
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />
      {ok ? (cap === "flask" ? "MetaMask Flask" : "Advanced Permissions") : "Flask required"}
    </span>
  );
}

function FlaskRequiredModal({ installed, version }: { installed: boolean; version: string }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(11,12,9,0.92)", backdropFilter: "blur(12px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
      fontFamily: "'Geist', system-ui, sans-serif",
    }}>
      <div style={{
        background: "#101109", border: "1px solid rgba(244,241,234,0.11)", borderRadius: 16,
        padding: "36px 40px", maxWidth: 480, width: "90%", color: "#E8E5DA",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, background: "rgba(242,184,92,0.1)",
            border: "1px solid rgba(242,184,92,0.25)", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20,
          }}>⚠️</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em" }}>
              MetaMask not detected
            </div>
            <div style={{ fontSize: 11, color: "#6F6E63", marginTop: 3, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              ERC-7715 Advanced Permissions
            </div>
          </div>
        </div>

        {/* Explanation */}
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#B5B2A5", margin: "0 0 20px" }}>
          CLOVE uses <strong style={{ color: "#E8E5DA" }}>ERC-7715 delegated permissions</strong> so agents
          can autonomously manage your DeFi portfolio without holding your private keys.
          Install MetaMask (v12+) to grant a permission and get started.
        </p>

        {installed && (
          <div style={{
            background: "rgba(242,184,92,0.07)", border: "1px solid rgba(242,184,92,0.2)",
            borderRadius: 8, padding: "10px 14px", marginBottom: 20, fontSize: 12.5, color: "#F2B85C",
          }}>
            MetaMask detected ({version.slice(0, 40)}) but Advanced Permissions are not available in this build.
          </div>
        )}

        {/* What Flask is */}
        <div style={{ fontSize: 12, color: "#6F6E63", marginBottom: 24, lineHeight: 1.6 }}>
          Flask is MetaMask&apos;s developer build. It&apos;s safe to install alongside regular MetaMask
          as a separate browser profile. Your existing accounts and seed phrase work in both.
        </div>

        {/* CTA */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <a
            href="https://metamask.io/download/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "12px 20px", borderRadius: 9, background: "#C8FF3D", color: "#0B0C09",
              fontWeight: 700, fontSize: 13.5, textDecoration: "none", letterSpacing: "-0.005em",
              transition: "transform .2s",
            }}
          >
            Install MetaMask →
          </a>
          <button
            onClick={() => setDismissed(true)}
            style={{
              padding: "10px 20px", borderRadius: 9, background: "none",
              border: "1px solid rgba(244,241,234,0.11)", color: "#6F6E63",
              fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Continue in view-only mode
          </button>
        </div>

        {/* Supported chains note */}
        <div style={{
          marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(244,241,234,0.06)",
          fontSize: 11, color: "#6F6E63", lineHeight: 1.6,
        }}>
          ERC-7715 is supported on <span style={{ color: "#B5B2A5" }}>Base mainnet (8453)</span> and{" "}
          <span style={{ color: "#B5B2A5" }}>Polygon (137)</span>.
          The MetaMask DelegationManager is deployed at{" "}
          <span style={{ fontFamily: "monospace", color: "#8F8E82" }}>0xdb9B…7dB3</span> on both chains.
        </div>
      </div>
    </div>
  );
}
