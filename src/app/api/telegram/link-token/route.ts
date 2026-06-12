import { NextRequest, NextResponse } from "next/server";
import { createTelegramLinkToken } from "@/lib/telegram/store";

export async function POST(request: NextRequest) {
  let body: { walletAddress?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const walletAddress = body.walletAddress?.toLowerCase();
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: "Valid walletAddress required" }, { status: 400 });
  }

  const { token, expiresAt } = await createTelegramLinkToken(walletAddress);
  const botName = process.env.TELEGRAM_BOT_USERNAME;
  const deepLink = botName ? `https://t.me/${botName}?start=${token}` : null;

  return NextResponse.json({ token, expiresAt, deepLink });
}
