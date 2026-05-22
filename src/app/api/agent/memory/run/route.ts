import { NextRequest, NextResponse } from "next/server";
import { saveRun, updatePosition, saveApySnapshot } from "@/lib/agent/memory";
import type { RunMemory } from "@/lib/agent/memory";

export async function POST(request: NextRequest) {
  let body: Partial<RunMemory> & { yields?: Record<string, number> };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!body.walletAddress) return NextResponse.json({ error: "walletAddress required" }, { status: 400 });

  try {
    // Save the run
    await saveRun({
      walletAddress: body.walletAddress,
      runId:         body.runId         ?? `run_${Date.now()}`,
      success:       body.success        ?? false,
      protocol:      body.protocol       ?? "unknown",
      action:        body.action         ?? "hold",
      amount:        body.amount         ?? "0",
      apy:           body.apy            ?? 0,
      riskLevel:     body.riskLevel      ?? "UNKNOWN",
      txHash:        body.txHash         ?? null,
      costPaid:      body.costPaid       ?? 0,
      veniceReason:  body.veniceReason   ?? "",
      durationMs:    body.durationMs     ?? 0,
    });

    // Update position if a deposit happened
    if (body.action === "deposit" && body.protocol && body.amount && body.apy) {
      await updatePosition(body.walletAddress, body.protocol, body.amount, body.apy);
    }

    // Save APY snapshot if yields provided
    if (body.yields && Object.keys(body.yields).length > 0) {
      await saveApySnapshot({
        morpho:    body.yields.morpho    ?? 0,
        sky:       body.yields.sky       ?? 0,
        aerodrome: body.yields.aerodrome ?? 0,
        lido:      body.yields.lido      ?? 0,
        uniswap:   body.yields.uniswap   ?? 0,
      });
    }

    return NextResponse.json({ saved: true });
  } catch (e) {
    console.error("[memory/run]", e);
    return NextResponse.json({ saved: false, error: String(e) });
  }
}
