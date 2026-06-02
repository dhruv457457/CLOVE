import "server-only";

/**
 * Centralized server-side environment access.
 * ────────────────────────────────────────────
 * One place that reads secrets. Each accessor THROWS ON USE if its variable is
 * missing or malformed — never silently falls back to a publicly-known Hardhat
 * test key/address. The app still boots; only the request that actually needs a
 * missing secret fails, with a clear message pointing at .env.local.example.
 *
 * Why "throw on use" and not "throw at import": unrelated routes keep working
 * with partial config (dev-friendly), and the failure surfaces exactly where the
 * secret is required instead of taking the whole process down at boot.
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `[config] Missing required environment variable: ${name}. ` +
        `Set it in .env.local (see .env.local.example).`,
    );
  }
  return v.trim();
}

/**
 * Server session signing key. NO Hardhat fallback — an unset key must fail loudly
 * rather than sign with the world-known Anvil account #0 private key.
 * Only needed for the local-key delegation path (when 1Shot is not configured).
 */
export function getSessionPrivateKey(): `0x${string}` {
  const key = requireEnv("CLOVE_SESSION_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      "[config] CLOVE_SESSION_KEY must be a 0x-prefixed 32-byte hex private key.",
    );
  }
  return key as `0x${string}`;
}

/**
 * x402 revenue address. NO Hardhat fallback — unset means we must NOT route real
 * USDC to a publicly-known test address. Prefers the explicit payout address, then
 * the session address; throws if neither is a valid 20-byte address.
 */
export function getPayToAddress(): `0x${string}` {
  const addr =
    process.env.CLOVE_PAY_TO_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS?.trim();
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error(
      "[config] No x402 pay-to address. Set CLOVE_PAY_TO_ADDRESS or " +
        "NEXT_PUBLIC_CLOVE_SESSION_ADDRESS to a real 0x address.",
    );
  }
  return addr as `0x${string}`;
}

/** Internal server-to-server secret used to authenticate internal x402 calls. */
export function getInternalSecret(): string {
  return requireEnv("CLOVE_INTERNAL_SECRET");
}

/** Internal secret if configured, else undefined (non-throwing — for comparisons). */
export function getInternalSecretOptional(): string | undefined {
  const v = process.env.CLOVE_INTERNAL_SECRET;
  return v && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * Canonical x402 service prices (USDC). Single source so routes and the run loop
 * never disagree about what a call costs. The run loop should still prefer the
 * X-Clove-Cost response header (actual charged amount) over these defaults.
 */
export const X402_PRICES = {
  intelligence: 0.01,
  tts: 0.005,
  image: 0.01,
} as const;
