import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getWorkflow } from "@/lib/agent/workflows";
import { getAgent, agentOnChainAddress } from "@/lib/agent/agents";
import { getVeniceClient, VENICE_MODELS } from "@/lib/venice/client";
import { executeTool, type ExecutorContext } from "@/lib/agent/tools";
import {
  createHandoffPacket, updateHandoffPacket,
  type AgentHandoffPacket, type IntelligencePayload,
  type DecisionPayload, type ExecutionPayload,
} from "@/lib/agent/handoff";
import { saveThought, generateThoughtId, generateRunId } from "@/lib/agent/thoughts";
import { saveInsight, saveRun, updatePosition } from "@/lib/agent/memory";
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
      const hasTools = opts.tools.length > 0;
      res = await client.chat.completions.create({
        model:       VENICE_MODELS.reasoning,
        messages,
        tools:       hasTools ? opts.tools : undefined,
        tool_choice: hasTools ? "auto" : undefined,
        temperature: 0.3,
        // llama-3.3-70b on Venice returns 400 when response_format=json_object is
        // combined with tools. Only request strict JSON mode for tool-less phases
        // (e.g. the Risk Monitor's final decision); tool phases emit tool_calls.
        ...(hasTools ? {} : { response_format: { type: "json_object" as const } }),
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

    // LIVE THINKING — reasoning text alongside tool calls was discarded before;
    // stream it so the team timeline shows each agent's actual deliberation.
    const thinking = typeof msg.content === "string" ? msg.content.trim() : "";
    if (thinking) {
      opts.send("thought", {
        id:      generateThoughtId(),
        runId:   opts.runId,
        agentId: opts.agentId,
        agent:   opts.agentName,
        role:    opts.agentRole,
        content: thinking.slice(0, 280),
      });
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

  // Per 1Shot guidance: build delegations on OUR side (smart-accounts-kit) with
  // the final hop to the public relayer's target — never the dev-platform
  // redelegate endpoint (that's for running your own server-wallet pool). Each
  // worker's scoped, relayer-redeemable chain is already built at agent-creation
  // time (from-answers → buildRedeemableWorkerChain) and stored as its
  // delegationContext. So "redelegation" here is simply handing the child its own
  // scoped chain — no API call, no dead endpoint.
  const childCtx = childAgent.delegationContext;
  const isScoped =
    typeof childCtx === "string" &&
    childCtx.startsWith("0x") &&
    childCtx.length > 40 &&
    childCtx !== "0xdemo" &&
    childCtx !== "0xresearch-only";

  if (isScoped) {
    send("redelegation-complete", {
      to:          childAgent.name,
      address:     await agentOnChainAddress(childAgent),
      contextHash: childCtx!.slice(0, 18) + "…",
    });
    return childCtx!;
  }

  // No scoped chain on the child (legacy/relayer-grant team) — pass the parent
  // context through so the spender stays executable.
  send("redelegation-skipped", { reason: "using parent context (no scoped child chain)" });
  return parentContext;
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

// ── Extract whale-convergence intelligence from checkWhaleTrades result ─────────
// Maps the copy-trade scout output onto the same IntelligencePayload shape the
// rest of the pipeline consumes, so the Risk/Executor phases stay generic.
function extractWhaleIntelligence(
  toolResults: Array<{ tool: string; result: string; cost?: number }>,
): IntelligencePayload | null {
  for (const r of toolResults) {
    if (r.tool !== "checkWhaleTrades" && r.tool !== "discoverWhales") continue;
    try {
      const d = JSON.parse(r.result) as {
        tradeCount?: number;
        wallets?: string[];
        trades?: Array<{ wallet: string; action: string; symbol?: string; ageMinutes: number }>;
        convergence?: Array<{ target: string; walletCount: number }>;
      };
      const trades = d.trades ?? [];
      // Strongest convergence = most whales on the same token.
      const top = (d.convergence ?? []).sort((a, b) => b.walletCount - a.walletCount)[0];
      const recommended = top?.target ?? "hold";
      const reason = top
        ? `${top.walletCount} whales converged on ${top.target}.`
        : trades.length > 0
          ? `Whale activity seen (${trades.length} trades) but no 2+ wallet convergence.`
          : "No recent whale activity — nothing to copy.";
      const tradesSummary = trades
        .slice(0, 8)
        .map(t => `${t.wallet.slice(0, 6)}… ${t.action} ${t.symbol ?? "?"} (${t.ageMinutes}m ago)`)
        .join("; ");
      return {
        bestApy:     0,
        recommended,
        reason,
        yields:      {},
        marketNews:  tradesSummary || undefined,
        x402Cost:    r.cost ?? 0,
        fetchedAt:   Date.now(),
      };
    } catch { /**/ }
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
      // Sentinel: explicit demand to revoke the executor's delegation on-chain.
      revoke:     d.revoke === true,
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
    if (r.tool === "executeDefi" || r.tool === "executeCopyTrade") {
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

  // Load every agent in the workflow, then resolve roles BY NAME so this works
  // for both the legacy 3-agent team and the new per-protocol fan-out
  // (5 scouts + Convergence Analyzer + Risk Monitor + Executor).
  const allAgents = (await Promise.all(wf.agentIds.map(getAgent))).filter(
    (a): a is NonNullable<typeof a> => !!a,
  );
  const nameMatch = (a: { name: string }, re: RegExp) => re.test(a.name);

  // Executor: the scheduled spender (name "…Executor" or has a schedule interval).
  const executor =
    allAgents.find(a => nameMatch(a, /executor/i)) ??
    allAgents.find(a => !!a.scheduleIntervalMs) ??
    allAgents[allAgents.length - 1];

  // Risk Monitor: the risk/guard/monitor gate.
  const riskMonitor =
    allAgents.find(a => nameMatch(a, /risk|monitor|guard|safety/i) && a.id !== executor.id) ??
    allAgents[allAgents.length - 2];

  // Scout/intelligence role: prefer the Convergence Analyzer (it aggregates all
  // protocols); else the first Scout. The scout phase calls checkYields across
  // every protocol in one shot, so a single representative covers the fan-out.
  const scout =
    allAgents.find(a => nameMatch(a, /analyzer|convergence/i)) ??
    allAgents.find(a => nameMatch(a, /scout/i)) ??
    allAgents.find(a => a.id !== executor.id && a.id !== riskMonitor.id) ??
    allAgents[0];

  if (!scout || !riskMonitor || !executor) {
    return Response.json({ error: "Could not resolve Scout / Risk / Executor roles" }, { status: 400 });
  }

  // Team kind drives which tools each phase uses (yield vs. copy-trade).
  const teamKind: "copy-trader" | "yield" =
    executor.agentType === "copy-trader" ||
    /copy|whale/i.test(`${executor.name} ${scout.name} ${wf.prompt}`)
      ? "copy-trader"
      : "yield";

  // For copy-trade teams, gather the tracked whale wallets from the scout goals
  // (each scout's goal embeds the full address it tracks) or the workflow prompt.
  const teamWallets = [
    ...new Set(
      allAgents
        .flatMap(a => a.goal.match(/0x[a-fA-F0-9]{40}/g) ?? [])
        .concat(wf.prompt.match(/0x[a-fA-F0-9]{40}/g) ?? [])
        .map(w => w.toLowerCase()),
    ),
  ];

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

      // ── AUTO-ALLOCATION — Fund Manager re-splits the budget each run ────────
      // Previously a manual "⚖️ Allocate budget" button; now every team run
      // starts with Venice reading live yields and re-weighting each
      // per-protocol executor's on-chain cap (ERC20TransferAmountEnforcer).
      // Single-executor and copy-desk teams 400 here — that's a clean no-op.
      try {
        const allocRes = await fetch(`${baseUrl}/api/workflow/${workflowId}/allocate-budget`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ walletAddress }),
          signal:  AbortSignal.timeout(45000),
        });
        if (allocRes.ok) {
          const alloc = await allocRes.json() as { reasoning?: string; source?: string; allocations?: unknown[] };
          send("allocation", { reasoning: alloc.reasoning, source: alloc.source, allocations: alloc.allocations });
        }
      } catch { /* allocation is best-effort — never blocks the run */ }

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
          // Copy-trade scouts need the tracked wallet list for checkWhaleTrades.
          ...(teamKind === "copy-trader" ? { typeConfig: { wallets: teamWallets } } : {}),
        };

        // Copy-trade teams: use checkWhaleTrades when wallets are supplied,
        // otherwise discoverWhales (the team finds its own smart money).
        const copyDiscovery = teamKind === "copy-trader" && teamWallets.length === 0;
        const scoutToolName = teamKind !== "copy-trader" ? "checkYields"
          : copyDiscovery ? "discoverWhales"
          : "checkWhaleTrades";
        const scoutTools = TOOL_DEFS.filter(t => [scoutToolName].includes((t as { function?: { name?: string } }).function?.name ?? ""));

        const scoutPhasePrompt = copyDiscovery
          ? {
              systemPrompt: `You are ${scout.name}, an autonomous smart-money discovery agent.
Your ONLY job in this run: call discoverWhales to find the most active high-value traders on Base, along with their recent trades and convergence.
Do NOT execute any transactions. Do NOT call checkRisk. Just discover and report.
After discoverWhales returns, stop — do not call any more tools.`,
              userMessage: `Discover the top smart-money wallets on Base right now and their convergence. Call discoverWhales now.`,
            }
          : teamKind === "copy-trader"
          ? {
              systemPrompt: `You are ${scout.name}, a smart-money intelligence agent.
Your ONLY job in this run: call checkWhaleTrades to fetch recent on-chain trades for the tracked whale wallets.
Do NOT execute any transactions. Do NOT call checkRisk. Just fetch and report.
After checkWhaleTrades returns, stop — do not call any more tools.`,
              userMessage: `Fetch recent whale trades for these wallets: ${teamWallets.join(", ") || "(from config)"}. Call checkWhaleTrades now.`,
            }
          : {
              systemPrompt: `You are ${scout.name}, an autonomous DeFi intelligence agent.
Your ONLY job in this run: call checkYields to fetch live APY data from Base DeFi protocols.
Do NOT execute any transactions. Do NOT call checkRisk. Just fetch and report.
After checkYields returns, stop — do not call any more tools.`,
              userMessage: `Fetch live DeFi yields for ${wf.prompt}. Call checkYields now.`,
            };

        const { toolResults: scoutResults } = await runAgentPhase({
          agentName:    scout.name,
          agentRole:    "scout",
          systemPrompt: scoutPhasePrompt.systemPrompt,
          userMessage:  scoutPhasePrompt.userMessage,
          tools:        scoutTools,
          ctx:          scoutCtx,
          send,
          runId,
          agentId:      scout.id,
        });

        const intelligence = teamKind === "copy-trader"
          ? extractWhaleIntelligence(scoutResults)
          : extractIntelligence(scoutResults);

        if (!intelligence) {
          throw new Error(
            teamKind === "copy-trader"
              ? "Scout failed to fetch whale activity"
              : "Scout failed to fetch intelligence",
          );
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

        const riskUserMessage = teamKind === "copy-trader"
          ? `Convergence Detector signal:
${intelligence.reason}
Converged token: ${intelligence.recommended}
Whale activity: ${intelligence.marketNews ?? "see scout report"}

Goal: ${wf.prompt}

Decide whether to MIRROR this trade. Approve ONLY if the token has healthy liquidity, is not an obvious scam/honeypot, and the convergence is genuine (2+ independent whales). If nothing converged, action must be "hold".
Return JSON: { "action": "deposit"|"hold", "protocol": "uniswap"|"aerodrome", "amount": "0.5", "confidence": 0.8, "reasoning": "...", "approved": true, "riskLevel": "LOW" }`
          : `Scout's intelligence (already paid via x402):
Best APY: ${intelligence.bestApy}% on ${intelligence.recommended}
Scout's reason: ${intelligence.reason}

All current yields:
${yieldsFormatted}

Market news: ${intelligence.marketNews ?? "No additional news"}

Goal: ${wf.prompt}

Evaluate this data. Is it safe to ${intelligence.recommended === "hold" ? "hold" : `deposit into ${intelligence.recommended}`}?
Return JSON: { "action": "deposit"|"hold"|"rebalance", "protocol": "...", "amount": "5", "confidence": 0.87, "reasoning": "...", "approved": true, "riskLevel": "LOW" }`;

        const { toolResults: riskResults, finalText: riskFinalText } = await runAgentPhase({
          agentName:    riskMonitor.name,
          agentRole:    "risk",
          systemPrompt: `You are ${riskMonitor.name}, a risk evaluation agent — a SENTINEL with real powers.
Scout has already fetched live intelligence — do NOT re-fetch it.
Use checkRisk if needed to validate current market conditions.

Your three powers (all enforced by the orchestrator, not just advisory):
1. VETO   — set approved=false (or riskLevel HIGH): the trade does not happen.
2. SHRINK — if riskLevel is MEDIUM and you still approve, the position is automatically halved.
3. REVOKE — if you find evidence the target is a SCAM/HONEYPOT or the signal looks like manipulation,
   set "revoke": true. The executor's on-chain delegation will be revoked via
   DelegationManager.disableDelegation — it physically loses spending authority. Use this
   only on strong evidence; it takes a human re-grant to restore.

Then output a JSON decision: { action, protocol, amount, confidence, reasoning, approved, riskLevel, revoke }`,
          userMessage: riskUserMessage,
          tools:   riskTools,
          ctx:     riskCtx,
          send,
          runId,
          agentId: riskMonitor.id,
        });

        const decision = extractDecision(riskFinalText, riskResults);

        // ── SENTINEL ENFORCEMENT — the Risk Monitor's powers are real ─────────
        // SHRINK: MEDIUM risk + approved → halve the position deterministically.
        if (decision.riskLevel === "MEDIUM" && decision.approved && decision.amount) {
          const orig = Number.parseFloat(decision.amount);
          if (Number.isFinite(orig) && orig > 0) {
            decision.shrunkFrom = decision.amount;
            decision.amount     = (orig / 2).toFixed(4);
            send("sentinel-shrink", {
              from: decision.shrunkFrom, to: decision.amount,
              reason: "MEDIUM risk — Sentinel halved the position before execution",
            });
          }
        }
        // REVOKE: scam/honeypot evidence → pull the executor's on-chain keys.
        // DelegationManager.disableDelegation — the worker physically loses
        // spending authority until a human re-grants. Not just a veto.
        if (decision.revoke) {
          send("sentinel-revoking", { executor: executor.name, reason: decision.reasoning.slice(0, 160) });
          try {
            const rres  = await fetch(`${baseUrl}/api/agent/${executor.id}/revoke`, { method: "POST" });
            const rdata = await rres.json() as { ok?: boolean; via?: string; txHash?: string | null };
            send("sentinel-revoked", { executor: executor.name, via: rdata.via, txHash: rdata.txHash ?? null });
          } catch (e) {
            send("sentinel-revoke-failed", { error: e instanceof Error ? e.message : String(e) });
          }
          decision.approved = false;   // a revoked executor must never execute
        }

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
          send("execution-skipped", {
            reason: decision.revoke
              ? `SENTINEL REVOKED the executor's delegation (scam/manipulation evidence): ${decision.reasoning.slice(0, 120)}`
              : `Risk Monitor decided to ${decision.action}: ${decision.reasoning.slice(0, 120)}`,
          });
          await updateHandoffPacket(packet.id, {
            phase:     "complete",
            completedAt: new Date(),
            execution: { protocol: "none", amount: "0", success: false, via: "risk-blocked" },
          });
          // Record the HOLD so the Portfolio token-flow feed shows blocked decisions.
          await saveRun({
            walletAddress, agentId: executor.id, runId,
            success: false, protocol: intelligence.recommended ?? "—", action: "hold",
            amount: "0", apy: intelligence.bestApy ?? 0, riskLevel: decision.riskLevel ?? "UNKNOWN",
            txHash: null, costPaid: intelligence.x402Cost ?? 0,
            veniceReason: decision.reasoning ?? "Risk Monitor held.", durationMs: 0,
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

        const execToolName = teamKind === "copy-trader" ? "executeCopyTrade" : "executeDefi";
        const execTools = TOOL_DEFS.filter(t => [execToolName, "notifyUser"].includes((t as { function?: { name?: string } }).function?.name ?? ""));

        const execPhasePrompt = teamKind === "copy-trader"
          ? {
              systemPrompt: `You are ${executor.name}, a copy-trade execution agent.
Risk Monitor has approved mirroring a whale trade — execute it EXACTLY as specified.
Do NOT re-evaluate risk. Just execute the swap.
After executeCopyTrade completes, call notifyUser to send a Telegram report.`,
              userMessage: `Risk Monitor approved mirroring this whale trade:
Token to buy: ${intelligence.recommended}
Swap venue: ${decision.protocol ?? "uniswap"}
Amount: ${decision.amount ?? "0.5"} USDC
Reasoning: ${decision.reasoning}
Confidence: ${Math.round(decision.confidence * 100)}%

Signal basis: ${intelligence.reason}

Call executeCopyTrade now with protocol="${decision.protocol ?? "uniswap"}", tokenSymbol="${intelligence.recommended}", amount="${decision.amount ?? "0.5"}". Then notify the user.`,
            }
          : {
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
            };

        const { toolResults: execResults } = await runAgentPhase({
          agentName:    executor.name,
          agentRole:    "executor",
          systemPrompt: execPhasePrompt.systemPrompt,
          userMessage:  execPhasePrompt.userMessage,
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

        // Record the run + position so the Portfolio dashboard reflects team
        // executions (the single-agent run-stream path already does this; the
        // orchestrate/team path previously did not — leaving deployed capital at $0).
        // For copy-trade teams the meaningful label is the token bought, not the swap venue.
        const posLabel = teamKind === "copy-trader"
          ? (intelligence.recommended || execution.protocol)
          : execution.protocol;
        await saveRun({
          walletAddress,
          agentId:      executor.id,
          runId,
          success:      execution.success,
          protocol:     posLabel,
          action:       decision.action ?? "deposit",
          amount:       execution.amount ?? decision.amount ?? "0",
          apy:          intelligence.bestApy ?? 0,
          riskLevel:    decision.riskLevel ?? "UNKNOWN",
          txHash:       execution.txHash ?? null,
          costPaid:     intelligence.x402Cost ?? 0,
          veniceReason: decision.reasoning ?? execInsight,
          durationMs:   0,
        });
        if (execution.success && execution.txHash) {
          await updatePosition(walletAddress, posLabel, execution.amount ?? decision.amount ?? "0", intelligence.bestApy ?? 0);
        }

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
  { type: "function", function: { name: "checkYields",  description: "Fetch live DeFi yields + market news across supported protocols.",             parameters: { type: "object", properties: { protocols: { type: "array", items: { type: "string" } } } } } },
  { type: "function", function: { name: "checkRisk",    description: "Classify market risk (LOW/MEDIUM/HIGH) using web search.",                    parameters: { type: "object", required: ["context"], properties: { context: { type: "string" } } } } },
  { type: "function", function: { name: "executeDefi",  description: "Deposit/swap/stake on a DeFi protocol using ERC-7715 delegation via 1Shot.", parameters: { type: "object", required: ["protocol","amount","reasoning"], properties: { protocol: { type: "string", enum: ["morpho","uniswap","aerodrome","lido","aave"] }, action: { type: "string", enum: ["deposit","swap","stake","supply","lp"] }, amount: { type: "string" }, reasoning: { type: "string" } } } } },
  { type: "function", function: { name: "notifyUser",   description: "Send a Telegram update. ALWAYS the last tool call.",                          parameters: { type: "object", required: ["message"], properties: { message: { type: "string" } } } } },
  { type: "function", function: { name: "discoverWhales", description: "Autonomously find top smart-money wallets on Base + their recent trades and convergence.", parameters: { type: "object", properties: { limit: { type: "number" }, hours: { type: "number" } } } } },
  { type: "function", function: { name: "checkWhaleTrades", description: "Fetch recent on-chain trades for tracked whale wallets + convergence signals.", parameters: { type: "object", properties: { wallets: { type: "array", items: { type: "string" } }, hours: { type: "number" } } } } },
  { type: "function", function: { name: "executeCopyTrade", description: "Mirror a whale's trade by swapping into a token via ERC-7715 delegation.", parameters: { type: "object", required: ["protocol","amount","tokenSymbol","reasoning"], properties: { protocol: { type: "string", enum: ["uniswap","aerodrome"] }, tokenSymbol: { type: "string" }, amount: { type: "string" }, reasoning: { type: "string" } } } } },
];
