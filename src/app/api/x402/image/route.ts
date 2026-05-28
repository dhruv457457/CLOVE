import { NextRequest, NextResponse } from "next/server";
import { build402, verifyPayment } from "@/lib/x402/helpers";

const PRICE_USDC = 0.01;

/**
 * x402-gated performance-art image service — powered by Venice AI (flux-2-max).
 *
 * Switched from fal.ai to Venice so the same VENICE_API_KEY that powers LLM
 * inference and TTS also powers image generation. No extra credits or payment
 * method required.
 *
 * On failure: returns a branded SVG fallback so the Telegram report always
 * has something visual. Never blocks the agent run.
 */
export async function POST(request: NextRequest) {
  const sig = request.headers.get("PAYMENT-SIGNATURE");
  if (!sig) return build402(PRICE_USDC);

  const ok = await verifyPayment(sig);
  if (!ok) return NextResponse.json({ error: "Invalid payment" }, { status: 402 });

  let body: { prompt?: string; runContext?: { apy?: number; protocol?: string; action?: string } };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const prompt   = buildImagePrompt(body.prompt, body.runContext);
  const ctx      = body.runContext ?? {};
  const veniceKey = process.env.VENICE_API_KEY;

  if (!veniceKey) {
    return NextResponse.json({
      imageUrl: generateFallbackSvgDataUrl(ctx),
      fallback: true,
      reason:   "VENICE_API_KEY not set",
      _clove:   { paid: true, costUsdc: 0, via: "fallback-svg" },
    });
  }

  try {
    const res = await fetch("https://api.venice.ai/api/v1/image/generate", {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${veniceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model:          "flux-2-max",   // Venice's highest quality model
        prompt,
        width:          1024,
        height:         576,
        steps:          4,              // fast generation; increase for quality
        cfg_scale:      7.5,
        negative_prompt: "text, watermark, logo, UI, low quality, blurry",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "(no body)");
      console.warn("[x402/image] Venice image failed:", res.status, errText.slice(0, 200));
      return NextResponse.json({
        imageUrl: generateFallbackSvgDataUrl(ctx),
        fallback: true,
        reason:   `Venice ${res.status}`,
        _clove:   { paid: true, costUsdc: 0, via: "fallback-svg" },
      });
    }

    const data = await res.json() as { images?: string[]; id?: string };
    const b64  = data.images?.[0];
    if (!b64) throw new Error("No image in Venice response");

    // Venice returns raw base64 (WebP). Wrap as data URL.
    const imageUrl = `data:image/webp;base64,${b64}`;

    return NextResponse.json({
      imageUrl,
      width:  1024,
      height: 576,
      prompt,
      _clove: { paid: true, costUsdc: PRICE_USDC, via: "venice-flux" },
    });
  } catch (e) {
    console.warn("[x402/image] Venice exception:", e);
    return NextResponse.json({
      imageUrl: generateFallbackSvgDataUrl(ctx),
      fallback: true,
      reason:   e instanceof Error ? e.message : String(e),
      _clove:   { paid: true, costUsdc: 0, via: "fallback-svg" },
    });
  }
}

export async function GET() {
  return build402(PRICE_USDC);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildImagePrompt(
  raw?: string,
  ctx?: { apy?: number; protocol?: string; action?: string },
): string {
  const palette = "quiet luxury, paper cream #F4F1EA, ink #0B0C09, single acid lime #C8FF3D accent";
  const action  = ctx?.action ?? "hold";
  const proto   = ctx?.protocol ?? "DeFi";
  const apy     = ctx?.apy ? ` ${ctx.apy.toFixed(2)}% APY` : "";

  const motif =
    action === "deposit"   ? `capital flowing like light into a single luminous petal, ${proto}${apy}`
  : action === "rebalance" ? `two petals exchanging energy in perfect balance, ${proto}${apy}`
  : action === "withdraw"  ? `a petal gracefully withdrawing inward, ${proto}${apy}`
  : `a quiet field at dawn, still water reflecting the moon, ${proto} at rest`;

  const base = raw?.trim() || `Editorial generative art: ${motif}. ${palette}. No text, no logos, abstract minimal.`;
  return base.slice(0, 400);
}

function generateFallbackSvgDataUrl(ctx: { protocol?: string; apy?: number; action?: string }): string {
  const proto = (ctx.protocol ?? "Idle").toUpperCase();
  const apy   = typeof ctx.apy === "number" ? `${ctx.apy.toFixed(2)}%` : "—";
  const act   = (ctx.action ?? "report").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 576" width="1024" height="576">
  <defs>
    <radialGradient id="g" cx="50%" cy="40%" r="60%">
      <stop offset="0%"  stop-color="#C8FF3D" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="#C8FF3D" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="576" fill="#F4F1EA"/>
  <rect width="1024" height="576" fill="url(#g)"/>
  <g font-family="Geist,system-ui,sans-serif" fill="#0B0C09">
    <text x="64" y="120" font-size="14" letter-spacing="3" font-weight="500">CLOVE · AGENT REPORT</text>
    <text x="64" y="280" font-size="120" font-weight="500" letter-spacing="-4">${apy}</text>
    <text x="64" y="340" font-size="36" font-style="italic" font-family="Georgia,serif">${proto}</text>
    <text x="64" y="500" font-size="14" letter-spacing="2" fill="#6B6A60">${act} · BASE MAINNET</text>
  </g>
  <circle cx="900" cy="80"  r="6"  fill="#C8FF3D"/>
  <circle cx="930" cy="80"  r="6"  fill="#C8FF3D" opacity="0.6"/>
  <circle cx="960" cy="80"  r="6"  fill="#C8FF3D" opacity="0.3"/>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
