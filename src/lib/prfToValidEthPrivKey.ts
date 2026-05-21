/**
 * WebAuthn PRF → secp256k1 Ethereum private key derivation.
 * Browser-safe and uses only the Web Crypto API (crypto.subtle) and BigInt.
 */

export const SECP256K1_N = BigInt(
  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"
);

export function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function prfToValidEthPrivKey(
  prfOutput: ArrayBuffer,
  infoLabel: Uint8Array
): Promise<`0x${string}`> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    prfOutput,
    "HKDF",
    false,
    ["deriveBits"]
  );

  const salt = new Uint8Array(32); // 32 zero bytes

  for (let counter = 0; counter < 16; counter++) {
    const info = new Uint8Array(infoLabel.byteLength + 1);
    info.set(infoLabel, 0);
    info[infoLabel.byteLength] = counter;

    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      baseKey,
      8 * 32
    );
    const privBytes = new Uint8Array(bits);

    let n = 0n;
    for (const b of privBytes) n = (n << 8n) + BigInt(b);
    if (n === 0n) continue;
    if (n >= SECP256K1_N) continue;

    return `0x${bufToHex(privBytes.buffer)}` as `0x${string}`;
  }

  throw new Error("Failed to derive valid secp256k1 private key after 16 attempts");
}
