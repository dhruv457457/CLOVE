import { NextRequest, NextResponse } from "next/server";
import { compileStrategyWithVenice } from "@/lib/venice/compiler";
import { saveWorkflow } from "@/lib/agent/memory";

export async function POST(request: NextRequest) {
  let body: { prompt: string; walletAddress?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  try {
    const workflow = await compileStrategyWithVenice(body.prompt);

    // Save workflow to MongoDB if we know the wallet (enables cron re-execution)
    if (body.walletAddress) {
      saveWorkflow(body.walletAddress, workflow, body.prompt).catch(() => {});
    }

    return NextResponse.json(workflow);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Compilation failed" },
      { status: 500 }
    );
  }
}
