import { NextResponse } from "next/server";

/**
 * Quick probe to tell the client whether Telegram is configured server-side.
 * Never leaks the actual token — returns only a boolean.
 */
export async function GET() {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return NextResponse.json({
    configured: !!(token && chatId && token.length > 10),
  });
}
