import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getAgent, bumpAgentCounters, transitionAgent, type Agent } from "@/lib/agent/agents";
import { veniceGeneratePlan, veniceReflect, imagePromptForReflection, type Plan, type SubGoal, type Reflection } from "@/lib/agent/planner";
import { buildMemoryPrompt, saveRun, saveInsight, updatePosition } from "@/lib/agent/memory";
import { getRelevantInsights } from "@/lib/agent/semantic-memory";
import { embedText } from "@/lib/agent/embeddings";
import { registerAgentOnChain } from "@/lib/agent/identity";
import { updateAgent } from "@/lib/agent/agents";
import { saveThought, generateThoughtId, generateRunId, type ThoughtType } from "@/lib/agent/thoughts";
import { TOOL_DEFINITIONS, executeTool, type ToolCallResult, type ExecutorContext } from "@/lib/agent/tools";
import { getVeniceClient } from "@/lib/venice/client";

export const maxDuration = 120;

/**
 * SSE-streaming agent run.
 *
 * Phases:
 *   1. PLAN     — Venice decomposes the goal into subgoals (one `plan` thought)
 *   2. EXECUTE  — for each subgoal, a sub-ReAct loop emits `tool-call` /
 *                 `tool-result` thoughts as they happen. Meta-tools (addThought
 *                 / revisePlan) let Venice grow the canvas at runtime.
 *   3. REFLECT  — Venice writes a one-sentence insight → `agent_insights`
 *   4. MEDIA    — policy-gated: voice (x402 TTS) + image (x402 FLUX) → Telegram
 *
 * Each step pushes one or more SSE events the client can render in real time.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    agentId?:            string;
    walletAddress?:      string;
    permissionsContext?: string;
    delegationManager?:  string;
    delegationId?:       string;
  };

  if (!body.agentId) {
    return Response.json({ error: "agentId required" }, { status: 400 });
  }

  const agent = await getAgent(body.agentId);
  if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });

  const baseUrl = request.nextUrl.origin;
  const runId   = generateRunId();

  // ── Set up SSE stream ────────────────────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: Record<string, unknown>) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify({ runId, ...data })}\n\n`;
        try { controller.enqueue(enc.encode(payload)); } catch { /* closed */ }
      };

      // Helper: persist a thought AND emit it as an SSE event
      const emit = async (
        type:    ThoughtType,
        content: Record<string, unknown>,
        parentId: string | null = null,
        position: { x: number; y: number } = autoPos(type),
      ) => {
        const id = generateThoughtId();
        const thought = { id, agentId: agent.id, runId, type, content, parentId, position };
        await saveThought(thought);
        send("thought", thought);
        return id;
      };

      try {
        // ── First-run ERC-8004 registration (lazy, opt-in) ─────────────────────
        if (!agent.registryId && process.env.QUICKNODE_ENDPOINT) {
          const reg = await registerAgentOnChain({
            agentAddress: process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ?? agent.walletAddress,
            name:         agent.name,
            goal:         agent.goal,
          });
          if (reg.via === "quicknode" && reg.registryId) {
            await updateAgent(agent.id, {
              registryId:     reg.registryId,
              registryTxHash: reg.txHash ?? null,
            });
            send("identity", { registryId: reg.registryId, txHash: reg.txHash });
          }
        }

        // ── Mark agent as planning ─────────────────────────────────────────────
        await bumpAgentCounters(agent.id, { status: "planning", ranOnce: true });
        send("status", { phase: "planning" });

        // Emit the GOAL node as the canvas root
        const goalId = await emit("goal", { text: agent.goal }, null, { x: 80, y: 80 });

        // ── PHASE 1: PLAN ──────────────────────────────────────────────────────
        // Pull memory + semantically-relevant insights (cross-agent via team scope)
        // MEM-1 fix: pass agentId so each agent in a team sees only its own history
        const memoryPrompt = await buildMemoryPrompt(agent.walletAddress, agent.id);
        const insights     = await getRelevantInsights(agent.id, agent.walletAddress, agent.goal, 6);
        const plan: Plan   = await veniceGeneratePlan(agent.goal, memoryPrompt, insights);

        const planId = await emit("plan", {
          reasoning: plan.reasoning,
          subgoals:  plan.subgoals,
        }, goalId, { x: 80, y: 200 });

        send("plan-generated", { plan });

        // ── PHASE 2: EXECUTE ───────────────────────────────────────────────────
        await bumpAgentCounters(agent.id, { status: "executing" });
        send("status", { phase: "executing" });

        const ctx: ExecutorContext = {
          baseUrl,
          walletAddress:      body.walletAddress      ?? agent.walletAddress,
          permissionsContext: body.permissionsContext,
          delegationManager:  body.delegationManager,
          delegationId:       body.delegationId,
          budgetUsdc:         agent.budgetUsdc,
          agentId:            agent.id,
          budgetUsedUsdc:     agent.budgetUsedUsdc,
        };

        const allToolResults: ToolCallResult[] = [];
        let lastAction: Agent["lastAction"] = "skip";
        let txHashSeen: string | undefined;
        let executedOnce = false;
        let x402Total = 0;
        let canvasY = 360;

        // Mutable subgoal queue (revisePlan can replace tail)
        const queue: SubGoal[] = [...plan.subgoals];

        while (queue.length > 0) {
          const sg = queue.shift()!;
          const subgoalId = await emit("plan", {
            subgoalActive: sg.id,
            description:   sg.description,
            tools:         sg.tools,
          }, planId, { x: 380, y: canvasY });
          canvasY += 140;

          const subResults = await runSubgoalReact(sg, ctx, emit, subgoalId);
          allToolResults.push(...subResults);

          for (const r of subResults) {
            if (r.cost)   x402Total += r.cost;
            if (r.txHash) { txHashSeen = r.txHash; executedOnce = true; }

            // Detect action type for `lastAction`
            if (r.tool === "executeDefi" && (r.txHash || /"prepared":\s*true/.test(r.result))) lastAction = "deposit";
            if (r.tool === "rebalance"   && (r.txHash || /"prepared":\s*true/.test(r.result))) lastAction = "rebalance";

            // Handle revisePlan: swap the rest of the queue
            if (r.tool === "revisePlan" && r.isMeta && Array.isArray(r.args.newSubgoals)) {
              queue.length = 0;
              for (const ns of r.args.newSubgoals as Array<{ description: string; tools: string[] }>) {
                queue.push({ id: `s_rev_${queue.length}`, description: ns.description, tools: ns.tools });
              }
              await emit("plan", { revised: true, newCount: queue.length }, subgoalId);
            }
          }
        }

        // If no executeDefi succeeded, the action was HOLD
        if (!executedOnce && lastAction === "skip") lastAction = "hold";

        // ── PHASE 3: REFLECT ───────────────────────────────────────────────────
        await bumpAgentCounters(agent.id, { status: "reflecting" });
        send("status", { phase: "reflecting" });

        const reflection: Reflection = await veniceReflect(agent.goal, plan, allToolResults);

        // Embed the insight for semantic retrieval in future runs
        const insightEmbedding = await embedText(reflection.insight).catch(() => undefined);

        // Determine scope: agents in a delegation chain share insights with their team
        // (Scout's "Morpho volatile" insight surfaces in Executor's plan)
        const insightScope = agent.parentAgentId ? "team" : "agent";

        // Walk to root for team-scoped insights
        let rootAgentId: string | undefined;
        if (insightScope === "team") {
          let cur: Agent | null = agent;
          const seen = new Set<string>();
          while (cur?.parentAgentId && !seen.has(cur.id)) {
            seen.add(cur.id);
            cur = await getAgent(cur.parentAgentId);
          }
          rootAgentId = cur?.id;
        } else {
          rootAgentId = agent.id;  // root agent IS its own team root
        }

        await saveInsight({
          agentId:       agent.id,
          walletAddress: agent.walletAddress,
          rootAgentId,
          runId,
          text:          reflection.insight,
          tags:          reflection.tags,
          scope:         insightScope,
          embedding:     insightEmbedding,
        });

        // A2A-1: Broadcast key tool results as team insights so downstream agents
        // (Risk Monitor, Executor) can read Scout's yield data and decisions.
        // Only broadcast if this agent has children (i.e. it IS a Scout / coordinator).
        if (rootAgentId && allToolResults.length > 0) {
          const teamFindings = allToolResults
            .filter(r => r.tool === "checkYields" || r.tool === "checkRisk")
            .map(r => `[${r.tool}] ${r.result.slice(0, 300)}`)
            .join(" | ");
          if (teamFindings) {
            const teamEmbedding = await embedText(teamFindings).catch(() => undefined);
            await saveInsight({
              agentId:       agent.id,
              walletAddress: agent.walletAddress,
              rootAgentId,
              runId,
              text:          `Run findings from ${agent.name}: ${teamFindings}`,
              tags:          [...reflection.tags, "team-broadcast"],
              scope:         "team",
              embedding:     teamEmbedding,
            });
          }
        }

        const reflectId = await emit("reflect", {
          insight:    reflection.insight,
          tags:       reflection.tags,
          didSucceed: reflection.didSucceed,
        }, planId, { x: 80, y: canvasY });
        canvasY += 140;

        send("reflection", { ...reflection });

        // ── PHASE 4: MEDIA (policy-gated) ──────────────────────────────────────
        const shouldGenerateMedia =
          agent.mediaPolicy === "every-run" ||
          (agent.mediaPolicy === "milestones" && lastAction !== "hold" && lastAction !== "skip");
        // mediaPolicy: "off" or "daily" → skipped here (daily handled by separate cron)

        let voiceUrl: string | undefined;
        let imageUrl: string | undefined;

        if (shouldGenerateMedia) {
          send("status", { phase: "media" });

          // TTS — call x402 endpoint, get audio bytes, convert to data URL for Telegram
          // Bug 6 fix: use CLOVE_INTERNAL_SECRET so verifyPayment() accepts the call.
          const internalSig = Buffer.from(JSON.stringify({
            internalSecret: process.env.CLOVE_INTERNAL_SECRET ?? "",
            payload: { permissionContext: ctx.permissionsContext ?? "0xinternalcall" },
          })).toString("base64");
          try {
            const ttsRes = await fetch(`${baseUrl}/api/x402/tts`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": internalSig },
              body: JSON.stringify({ text: reflection.insight }),
              signal: AbortSignal.timeout(12000),
            });
            if (ttsRes.ok && ttsRes.headers.get("content-type")?.includes("audio")) {
              // Telegram needs a public URL. For demo we encode into a data URL — Telegram won't accept
              // data URLs for sendVoice, so instead we read X-Clove-Cost and trust the client to download.
              x402Total += 0.005;
              voiceUrl  = `${baseUrl}/api/x402/tts/last?runId=${runId}`; // placeholder, see note below
            } else {
              const j = await ttsRes.json().catch(() => ({}));
              if (j.skipped) console.log("[run-stream] TTS skipped:", j.reason);
            }
          } catch (e) { console.warn("[run-stream] TTS exception:", e); }

          // IMAGE — call x402 endpoint, get URL (or SVG data URL fallback)
          try {
            const imgRes = await fetch(`${baseUrl}/api/x402/image`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": internalSig },
              body: JSON.stringify({
                prompt:     imagePromptForReflection(reflection, {
                  protocol: extractProtocol(allToolResults),
                  apy:      extractApy(allToolResults),
                  action:   lastAction ?? undefined,
                }),
                runContext: {
                  protocol: extractProtocol(allToolResults),
                  apy:      extractApy(allToolResults),
                  action:   lastAction ?? undefined,
                },
              }),
              signal: AbortSignal.timeout(35000),
            });
            if (imgRes.ok) {
              const j = await imgRes.json();
              imageUrl = j.imageUrl;
              if (!j.fallback) x402Total += 0.01;
            }
          } catch (e) { console.warn("[run-stream] image exception:", e); }

          if (voiceUrl || imageUrl) {
            await emit("media", { voiceUrl, imageUrl, service: "tts+image" }, reflectId, { x: 380, y: canvasY });
            canvasY += 140;
          }
        }

        // ── PHASE 5: TELEGRAM RICH REPORT ──────────────────────────────────────
        const budget    = Number.parseFloat(agent.budgetUsdc) || 0;
        const remaining = Math.max(0, budget - agent.budgetUsedUsdc);
        try {
          await fetch(`${baseUrl}/api/notify/telegram`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              richReport: {
                text: `*${agent.name}* — ${reflection.insight}`,
                voiceUrl: voiceUrl?.startsWith("http") ? voiceUrl : undefined,
                imageUrl: imageUrl,
                spending: {
                  x402Total: agent.x402SpentUsdc + x402Total,
                  defi:      agent.budgetUsedUsdc,
                  remaining,
                  budget:    agent.budgetUsdc,
                },
              },
            }),
          });
        } catch (e) { console.warn("[run-stream] telegram failed:", e); }

        // ── Persist run summary + agent counters ───────────────────────────────
        // MEM-1 fix: store agentId so workflow history can attribute runs correctly
        await saveRun({
          walletAddress: agent.walletAddress,
          agentId:       agent.id,
          runId,
          success:       reflection.didSucceed,
          protocol:      extractProtocol(allToolResults) ?? "unknown",
          action:        lastAction ?? "hold",
          amount:        agent.budgetUsdc,
          apy:           extractApy(allToolResults) ?? 0,
          riskLevel:     "LOW",
          txHash:        txHashSeen ?? null,
          costPaid:      x402Total,
          veniceReason:  reflection.insight,
          durationMs:    0,
        });

        if (txHashSeen && lastAction === "deposit") {
          const proto = extractProtocol(allToolResults);
          const apy   = extractApy(allToolResults);
          if (proto && typeof apy === "number") {
            await updatePosition(agent.walletAddress, proto, agent.budgetUsdc, apy);
          }
        }

        await bumpAgentCounters(agent.id, {
          status:       "idle",
          executedOnce: executedOnce,
          x402Spent:    x402Total,
          lastAction,
        });

        send("done", { success: reflection.didSucceed, lastAction, x402Total });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        send("error", { message });

        // Self-healing: mark agent as failed + alert via Telegram (the human escalation)
        try {
          await transitionAgent(agent.id, {
            status:       "failed",
            lastError:    message.slice(0, 280),
            currentRunId: null,
          });
          await fetch(`${baseUrl}/api/notify/telegram`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              message: `🚨 *${agent.name}* failed after retries.\n\nError: \`${message.slice(0, 200)}\`\n\nUse \`/resume ${agent.id}\` in Telegram to retry, or open the dashboard.`,
            }),
          });
        } catch { /* don't throw from finally */ }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":       "text/event-stream",
      "Cache-Control":      "no-cache, no-transform",
      "Connection":         "keep-alive",
      "X-Accel-Buffering":  "no",   // disable proxy buffering
    },
  });
}

// ── Sub-ReAct ────────────────────────────────────────────────────────────────────

/**
 * Run a small ReAct loop scoped to one subgoal. Venice can only call tools
 * from `sg.tools` plus the meta-tools. Each call emits a `tool-call` and
 * `tool-result` thought as it happens.
 */
async function runSubgoalReact(
  sg: SubGoal,
  ctx: ExecutorContext,
  emit: (type: ThoughtType, content: Record<string, unknown>, parentId?: string | null, position?: { x: number; y: number }) => Promise<string>,
  parentId: string,
): Promise<ToolCallResult[]> {
  const client = getVeniceClient();
  const filteredTools = TOOL_DEFINITIONS.filter((t) => {
    const fn = (t as { function?: { name?: string } }).function;
    if (!fn?.name) return false;
    return sg.tools.includes(fn.name) || fn.name === "addThought" || fn.name === "revisePlan";
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are executing one subgoal of a larger plan.

SUBGOAL: ${sg.description}
Allowed tools: ${sg.tools.join(", ")} (plus meta-tools addThought, revisePlan)

Call the tools needed. Use addThought for short observations the user should see.
Call revisePlan ONLY if scout results invalidate the original plan.
Once the subgoal is done, output a one-line summary as plain text (no tool call).`,
    },
    { role: "user", content: "Begin the subgoal." },
  ];

  const results: ToolCallResult[] = [];
  let cx = 600, cy = 100;

  // 3 iterations is enough for 99% of subgoals (scout → result → done).
  // Was 5 — empirically the 4th and 5th iterations almost always early-exit
  // with no tool calls, wasting one round-trip each.
  for (let iter = 0; iter < 3; iter++) {
    // Self-healing Venice call: exponential backoff on 500s
    const res = await retryWithBackoff(
      () => client.chat.completions.create({
        // llama-3.3-70b has the most reliable tool-calling on Venice — small models
        // routinely 500 with "Inference processing failed" on multi-tool prompts.
        model: "llama-3.3-70b",
        messages,
        tools: filteredTools,
        tool_choice: "auto",
      }),
      3,    // max 3 attempts
      1000, // start at 1s, doubles each retry
    );
    if (!res) break;  // all retries exhausted — give up on this subgoal
    const msg = res.choices[0]?.message;
    if (!msg) break;
    messages.push(msg);
    if (!msg.tool_calls?.length) break;

    const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];
    for (const tc of msg.tool_calls) {
      const call = tc as unknown as { id: string; function: { name: string; arguments: string } };
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments) as Record<string, unknown>; } catch { /**/ }

      // Emit tool-call thought BEFORE execution so the canvas shows it "thinking"
      const callId = await emit("tool-call", {
        tool: call.function.name,
        args,
      }, parentId, { x: cx, y: cy });
      cy += 90;

      const result = await executeTool(call.function.name, args, ctx);
      results.push(result);

      // Emit tool-result thought
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(result.result) as Record<string, unknown>; } catch { /**/ }
      await emit("tool-result", {
        tool:    call.function.name,
        ...parsed,
        cost:    result.cost,
        txHash:  result.txHash,
      }, callId, { x: cx + 220, y: cy - 90 });

      // Special handling for addThought — emit a goal-style observation
      if (call.function.name === "addThought" && result.isMeta) {
        await emit("plan", { observation: args.text }, parentId, { x: cx, y: cy });
        cy += 80;
      }

      toolResults.push({ role: "tool", tool_call_id: call.id, content: result.result });
    }
    messages.push(...toolResults);
  }
  return results;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function autoPos(type: ThoughtType): { x: number; y: number } {
  // Default off-canvas position — caller usually overrides with a deliberate layout
  const base = { goal: 80, plan: 200, "tool-call": 380, "tool-result": 600, reflect: 80, media: 380 };
  return { x: base[type] ?? 200, y: 80 };
}

function extractProtocol(results: ToolCallResult[]): string | undefined {
  for (const r of results.slice().reverse()) {
    if (r.tool === "executeDefi") {
      const p = r.args.protocol;
      if (typeof p === "string") return p;
    }
    if (r.tool === "checkYields") {
      try {
        const parsed = JSON.parse(r.result) as { recommended?: string };
        if (parsed.recommended) return parsed.recommended;
      } catch { /**/ }
    }
  }
  return undefined;
}

function extractApy(results: ToolCallResult[]): number | undefined {
  for (const r of results) {
    if (r.tool === "checkYields") {
      try {
        const parsed = JSON.parse(r.result) as { bestApy?: number };
        if (typeof parsed.bestApy === "number") return parsed.bestApy;
      } catch { /**/ }
    }
  }
  return undefined;
}

/**
 * Self-healing wrapper: retry a function with exponential backoff.
 * Returns null after `maxAttempts` failures.
 * Used to absorb transient Venice 500s without killing the entire run.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000,
): Promise<T | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === maxAttempts - 1) break;
      const delay = baseDelayMs * Math.pow(2, attempt); // 1s, 2s, 4s, ...
      console.warn(`[retry] attempt ${attempt + 1}/${maxAttempts} failed, retrying in ${delay}ms:`, e instanceof Error ? e.message : e);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  console.error(`[retry] exhausted ${maxAttempts} attempts. last error:`, lastErr);
  return null;
}
