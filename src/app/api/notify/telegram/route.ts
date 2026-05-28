import { NextRequest, NextResponse } from "next/server";

interface TelegramRequest {
  // Mode 1: plain text only (back-compat)
  message?: string;

  // Mode 2: rich report (multiple chained sends)
  richReport?: {
    text:      string;
    voiceUrl?: string;
    imageUrl?: string;
    spending?: {
      x402Total: number;
      defi:      number;
      remaining: number;
      budget:    string;
    };
  };

  botToken?: string;
  chatId?:   string;
}

function envCreds(body: TelegramRequest) {
  return {
    botToken: body.botToken ?? process.env.TELEGRAM_BOT_TOKEN,
    chatId:   body.chatId   ?? process.env.TELEGRAM_CHAT_ID,
  };
}

// ── Senders ─────────────────────────────────────────────────────────────────────

async function sendMessage(botToken: string, chatId: string, text: string) {
  return fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function sendPhoto(botToken: string, chatId: string, photoUrl: string, caption?: string) {
  return fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo:   photoUrl,
      caption: caption ?? undefined,
      parse_mode: "Markdown",
    }),
  });
}

async function sendVoice(botToken: string, chatId: string, voiceUrl: string, caption?: string) {
  return fetch(`https://api.telegram.org/bot${botToken}/sendVoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      voice:   voiceUrl,
      caption: caption ?? undefined,
    }),
  });
}

function formatSpending(s: NonNullable<TelegramRequest["richReport"]>["spending"]): string {
  if (!s) return "";
  const fmt = (n: number) => n.toFixed(3);
  return [
    "💸 *Spending breakdown*",
    `\`x402 fees:\`   ${fmt(s.x402Total)} USDC`,
    `\`Deployed:\`    ${fmt(s.defi)} USDC`,
    `\`Remaining:\`   ${fmt(s.remaining)} / ${s.budget} USDC`,
  ].join("\n");
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: TelegramRequest;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const { botToken, chatId } = envCreds(body);
  if (!botToken || !chatId) {
    return NextResponse.json({
      sent: false,
      reason: "Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local.",
    });
  }

  // ── Rich report mode ────────────────────────────────────────────────────────
  if (body.richReport) {
    const { text, voiceUrl, imageUrl, spending } = body.richReport;
    const caption = `🤖 *CLOVE Agent*\n\n${text}`;
    const results: Record<string, boolean> = {};

    try {
      if (imageUrl) {
        const r = await sendPhoto(botToken, chatId, imageUrl, caption);
        results.photo = r.ok;
      } else {
        const r = await sendMessage(botToken, chatId, caption);
        results.message = r.ok;
      }
    } catch (e) { results.photo = false; console.warn("[telegram] photo failed:", e); }

    if (voiceUrl) {
      try {
        const r = await sendVoice(botToken, chatId, voiceUrl);
        results.voice = r.ok;
      } catch (e) { results.voice = false; console.warn("[telegram] voice failed:", e); }
    }

    if (spending) {
      try {
        const r = await sendMessage(botToken, chatId, formatSpending(spending));
        results.spending = r.ok;
      } catch (e) { results.spending = false; }
    }

    return NextResponse.json({ sent: true, parts: results });
  }

  // ── Simple text mode (back-compat) ──────────────────────────────────────────
  if (!body.message) {
    return NextResponse.json({ error: "Missing message or richReport" }, { status: 400 });
  }

  const text = `🤖 *CLOVE Agent*\n\n${body.message}\n\n_${new Date().toLocaleString()}_`;
  const res  = await sendMessage(botToken, chatId, text);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ sent: false, error: err.description ?? res.statusText }, { status: 502 });
  }
  return NextResponse.json({ sent: true });
}
