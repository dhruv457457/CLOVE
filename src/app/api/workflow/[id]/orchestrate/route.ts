import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getWorkflow } from "@/lib/agent/workflows";
import { getAgent, agentOnChainAddress, updateAgent } from "@/lib/agent/agents";
import { getVeniceClient, VENICE_MODELS } from "@/lib/venice/client";
import { executeTool, type ExecutorContext } from "@/lib/agent/tools";
import {
  createHandoffPacket, updateHandoffPacket,
  type AgentHandoffPacket, type IntelligencePayload,
  type DecisionPayload, type ExecutionPayload,
} from "@/lib/agent/handoff";
import { saveThought, generateThoughtId, generateRunId } from "@/lib/agent/thoughts";
import { saveInsight } from "@/lib/agent/memory";
import { embedText } from "@/lib/agent/embeddings";

export const maxDuration = 300;

// ── SSE helpers ────────────────────────────────────────────────────────────────

function makeSSE(controller: ReadableStreamDefaultController<Uint8Array>) {
  const enc = new TextEncoder();
  return function send(event: string, data: Record<string, unknown>) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    try { controller.enqueue(enc.encode(payload)); } catch { /* closed */ }
  };
}

// ── Venice phase runner ────────────────────────────────────────────────────────

async function runAgentPhase(opts: {
  agentName:    string;
  agentRole:    "scout" | "risk" | "executor";
  systemPrompt: string;
  userMessage:  string;
  tools:        OpenAI.Chat.ChatCompletionTool[];
  ctx:          ExecutorContext;
  send:         ReturnType<typeof makeSSE>;
  runId:        string;
  agentId:      string;
}): Promise<{ toolResults: Array<{ tool: string; result: string; txHash?: string; cost?: number }>; finalText: string }> {
  const client = getVeniceClient();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: opts.systemPrompt },
    { role: "user",   content: opts.userMessage },
  ];

  const toolResults: Array<{ tool: string; result: string; txHash?: string; cost?: number }> = [];
  let finalText = "";

  for (let iter = 0; iter < 4; iter++) {
    let res: OpenAI.Chat.ChatCompletion;
    try {
      res = await client.chat.completions.create({
        model:           VENICE_MODELS.reasoning,
        messages,
        tools:           opts.tools.length > 0 ? opts.tools : undefined,
        tool_choice:     opts.tools.length > 0 ? "auto" : undefined,
        temperature:     0.3,
        response_format: { type: "json_object" },
      });
    } catch (e) {
      console.warn(`[orchestrate] ${opts.agentName} Venice call failed:`, e);
      break;
    }

    const msg = res.choices[0]?.message;
    if (!msg) break;
    messages.push(msg);

    // No tool calls → agent finished reasoning
    if (!msg.tool_calls?.length) {
      finalText = msg.content ?? "";
      break;
    }

    const toolMsgs: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];

    for (const tc of msg.tool_calls) {
      const call = tc as unknown as { id: string; function: { name: string; arguments: string } };
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments) as Record<string, unknown>; } catch { /**/ }

      // Emit tool-call thought
      const callThoughtId = generateThoughtId();
      opts.send("thought", {
        id:      callThoughtId,
        runId:   opts.runId,
        agentId: opts.agentId,
        agent:   opts.agentName,
        role:    opts.agentRole,
        tool:    call.function.name,
        content: `Calling ${call.function.name}(${JSON.stringify(args).slice(0, 120)})`,
      });

      const result = await executeTool(call.function.name, args, opts.ctx);
      toolResults.push({ tool: call.function.name, result: result.result, txHash: result.txHash, cost: result.cost });

      // Emit tool-result thought
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(result.result) as Record<string, unknown>; } catch { /**/ }
      opts.send("thought", {
        id:      generateThoughtId(),
        runId:   opts.runId,
        agentId: opts.agentId,
        agent:   opts.agentName,
        role:    opts.agentRole,
        tool:    call.function.name,
        content: (parsed.bestApy ? `Best APY: ${String(parsed.bestApy)}% on ${String(parsed.recommended ?? "?")}` : result.result.slice(0, 200)),
      });

      // Save to DB
      await saveThought({
        id: callThoughtId, agentId: opts.agentId, runId: opts.runId,
        type: "tool-call", content: { tool: call.function.name, args },
        parentId: null, position: { x: 400, y: 200 + toolResults.length * 80 },
      });

      toolMsgs.push({ role: "tool", tool_call_id: call.id, content: result.result });
    }

    messages.push(...toolMsgs);
  }

  return { toolResults, finalText };
}

// ── Live redelegation ──────────────────────────────────────────────────────────

async function liveRedelegate(
  parentContext: string,
  childAgent: Awaited<ReturnType<typeof getAgent>>,
  send: ReturnType<typeof makeSSE>,
): Promise<string> {
  if (!childAgent) return parentContext;
  if (!parentContext || parentContext === "0xdemo" || parentContext.length < 40) return "0xdemo";

  const apiKey    = process.env.ONESHOT_API_KEY;
  const apiSecret = process.env.ONESHOT_API_SECRET;
  const walletId  = process.env.ONESHOT_WALLET_ID;
  if (!apiKey || !apiSecret || !walletId) {
    send("redelegation-skipped", { reason: "1Shot not configured — using parent context" });
    return parentContext;
  }

  try {
    const childAddress = await agentOnChainAddress(childAgent);

    // Get 1Shot token
    const tokenRes = await fetch("https://api.1shotapi.com/v0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: apiKey, client_secret: apiSecret }),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) throw new Error(`1Shot token failed: ${tokenRes.status}`);
    const { access_token } = await tokenRes.json() as { access_token: string };

    // Redelegate
    const reRes = await fetch(
      `https://api.1shotapi.com/v0/wallets/${walletId}/redelegate-with-delegation-data`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ delegationData: parentContext, delegateAddress: childAddress }),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!reRes.ok) throw new Error(`1Shot redelegate failed: ${reRes.status} ${await reRes.text()}`);
    const result = await reRes.json() as { parent: string; redelegation: string };

    const chain = [JSON.parse(result.parent), JSON.parse(result.redelegation)];
    const newCtx = "0x" + Buffer.from(JSON.stringify(chain)).toString("hex");

    // Update agent's delegationContext in DB with the fresh runtime context
    await updateAgent(childAgent.id, {
      delegationContext:  newCtx,
      delegationStatus:   "active",
    });

    // 'for' is set by the caller via the redelegating event; pass contextHash for frontend
    send("redelegation-complete", {
      to:          childAgent.name,
      address:     childAddress,
      contextHash: newCtx.slice(0, 18) + "…",
    });

    return newCtx;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[orchestrate] live redelegate failed:", msg);
    send("redelegation-failed", { reason: msg, fallback: "using parent context" });
    return parentContext;
  }
}

// ── Extract intelligence from checkYields result ───────────────────────────────

function extractIntelligence(
  toolResults: Array<{ tool: string; result: string; cost?: number }>,
): IntelligencePayload | null {
  for (const r of toolResults) {
    if (r.tool === "checkYields") {
      try {
        const d = JSON.parse(r.result) as {
          bestApy?: number; recommended?: string; reason?: string;
          yields?: Record<string, { apy: number; tvl: string; risk: string }>;
          marketNews?: string; paidVia?: string; costPaid?: number;
        };
        return {
          bestApy:     d.bestApy     ?? 0,
          recommended: d.recommended ?? "unknown",
          reason:      d.reason      ?? "",
          yields:      d.yields      ?? {},
          marketNews:  d.marketNews,
          x402Cost:    d.costPaid    ?? r.cost ?? 0.01,
          fetchedAt:   Date.now(),
        };
      } catch { /**/ }
    }
  }
  return null;
}

// ── Extract decision from Risk Monitor's response ──────────────────────────────

function extractDecision(
  finalText: string,
  toolResults: Array<{ tool: string; result: string }>,
): DecisionPayload {
  // Try to parse finalText as JSON first (Venice should return JSON)
  let riskLevel: "LOW" | "MEDIUM" | "HIGH" = "LOW";

  // Check checkRisk tool result for risk level
  for (const r of toolResults) {
    if (r.tool === "checkRisk") {
      try {
        const d = JSON.parse(r.result) as { riskLevel?: string; safeToExecute?: boolean };
        if (d.riskLevel === "HIGH" || d.riskLevel === "MEDIUM" || d.riskLevel === "LOW") {
          riskLevel = d.riskLevel;
        }
      } catch { /**/ }
    }
  }

  // Parse the agent's JSON decision. We do NOT keyword-guess an action from prose
  // when parsing fails — that would fabricate a decision the agent never made.
  // A failure to produce a parseable decision is treated as "hold / not approved".
  try {
    const text = finalText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const d = JSON.parse(text) as Partial<DecisionPayload>;
    const action = (d.action as DecisionPayload["action"]) ?? "hold";
    return {
      action,
      protocol:   d.protocol,
      amount:     d.amount,
      confidence: typeof d.confidence === "number" ? d.confidence : 0.5,
      reasoning:  d.reasoning ?? finalText.slice(0, 280),
      // Only approve if the agent explicitly approved AND risk isn't HIGH.
      approved:   d.approved === true && riskLevel !== "HIGH" && action !== "hold",
      riskLevel,
    };
  } catch { /* fall through to a safe non-executing decision */ }

  // No parseable decision → do nothing (honest: the agent did not decide).
  return {
    action:     "hold",
    confidence: 0,
    reasoning:  "Risk agent did not return a parseable decision — holding (no action taken).",
    approved:   false,
    riskLevel,
  };
}

// ── Extract execution from executeDefi result ──────────────────────────────────

function extractExecution(
  toolResults: Array<{ tool: string; result: string; txHash?: string }>,
  decision: DecisionPayload,
): ExecutionPayload {
  for (const r of toolResults) {
    if (r.tool === "executeDefi") {
      try {
        const d = JSON.parse(r.result) as {
          submitted?: boolean; prepared?: boolean; txHash?: string;
          contractAddress?: string; via?: string; blocked?: boolean;
        };
        const txHash = r.txHash ?? d.txHash;
        // HONEST: success requires an actual on-chain submission (txHash or
        // submitted:true). A "prepared"-only result is unsigned calldata that was
        // never broadcast — it is NOT a successful execution.
        const wasSubmitted = !!txHash || d.submitted === true;
        return {
          txHash,
          protocol:        decision.protocol ?? "unknown",
          amount:          decision.amount   ?? "0",
          success:         wasSubmitted,
          via:             wasSubmitted ? (d.via ?? "1shot") : "not-executed",
          contractAddress: d.contractAddress,
          basescanUrl:     txHash ? `https://basescan.org/tx/${txHash}` : undefined,
        };
      } catch { /**/ }
    }
  }
  return { protocol: decision.protocol ?? "unknown", amount: decision.amount ?? "0", success: false, via: "not-executed" };
}

// ── Main orchestrator ──────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: workflowId } = await ctx.params;

  const wf = await getWorkflow(workflowId);
  if (!wf) return Response.json({ error: "Workflow not found" }, { status: 404 });
  if (wf.agentIds.length < 3) {
    return Response.json({ error: "Workflow needs at least 3 agents (Scout, Risk, Executor)" }, { status: 400 });
  }

  // Load agents
  const [scout, riskMonitor, executor] = await Promise.all([
    getAgent(wf.agentIds[0]),
    getAgent(wf.agentIds[1]),
    getAgent(wf.agentIds[2]),
  ]);
  if (!scout || !riskMonitor || !executor) {
    return Response.json({ error: "Could not load all agents" }, { status: 400 });
  }

  const runId = generateRunId();
  const walletAddress = wf.walletAddress;

  // Use workflow's permission if available, else individual agent's
  const rootContext = wf.permissionsContext ?? scout.delegationContext ?? "0xdemo";
  const delegationManager = wf.delegationManagerAddress ?? scout.delegationManagerAddress ?? "0x";

  const baseUrl = request.nextUrl.origin;

  // Create the handoff packet record
  const packet = await createHandoffPacket({
    workflowId,
    runId,
    scoutAgentId:    scout.id,
    riskAgentId:     riskMonitor.id,
    executorAgentId: executor.id,
    scoutName:       scout.name,
    riskName:        riskMonitor.name,
    executorName:    executor.name,
    scoutDelegationContext: rootContext,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = makeSSE(controller);

      send("orchestration-start", {
        packetId:  packet.id,
        runId,
        workflow:  wf.name,
        agents:    [scout.name, riskMonitor.name, executor.name],
      });

      let fullPacket: AgentHandoffPacket = packet;

      try {
        // ────────────────────────────────────────────────────────────────────
        // PHASE 1: SCOUT — fetch live intelligence (single x402 payment)
        // ────────────────────────────────────────────────────────────────────
        await updateHandoffPacket(packet.id, { phase: "scouting" });
        send("phase-start", { phase: "scouting", agent: scout.name, agentId: scout.id });

        const scoutCtx: ExecutorContext = {
          baseUrl,
          walletAddress,
          permissionsContext: rootContext,
          delegationManager,
          budgetUsdc:     scout.budgetUsdc,
          agentId:        scout.id,
          budgetUsedUsdc: scout.budgetUsedUsdc ?? 0,
        };

        const scoutTools = TOOL_DEFS.filter(t => ["checkYields"].includes((t as { function?: { name?: string } }).function?.name ?? ""));

        const { toolResults: scoutResults } = await runAgentPhase({
          agentName:    scout.name,
          agentRole:    "scout",
          systemPrompt: `You are ${scout.name}, an autonomous DeFi intelligence agent.
Your ONLY job in this run: call checkYields to fetch live APY data from Base DeFi protocols.
Do NOT execute any transactions. Do NOT call checkRisk. Just fetch and report.
After checkYields returns, stop — do not call any more tools.`,
          userMessage:  `Fetch live DeFi yields for ${wf.prompt}. Call checkYields now.`,
          tools:        scoutTools,
          ctx:          scoutCtx,
          send,
          runId,
          agentId:      scout.id,
        });

        const intelligence = extractIntelligence(scoutResults);

        if (!intelligence) {
          throw new Error("Scout failed to fetch intelligence");
        }

        await updateHandoffPacket(packet.id, { intelligence, phase: "redelegating-risk" });
        fullPacket = { ...fullPacket, intelligence };

        send("scout-complete", {
          intelligence,          // full nested object for frontend
          bestApy:     intelligence.bestApy,
          recommended: intelligence.recommended,
          x402Cost:    intelligence.x402Cost,
          yields:      intelligence.yields,
        });

        // Save Scout's insight as team memory
        const scoutInsightText = `Scout found best APY ${intelligence.bestApy}% on ${intelligence.recommended}. ${intelligence.reason}`;
        const scoutEmbedding = await embedText(scoutInsightText).catch(() => undefined);
        await saveInsight({
          agentId:       scout.id,
          walletAddress,
          rootAgentId:   scout.id,
          runId,
          text:          scoutInsightText,
          tags:          ["scout", "yield", intelligence.recommended.toLowerCase()],
          scope:         "team",
          embedding:     scoutEmbedding,
        });

        // ────────────────────────────────────────────────────────────────────
        // LIVE REDELEGATION 1: Scout → Risk Monitor
        // ────────────────────────────────────────────────────────────────────
        send("redelegating", {
          for:         "risk",
          from:        scout.name,
          to:          riskMonitor.name,
          description: "Handing intelligence + delegating authority to risk evaluator",
        });

        const riskCtx_context = await liveRedelegate(rootContext, riskMonitor, send);
        await updateHandoffPacket(packet.id, {
          riskDelegationContext: riskCtx_context,
          phase: "risk-check",
        });
        fullPacket = { ...fullPacket, riskDelegationContext: riskCtx_context };

        // ────────────────────────────────────────────────────────────────────
        // PHASE 2: RISK MONITOR — evaluate with Scout's exact findings
        // ────────────────────────────────────────────────────────────────────
        send("phase-start", { phase: "risk-check", agent: riskMonitor.name, agentId: riskMonitor.id });

        const yieldsFormatted = Object.entries(intelligence.yields)
          .map(([p, d]) => `  ${p}: ${d.apy}% APY (${d.risk} risk, TVL ${d.tvl})`)
          .join("\n");

        const riskCtx: ExecutorContext = {
          baseUrl,
          walletAddress,
          permissionsContext: riskCtx_context,
          delegationManager,
          budgetUsdc:     riskMonitor.budgetUsdc,
          agentId:        riskMonitor.id,
          budgetUsedUsdc: riskMonitor.budgetUsedUsdc ?? 0,
        };

        const riskTools = TOOL_DEFS.filter(t => ["checkRisk"].includes((t as { function?: { name?: string } }).function?.name ?? ""));

        const { toolResults: riskResults, finalText: riskFinalText } = await runAgentPhase({
          agentName:    riskMonitor.name,
          agentRole:    "risk",
          systemPrompt: `You are ${riskMonitor.name}, a DeFi risk evaluation agent.
Scout has already fetched live intelligence — do NOT call checkYields again.
Use checkRisk if needed to validate current market conditions.
Then output a JSON decision: { action, protocol, amount, confidence, reasoning, approved, riskLevel }`,
          userMessage: `Scout's intelligence (already paid via x402):
Best APY: ${intelligence.bestApy}% on ${intelligence.recommended}
Scout's reason: ${intelligence.reason}

All current yields:
${yieldsFormatted}

Market news: ${intelligence.marketNews ?? "No additional news"}

Goal: ${wf.prompt}

Evaluate this data. Is it safe to ${intelligence.recommended === "hold" ? "hold" : `deposit into ${intelligence.recommended}`}?
Return JSON: { "action": "deposit"|"hold"|"rebalance", "protocol": "...", "amount": "5", "confidence": 0.87, "reasoning": "...", "approved": true, "riskLevel": "LOW" }`,
          tools:   riskTools,
          ctx:     riskCtx,
          send,
          runId,
          agentId: riskMonitor.id,
        });

        const decision = extractDecision(riskFinalText, riskResults);
        await updateHandoffPacket(packet.id, { decision, phase: "redelegating-executor" });
        fullPacket = { ...fullPacket, decision };

        send("risk-complete", {
          action:     decision.action,
          protocol:   decision.protocol,
          amount:     decision.amount,
          confidence: decision.confidence,
          riskLevel:  decision.riskLevel,
          approved:   decision.approved,
          reasoning:  decision.reasoning.slice(0, 200),
        });

        if (!decision.approved || decision.action === "hold") {
          send("execution-skipped", { reason: `Risk Monitor decided to ${decision.action}: ${decision.reasoning.slice(0, 120)}` });
          await updateHandoffPacket(packet.id, {
            phase:     "complete",
            completedAt: new Date(),
            execution: { protocol: "none", amount: "0", success: false, via: "risk-blocked" },
          });
          send("orchestration-complete", { packet: { ...fullPacket, phase: "complete" }, skipped: true });
          controller.close();
          return;
        }

        // ────────────────────────────────────────────────────────────────────
        // LIVE REDELEGATION 2: Risk Monitor → Executor
        // ────────────────────────────────────────────────────────────────────
        send("redelegating", {
          for:         "executor",
          from:        riskMonitor.name,
          to:          executor.name,
          description: "Handing approved decision + delegating execution authority",
        });

        const execCtx_context = await liveRedelegate(riskCtx_context, executor, send);
        await updateHandoffPacket(packet.id, {
          executorDelegationContext: execCtx_context,
          phase: "executing",
        });
        fullPacket = { ...fullPacket, executorDelegationContext: execCtx_context };

        // ────────────────────────────────────────────────────────────────────
        // PHASE 3: EXECUTOR — act on Risk Monitor's approved decision
        // ────────────────────────────────────────────────────────────────────
        send("phase-start", { phase: "executing", agent: executor.name, agentId: executor.id });

        const execCtx: ExecutorContext = {
          baseUrl,
          walletAddress,
          permissionsContext: execCtx_context,
          delegationManager,
          budgetUsdc:     executor.budgetUsdc,
          agentId:        executor.id,
          budgetUsedUsdc: executor.budgetUsedUsdc ?? 0,
        };

        const execTools = TOOL_DEFS.filter(t => ["executeDefi", "notifyUser"].includes((t as { function?: { name?: string } }).function?.name ?? ""));

        const { toolResults: execResults } = await runAgentPhase({
          agentName:    executor.name,
          agentRole:    "executor",
          systemPrompt: `You are ${executor.name}, a DeFi execution agent.
Risk Monitor has approved a specific action — execute it EXACTLY as specified.
Do NOT re-evaluate risk. Do NOT check yields again. Just execute.
After executeDefi completes, call notifyUser to send a Telegram report.`,
          userMessage: `Risk Monitor approved this action:
Action: ${decision.action}
Protocol: ${decision.protocol ?? intelligence.recommended}
Amount: ${decision.amount ?? "5"} USDC
Reasoning: ${decision.reasoning}
Confidence: ${Math.round(decision.confidence * 100)}%

Intelligence basis: Scout found ${intelligence.bestApy}% APY on ${intelligence.recommended}.

Execute via executeDefi now. Then notify the user.`,
          tools:   execTools,
          ctx:     execCtx,
          send,
          runId,
          agentId: executor.id,
        });

        const execution = extractExecution(execResults, decision);
        const completedAt = new Date();

        await updateHandoffPacket(packet.id, {
          execution,
          phase:       "complete",
          completedAt,
        });
        fullPacket = { ...fullPacket, execution, phase: "complete", completedAt };

        send("execution-complete", {
          txHash:         execution.txHash,
          basescanUrl:    execution.basescanUrl,
          protocol:       execution.protocol,
          amount:         execution.amount,
          success:        execution.success,
          via:            execution.via,
        });

        // Save Executor's insight as team memory
        const execInsight = execution.success
          ? `Executed ${decision.action} ${execution.amount} USDC → ${execution.protocol} @ ${intelligence.bestApy}% APY. tx: ${execution.txHash ?? "pending"}`
          : `Execution failed for ${decision.protocol}: ${execution.error ?? "unknown error"}`;
        const execEmbedding = await embedText(execInsight).catch(() => undefined);
        await saveInsight({
          agentId:       executor.id,
          walletAddress,
          rootAgentId:   scout.id,
          runId,
          text:          execInsight,
          tags:          ["executor", decision.action, execution.protocol],
          scope:         "team",
          embedding:     execEmbedding,
        });

        send("orchestration-complete", {
          packet:   fullPacket,
          skipped:  false,
          x402Cost: intelligence.x402Cost,
          txHash:   execution.txHash,
        });

      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error("[orchestrate] error:", errMsg);
        await updateHandoffPacket(packet.id, { phase: "failed", error: errMsg });
        send("orchestration-error", { error: errMsg, packetId: packet.id });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache, no-transform",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ── Tool definitions subset (copied from tools.ts to avoid circular imports) ───

const TOOL_DEFS: OpenAI.Chat.ChatCompletionTool[] = [
  { type: "function", function: { name: "checkYields",  description: "Fetch live DeFi yields + market news. Pays 0.01 USDC via x402.",             parameters: { type: "object", properties: { protocols: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "checkRisk",    description: "Classify market risk (LOW/MEDIUM/HIGH) using web search.",                    parameters: { type: "object", required: ["context"], properties: { context: { type: "string" } } } } },
  { type: "function", function: { name: "executeDefi",  description: "Deposit/swap/stake on a DeFi protocol using ERC-7715 delegation via 1Shot.", parameters: { type: "object", required: ["protocol","amount","reasoning"], properties: { protocol: { type: "string", enum: ["morpho","uniswap","aerodrome","lido","aave"] }, action: { type: "string", enum: ["deposit","swap","stake","supply","lp"] }, amount: { type: "string" }, reasoning: { type: "string" } } } } },
  { type: "function", function: { name: "notifyUser",   description: "Send a Telegram update. ALWAYS the last tool call.",                          parameters: { type: "object", required: ["message"], properties: { message: { type: "string" } } } } },
];
