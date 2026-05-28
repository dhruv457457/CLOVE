import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/mongodb";
import { transitionAgent, type Agent } from "@/lib/agent/agents";

export const maxDuration = 60;

/**
 * Telegram bot webhook handler.
 *
 * Set the webhook URL via:
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -d "url=https://YOUR_DOMAIN/api/notify/telegram/webhook"
 *
 * Supported commands (text starts with `/`):
 *   /status              — list all agents with status + last run
 *   /agents              — alias for /status
 *   /run <agent_id>      — manually trigger a run for one agent
 *   /pause <agent_id>    — set agent to "paused" (cron will skip it)
 *   /resume <agent_id>   — set agent back to "idle"
 *   /help                — show command list
 *
 * Security: requires `TELEGRAM_CHAT_ID` to match the incoming chat id —
 * commands from any other chat are ignored. This way only the user who set
 * the env var can control their agents.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: true });

  const message = body.message ?? body.edited_message;
  if (!message?.text) return NextResponse.json({ ok: true });

  const chatId  = String(message.chat?.id ?? "");
  const text    = String(message.text ?? "").trim();
  const ownerId = process.env.TELEGRAM_CHAT_ID ?? "";

  if (!chatId || chatId !== ownerId) {
    // Silent ignore for non-owners; don't leak agent state to randos
    return NextResponse.json({ ok: true });
  }

  if (!text.startsWith("/")) return NextResponse.json({ ok: true });

  const [rawCmd, ...args] = text.split(/\s+/);
  const cmd = rawCmd.toLowerCase().split("@")[0]; // strip @BotName suffix

  try {
    switch (cmd) {
      case "/status":
      case "/agents":
        await replyStatus(chatId);
        break;
      case "/run":
      case "/runnow":
        await replyRunNow(chatId, args[0], request.nextUrl.origin);
        break;
      case "/pause":
        await replyPause(chatId, args[0]);
        break;
      case "/resume":
        await replyResume(chatId, args[0]);
        break;
      case "/help":
      case "/start":
        await reply(chatId, helpText());
        break;
      default:
        await reply(chatId, `Unknown command: \`${cmd}\`. Try /help`);
    }
  } catch (e) {
    await reply(chatId, `Error: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function replyStatus(chatId: string) {
  const db = await getDb();
  if (!db) return reply(chatId, "Database unavailable");

  const agents = await db.collection<Agent>("agents").find({}).limit(20).toArray();
  if (!agents.length) return reply(chatId, "No agents created yet. Visit the dashboard to set one up.");

  const lines = [`*CLOVE — ${agents.length} agent${agents.length > 1 ? "s" : ""}*\n`];
  for (const a of agents) {
    const status = statusEmoji(a.status) + " " + a.status;
    const last   = a.lastRunAt ? humanTime(a.lastRunAt) : "never";
    const sched  = a.scheduleIntervalMs ? humanInterval(a.scheduleIntervalMs) : "manual";
    lines.push(`*${escapeMd(a.name)}*`);
    lines.push(`  \`${a.id}\``);
    lines.push(`  ${status} · ${sched} · last: ${last}`);
    lines.push(`  budget: ${a.budgetUsedUsdc.toFixed(2)}/${a.budgetUsdc} USDC · ${a.totalRuns} runs`);
    if (a.lastError) lines.push(`  ⚠ ${a.lastError.slice(0, 80)}`);
    lines.push("");
  }
  lines.push("Commands: `/run <id>` `/pause <id>` `/resume <id>`");
  return reply(chatId, lines.join("\n"));
}

async function replyRunNow(chatId: string, agentId: string | undefined, origin: string) {
  if (!agentId) return reply(chatId, "Usage: `/run <agent_id>` (use /status to list ids)");

  const db = await getDb();
  if (!db) return reply(chatId, "Database unavailable");
  const agent = await db.collection<Agent>("agents").findOne({ id: agentId });
  if (!agent) return reply(chatId, `Agent \`${agentId}\` not found`);

  await reply(chatId, `▶ Triggering *${escapeMd(agent.name)}*…`);

  // Fire and forget — drain the SSE stream in the background
  const res = await fetch(`${origin}/api/agent/run-stream`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      agentId,
      walletAddress:      agent.walletAddress,
      permissionsContext: agent.delegationContext,
      delegationManager:  agent.delegationManagerAddress,
    }),
  });
  if (!res.body) return reply(chatId, "Failed to start run");
  // Drain — the run-stream sends its own Telegram report at the end
  const reader = res.body.getReader();
  while (true) { const { done } = await reader.read(); if (done) break; }
}

async function replyPause(chatId: string, agentId: string | undefined) {
  if (!agentId) return reply(chatId, "Usage: `/pause <agent_id>`");
  await transitionAgent(agentId, { status: "paused", pauseReason: "Paused via Telegram" });
  return reply(chatId, `⏸ Paused \`${agentId}\``);
}

async function replyResume(chatId: string, agentId: string | undefined) {
  if (!agentId) return reply(chatId, "Usage: `/resume <agent_id>`");
  await transitionAgent(agentId, { status: "idle", pauseReason: null, lastError: null });
  return reply(chatId, `▶ Resumed \`${agentId}\``);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function reply(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  }).catch(() => {});
}

function helpText(): string {
  return [
    "*CLOVE Bot Commands*",
    "",
    "`/status` — list all agents + their status",
    "`/run <agent_id>` — manually trigger a run",
    "`/pause <agent_id>` — stop autonomous runs",
    "`/resume <agent_id>` — re-enable",
    "`/help` — this message",
    "",
    "Agents run on schedule from the CLOVE cron service. Use the dashboard to create agents and set schedules.",
  ].join("\n");
}

function statusEmoji(s: Agent["status"]): string {
  return s === "idle"       ? "🟢"
       : s === "planning"   ? "🟡"
       : s === "executing"  ? "🟠"
       : s === "reflecting" ? "🟡"
       : s === "paused"     ? "⏸"
       : s === "blocked"    ? "🚧"
       : s === "failed"     ? "🔴"
       :                       "⚪";
}

function humanTime(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d_ = Math.floor(diff / 86400000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d_}d ago`;
}

function humanInterval(ms: number): string {
  const h = ms / 3600000;
  if (h < 1)   return "manual";
  if (h <= 1)  return "hourly";
  if (h <= 6)  return "6h";
  if (h <= 24) return "daily";
  return `${Math.round(h / 24)}d`;
}

function escapeMd(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!]/g, (m) => `\\${m}`);
}
