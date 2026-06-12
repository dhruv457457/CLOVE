import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getAgent, bumpAgentCounters, transitionAgent, type Agent } from "@/lib/agent/agents";
import { veniceGeneratePlan, veniceReflect, imagePromptForReflection, type Plan, type SubGoal, type Reflection } from "@/lib/agent/planner";
import { buildMemoryPrompt, saveRun, saveInsight, updatePosition } from "@/lib/agent/memory";
import { getRelevantInsights } from "@/lib/agent/semantic-memory";
import { getRelevantKnowledge, formatKnowledgeForPrompt } from "@/lib/agent/knowledge";
import { embedText } from "@/lib/agent/embeddings";
import { registerAgentOnChain } from "@/lib/agent/identity";
import { updateAgent } from "@/lib/agent/agents";
import { saveThought, generateThoughtId, generateRunId, type ThoughtType } from "@/lib/agent/thoughts";
import { internalHeaders } from "@/lib/auth/internal";
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

        // ── Guard: require a real ERC-7715 permission before running ─────────
        // Agents without a real delegationContext cannot execute on-chain.
        // Abort immediately with a clear error — never run in demo mode.
        const hasRealCtx =
          agent.delegationContext &&
          agent.delegationContext !== "0xdemo" &&
          agent.delegationContext !== "0x" &&
          agent.delegationContext.length > 20 &&
          !/^0x0*$/.test(agent.delegationContext);

        // READ-ONLY agents (scouts / analyzers) research + write to shared team
        // memory but never transact — they have a "0xresearch-only" context and a
        // 0 budget. They're allowed to run WITHOUT a spending permission; they
        // simply can't call executeDefi (and the forced-deposit path is gated on
        // a real context below). Only block a SPENDING agent that lacks a grant.
        const isReadOnly =
          agent.delegationContext === "0xresearch-only" ||
          (Number(agent.budgetUsdc) || 0) === 0;

        if (!hasRealCtx && !isReadOnly) {
          send("error", {
            message:
              "No real ERC-7715 permission found for this agent. " +
              "Click 'Grant Permission' in the dashboard to sign a delegation before running.",
            code: "needs-permission",
          });
          return;
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
        // RAG: inject the user's uploaded playbook/rules relevant to this goal.
        const knowledge    = await getRelevantKnowledge(agent.id, agent.goal, 5);
        const fullMemory   = memoryPrompt + formatKnowledgeForPrompt(knowledge);
        const insights     = await getRelevantInsights(agent.id, agent.walletAddress, agent.goal, 6);
        // Copy-trader has two modes — tell the planner which entry tool to use:
        // friend mode (wallets set) → checkWhaleTrades; discovery → discoverWhales.
        const hasWallets   = Array.isArray((agent.typeConfig as { wallets?: unknown[] } | undefined)?.wallets)
          && ((agent.typeConfig as { wallets: unknown[] }).wallets.length > 0);
        const plan: Plan   = await veniceGeneratePlan(agent.goal, fullMemory, insights, agent.agentType, hasWallets);

        const planId = await emit("plan", {
          reasoning: plan.reasoning,
          subgoals:  plan.subgoals,
        }, goalId, { x: 80, y: 200 });

        send("plan-generated", { plan });

        // ── PHASE 2: EXECUTE ───────────────────────────────────────────────────
        await bumpAgentCounters(agent.id, { status: "executing" });
        send("status", { phase: "executing" });

        // Resolve permissionsContext: agent DB (authoritative) → body → undefined.
        // The agent's stored delegationContext is its OWN authority — for A2A
        // workers this is a SCOPED, on-chain-capped chain (user→FM→worker→relayer).
        // It MUST take precedence over body.permissionsContext (the root grant the
        // dashboard sends), otherwise a worker would redeem the uncapped root and
        // bypass its ERC20TransferAmountEnforcer cap. Body is only a fallback for
        // agents that have no real stored context yet.
        const resolvedPermCtx =
          (agent.delegationContext && agent.delegationContext !== "0xdemo" && agent.delegationContext.length > 20)
            ? agent.delegationContext
            : (body.permissionsContext && body.permissionsContext !== "0xdemo" && body.permissionsContext.length > 20)
                ? body.permissionsContext
                : undefined;

        const ctx: ExecutorContext = {
          baseUrl,
          walletAddress:      body.walletAddress      ?? agent.walletAddress,
          permissionsContext: resolvedPermCtx,
          delegationManager:  body.delegationManager  ?? agent.delegationManagerAddress ?? "0x",
          delegationId:       body.delegationId,
          budgetUsdc:         agent.budgetUsdc,
          agentId:            agent.id,
          budgetUsedUsdc:     agent.budgetUsedUsdc,
          chainId:            agent.chainId,
          typeConfig:         agent.typeConfig,
          // Copy-desk workers carry a root-grant fallback for relayer rejection
          // of their scoped multi-hop chain (the swap still lands; cap then
          // enforced off-chain by the budget guard).
          fallbackPermissionsContext: agent.rootFallbackContext,
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
            // BREAK-4: accumulate spend within this run so the next executeDefi
            // call in the same run sees the updated used amount in the budget guard.
            if (r.tool === "executeDefi" && r.txHash) {
              // BREAK-4 fix: r.args.amount is the USDC string the agent passed in
              // (e.g. "0.1"), not the Wei bigint from defaultAmount. Use args, not result.
              const spent = parseFloat(String(r.args?.amount ?? "0")) || 0;
              ctx.budgetUsedUsdc = (ctx.budgetUsedUsdc ?? 0) + spent;
            }

            // Detect action type for `lastAction`. HONEST: only count an action as
            // executed when it was actually broadcast on-chain (real txHash, or 1Shot
            // returned submitted:true). "prepared:true" is mere calldata that was never
            // submitted — reporting it as a deposit/rebalance would fabricate an outcome.
            const wasSubmitted = !!r.txHash || /"submitted":\s*true/.test(r.result);
            if (r.tool === "executeDefi" && wasSubmitted) lastAction = "deposit";
            if (r.tool === "rebalance"   && wasSubmitted) lastAction = "rebalance";

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

        // ── FORCED EXECUTION ──────────────────────────────────────────────────
        // Venice's ReAct loop is non-deterministic and often "holds" even when the
        // goal explicitly says to execute. When the user's goal demands immediate
        // execution and the loop didn't broadcast a tx, force a direct executeDefi
        // so the intent is honored deterministically. This is a REAL on-chain call
        // via the relayer — not a simulation.
        const wantsImmediate = /execute\s+immediately|execute\s+now|just\s+execute|supply\s+\$?\d/i.test(agent.goal);
        // A FRESH yield/rebalancer agent (budget granted, nothing deployed yet)
        // should make its FIRST deposit rather than hold indefinitely — unless
        // risk came back HIGH. This makes "deploy my capital" the default on run 1,
        // matching what a yield agent is for. Subsequent runs use normal reasoning.
        const isYieldType   = !agent.agentType || agent.agentType === "yield" || agent.agentType === "rebalancer";
        const neverExecuted = (agent.totalExecuted ?? 0) === 0 && (agent.budgetUsedUsdc ?? 0) === 0;
        const sawHighRisk   = allToolResults.some(r => r.tool === "checkRisk" && /\bhigh\b/i.test(r.result));
        // Only a SPENDING agent (real context + budget) may force a first deposit —
        // never a read-only scout/analyzer.
        const canSpend      = !!hasRealCtx && (Number(agent.budgetUsdc) || 0) > 0;
        const shouldFirstDeposit = canSpend && isYieldType && neverExecuted && !sawHighRisk;

        if (!executedOnce && (wantsImmediate || shouldFirstDeposit)) {
          // Protocol: first one named in the goal, else Morpho (a safe blue-chip default).
          const protoMatch = agent.goal.toLowerCase().match(/\b(morpho|aave|uniswap|aerodrome|lido)\b/);
          const protocol = protoMatch ? protoMatch[1] : "morpho";
          // Amount: parse from the goal, else the full budget — then leave room
          // for the relayer fee so fee+work stays UNDER the on-chain cap (else the
          // ERC20TransferAmountEnforcer would revert). Floor at 0.1 USDC.
          const budgetNum = Number(agent.budgetUsdc) || 1;
          const amtMatch  = agent.goal.match(/\$?\s*(\d+(?:\.\d+)?)\s*USDC/i);
          const parsed    = amtMatch ? Number(amtMatch[1]) : budgetNum;
          const amount    = Math.max(0.1, Math.min(parsed, budgetNum - 0.2)).toFixed(2);

          await emit("plan", { observation: `Deploying first position — executeDefi(${protocol}, ${amount} USDC) within the ${budgetNum} USDC cap.` }, planId, { x: 380, y: canvasY });
          canvasY += 100;

          const forced = await executeTool("executeDefi", {
            protocol, amount, action: "deposit",
            reasoning: "Forced execution: goal demands immediate on-chain action.",
          }, ctx);
          allToolResults.push(forced);

          let fparsed: Record<string, unknown> = {};
          try { fparsed = JSON.parse(forced.result) as Record<string, unknown>; } catch { /**/ }
          await emit("tool-result", { tool: "executeDefi", ...fparsed, txHash: forced.txHash }, planId, { x: 600, y: canvasY });
          canvasY += 120;

          const fSubmitted = !!forced.txHash || /"submitted":\s*true/.test(forced.result);
          if (fSubmitted) { txHashSeen = forced.txHash; executedOnce = true; lastAction = "deposit"; }
        }

        // ── FORCED COPY — deterministic perception + execution ────────────────
        // Venice's tool-calling is unreliable: some runs it never calls ANY tool
        // (no discoverWhales, no executeCopyTrade — just text). The agent must
        // not depend on the model's mood for its data: if the LLM skipped the
        // read tool, the SERVER fetches the smart-money data itself, then mirrors
        // the strongest copyable signal deterministically. The LLM judges; the
        // pipeline perceives and acts. Every non-execution records a holdReason
        // the user can actually see.
        let holdReason: string | null = null;
        const isCopyType = agent.agentType === "copy-trader";
        if (isCopyType && !executedOnce) {
          if (!canSpend) {
            holdReason = "No spending authority — agent has no real permission or zero budget.";
          } else if (sawHighRisk) {
            holdReason = "Risk check returned HIGH — execution intentionally skipped.";
          } else {
            // 1. Deterministic perception: if the model never called its read tool,
            //    fetch the data server-side so the run always has real signals.
            const hasWhaleData = allToolResults.some(r => r.tool === "discoverWhales" || r.tool === "checkWhaleTrades");
            if (!hasWhaleData) {
              const readTool = hasWallets ? "checkWhaleTrades" : "discoverWhales";
              await emit("plan", { observation: `Model skipped its tools this run — fetching smart-money data deterministically via ${readTool}.` }, planId, { x: 380, y: canvasY });
              canvasY += 100;
              const read = await executeTool(readTool, {}, ctx);
              allToolResults.push(read);
              let rparsed: Record<string, unknown> = {};
              try { rparsed = JSON.parse(read.result) as Record<string, unknown>; } catch { /**/ }
              await emit("tool-result", { tool: readTool, ...rparsed }, planId, { x: 600, y: canvasY });
              canvasY += 120;
            }

            // 2. Resolve the copy target: discoverWhales.copyTarget (discovery),
            //    else the freshest checkWhaleTrades trade with a real address (friend).
            let copyAddr: string | undefined, copySym: string | undefined;
            for (const r of allToolResults) {
              if (r.tool === "discoverWhales") {
                try {
                  const d = JSON.parse(r.result) as { copyTarget?: { tokenAddress?: string; symbol?: string } };
                  if (d.copyTarget?.tokenAddress) { copyAddr = d.copyTarget.tokenAddress; copySym = d.copyTarget.symbol; }
                } catch { /**/ }
              }
              if (r.tool === "checkWhaleTrades" && !copyAddr) {
                try {
                  const d = JSON.parse(r.result) as { trades?: Array<{ token?: string; symbol?: string }> };
                  const t = (d.trades ?? []).find(x => typeof x.token === "string" && /^0x[a-fA-F0-9]{40}$/.test(x.token!) && !/^0x0+$/.test(x.token!));
                  if (t) { copyAddr = t.token; copySym = t.symbol; }
                } catch { /**/ }
              }
            }

            // 3. Act deterministically — or record exactly why we can't.
            if (!copyAddr) {
              // discoverWhales explains its own selection outcome (all tokens
              // already held / tier liquidity rules / no address) — prefer that.
              let discoverReason: string | undefined;
              for (const r of allToolResults) {
                if (r.tool === "discoverWhales") {
                  try { discoverReason = (JSON.parse(r.result) as { instruction?: string }).instruction; } catch { /**/ }
                }
              }
              holdReason = hasWallets
                ? "Tracked wallets made no qualifying buys in the lookback window — nothing to copy."
                : (discoverReason ?? "No converged token carried a usable contract address — nothing safe to copy.");
            } else {
              const budgetNum = Number(agent.budgetUsdc) || 1;
              const ratio = (agent.typeConfig as { copyRules?: { copyRatio?: number } } | undefined)?.copyRules?.copyRatio;
              const amount = Math.max(0.1, Math.min(ratio ? budgetNum * ratio : budgetNum * 0.1, budgetNum - 0.2)).toFixed(4);

              await emit("plan", { observation: `Mirroring smart-money convergence — executeCopyTrade(${copySym ?? copyAddr.slice(0, 8)}, ${amount} USDC).` }, planId, { x: 380, y: canvasY });
              canvasY += 100;

              const forced = await executeTool("executeCopyTrade", {
                protocol: "uniswap", tokenAddress: copyAddr, tokenSymbol: copySym ?? "",
                amount, reasoning: "Forced copy: clear converged signal, risk not HIGH.",
              }, ctx);
              allToolResults.push(forced);

              let fparsed: Record<string, unknown> = {};
              try { fparsed = JSON.parse(forced.result) as Record<string, unknown>; } catch { /**/ }
              await emit("tool-result", { tool: "executeCopyTrade", ...fparsed, txHash: forced.txHash }, planId, { x: 600, y: canvasY });
              canvasY += 120;

              const fSubmitted = !!forced.txHash || /"submitted":\s*true/.test(forced.result);
              if (fSubmitted) { txHashSeen = forced.txHash; executedOnce = true; lastAction = "deposit"; }
              else {
                holdReason = String(
                  fparsed.error ?? fparsed.reason ??
                  "Swap was attempted but did not land on-chain (relayer or pool issue).",
                );
              }
            }
          }
        }

        // If no executeDefi succeeded, the action was HOLD
        if (!executedOnce && lastAction === "skip") lastAction = "hold";

        // ── HOLD REASON — make "nothing happened" visible, never silent ────────
        // The user must always be able to answer "why didn't it trade?" from the
        // canvas itself. Emitted as a node, fed to the reflection (so it can't
        // fabricate an execution), and stored on the run record below.
        if (!executedOnce && holdReason) {
          await emit("plan", { observation: `⚠ Held — ${holdReason}` }, planId, { x: 380, y: canvasY });
          canvasY += 100;
        }

        // ── PHASE 3: REFLECT ───────────────────────────────────────────────────
        await bumpAgentCounters(agent.id, { status: "reflecting" });
        send("status", { phase: "reflecting" });

        const reflection: Reflection = await veniceReflect(agent.goal, plan, allToolResults, {
          executed: executedOnce,
          holdReason,
        });

        // Embed the insight for semantic retrieval in future runs
        const insightEmbedding = await embedText(reflection.insight).catch(() => undefined);

        // ── Determine scope and root for insight storage ─────────────────────
        // Walk up the parentAgentId chain to find the root of this delegation tree.
        // rootAgentId is shared across all agents in a Scout→Risk→Executor chain,
        // so team-scoped insights are visible to all members of the same workflow.
        let rootAgentId: string = agent.id;
        {
          let cur: Agent | null = agent;
          const seen = new Set<string>();
          while (cur?.parentAgentId && !seen.has(cur.id)) {
            seen.add(cur.id);
            const parent = await getAgent(cur.parentAgentId);
            if (!parent) break;
            cur = parent;
          }
          rootAgentId = cur?.id ?? agent.id;
        }

        // Check if this agent has children — used to decide team broadcast scope.
        const { listChildAgents } = await import("@/lib/agent/agents");
        const childAgents = await listChildAgents(agent.id);
        const isCoordinator = childAgents.length > 0;      // Scout, Risk Monitor
        const isInChain     = !!agent.parentAgentId || isCoordinator; // any member of a multi-agent team

        // A2A-1 core fix: use "team" scope for any agent that's part of a chain.
        // Old logic: parent-less agents (Scout) got scope "agent" — their insights
        // were invisible to children. Now: all chain members broadcast as "team"
        // so Scout's checkYields findings appear in Risk Monitor's and Executor's plans.
        const insightScope = isInChain ? "team" : "agent";

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

        // A2A-1: Broadcast raw tool findings (yields, risk) as a separate team insight
        // so downstream agents get structured data, not just the reflection summary.
        // Only emit when this agent is upstream (coordinator/Scout) — not for leaf Executors.
        if (isCoordinator && allToolResults.length > 0) {
          const teamFindings = allToolResults
            .filter(r => r.tool === "checkYields" || r.tool === "checkRisk")
            .map(r => `[${r.tool}] ${r.result.slice(0, 400)}`)
            .join("\n---\n");
          if (teamFindings) {
            const teamEmbedding = await embedText(teamFindings).catch(() => undefined);
            await saveInsight({
              agentId:       agent.id,
              walletAddress: agent.walletAddress,
              rootAgentId,
              runId,
              text:          `TEAM DATA from ${agent.name} (runId ${runId.slice(-8)}):\n${teamFindings}`,
              tags:          [...reflection.tags, "team-data", "latest-run"],
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

        let imageUrl: string | undefined;

        if (shouldGenerateMedia) {
          send("status", { phase: "media" });

          // Voice + image reports (Venice) — internal endpoints, no x402.
          try {
            const ttsRes = await fetch(`${baseUrl}/api/media/tts`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...internalHeaders() },
              body: JSON.stringify({ text: reflection.insight }),
              signal: AbortSignal.timeout(12000),
            });
            if (!(ttsRes.ok && ttsRes.headers.get("content-type")?.includes("audio"))) {
              const j = await ttsRes.json().catch(() => ({}));
              if (j.skipped) console.log("[run-stream] TTS skipped:", j.reason);
            }
            // Audio is generated but not surfaced as a URL (no public audio host yet).
          } catch (e) { console.warn("[run-stream] TTS exception:", e); }

          try {
            const imgRes = await fetch(`${baseUrl}/api/media/image`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...internalHeaders() },
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
            }
          } catch (e) { console.warn("[run-stream] image exception:", e); }

          // Audio is generated + charged above but intentionally not surfaced as a
          // URL (no public audio host yet), so the media node carries only the image.
          if (imageUrl) {
            await emit("media", { imageUrl, service: "image" }, reflectId, { x: 380, y: canvasY });
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
              walletAddress: agent.walletAddress,
              agentId: agent.id,
              richReport: {
                text: `*${agent.name}* — ${reflection.insight}`,
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
        // Extract the actual executed amount from tool results (not total budget)
        const executedAmount = (() => {
          for (const r of allToolResults.slice().reverse()) {
            if ((r.tool === "executeDefi" || r.tool === "rebalance") && r.txHash) {
              const amt = parseFloat(String(r.args?.amount ?? "0")) || 0;
              if (amt > 0) return String(amt);
            }
          }
          return "0";
        })();

        await saveRun({
          walletAddress: agent.walletAddress,
          agentId:       agent.id,
          runId,
          success:       reflection.didSucceed,
          protocol:      extractProtocol(allToolResults) ?? "unknown",
          action:        lastAction ?? "hold",
          amount:        executedAmount,          // actual executed USDC, not total budget
          apy:           extractApy(allToolResults) ?? 0,
          riskLevel:     (() => {
            for (const r of allToolResults) {
              if (r.tool === "checkRisk") {
                try { const p = JSON.parse(r.result) as { riskLevel?: string }; if (p.riskLevel) return p.riskLevel; } catch { /**/ }
              }
            }
            return "UNKNOWN";
          })(),
          txHash:        txHashSeen ?? null,
          costPaid:      x402Total,
          // For held runs, the stored reason is the REAL hold reason — the user
          // reads this in history to answer "why didn't it trade?".
          veniceReason:  !executedOnce && holdReason ? `Held — ${holdReason}` : reflection.insight,
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
              walletAddress: agent.walletAddress,
              agentId: agent.id,
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
  const cx = 600;
  let cy = 100;

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

    // LIVE THINKING — the model's reasoning text was previously discarded.
    // Surfacing it as a node is what makes the canvas feel like watching the
    // agent think, not just watching tool calls fire.
    const thinking = typeof msg.content === "string" ? msg.content.trim() : "";
    if (thinking) {
      await emit("plan", { observation: thinking.slice(0, 320) }, parentId, { x: cx - 220, y: cy });
      cy += 80;
    }

    if (!msg.tool_calls?.length) break;

    const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];
    for (const tc of msg.tool_calls) {
      const call = tc as unknown as { id: string; function: { name: string; arguments: string } };
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments) as Record<string, unknown>; } catch { /**/ }

      const isMetaTool = call.function.name === "addThought" || call.function.name === "revisePlan";

      // META-TOOLS (addThought / revisePlan) are pure reasoning — emit ONE clean
      // observation node, not the generic "Thinking" + "Thinking done" pair that
      // clutters the canvas. REAL tools (checkYields, executeDefi, …) get the
      // full tool-call → tool-result pair so the action + tx are visible.
      if (isMetaTool) {
        const result = await executeTool(call.function.name, args, ctx);
        results.push(result);
        if (call.function.name === "addThought" && typeof args.text === "string" && args.text.trim()) {
          await emit("plan", { observation: args.text }, parentId, { x: cx, y: cy });
          cy += 80;
        }
        toolResults.push({ role: "tool", tool_call_id: call.id, content: result.result });
        continue;
      }

      // Emit tool-call thought BEFORE execution so the canvas shows the action.
      const callId = await emit("tool-call", {
        tool: call.function.name,
        args,
      }, parentId, { x: cx, y: cy });
      cy += 90;

      const result = await executeTool(call.function.name, args, ctx);
      results.push(result);

      // Emit tool-result thought — includes txHash so the canvas shows the on-chain action.
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(result.result) as Record<string, unknown>; } catch { /**/ }
      await emit("tool-result", {
        tool:    call.function.name,
        ...parsed,
        cost:    result.cost,
        txHash:  result.txHash,
      }, callId, { x: cx + 220, y: cy - 90 });

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
