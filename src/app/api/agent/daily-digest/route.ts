import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/mongodb";
import { getRecentThoughts } from "@/lib/agent/thoughts";
import { imagePromptForReflection } from "@/lib/agent/planner";
import { getInternalSecretOptional } from "@/lib/config/env";
import type { Agent } from "@/lib/agent/agents";

/**
 * Cron endpoint — runs once per day. For every agent with mediaPolicy === "daily",
 * aggregates the last 24h of thoughts, asks Venice for a one-paragraph summary,
 * then sends one rich Telegram report per agent (voice + image + spending).
 *
 * Schedule via Vercel cron at `0 9 * * *` (09:00 UTC daily).
 */
export async function GET(request: NextRequest) {
  // Optional CRON_SECRET protection
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const db = await getDb();
  if (!db) return NextResponse.json({ ran: 0, reason: "no DB" });

  const agents = await db
    .collection<Agent>("agents")
    .find({ mediaPolicy: "daily" })
    .toArray();

  if (!agents.length) {
    return NextResponse.json({ ran: 0, reason: "no agents with mediaPolicy=daily" });
  }

  const baseUrl = request.nextUrl.origin;
  const results: Array<{ agentId: string; ok: boolean; reason?: string }> = [];

  // Real internal-secret signature so the fail-closed x402 verifier accepts these
  // server-to-server media calls. If the secret isn't configured, media is skipped.
  const internalSecret = getInternalSecretOptional();
  const internalSig = internalSecret
    ? Buffer.from(JSON.stringify({ internalSecret, payload: {} })).toString("base64")
    : null;

  for (const agent of agents) {
    try {
      const thoughts = await getRecentThoughts(agent.id, 24 * 60 * 60 * 1000);
      if (!thoughts.length) {
        results.push({ agentId: agent.id, ok: false, reason: "no thoughts in 24h" });
        continue;
      }

      // Find the most recent reflection's insight as the digest seed
      const lastReflect = [...thoughts].reverse().find(t => t.type === "reflect");
      const insightText = (lastReflect?.content?.insight as string | undefined)
        ?? `${agent.name} ran ${thoughts.length} thought-steps in the last 24h.`;

      // Generate image via x402 endpoint (CLOVE-provided). Audio is not surfaced
      // as a URL yet (no public audio host), so the digest carries only an image.
      let imageUrl: string | undefined;

      try {
        if (!internalSig) throw new Error("CLOVE_INTERNAL_SECRET not set — skipping media");
        const imgRes = await fetch(`${baseUrl}/api/x402/image`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": internalSig },
          body: JSON.stringify({
            prompt: imagePromptForReflection(
              { insight: insightText, tags: [], didSucceed: true },
              { protocol: undefined, apy: undefined, action: agent.lastAction ?? undefined },
            ),
            runContext: { action: agent.lastAction ?? undefined },
          }),
          signal: AbortSignal.timeout(35000),
        });
        if (imgRes.ok) {
          const j = await imgRes.json();
          imageUrl = j.imageUrl;
        }
      } catch { /* fallthrough */ }

      // Telegram rich report
      const budget = Number.parseFloat(agent.budgetUsdc) || 0;
      await fetch(`${baseUrl}/api/notify/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          richReport: {
            text: `*${agent.name} — daily digest*\n\n${insightText}\n\n_${thoughts.length} thought-steps · last 24h_`,
            imageUrl,
            spending: {
              x402Total: agent.x402SpentUsdc,
              defi:      agent.budgetUsedUsdc,
              remaining: Math.max(0, budget - agent.budgetUsedUsdc),
              budget:    agent.budgetUsdc,
            },
          },
        }),
      });

      results.push({ agentId: agent.id, ok: true });
    } catch (e) {
      results.push({ agentId: agent.id, ok: false, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ran: results.filter(r => r.ok).length, results });
}
