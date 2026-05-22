import "server-only";

import { OneShotClient } from "@1shotapi/client-sdk";

let _client: OneShotClient | null = null;

export function getOneShotClient(): OneShotClient {
  if (_client) return _client;

  const apiKey = process.env.ONESHOT_API_KEY;
  const apiSecret = process.env.ONESHOT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      "ONESHOT_API_KEY and ONESHOT_API_SECRET must be set in environment variables."
    );
  }

  _client = new OneShotClient({ apiKey, apiSecret });
  return _client;
}
