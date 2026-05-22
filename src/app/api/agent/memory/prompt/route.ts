import { NextRequest, NextResponse } from "next/server";
import { buildMemoryPrompt } from "@/lib/agent/memory";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet param required" }, { status: 400 });
  const prompt = await buildMemoryPrompt(wallet);
  return NextResponse.json({ prompt });
}
