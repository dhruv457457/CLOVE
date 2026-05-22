import { NextRequest, NextResponse } from "next/server";
import { generateStrategyImage } from "@/lib/fal/client";

/**
 * POST /api/intelligence/visualize
 * Generate a fal.ai strategy visualization image.
 * Gated behind x402 — same payment signature as /api/intelligence.
 */
export async function POST(request: NextRequest) {
  const paymentSig = request.headers.get("PAYMENT-SIGNATURE");
  if (!paymentSig) {
    return NextResponse.json({ error: "Payment Required" }, { status: 402 });
  }

  if (!process.env.FAL_API_KEY) {
    return NextResponse.json({ error: "FAL_API_KEY not configured" }, { status: 503 });
  }

  let body: { strategy?: string; protocol?: string; bestApy?: number };
  try { body = await request.json(); }
  catch { body = {}; }

  try {
    const result = await generateStrategyImage(
      body.strategy ?? "Autonomous DeFi yield strategy on Base",
      body.protocol ?? "Morpho",
      body.bestApy,
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Image generation failed" },
      { status: 500 }
    );
  }
}
