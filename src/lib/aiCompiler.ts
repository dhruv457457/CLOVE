/**
 * Natural Language AI Strategy Compiler for CLOVE.
 * Converts user prompt strings into structured workflow nodes + edges.
 *
 * This is the LOCAL regex-based fallback. The primary path goes through
 * /api/agent/compile which calls Venice AI with Tavily market context.
 */

export type NodeType =
  | "trigger"
  | "budget"
  | "intelligence"           // Venice AI (x402)
  | "intelligence-tavily"    // Tavily web research + crypto news
  | "intelligence-exa"       // Exa semantic protocol search
  | "intelligence-fal"       // fal.ai image/video generation
  | "risk-check"             // Evaluate risk signals from Tavily
  | "compare-apy"            // Compare APYs across protocols
  | "sentiment-check"        // Market sentiment gate (act only if bullish/neutral)
  | "defi"
  | "defi-swap"              // Uniswap V3
  | "defi-lend"              // Morpho supply/withdraw
  | "defi-stake"             // Lido wrap/unwrap
  | "defi-save"              // Sky sUSDS
  | "defi-lp"                // Aerodrome LP
  | "condition"              // if/else branch
  | "notify";                // Telegram / email

export interface BlueprintNode {
  id: string;
  type: NodeType;
  label: string;
  description: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
  /** Protocol slug if type is defi-* */
  protocol?: "uniswap" | "morpho" | "aerodrome" | "lido" | "sky";
  /** Protocol action slug */
  action?: string;
}

export interface BlueprintEdge {
  id: string;
  source: string;
  target: string;
  active?: boolean;
}

export interface CompiledWorkflow {
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  summary: string;
  /** Market context Tavily fetched before compiling (if available) */
  marketContext?: string;
}

// ── Regex-based fallback compiler ─────────────────────────────────────────────

export function compilePromptToWorkflow(prompt: string, marketContext?: string): CompiledWorkflow {
  const lc = prompt.toLowerCase();
  const nodes: BlueprintNode[] = [];
  const edges: BlueprintEdge[] = [];

  const hasRisk       = lc.includes("risk") || lc.includes("protect") || lc.includes("safe") || lc.includes("panic");
  const hasSentiment  = lc.includes("sentiment") || lc.includes("bullish") || lc.includes("bearish") || lc.includes("when");
  const hasTavily     = lc.includes("research") || lc.includes("news") || lc.includes("search") || lc.includes("market");
  const hasCompare    = lc.includes("highest") || lc.includes("best") || lc.includes("compare") || lc.includes("rebalance");

  // 1. Trigger
  let triggerLabel = "Interval Trigger";
  let triggerDesc  = "Triggers the strategy on a recurring schedule.";
  let triggerCfg: Record<string, unknown> = { schedule: "Daily at 9:00 AM" };

  if (lc.includes("daily") || lc.includes("every day")) {
    triggerLabel = "Daily Schedule"; triggerDesc = "Executes daily at 8:00 AM UTC."; triggerCfg = { schedule: "Daily" };
  } else if (lc.includes("hour") || lc.includes("hourly")) {
    triggerLabel = "Hourly Check"; triggerDesc = "Triggers every 60 minutes."; triggerCfg = { schedule: "Hourly" };
  } else if (lc.includes("6h") || lc.includes("6 hour")) {
    triggerLabel = "6-Hour Check"; triggerDesc = "Triggers every 6 hours."; triggerCfg = { schedule: "Every 6h" };
  } else if (lc.includes("week")) {
    triggerLabel = "Weekly Check"; triggerDesc = "Triggers every Monday at 9:00 AM UTC."; triggerCfg = { schedule: "Weekly" };
  } else if (lc.includes("price") || lc.includes("drops") || lc.includes("<")) {
    triggerLabel = "ETH Price Alert"; triggerDesc = "Triggers when ETH drops below $3,200."; triggerCfg = { condition: "ETH < $3200" };
  }
  nodes.push({ id: "trigger-node", type: "trigger", label: triggerLabel, description: triggerDesc, x: 0, y: 0, config: triggerCfg });
  let prevId = "trigger-node";
  let edgeIdx = 1;

  // 2. Budget
  const budgetMatch = prompt.match(/(?:budget|allowance|limit|spend)\s*(?:of)?\s*\$?([0-9.]+)/i);
  const budgetAmount = budgetMatch ? parseFloat(budgetMatch[1]).toFixed(2) : "10.00";
  nodes.push({
    id: "budget-node", type: "budget",
    label: "MetaMask Budget (ERC-7715)",
    description: `Recurring allowance of ${budgetAmount} USDC via ERC-7715 delegation.`,
    x: 0, y: 0, config: { amount: budgetAmount, token: "USDC" },
  });
  edges.push({ id: `e${edgeIdx++}`, source: prevId, target: "budget-node" });
  prevId = "budget-node";

  // 3a. Tavily research node (if context-aware strategy)
  if (hasTavily || hasRisk || hasSentiment) {
    nodes.push({
      id: "tavily-node", type: "intelligence-tavily",
      label: "Tavily Research",
      description: "Searches crypto news, protocol updates, and market conditions in real-time.",
      x: 0, y: 0,
      config: {
        query: hasRisk ? "DeFi protocol risk events hacks" : "DeFi yield rates crypto market",
        provider: "tavily",
        cost: "0.005",
        ...(marketContext ? { contextSnippet: marketContext.slice(0, 60) } : {}),
      },
    });
    edges.push({ id: `e${edgeIdx++}`, source: prevId, target: "tavily-node" });
    prevId = "tavily-node";
  }

  // 3b. Venice AI intelligence node
  const costMatch = prompt.match(/(?:pay|fee|cost)\s*(?:of)?\s*\$?([0-9.]+)/i);
  const apiCost = costMatch ? parseFloat(costMatch[1]).toFixed(3) : "0.01";
  nodes.push({
    id: "api-node", type: "intelligence",
    label: "Venice AI (x402)",
    description: `AI yield reasoning + strategy decision. Billed ${apiCost} USDC via x402.`,
    x: 0, y: 0,
    config: { cost: apiCost, resource: "/api/intelligence", provider: "venice" },
  });
  edges.push({ id: `e${edgeIdx++}`, source: prevId, target: "api-node" });
  prevId = "api-node";

  // 4a. Risk check node
  if (hasRisk) {
    nodes.push({
      id: "risk-node", type: "risk-check",
      label: "Risk Signal Check",
      description: "Evaluates Tavily news for hacks, exploits, or high-volatility signals. Pauses if risk is HIGH.",
      x: 0, y: 0,
      config: { threshold: "medium", action: "pause-if-high" },
    });
    edges.push({ id: `e${edgeIdx++}`, source: prevId, target: "risk-node" });
    prevId = "risk-node";
  }

  // 4b. Sentiment check node
  if (hasSentiment) {
    nodes.push({
      id: "sentiment-node", type: "sentiment-check",
      label: "Sentiment Gate",
      description: "Acts only when market sentiment is bullish or neutral. Waits if bearish.",
      x: 0, y: 0,
      config: { minSentiment: "neutral", pauseIfBearish: true },
    });
    edges.push({ id: `e${edgeIdx++}`, source: prevId, target: "sentiment-node" });
    prevId = "sentiment-node";
  }

  // 4c. APY comparison node
  if (hasCompare) {
    nodes.push({
      id: "compare-node", type: "compare-apy",
      label: "Compare APY",
      description: "Fetches live APYs from Morpho, Sky, Aerodrome and selects the highest rate.",
      x: 0, y: 0,
      config: { protocols: ["morpho", "sky", "aerodrome"], metric: "apy" },
    });
    edges.push({ id: `e${edgeIdx++}`, source: prevId, target: "compare-node" });
    prevId = "compare-node";
  }

  // 5. DeFi action
  let defiNode: BlueprintNode;
  if (lc.includes("morpho") || lc.includes("vault") || lc.includes("lend")) {
    defiNode = { id: "defi-node", type: "defi-lend", protocol: "morpho", action: "morpho-vault-deposit",
      label: "Morpho Vault Deposit", description: "Deposit USDC into the highest-yield Morpho MetaMorpho vault.",
      x: 0, y: 0, config: { platform: "Morpho", action: "deposit" } };
  } else if (lc.includes("stake") || lc.includes("lido") || lc.includes("wsteth") || lc.includes("steth")) {
    defiNode = { id: "defi-node", type: "defi-stake", protocol: "lido", action: "lido-wrap",
      label: "Lido Wrap stETH", description: "Convert stETH to wstETH via Lido for non-rebasing staking yield.",
      x: 0, y: 0, config: { platform: "Lido", action: "wrap" } };
  } else if (lc.includes("aerodrome") || lc.includes("lp") || lc.includes("liquidity")) {
    defiNode = { id: "defi-node", type: "defi-lp", protocol: "aerodrome", action: "aerodrome-swap-exact-tokens",
      label: "Aerodrome LP", description: "Provide liquidity on Aerodrome (Base-native AMM).",
      x: 0, y: 0, config: { platform: "Aerodrome", action: "addLiquidity" } };
  } else if (lc.includes("sky") || lc.includes("usds") || lc.includes("savings") || lc.includes("susds")) {
    defiNode = { id: "defi-node", type: "defi-save", protocol: "sky", action: "sky-deposit",
      label: "Sky sUSDS Deposit", description: "Deposit USDS into Sky Savings for stablecoin yield.",
      x: 0, y: 0, config: { platform: "Sky", action: "deposit" } };
  } else if (lc.includes("swap") || lc.includes("uniswap") || lc.includes("dca")) {
    defiNode = { id: "defi-node", type: "defi-swap", protocol: "uniswap", action: "uniswap-swap-exact-input",
      label: "Uniswap V3 Swap", description: "Execute a token swap on Uniswap V3 (Base mainnet).",
      x: 0, y: 0, config: { platform: "Uniswap V3", action: "swap" } };
  } else {
    defiNode = { id: "defi-node", type: "defi-lend", protocol: "morpho", action: "morpho-vault-deposit",
      label: "Morpho Vault Deposit", description: "Supply USDC to highest-yield Morpho vault.",
      x: 0, y: 0, config: { platform: "Morpho", action: "deposit" } };
  }
  nodes.push(defiNode);
  edges.push({ id: `e${edgeIdx++}`, source: prevId, target: "defi-node" });
  prevId = "defi-node";

  // 6. Notify (optional)
  if (lc.includes("notify") || lc.includes("alert") || lc.includes("telegram") || lc.includes("email") || lc.includes("report") || lc.includes("summary") || lc.includes("video")) {
    const isTelegram = !lc.includes("email");
    const hasVideo   = lc.includes("video") || lc.includes("visual");
    const label      = hasVideo ? "fal.ai Visual Report" : isTelegram ? "Telegram Alert" : "Email Report";
    const type: NodeType = hasVideo ? "intelligence-fal" : "notify";
    nodes.push({
      id: "notify-node", type,
      label,
      description: hasVideo
        ? "Generates an AI strategy visualization via fal.ai and sends to Telegram."
        : isTelegram ? "Pushes execution summary to your Telegram bot." : "Emails a full strategy report.",
      x: 0, y: 0,
      config: { channel: isTelegram ? "Telegram" : "Email" },
    });
    edges.push({ id: `e${edgeIdx++}`, source: prevId, target: "notify-node" });
  }

  // Layout: stagger x + y
  nodes.forEach((n, idx) => {
    n.x = 80 + idx * 200;
    n.y = 200 + (idx % 2 === 0 ? -30 : 30);
  });

  const summary = `${nodes.length} nodes: ${nodes.map(n => n.label).join(" → ")}.`;
  return { nodes, edges, summary, marketContext };
}
