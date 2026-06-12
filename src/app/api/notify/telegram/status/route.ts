import { NextResponse } from "next/server";

/**
 * Quick probe to tell the client whether Telegram is configured server-side.
 * Never leaks the actual token — returns only a boolean.
 */
export async function GET() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return NextResponse.json({
    configured: !!(token && token.length > 10),
    perWalletLinking: true,
  });
}
