import { NextRequest, NextResponse } from "next/server";
import { getTelegramAccountForWallet } from "@/lib/telegram/store";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ linked: false });

  const account = await getTelegramAccountForWallet(wallet);
  return NextResponse.json({
    linked: !!account,
    account: account
      ? {
          telegramUserId: account.telegramUserId,
          username: account.username,
          firstName: account.firstName,
          linkedAt: account.linkedAt,
          lastSeenAt: account.lastSeenAt,
        }
      : null,
  });
}
