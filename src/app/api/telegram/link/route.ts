import { NextRequest, NextResponse } from "next/server";
import { unlinkTelegramWallet } from "@/lib/telegram/store";

export async function DELETE(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ ok: true });
  await unlinkTelegramWallet(wallet);
  return NextResponse.json({ ok: true });
}
