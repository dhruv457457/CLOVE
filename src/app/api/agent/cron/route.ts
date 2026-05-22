import { NextRequest, NextResponse } from "next/server";
import { runCloveAgent } from "@/lib/agent/clove-agent";
import { getEnabledSchedules, getWorkflow, saveRun } from "@/lib/agent/memory";

export const maxDuration = 60;

/**
 * GET /api/agent/cron
 * Called by Vercel Cron every hour.
 * Loads ALL enabled schedules from MongoDB and runs each wallet's saved workflow.
 * This is what makes CLOVE truly autonomous — it runs without the user's browser open.
 */
export async function GET(request: NextRequest) {
  // Verify Vercel cron secret
  const authHeader = request.headers.get("authorization");
  if (process.env.VERCEL && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = request.nextUrl.origin;

  // Load all enabled schedules from MongoDB
  const schedules = await getEnabledSchedules();

  if (!schedules.length) {
    return NextResponse.json({ ran: 0, reason: "No enabled schedules" });
  }

  const results = [];

  for (const schedule of schedules) {
    const walletAddress = schedule.walletAddress;

    // Load this wallet's saved workflow + permission from MongoDB
    const saved = await getWorkflow(walletAddress);
    const goal  = saved?.prompt ?? "Optimize stablecoin yield on Base";

    try {
      const result = await runCloveAgent({
        walletAddress,
        budgetUsdc:  "10.00",
        // Note: permissionsContext comes from 1Shot stored delegation
        // The agent will use the stored delegation via delegationId if available
        goal,
        baseUrl: origin,
      });

      // Save run to MongoDB
      await saveRun({
        walletAddress,
        runId:        result.steps[0]?.tool ? `cron_${Date.now()}` : `cron_${Date.now()}`,
        success:      result.success,
        protocol:     result.protocol     ?? "unknown",
        action:       result.txHash       ? "deposit" : "hold",
        amount:       "10.00",
        apy:          result.bestApy      ?? 0,
        riskLevel:    "AUTO",
        txHash:       result.txHash       ?? null,
        costPaid:     result.costPaid,
        veniceReason: result.finalText?.slice(0, 200) ?? "",
        durationMs:   result.durationMs,
      }).catch(() => {});

      results.push({ wallet: walletAddress, success: result.success, durationMs: result.durationMs });
      console.log(`[cron] ${walletAddress}: ${result.success ? "✓" : "✗"} in ${result.durationMs}ms`);
    } catch (e) {
      console.error(`[cron] ${walletAddress} failed:`, e);
      results.push({ wallet: walletAddress, success: false, error: String(e) });
    }
  }

  return NextResponse.json({ ran: results.length, results });
}
