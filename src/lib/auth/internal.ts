import "server-only";

/**
 * Server-to-server internal auth — replaces the old x402 "payment" wrapper.
 *
 * CLOVE's own routes (intelligence, media generation) are called by the agent
 * runtime, not by users. They were previously gated behind a simulated x402
 * payment; now they require a simple shared internal secret instead.
 */

const HEADER = "x-internal-secret";

/** Headers to attach when calling an internal CLOVE endpoint server-side. */
export function internalHeaders(): Record<string, string> {
  return { [HEADER]: process.env.CLOVE_INTERNAL_SECRET ?? "" };
}

/** True if the request carries the correct internal secret. Fail-closed. */
export function isInternalRequest(req: Request): boolean {
  const secret = process.env.CLOVE_INTERNAL_SECRET;
  if (!secret) return false;
  return req.headers.get(HEADER) === secret;
}
