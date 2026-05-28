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
  /**
   * LLM-2 fix: full 70B model for reflection — insights are written to permanent
   * memory and affect every future plan, so quality matters here.
   */
  reasoning: "llama-3.3-70b",
  /**
   * Text-to-speech — Venice's Kokoro model.
   * Voices: af_heart (warm female, default), af_nova, am_echo, am_fenrir,
   *         bf_emma (British female), bm_george (British male)
   * Endpoint: POST /api/v1/audio/speech  (OpenAI-compatible)
   * Output: mp3 (response_format: "mp3")
   * No extra API key needed — uses VENICE_API_KEY.
   */
  tts: "tts-kokoro",
} as const;

export const VENICE_TTS_VOICES = {
  default:  "af_heart",   // warm American female
  nova:     "af_nova",    // clear American female
  echo:     "am_echo",    // deep American male
  fenrir:   "am_fenrir",  // calm American male
  emma:     "bf_emma",    // British female
  george:   "bm_george",  // British male
} as const;
