import { NextRequest, NextResponse } from "next/server";
import { createAgent, listAgentsForWallet, type MediaPolicy } from "@/lib/agent/agents";
import { ensureIndexes } from "@/lib/db/indexes";

/** GET ?wallet=0x... — list all agents for a wallet (top-level canvas) */
export async function GET(request: NextRequest) {
  await ensureIndexes();  // idempotent — lazy index creation on first request
  const wallet = request.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  const agents = await listAgentsForWallet(wallet);
  return NextResponse.json({ agents });
}

/** POST { walletAddress, name, goal, budgetUsdc?, mediaPolicy? } — create new agent */
export async function POST(request: NextRequest) {
  let body: {
    walletAddress: string;
    name:          string;
    goal:          string;
    budgetUsdc?:   string;
    mediaPolicy?:  MediaPolicy;
    position?:     { x: number; y: number };
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!body.walletAddress || !body.name || !body.goal) {
    return NextResponse.json({ error: "walletAddress, name, goal required" }, { status: 400 });
  }

  const agent = await createAgent(body);
  return NextResponse.json({ agent });
}
