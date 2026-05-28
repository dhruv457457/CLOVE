import { NextRequest, NextResponse } from "next/server";
import { build402, verifyPayment } from "@/lib/x402/helpers";

const PRICE_USDC = 0.005;

/**
 * x402-gated text-to-speech service — powered by Venice AI (tts-kokoro).
 *
 * No OPENAI_API_KEY needed — uses the same VENICE_API_KEY already set for
 * LLM inference. Venice's /audio/speech endpoint is OpenAI-compatible.
 *
 * Reliability: 10s timeout. On any failure returns { skipped: true } with 200
 * rather than throwing — the agent loop is never blocked by a media fail.
 *
 * Venice TTS models: tts-kokoro (high quality, natural prosody)
 * Voices: af_heart (warm female), af_nova (clear female), am_echo (deep male),
 *         am_fenrir (calm male), bf_emma (british female), bm_george (british male)
 */
export async function POST(request: NextRequest) {
  const sig = request.headers.get("PAYMENT-SIGNATURE");
  if (!sig) return build402(PRICE_USDC);

  const ok = await verifyPayment(sig);
  if (!ok) {
    return NextResponse.json({ error: "Invalid payment" }, { status: 402 });
  }

  let body: { text?: string; voice?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const text  = (body.text ?? "").slice(0, 1000); // hard cap to control cost
  const voice = body.voice ?? "af_heart";         // warm, natural default

  if (!text.trim()) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  const veniceKey = process.env.VENICE_API_KEY;
  if (!veniceKey) {
    return NextResponse.json({
      skipped: true,
      reason: "VENICE_API_KEY not set",
      _clove: { paid: true, costUsdc: 0, via: "demo" },
    });
  }

  try {
    const res = await fetch("https://api.venice.ai/api/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${veniceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model:           "tts-kokoro",
        input:           text,
        voice,
        response_format: "mp3",   // mp3 is universally supported + Telegram-friendly
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "(no body)");
      console.warn("[x402/tts] Venice TTS failure:", res.status, errText);
      return NextResponse.json({
        skipped: true,
        reason:  `Venice TTS ${res.status}`,
        _clove:  { paid: true, costUsdc: 0, via: "fallback" },
      });
    }

    const audio = await res.arrayBuffer();

    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type":    "audio/mpeg",
        "Content-Length":  String(audio.byteLength),
        "X-Clove-Cost":    String(PRICE_USDC),
        "X-Clove-Service": "tts",
        "X-Clove-Model":   "tts-kokoro",
      },
    });
  } catch (e) {
    console.warn("[x402/tts] exception:", e);
    return NextResponse.json({
      skipped: true,
      reason:  e instanceof Error ? e.message : String(e),
      _clove:  { paid: true, costUsdc: 0, via: "fallback" },
    });
  }
}

/** GET returns 402 too — lets curl probe the gate easily. */
export async function GET() {
  return build402(PRICE_USDC);
}
