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

/** Internal server-to-server secret used to authenticate internal CLOVE calls. */
export function getInternalSecret(): string {
  return requireEnv("CLOVE_INTERNAL_SECRET");
}

/** Internal secret if configured, else undefined (non-throwing — for comparisons). */
export function getInternalSecretOptional(): string | undefined {
  const v = process.env.CLOVE_INTERNAL_SECRET;
  return v && v.trim() !== "" ? v.trim() : undefined;
}
