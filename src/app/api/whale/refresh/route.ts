import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/whale/refresh
 *
 * Re-executes the Dune whale queries (ranking + convergence) so their cached
 * `/results` stay fresh. Dune execution is async — we just kick off the runs;
 * Dune caches the output when each completes, and /api/whale/discover reads that
 * cache on the next call.
 *
 * Wired into Vercel Cron (see vercel.json). Also safe to call manually.
 */

export const maxDuration = 60;

async function executeQuery(queryId: string, apiKey: string): Promise<{ id: string; ok: boolean; executionId?: string; error?: string }> {
  try {
    const res = await fetch(`https://api.dune.com/api/v1/query/${queryId}/execute`, {
      method: "POST",
      headers: { "X-Dune-API-Key": apiKey },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { id: queryId, ok: false, error: `HTTP ${res.status}` };
    const data = await res.json() as { execution_id?: string };
    return { id: queryId, ok: true, executionId: data.execution_id };
  } catch (e) {
    return { id: queryId, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(request: NextRequest) {
  // Verify Vercel cron secret (only enforced in production).
  const authHeader = request.headers.get("authorization");
  if (process.env.VERCEL && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.DUNE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ refreshed: 0, reason: "DUNE_API_KEY not set" });
  }

  const queryIds = [
    process.env.DUNE_WHALE_QUERY_ID,
    process.env.DUNE_CONVERGENCE_QUERY_ID,
  ].filter((id): id is string => !!id);

  if (queryIds.length === 0) {
    return NextResponse.json({ refreshed: 0, reason: "No Dune query IDs configured" });
  }

  const results = await Promise.all(queryIds.map(id => executeQuery(id, apiKey)));

  return NextResponse.json({
    refreshed: results.filter(r => r.ok).length,
    results,
    at: Date.now(),
  });
}
