import { NextRequest, NextResponse } from "next/server";
import { isInternalRequest } from "@/lib/auth/internal";
import { VENICE_TTS_VOICES } from "@/lib/venice/client";

/**
 * Text-to-speech (voice report) — powered by Venice AI (tts-kokoro).
 *
 * Internal endpoint called by the agent runtime (not users). Uses the same
 * VENICE_API_KEY already set for LLM inference. On any failure returns
 * { skipped: true } with 200 so the agent loop is never blocked.
 */
export async function POST(request: NextRequest) {
  if (!isInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { text?: string; voice?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const text  = (body.text ?? "").slice(0, 1000);
  const voice = body.voice ?? VENICE_TTS_VOICES.default;
  if (!text.trim()) return NextResponse.json({ error: "Missing text" }, { status: 400 });

  const veniceKey = process.env.VENICE_API_KEY;
  if (!veniceKey) {
    return NextResponse.json({ skipped: true, reason: "VENICE_API_KEY not set" });
  }

  try {
    const res = await fetch("https://api.venice.ai/api/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${veniceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-kokoro", input: text, voice, response_format: "mp3" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "(no body)");
      console.warn("[media/tts] Venice TTS failure:", res.status, errText);
      return NextResponse.json({ skipped: true, reason: `Venice TTS ${res.status}` });
    }
    const audio = await res.arrayBuffer();
    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type":    "audio/mpeg",
        "Content-Length":  String(audio.byteLength),
        "X-Clove-Service": "tts",
        "X-Clove-Model":   "tts-kokoro",
      },
    });
  } catch (e) {
    console.warn("[media/tts] exception:", e);
    return NextResponse.json({ skipped: true, reason: e instanceof Error ? e.message : String(e) });
  }
}
