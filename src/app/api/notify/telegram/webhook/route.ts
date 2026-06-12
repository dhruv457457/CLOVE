import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/mongodb";
import { listAgentsForWallet, transitionAgent, type Agent } from "@/lib/agent/agents";
import { listWorkflowsForWallet, type Workflow } from "@/lib/agent/workflows";
import { getLastRuns, getPositions } from "@/lib/agent/memory";
import {
  consumeTelegramLinkToken,
  getTelegramAccountByChatId,
  linkTelegramAccount,
  shortWallet,
  type TelegramAccount,
} from "@/lib/telegram/store";
import { escapeTelegramMd, formatRelativeTime, sendTelegramMessage } from "@/lib/telegram/send";
import { parseTelegramIntent, type TelegramIntent } from "@/lib/telegram/intent";

export const maxDuration = 300;

// Best-effort idempotency: Telegram retries an update if we don't 200 in time.
// Long runs reply fast and execute in the background, but we still dedupe by
// update_id so a retry can never double-fire an on-chain run.
const seenUpdates = new Set<number>();

type TelegramMessage = {
  message_id?: number;
  text?: string;
  chat?: { id?: number | string };
  from?: {
    id?: number | string;
    username?: string;
    first_name?: string;
  };
};

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (configuredSecret) {
    const got = request.headers.get("x-telegram-bot-api-secret-token");
    if (got !== configuredSecret) return NextResponse.json({ ok: true });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: true });

  const updateId = Number(body.update_id);
  if (Number.isFinite(updateId)) {
    if (seenUpdates.has(updateId)) return NextResponse.json({ ok: true });
    seenUpdates.add(updateId);
    if (seenUpdates.size > 1000) seenUpdates.clear();
  }

  const message: TelegramMessage | undefined = body.message ?? body.edited_message;
  if (!message?.text) return NextResponse.json({ ok: true });

  const chatId = String(message.chat?.id ?? "");
  const telegramUserId = String(message.from?.id ?? "");
  const text = String(message.text).trim();
  if (!chatId || !telegramUserId) return NextResponse.json({ ok: true });

  try {
    if (text.toLowerCase().startsWith("/start")) {
      await handleStart({
        chatId,
        telegramUserId,
        username: message.from?.username,
        firstName: message.from?.first_name,
        token: text.split(/\s+/)[1],
      });
      return NextResponse.json({ ok: true });
    }

    const account = await getTelegramAccountByChatId(chatId);
    if (!account) {
      await reply(chatId, [
        "*CLOVE Telegram is not linked yet.*",
        "",
        "Open the CLOVE dashboard, connect your wallet, then use *Connect Telegram* to link this chat.",
      ].join("\n"));
      return NextResponse.json({ ok: true });
    }

    const intent = parseTelegramIntent(text);
    // Self-calls (run-stream, from-answers) must hit the LOCAL server, not the
    // public domain — a container fetching its own public URL hairpin-fails on
    // Railway ("fetch failed"). Mirror the internal scheduler's loopback base.
    const selfBase = internalBase(request.nextUrl.origin);
    // Runs take ~70s+ — reply fast and execute in the background so Telegram
    // doesn't time out and retry (which would double-run the agent on-chain).
    if (intent.type === "run_agent" || intent.type === "run_workflow") {
      void handleIntent(account, intent, selfBase).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    await handleIntent(account, intent, selfBase);
  } catch (e) {
    await reply(chatId, `Error: ${escapeTelegramMd(e instanceof Error ? e.message : String(e))}`).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

/**
 * Base URL for self-calls. A container fetching its own PUBLIC domain hairpin-fails
 * on Railway, so internal route calls must hit the local server directly — exactly
 * what the internal scheduler does (127.0.0.1:PORT). Falls back to the request
 * origin in dev where PORT isn't set (origin is already http://localhost:3000).
 */
function internalBase(origin: string): string {
  if (process.env.INTERNAL_BASE_URL) return process.env.INTERNAL_BASE_URL;
  const port = process.env.PORT;
  return port ? `http://127.0.0.1:${port}` : origin;
}

async function handleStart(input: {
  chatId: string;
  telegramUserId: string;
  token?: string;
  username?: string;
  firstName?: string;
}) {
  if (!input.token) {
    await reply(input.chatId, [
      "*Welcome to CLOVE.*",
      "",
      "To link this chat, open the CLOVE web dashboard after connecting your wallet and generate a Telegram link.",
    ].join("\n"));
    return;
  }

  const walletAddress = await consumeTelegramLinkToken(input.token);
  if (!walletAddress) {
    await reply(input.chatId, "That link is expired or already used. Generate a fresh Telegram link from the dashboard.");
    return;
  }

  await linkTelegramAccount({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    username: input.username,
    firstName: input.firstName,
    walletAddress,
  });

  await reply(input.chatId, [
    "*CLOVE linked.*",
    "",
    `Wallet: \`${shortWallet(walletAddress)}\``,
    "",
    "Try `/agents`, `/portfolio`, `/cap`, `/tx`, `/run <agent_id>`, or `/team <workflow_id>`.",
  ].join("\n"));
}

async function handleIntent(account: TelegramAccount, intent: TelegramIntent, origin: string) {
  switch (intent.type) {
    case "help":
      return reply(account.chatId, helpText(account));
    case "whoami":
      return reply(account.chatId, `Linked wallet: \`${shortWallet(account.walletAddress)}\``);
    case "list_agents":
      return replyAgents(account);
    case "list_workflows":
      return replyWorkflows(account);
    case "portfolio":
      return replyPortfolio(account);
    case "cap_status":
      return replyCap(account);
    case "latest_tx":
      return replyLatestTx(account);
    case "run_agent":
      return runAgentFromTelegram(account, intent.target, origin);
    case "run_workflow":
      return runWorkflowFromTelegram(account, intent.target, origin);
    case "pause_agent":
      return patchAgentStatus(account, intent.target, "paused");
    case "resume_agent":
      return patchAgentStatus(account, intent.target, "idle");
    case "create_agent":
      return createAgentFromTelegram(account, intent.prompt, origin);
    case "unknown":
      return reply(account.chatId, `I did not understand that yet. Try /help.`);
  }
}

async function replyAgents(account: TelegramAccount) {
  const agents = await listAgentsForWallet(account.walletAddress);
  if (!agents.length) return reply(account.chatId, "No agents yet. Create one in the web dashboard, or say `/create <strategy>` after granting a budget.");

  const lines = [`*Your CLOVE agents* (${agents.length})`, ""];
  for (const a of agents.slice(0, 12)) {
    lines.push(`*${escapeTelegramMd(a.name)}*`);
    lines.push(`\`${a.id}\``);
    lines.push(`${statusLabel(a.status)} · ${a.scheduleIntervalMs ? intervalLabel(a.scheduleIntervalMs) : "manual"} · last ${formatRelativeTime(a.lastRunAt)}`);
    lines.push(`budget ${Number(a.budgetUsedUsdc ?? 0).toFixed(3)}/${a.budgetUsdc} USDC · ${a.totalRuns} runs · ${a.totalExecuted} tx`);
    lines.push("");
  }
  lines.push("Run one with `/run <agent_id>`.");
  return reply(account.chatId, lines.join("\n"));
}

async function replyWorkflows(account: TelegramAccount) {
  const workflows = await listWorkflowsForWallet(account.walletAddress);
  if (!workflows.length) return reply(account.chatId, "No workflows yet.");

  const lines = [`*Your CLOVE teams/workflows* (${workflows.length})`, ""];
  for (const wf of workflows.slice(0, 10)) {
    lines.push(`*${escapeTelegramMd(wf.name)}*`);
    lines.push(`\`${wf.id}\``);
    lines.push(`${wf.status} · ${wf.agentIds.length} agents · budget ${wf.budgetUsdc} USDC · permission ${wf.permissionStatus}`);
    lines.push("");
  }
  lines.push("Run a team with `/team <workflow_id>`.");
  return reply(account.chatId, lines.join("\n"));
}

async function replyPortfolio(account: TelegramAccount) {
  const [positions, runs, agents] = await Promise.all([
    getPositions(account.walletAddress),
    getLastRuns(account.walletAddress, 5),
    listAgentsForWallet(account.walletAddress),
  ]);
  const deployed = positions.reduce((s, p) => s + (Number.parseFloat(p.amount) || 0), 0);
  const txCount = runs.filter(r => r.txHash).length;

  const lines = [
    "*Portfolio snapshot*",
    "",
    `Agents: ${agents.length}`,
    `Recorded positions: ${positions.length}`,
    `Recorded deployed: ${deployed.toFixed(3)} USDC`,
    `Recent on-chain tx: ${txCount}`,
  ];
  if (positions.length) {
    lines.push("", "*Positions*");
    for (const p of positions.slice(0, 8)) {
      lines.push(`- ${escapeTelegramMd(p.protocol)}: ${Number.parseFloat(p.amount).toFixed(3)} USDC @ ${p.entryApy}%`);
    }
  }
  return reply(account.chatId, lines.join("\n"));
}

async function replyCap(account: TelegramAccount) {
  const agents = await listAgentsForWallet(account.walletAddress);
  if (!agents.length) return reply(account.chatId, "No agents yet.");
  const totalBudget = agents.reduce((s, a) => s + (Number.parseFloat(a.budgetUsdc) || 0), 0);
  const used = agents.reduce((s, a) => s + (Number(a.budgetUsedUsdc) || 0), 0);
  const lines = [
    "*Budget / cap status*",
    "",
    `Used: ${used.toFixed(3)} USDC`,
    `Total caps: ${totalBudget.toFixed(3)} USDC`,
    `Remaining: ${Math.max(0, totalBudget - used).toFixed(3)} USDC`,
    "",
  ];
  for (const a of agents.slice(0, 10)) {
    lines.push(`- ${escapeTelegramMd(a.name)}: ${Number(a.budgetUsedUsdc ?? 0).toFixed(3)}/${a.budgetUsdc}`);
  }
  return reply(account.chatId, lines.join("\n"));
}

async function replyLatestTx(account: TelegramAccount) {
  const runs = await getLastRuns(account.walletAddress, 8);
  if (!runs.length) return reply(account.chatId, "No recorded runs yet.");
  const lines = ["*Latest runs / tx*", ""];
  for (const r of runs) {
    const tx = r.txHash ? ` · [tx](https://basescan.org/tx/${r.txHash})` : "";
    lines.push(`- ${formatRelativeTime(r.timestamp)} · ${escapeTelegramMd(r.action)} ${escapeTelegramMd(r.amount)} USDC → ${escapeTelegramMd(r.protocol)}${tx}`);
  }
  return reply(account.chatId, lines.join("\n"));
}

async function runAgentFromTelegram(account: TelegramAccount, target: string | undefined, origin: string) {
  const agent = await resolveAgent(account.walletAddress, target);
  if (!agent) return reply(account.chatId, "Agent not found. Use `/agents` to list ids.");

  await reply(account.chatId, `Starting *${escapeTelegramMd(agent.name)}*...`);
  const res = await fetch(`${origin}/api/agent/run-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: agent.id,
      walletAddress: agent.walletAddress,
      permissionsContext: agent.delegationContext,
      delegationManager: agent.delegationManagerAddress,
    }),
  });

  if (!res.body) return reply(account.chatId, "Run failed to start.");
  await drainStream(res.body);
  return reply(account.chatId, `Finished *${escapeTelegramMd(agent.name)}*. Use /tx for the latest result.`);
}

async function runWorkflowFromTelegram(account: TelegramAccount, target: string | undefined, origin: string) {
  const wf = await resolveWorkflow(account.walletAddress, target);
  if (!wf) return reply(account.chatId, "Workflow not found. Use `/workflows` to list ids.");

  // Run each SPENDING agent in the team via run-stream (skip the Fund Manager,
  // which only holds the grant). Matches the dashboard and avoids the orchestrate
  // path's grant-shape issues for copy desks.
  const team = (await listAgentsForWallet(account.walletAddress))
    .filter(a => wf.agentIds.includes(a.id) && a.name !== "Fund Manager")
    .sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
  if (!team.length) return reply(account.chatId, "This team has no runnable agents.");

  await reply(account.chatId, `Starting team *${escapeTelegramMd(wf.name)}* (${team.length} agent${team.length !== 1 ? "s" : ""})...`);
  for (const a of team) {
    try {
      const res = await fetch(`${origin}/api/agent/run-stream`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: a.id, walletAddress: a.walletAddress,
          permissionsContext: a.delegationContext, delegationManager: a.delegationManagerAddress,
        }),
      });
      if (res.body) await drainStream(res.body);
    } catch { /* one agent failing shouldn't stop the team */ }
  }
  return reply(account.chatId, `Finished team *${escapeTelegramMd(wf.name)}*. Use /tx for the latest result.`);
}

async function patchAgentStatus(account: TelegramAccount, target: string | undefined, status: "idle" | "paused") {
  const agent = await resolveAgent(account.walletAddress, target);
  if (!agent) return reply(account.chatId, "Agent not found. Use `/agents` to list ids.");
  await transitionAgent(agent.id, {
    status,
    pauseReason: status === "paused" ? "Paused via Telegram" : null,
    lastError: status === "idle" ? null : undefined,
  });
  return reply(account.chatId, `${status === "paused" ? "Paused" : "Resumed"} *${escapeTelegramMd(agent.name)}*.`);
}

async function createAgentFromTelegram(account: TelegramAccount, prompt: string, origin: string) {
  const db = await getDb();
  const perm = db ? await db.collection("user_permissions").findOne({ walletAddress: account.walletAddress.toLowerCase() }) : null;
  if (!perm?.permissionsContext) {
    return reply(account.chatId, [
      "I can create this, but you need a web wallet grant first.",
      "",
      "Open CLOVE, connect your wallet, grant a capped USDC budget, then send this again.",
    ].join("\n"));
  }

  const budgetMatch = prompt.match(/(\d+(?:\.\d+)?)\s*USDC/i);
  const budget = budgetMatch ? Number(budgetMatch[1]) : 5;
  const res = await fetch(`${origin}/api/agent/from-answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      walletAddress: account.walletAddress,
      permissionsContext: perm.permissionsContext,
      delegationManager: perm.delegationManager,
      expiresAt: perm.expiresAt,
      answers: {
        budget,
        risk: /aggressive/i.test(prompt) ? "Aggressive" : /safe|conservative/i.test(prompt) ? "Conservative" : "Moderate",
        schedule: /hour/i.test(prompt) ? "Every hour" : /week/i.test(prompt) ? "Weekly" : /manual|on-demand/i.test(prompt) ? "On-demand only" : "Daily",
        notify: ["Telegram message"],
        orchestration: /team|multi/i.test(prompt) ? "Multi-agent team" : "Single agent",
      },
    }),
  });

  const data = await res.json().catch(() => ({})) as { agents?: Agent[]; workflow?: Workflow; error?: string };
  if (!res.ok) return reply(account.chatId, `Creation failed: ${escapeTelegramMd(data.error ?? `HTTP ${res.status}`)}`);

  return reply(account.chatId, [
    "*Created from Telegram.*",
    "",
    `Workflow: ${data.workflow ? `\`${data.workflow.id}\`` : "none"}`,
    `Agents: ${data.agents?.length ?? 0}`,
    "",
    "Use `/agents` or `/workflows` to run it.",
  ].join("\n"));
}

async function resolveAgent(walletAddress: string, target?: string): Promise<Agent | null> {
  const agents = await listAgentsForWallet(walletAddress);
  if (!agents.length) return null;
  const needle = target?.trim().toLowerCase();
  if (!needle) return agents[0] ?? null;
  return agents.find(a => a.id.toLowerCase() === needle || a.name.toLowerCase().includes(needle)) ?? null;
}

async function resolveWorkflow(walletAddress: string, target?: string): Promise<Workflow | null> {
  const workflows = await listWorkflowsForWallet(walletAddress);
  if (!workflows.length) return null;
  const needle = target?.trim().toLowerCase();
  if (!needle) return workflows[0] ?? null;
  return workflows.find(w => w.id.toLowerCase() === needle || w.name.toLowerCase().includes(needle)) ?? null;
}

async function drainStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

async function reply(chatId: string, text: string): Promise<void> {
  await sendTelegramMessage(chatId, text);
}

function helpText(account: TelegramAccount): string {
  return [
    "*CLOVE Telegram*",
    "",
    `Linked wallet: \`${shortWallet(account.walletAddress)}\``,
    "",
    "`/agents` - list your agents",
    "`/workflows` - list your teams",
    "`/portfolio` - portfolio snapshot",
    "`/cap` - budget used and remaining",
    "`/tx` - latest runs and transactions",
    "`/run <agent_id>` - run one agent",
    "`/team <workflow_id>` - run a team",
    "`/pause <agent_id>` / `/resume <agent_id>`",
    "`/create <strategy>` - create from prompt if a web grant exists",
  ].join("\n");
}

function statusLabel(status: Agent["status"]): string {
  if (status === "idle") return "idle";
  if (status === "planning" || status === "executing" || status === "reflecting") return "running";
  return status;
}

function intervalLabel(ms: number): string {
  const h = ms / 3600000;
  if (h < 1) return "sub-hourly";
  if (h <= 1) return "hourly";
  if (h <= 6) return "6h";
  if (h <= 24) return "daily";
  return `${Math.round(h / 24)}d`;
}
