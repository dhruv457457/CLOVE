/**
 * Next.js instrumentation — runs ONCE when the server process boots.
 *
 * INTERNAL SCHEDULER (Railway / any always-on Node host):
 * Vercel Hobby cron only fires daily, and a sleeping laptop kills local agents.
 * On an always-on server (Railway), we don't need an external cron at all —
 * this hook starts a heartbeat that calls /api/agent/cron every minute. The
 * cron route itself decides which agents are actually due (per-agent
 * scheduleIntervalMs), recovers stalled runs, and runs the revocation monitor,
 * so the heartbeat can be dumb and frequent.
 *
 * Enable with ENABLE_INTERNAL_SCHEDULER=true (set on Railway; leave unset on
 * Vercel where its native cron calls the same endpoint, and locally unless you
 * want background runs while developing).
 */
export async function register() {
  // Only in the Node.js server runtime — never in edge/browser bundles.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.ENABLE_INTERNAL_SCHEDULER !== "true") return;

  // Guard against double-start (dev hot reload re-imports modules).
  const g = globalThis as typeof globalThis & { __cloveSchedulerStarted?: boolean };
  if (g.__cloveSchedulerStarted) return;
  g.__cloveSchedulerStarted = true;

  const TICK_MS = 60_000;
  const port = process.env.PORT ?? "3000";
  const base = process.env.INTERNAL_BASE_URL ?? `http://127.0.0.1:${port}`;

  let inFlight = false;

  const tick = async () => {
    // A cron pass runs agents serially and can take minutes — never overlap.
    if (inFlight) return;
    inFlight = true;
    try {
      const res = await fetch(`${base}/api/agent/cron`, {
        headers: process.env.CRON_SECRET
          ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
          : undefined,
        // Generous: a pass with several due agents legitimately takes minutes.
        signal: AbortSignal.timeout(10 * 60_000),
      });
      const data = await res.json().catch(() => null) as { ran?: number; checked?: number } | null;
      if (data && (data.ran ?? 0) > 0) {
        console.log(`[scheduler] cron pass: ran ${data.ran}/${data.checked} agents`);
      }
    } catch (e) {
      console.warn("[scheduler] cron tick failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };

  // First tick after a short delay so the server finishes booting first.
  setTimeout(tick, 15_000);
  setInterval(tick, TICK_MS);
  console.log(`[scheduler] internal scheduler started — ticking ${base}/api/agent/cron every ${TICK_MS / 1000}s`);
}
