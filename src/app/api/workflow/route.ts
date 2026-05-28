import { NextRequest, NextResponse } from "next/server";
import { createWorkflow, listWorkflowsForWallet } from "@/lib/agent/workflows";
import { ensureIndexes } from "@/lib/db/indexes";

/** GET ?wallet=0x... — list workflows for a wallet */
export async function GET(request: NextRequest) {
  await ensureIndexes();
  const wallet = request.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  const workflows = await listWorkflowsForWallet(wallet);
  return NextResponse.json({ workflows });
}

/** POST { walletAddress, name, prompt, budgetUsdc?, periodDays? } — create a new workflow */
export async function POST(request: NextRequest) {
  let body: {
    walletAddress: string;
    name:          string;
    prompt:        string;
    budgetUsdc?:   string;
    periodDays?:   number;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!body.walletAddress || !body.name || !body.prompt) {
    return NextResponse.json({ error: "walletAddress, name, prompt required" }, { status: 400 });
  }
  const workflow = await createWorkflow(body);
  return NextResponse.json({ workflow });
}
