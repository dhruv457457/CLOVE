import "server-only";

import type { BlueprintNode, BlueprintEdge, CompiledWorkflow } from "@/lib/aiCompiler";

// ── Types ──────────────────────────────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface StepResult {
  nodeId:    string;
  nodeType:  string;
  label:     string;
  status:    StepStatus;
  output?:   Record<string, unknown>;
  error?:    string;
  durationMs: number;
}

export interface AgentRunResult {
  runId:      string;
  success:    boolean;
  steps:      StepResult[];
  finalState: AgentState;
  durationMs: number;
  error?:     string;
}

/** Shared state passed between nodes — grows as the agent executes. */
export interface AgentState {
  // From permission panel
  permissionsContext?: string;
  delegationManager?:  string;
  delegationId?:       string;
  walletAddress?:      string;

  // From intelligence nodes
  bestApy?:       number;
  recommended?:   string;
  reason?:        string;
  tavilyAnswer?:  string;
  newsHeadline?:  string;
  riskLevel?:     "low" | "medium" | "high";
  sentiment?:     "bullish" | "neutral" | "bearish";

  // From DeFi execution
  txHash?:          string;
  calldataPrepared?: string;
  contractAddress?:  string;

  // From notify
  telegramSent?: boolean;

  // From fal.ai
  strategyImageUrl?: string;

  // Runtime
  budgetUsdc?:  string;
  periodDays?:  number;
  costPaid?:    number;
  aborted?:     boolean;
  abortReason?: string;
}

// ── Node handlers ──────────────────────────────────────────────────────────────

type NodeHandler = (
  node: BlueprintNode,
  state: AgentState,
  baseUrl: string
) => Promise<Partial<AgentState>>;

const HANDLERS: Partial<Record<string, NodeHandler>> = {

  trigger: async (node, state) => {
    // Just validates the schedule — in production a cron fires this
    return { budgetUsdc: state.budgetUsdc ?? "10.00" };
  },

  budget: async (node, state) => {
    if (!state.permissionsContext) {
      throw new Error("No ERC-7715 permission found. User must grant permission first.");
    }
    const amount = String(node.config.amount ?? state.budgetUsdc ?? "10.00");
    return { budgetUsdc: amount };
  },

  "intelligence-tavily": async (node, _state, baseUrl) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      headers: { "PAYMENT-SIGNATURE": "tavily-prefetch" },
    });
    if (!res.ok) return {};
    const data = await res.json() as Record<string, unknown>;
    const intel = data as { marketIntel?: { tavilyAnswer?: string; newsHeadline?: string } };
    return {
      tavilyAnswer: intel.marketIntel?.tavilyAnswer,
      newsHeadline: intel.marketIntel?.newsHeadline,
    };
  },

  intelligence: async (node, state, baseUrl) => {
    // Pay x402 and get Venice AI yield analysis
    const res = await fetch(`${baseUrl}/api/x402/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "/api/intelligence",
        permissionsContext: state.permissionsContext ?? "demo",
        delegationManager:  state.delegationManager ?? "0x",
        delegationId:       state.delegationId,
      }),
    });

    if (!res.ok) {
      // Fallback to direct call in demo mode
      const fallback = await fetch(`${baseUrl}/api/intelligence`, {
        headers: { "PAYMENT-SIGNATURE": "demo-fallback" },
      });
      if (!fallback.ok) throw new Error("Intelligence API unavailable");
      const d = await fallback.json() as Record<string, unknown>;
      return {
        bestApy:      d.bestApy as number,
        recommended:  d.recommended as string,
        reason:       d.reason as string,
        costPaid:     0.01,
      };
    }

    const data = await res.json() as {
      bestApy?: number; recommended?: string; reason?: string;
      marketIntel?: { tavilyAnswer?: string; newsHeadline?: string };
      _clove?: { costUsdc?: number };
    };
    return {
      bestApy:      data.bestApy,
      recommended:  data.recommended,
      reason:       data.reason,
      tavilyAnswer: data.marketIntel?.tavilyAnswer,
      newsHeadline: data.marketIntel?.newsHeadline,
      costPaid:     data._clove?.costUsdc ?? 0.01,
    };
  },

  "risk-check": async (_node, state) => {
    // Derive risk level from Tavily news keywords
    const text = (state.tavilyAnswer ?? state.newsHeadline ?? "").toLowerCase();
    const highRiskWords = ["hack", "exploit", "vulnerability", "attack", "breach", "drain", "rug"];
    const medRiskWords  = ["risk", "volatile", "uncertainty", "warning", "caution", "dip"];

    const riskLevel: AgentState["riskLevel"] =
      highRiskWords.some(w => text.includes(w)) ? "high"   :
      medRiskWords.some(w => text.includes(w))  ? "medium" : "low";

    if (riskLevel === "high") {
      return { riskLevel, aborted: true, abortReason: `Risk level HIGH — agent paused. Detected: ${text.slice(0, 60)}` };
    }
    return { riskLevel };
  },

  "sentiment-check": async (_node, state) => {
    const text = (state.tavilyAnswer ?? state.reason ?? "").toLowerCase();
    const bullishWords  = ["bullish", "rally", "surge", "positive", "growth", "gain"];
    const bearishWords  = ["bearish", "crash", "dump", "panic", "fear", "sell-off"];

    const sentiment: AgentState["sentiment"] =
      bullishWords.some(w => text.includes(w))  ? "bullish" :
      bearishWords.some(w => text.includes(w))   ? "bearish" : "neutral";

    const pauseIfBearish = _node.config.pauseIfBearish !== false;
    if (sentiment === "bearish" && pauseIfBearish) {
      return { sentiment, aborted: true, abortReason: `Sentiment BEARISH — agent paused to protect capital.` };
    }
    return { sentiment };
  },

  "compare-apy": async (_node, state, baseUrl) => {
    // ── REAL AI DECISION: Venice reasons about what to actually do ──────────
    // This is what makes CLOVE a true agent — not just returning data,
    // but having Venice AI DECIDE the action based on full context.
    const { makeAgentDecision } = await import("@/lib/venice/decision");

    // Fetch fresh yields
    let yields: Record<string, { apy: number; tvl: string; risk: string }> | undefined;
    try {
      const r = await fetch(`${baseUrl}/api/intelligence`, {
        headers: { "PAYMENT-SIGNATURE": "compare-apy-internal" },
      });
      if (r.ok) {
        const d = await r.json() as { yields?: typeof yields; bestApy?: number; recommended?: string };
        yields = d.yields;
        // If no prior Venice call ran, populate from this
        if (!state.bestApy && d.bestApy) {
          state.bestApy    = d.bestApy;
          state.recommended = d.recommended;
        }
      }
    } catch { /* non-fatal */ }

    // Ask Venice AI to make a real decision
    const decision = await makeAgentDecision({
      walletAddress: state.walletAddress ?? "0x0",
      budgetUsdc:    state.budgetUsdc ?? "10.00",
      yields,
      riskLevel:     state.riskLevel,
      marketContext: state.tavilyAnswer,
      goal:          "Maximize stablecoin yield on Base with low risk",
    });

    console.log("[agent/decision]", decision.action, "→", decision.protocol, `(${(decision.confidence * 100).toFixed(0)}% confident)`);

    // If Venice says abort → propagate
    if (decision.abort) {
      return {
        bestApy:      state.bestApy,
        recommended:  state.recommended,
        aborted:      true,
        abortReason:  decision.abortReason ?? decision.reasoning,
      };
    }

    return {
      bestApy:     state.bestApy,
      // Override recommended with Venice's actual decision
      recommended: decision.protocol ?? state.recommended,
      reason:      decision.reasoning,
      // Store decision for defi handler to use
      _decision:   decision,
    } as AgentState & { _decision: typeof decision };
  },

  defi: async (node, state, baseUrl) => {
    // Use Venice's decision to pick the right protocol dynamically
    // If compare-apy ran before us, use its decision — otherwise use node config
    const decision = (state as AgentState & { _decision?: { action: string; protocol?: string; amount?: string } })._decision;
    const protocol  = decision?.protocol ?? node.protocol ?? state.recommended ?? "morpho";
    const action    = decision?.action === "rebalance" ? "morpho-vault-deposit"
                    : node.action ?? "morpho-vault-deposit";
    const amount    = decision?.amount ?? state.budgetUsdc;

    const res = await fetch(`${baseUrl}/api/execute/defi`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        protocol,
        nodeConfig:         { ...node.config, amount },
        permissionsContext: state.permissionsContext,
        delegationManager:  state.delegationManager,
        delegationId:       state.delegationId,
        walletAddress:      state.walletAddress,
      }),
    });

    const data = await res.json().catch(() => ({})) as {
      submitted?: boolean; prepared?: boolean;
      txHash?: string; calldata?: string;
      contractAddress?: string; error?: string;
    };

    if (data.error && !data.prepared) throw new Error(data.error);
    return {
      txHash:           data.txHash,
      calldataPrepared: data.calldata,
      contractAddress:  data.contractAddress,
    };
  },

  "intelligence-fal": async (node, state, baseUrl) => {
    if (!process.env.FAL_API_KEY) return {};
    try {
      const res = await fetch(`${baseUrl}/api/intelligence/visualize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": "fal-internal",
        },
        body: JSON.stringify({
          strategy:    state.reason ?? "Autonomous DeFi strategy",
          protocol:    state.recommended ?? node.config.protocol ?? "Morpho",
          bestApy:     state.bestApy,
        }),
      });
      if (!res.ok) return {};
      const data = await res.json() as { imageUrl?: string };
      return { strategyImageUrl: data.imageUrl };
    } catch { return {}; }
  },

  notify: async (node, state, baseUrl) => {
    const lines = [
      `Strategy cycle complete.`,
      state.recommended ? `Best APY: ${state.bestApy ?? "—"}% on ${state.recommended}` : "",
      state.riskLevel   ? `Risk level: ${state.riskLevel.toUpperCase()}` : "",
      state.sentiment   ? `Sentiment: ${state.sentiment}` : "",
      state.txHash      ? `Tx: ${state.txHash}` : state.calldataPrepared ? "Calldata prepared (testnet)." : "",
      state.reason      ? `AI: ${state.reason.slice(0, 80)}` : "",
    ].filter(Boolean);

    const res = await fetch(`${baseUrl}/api/notify/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: lines.join("\n") }),
    });
    const data = await res.json().catch(() => ({})) as { sent?: boolean };
    return { telegramSent: data.sent === true };
  },
};

// Share the same handler for all defi subtypes
HANDLERS["defi-swap"]  = HANDLERS["defi"] as NodeHandler;
HANDLERS["defi-lend"]  = HANDLERS["defi"] as NodeHandler;
HANDLERS["defi-stake"] = HANDLERS["defi"] as NodeHandler;
HANDLERS["defi-save"]  = HANDLERS["defi"] as NodeHandler;
HANDLERS["defi-lp"]    = HANDLERS["defi"] as NodeHandler;

// ── Graph walker ───────────────────────────────────────────────────────────────

/** Build an ordered execution list by following edges from the trigger node. */
function topoSort(nodes: BlueprintNode[], edges: BlueprintEdge[]): BlueprintNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    adjacency.get(e.source)!.push(e.target);
  }

  const ordered: BlueprintNode[] = [];
  const visited = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodeMap.get(id);
    if (!node) return;
    ordered.push(node);
    for (const next of adjacency.get(id) ?? []) visit(next);
  }

  // Start from trigger node (or first node)
  const start = nodes.find(n => n.type === "trigger") ?? nodes[0];
  if (start) visit(start.id);
  // Add any disconnected nodes
  for (const n of nodes) visit(n.id);
  return ordered;
}

// ── Main executor ──────────────────────────────────────────────────────────────

export async function runWorkflow(
  workflow: CompiledWorkflow,
  initialState: Partial<AgentState>,
  baseUrl: string,
): Promise<AgentRunResult> {
  const runId    = `run_${Date.now()}`;
  const started  = Date.now();
  const steps:   StepResult[] = [];
  const state:   AgentState  = { ...initialState };

  const ordered = topoSort(workflow.nodes, workflow.edges);

  for (const node of ordered) {
    if (state.aborted) {
      steps.push({
        nodeId: node.id, nodeType: node.type, label: node.label,
        status: "skipped", durationMs: 0,
        output: { reason: state.abortReason },
      });
      continue;
    }

    const handler = HANDLERS[node.type];
    const t0 = Date.now();

    if (!handler) {
      // Unknown node type — skip gracefully
      steps.push({ nodeId: node.id, nodeType: node.type, label: node.label, status: "skipped", durationMs: 0 });
      continue;
    }

    try {
      const update = await handler(node, state, baseUrl);
      Object.assign(state, update);
      steps.push({
        nodeId: node.id, nodeType: node.type, label: node.label,
        status: state.aborted ? "skipped" : "done",
        output: update as Record<string, unknown>,
        durationMs: Date.now() - t0,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      steps.push({
        nodeId: node.id, nodeType: node.type, label: node.label,
        status: "error", error: msg, durationMs: Date.now() - t0,
      });
      // Non-fatal for notify/fal, fatal for budget/intelligence
      if (node.type === "budget" || node.type === "intelligence") {
        return {
          runId, success: false, steps, finalState: state,
          durationMs: Date.now() - started, error: msg,
        };
      }
    }
  }

  return {
    runId,
    success: !state.aborted && steps.every(s => s.status !== "error"),
    steps,
    finalState: state,
    durationMs: Date.now() - started,
  };
}
