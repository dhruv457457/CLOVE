import "server-only";

import OpenAI from "openai";

/**
 * Venice API client — OpenAI-compatible, privacy-first LLM.
 *
 * Two auth modes:
 *   1. API key   (VENICE_API_KEY set) — standard Bearer token, billed to your account
 *   2. x402      (VENICE_X402=true)   — pay per request in USDC on Base via the user's
 *                                        ERC-7715 delegation; no Venice account needed
 *
 * In x402 mode the client issues unauthenticated requests; callers must intercept the
 * 402 response and settle via the x402 pay route before retrying.
 */
export function getVeniceClient(): OpenAI {
  const apiKey = process.env.VENICE_API_KEY || "x402-no-key"; // || catches empty string too

  return new OpenAI({
    apiKey,
    baseURL: "https://api.venice.ai/api/v1",
    defaultHeaders: {
      // Disable Venice's system prompt injection — CLOVE controls all prompts
      "X-Venice-Include-System-Prompt": "false",
    },
  });
}

/** Venice models used in CLOVE */
export const VENICE_MODELS = {
  /** Fast strategy compiler — good balance of speed + quality */
  compiler: "qwen3-5-9b",
  /** Deep reasoning for yield analysis and strategy decisions */
  analyst: "zai-org-glm-5-1",
  /** Cheap + fast for simple classification / extraction */
  fast: "llama-3.2-3b",
} as const;
