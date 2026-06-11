import "server-only";

/**
 * EIP-7702 account upgrade VIA the 1Shot permissionless relayer.
 *
 * The 1Shot track requires: "use 7702 authorizations to upgrade accounts to
 * smart accounts through 1Shot Permissionless relayer." Proven in scripts/
 * spike-7702.mjs — the relayer accepts a top-level `authorizationList` on
 * relayer_send7710Transaction and upgrades the EOA in-flight.
 *
 * This builds the authorizationList entry for an account, ONCE — it returns null
 * if the account already has code (already upgraded), so it's a safe no-op on
 * every call after the first. The entry is included in the existing relayer
 * submission; nothing else about the redemption changes.
 */

import { createPublicClient, createWalletClient, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import { CHAIN } from "./config";

const RPC = process.env.BASE_RPC ?? CHAIN.rpcUrls.default.http[0];

/** EIP-7702 authorizationList entry shape the 1Shot relayer accepts. */
export interface RelayerAuthorization {
  chainId: string;
  address: `0x${string}`;
  nonce:   `0x${string}`;
  yParity: `0x${string}`;
  r:       `0x${string}`;
  s:       `0x${string}`;
}

/**
 * Build a 7702 authorization to upgrade `address` (owned by `privateKey`) to the
 * MetaMask Stateless7702 delegator implementation — UNLESS it already has code.
 *
 * @returns the authorizationList entry, or null if already upgraded / on error.
 */
export async function build7702Authorization(
  privateKey: `0x${string}`,
  chainId: number,
): Promise<RelayerAuthorization | null> {
  try {
    const env  = getSmartAccountsEnvironment(chainId);
    const impl = (env.implementations as Record<string, string>).EIP7702StatelessDeleGatorImpl as `0x${string}`;
    if (!impl) return null;

    const account = privateKeyToAccount(privateKey);
    const pub     = createPublicClient({ chain: CHAIN, transport: http(RPC) });

    // Already a smart account? → nothing to do (no-op after first upgrade).
    const code = await pub.getCode({ address: account.address });
    if (code && code !== "0x") return null;

    // SPONSORED authorization: the relayer submits the type-4 tx, so the nonce
    // must equal the EOA's CURRENT nonce (no executor: "self").
    const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });
    const auth   = await wallet.signAuthorization({ contractAddress: impl });

    return {
      chainId: String(chainId),
      address: impl,
      nonce:   toHex(BigInt(auth.nonce)),
      yParity: toHex(BigInt(auth.yParity ?? 0)),
      r:       auth.r,
      s:       auth.s,
    };
  } catch (e) {
    console.warn("[upgrade7702] could not build authorization (skipping):", e instanceof Error ? e.message : e);
    return null;
  }
}
