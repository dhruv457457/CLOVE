import { NextRequest, NextResponse } from "next/server";
import { nudgeRelayTask } from "@/lib/oneshot/publicRelayer";

/**
 * POST /api/relay/webhook
 *
 * Receives 1Shot public-relayer status pushes (set via `destinationUrl` on
 * submit). We do NOT trust the payload as authoritative — it only NUDGES the
 * in-flight waiter for that task to immediately re-read relayer_getStatus (the
 * source of truth). So a spoofed webhook can't fake a confirmation; worst case
 * it triggers one extra status read.
 *
 * Set PUBLIC_BASE_URL on an always-on host (Railway) to enable webhook delivery;
 * without it, execution falls back to polling and this route is simply unused.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* tolerate empty/non-JSON pings */ }

  // The relayer's task id may arrive under a few keys depending on the event.
  const taskId =
    (body.id as string) ??
    (body.taskId as string) ??
    ((body.task as Record<string, unknown> | undefined)?.id as string) ??
    "";

  const nudged = typeof taskId === "string" && taskId.length > 0 ? nudgeRelayTask(taskId) : false;
  return NextResponse.json({ ok: true, nudged });
}
