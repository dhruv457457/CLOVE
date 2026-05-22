import { NextRequest, NextResponse } from "next/server";
import { runCloveAgent, type CloveAgentInput } from "@/lib/agent/clove-agent";
import { saveRun, updatePosition, saveApySnapshot } from "@/lib/agent/memory";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: Omit<CloveAgentInput, "baseUrl"> & { yields?: Record<string, number> };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!body.walletAddress || !body.budgetUsdc) {
    return NextResponse.json({ error: "walletAddress and budgetUsdc required" }, { status: 400 });
  }

  const baseUrl = request.nextUrl.origin;

  try {
    const result = await runCloveAgent({ ...body, baseUrl });

    // ── Save to MongoDB (best-effort, non-fatal) ──────────────────────────────
    const walletAddress = body.walletAddress;
    Promise.allSettled([
      // Save run record
      saveRun({
        walletAddress,
        runId:        `run_${Date.now()}`,
        success:      result.success,
        protocol:     result.protocol    ?? "unknown",
        action:       result.txHash      ? "deposit" : "hold",
        amount:       body.budgetUsdc,
        apy:          result.bestApy     ?? 0,
        riskLevel:    "LOW",
        txHash:       result.txHash      ?? null,
        costPaid:     result.costPaid,
        veniceReason: result.finalText?.slice(0, 200) ?? "",
        durationMs:   result.durationMs,
      }),

      // Update position if a deposit happened
      ...(result.txHash && result.protocol && result.bestApy
        ? [updatePosition(walletAddress, result.protocol, body.budgetUsdc, result.bestApy)]
        : []
      ),

      // Save APY snapshot if yields available from the step results
      ...(body.yields
        ? [saveApySnapshot({
            morpho:    body.yields.morpho    ?? 0,
            sky:       body.yields.sky       ?? 0,
            aerodrome: body.yields.aerodrome ?? 0,
            lido:      body.yields.lido      ?? 0,
            uniswap:   body.yields.uniswap   ?? 0,
          })]
        : []
      ),
    ]).catch(() => {/* silently ignore DB errors */});

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Agent run failed" },
      { status: 500 }
    );
  }
}
