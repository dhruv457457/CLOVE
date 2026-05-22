import { NextRequest, NextResponse } from "next/server";

interface TelegramRequest {
  message: string;
  /** Optional: override bot token for this call */
  botToken?: string;
  chatId?: string;
}

export async function POST(request: NextRequest) {
  let body: TelegramRequest;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const botToken = body.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = body.chatId   ?? process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    // Not configured — log gracefully instead of erroring
    return NextResponse.json({
      sent: false,
      reason: "Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local.",
    });
  }

  const text = `🤖 *CLOVE Agent*\n\n${body.message}\n\n_${new Date().toLocaleString()}_`;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ sent: false, error: err.description ?? res.statusText }, { status: 502 });
  }

  return NextResponse.json({ sent: true });
}
