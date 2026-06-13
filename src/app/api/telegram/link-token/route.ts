import { NextRequest, NextResponse } from "next/server";
import { createTelegramLinkToken } from "@/lib/telegram/store";

// Cache the bot username so we don't call getMe on every link request.
let cachedBotUsername: string | null = null;

/**
 * Resolve the bot's @username for the deep link. Prefer the explicit
 * TELEGRAM_BOT_USERNAME env; otherwise derive it from the bot token via
 * Telegram's getMe — so one-tap linking works without extra config.
 */
async function resolveBotUsername(): Promise<string | null> {
  if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME;
  if (cachedBotUsername) return cachedBotUsername;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) });
    const d = await r.json() as { ok?: boolean; result?: { username?: string } };
    cachedBotUsername = d?.result?.username ?? null;
    return cachedBotUsername;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: { walletAddress?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const walletAddress = body.walletAddress?.toLowerCase();
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: "Valid walletAddress required" }, { status: 400 });
  }

  const { token, expiresAt } = await createTelegramLinkToken(walletAddress);
  const botName = await resolveBotUsername();
  const deepLink = botName ? `https://t.me/${botName}?start=${token}` : null;

  // botConfigured=false → the client should explain there's no bot set up yet,
  // instead of silently copying a token the user can't use.
  return NextResponse.json({ token, expiresAt, deepLink, botConfigured: !!process.env.TELEGRAM_BOT_TOKEN });
}
