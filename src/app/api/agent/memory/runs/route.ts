import { NextRequest, NextResponse } from "next/server";
import { getLastRuns, getPosition } from "@/lib/agent/memory";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet");
  const n      = parseInt(request.nextUrl.searchParams.get("n") ?? "10");
  if (!wallet) return NextResponse.json({ error: "wallet param required" }, { status: 400 });

  const [runs, position] = await Promise.all([
    getLastRuns(wallet, Math.min(n, 20)),
    getPosition(wallet),
  ]);

  return NextResponse.json({ runs, position });
}
