import { NextRequest, NextResponse } from "next/server";
import { runWorkflow, type AgentState } from "@/lib/agent/executor";
import type { CompiledWorkflow } from "@/lib/aiCompiler";

export const maxDuration = 60; // Vercel: allow up to 60s for full agent run

export async function POST(request: NextRequest) {
  let body: {
    workflow:    CompiledWorkflow;
    state:       Partial<AgentState>;
  };

  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  if (!body.workflow?.nodes?.length) {
    return NextResponse.json({ error: "workflow.nodes is required" }, { status: 400 });
  }

  // Derive base URL from request (works on localhost + Vercel)
  const origin = request.nextUrl.origin;

  try {
    const result = await runWorkflow(body.workflow, body.state ?? {}, origin);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Agent run failed" },
      { status: 500 }
    );
  }
}
