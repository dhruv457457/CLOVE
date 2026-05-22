import "server-only";

import { OneShotClient } from "@1shotapi/client-sdk";

// Don't singleton-cache: env vars could be updated and Next.js hot-reload
// wouldn't pick up the cached client. Create fresh per-request (SDK handles token caching internally).
export function getOneShotClient(): OneShotClient {
  const apiKey = process.env.ONESHOT_API_KEY;
  const apiSecret = process.env.ONESHOT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      "ONESHOT_API_KEY and ONESHOT_API_SECRET must be set in environment variables."
    );
  }

  return new OneShotClient({ apiKey, apiSecret });
}
