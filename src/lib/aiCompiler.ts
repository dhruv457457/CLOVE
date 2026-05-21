/**
 * Natural Language AI Strategy Compiler for CLOVE.
 * Parses user text inputs into structured nodes and edges for the Visual Blueprint Canvas.
 */

export interface BlueprintNode {
  id: string;
  type: "trigger" | "budget" | "intelligence" | "defi" | "notify";
  label: string;
  description: string;
  x: number;
  y: number;
  config: Record<string, any>;
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
}

export function compilePromptToWorkflow(prompt: string): CompiledWorkflow {
  const nodes: BlueprintNode[] = [];
  const edges: BlueprintEdge[] = [];
  
  // 1. Detect Trigger Node
  let triggerLabel = "Interval Trigger";
  let triggerDesc = "Triggers the strategy on a recurring schedule.";
  let triggerConfig: Record<string, any> = { schedule: "Daily at 9:00 AM" };

  if (prompt.toLowerCase().includes("daily") || prompt.toLowerCase().includes("every day")) {
    triggerLabel = "Daily Schedule";
    triggerDesc = "Executes daily at 8:00 AM UTC.";
    triggerConfig = { schedule: "Daily at 8:00 AM" };
  } else if (prompt.toLowerCase().includes("hour") || prompt.toLowerCase().includes("hourly")) {
    triggerLabel = "Hourly Check";
    triggerDesc = "Triggers every 60 minutes.";
    triggerConfig = { schedule: "Hourly" };
  } else if (prompt.toLowerCase().includes("price") || prompt.toLowerCase().includes("drops") || prompt.toLowerCase().includes("<")) {
    triggerLabel = "ETH Price Alert";
    triggerDesc = "Triggers when ETH drops below $3,200.";
    triggerConfig = { condition: "ETH < $3200" };
  }

  nodes.push({
    id: "trigger-node",
    type: "trigger",
    label: triggerLabel,
    description: triggerDesc,
    x: 80,
    y: 180,
    config: triggerConfig
  });

  // 2. Detect Budget Node (ERC-7715)
  let budgetLabel = "MetaMask Budget (ERC-7715)";
  let budgetAmount = "10.00";
  let budgetDesc = "Daily allowance limit of 10.00 USDC.";

  const budgetMatch = prompt.match(/(?:budget|allowance|limit|spend)\s*(?:of)?\s*\$?([0-9.]+)/i);
  if (budgetMatch) {
    budgetAmount = parseFloat(budgetMatch[1]).toFixed(2);
    budgetDesc = `Daily allowance limit of ${budgetAmount} USDC.`;
  }

  nodes.push({
    id: "budget-node",
    type: "budget",
    label: budgetLabel,
    description: budgetDesc,
    x: 280,
    y: 180,
    config: { amount: budgetAmount, token: "USDC" }
  });
  edges.push({ id: "e1", source: "trigger-node", target: "budget-node" });

  // 3. Detect Intelligence API Node (x402)
  let includeApi = true;
  let apiLabel = "Premium Intelligence (x402)";
  let apiDesc = "Fetches premium yield reports for 0.01 USDC.";
  let apiCost = "0.01";

  if (prompt.toLowerCase().includes("pay") || prompt.toLowerCase().includes("intelligence") || prompt.toLowerCase().includes("api") || prompt.toLowerCase().includes("x402")) {
    const costMatch = prompt.match(/(?:pay|fee|cost)\s*(?:of)?\s*\$?([0-9.]+)/i);
    if (costMatch) {
      apiCost = parseFloat(costMatch[1]).toFixed(3);
    }
    apiDesc = `Queries market intelligence API. Billed ${apiCost} USDC via x402.`;
  } else {
    // default premium yield intelligence
    apiDesc = "Enforces premium yield scouting. Billed 0.01 USDC via x402.";
  }

  nodes.push({
    id: "api-node",
    type: "intelligence",
    label: apiLabel,
    description: apiDesc,
    x: 480,
    y: 180,
    config: { cost: apiCost, resource: "/api/intelligence" }
  });
  edges.push({ id: "e2", source: "budget-node", target: "api-node" });

  // 4. Detect DeFi Action Node
  let defiLabel = "1Shot Yield Optimizer";
  let defiDesc = "Deploys assets to high-yield pools gaslessly via 1Shot Relayer.";
  let actionAmount = "50.00";

  const swapMatch = prompt.match(/(?:swap|spend|deposit|supply)\s*\$?([0-9.]+)\s*(?:usdc)?\s*(?:for|to)\s*([a-z0-9]+)/i);
  if (swapMatch) {
    actionAmount = parseFloat(swapMatch[1]).toFixed(2);
    const asset = swapMatch[2].toUpperCase();
    defiLabel = `Swap USDC to ${asset}`;
    defiDesc = `Executes swap of ${actionAmount} USDC for ${asset} gaslessly via 1Shot Relayer.`;
  } else if (prompt.toLowerCase().includes("aave") || prompt.toLowerCase().includes("supply") || prompt.toLowerCase().includes("lend")) {
    defiLabel = "Supply USDC to Aave";
    defiDesc = "Lends excess USDC into Aave lending market for stable APY.";
  }

  nodes.push({
    id: "defi-node",
    type: "defi",
    label: defiLabel,
    description: defiDesc,
    x: 680,
    y: 180,
    config: { amount: actionAmount, platform: "Uniswap V3 / Aave" }
  });
  edges.push({ id: "e3", source: "api-node", target: "defi-node" });

  // 5. Detect Notification Node
  let includeNotify = false;
  let notifyLabel = "Strategy Notification";
  let notifyDesc = "Sends strategy execution summary reports.";

  if (prompt.toLowerCase().includes("notify") || prompt.toLowerCase().includes("alert") || prompt.toLowerCase().includes("telegram") || prompt.toLowerCase().includes("email")) {
    includeNotify = true;
    if (prompt.toLowerCase().includes("telegram")) {
      notifyLabel = "Telegram Alert";
      notifyDesc = "Pushes transaction reports directly to your Telegram bot.";
    } else {
      notifyLabel = "Email Report";
      notifyDesc = "Mails full strategy rebalancing receipts.";
    }
  }

  if (includeNotify) {
    nodes.push({
      id: "notify-node",
      type: "notify",
      label: notifyLabel,
      description: notifyDesc,
      x: 880,
      y: 180,
      config: { channel: notifyLabel.includes("Telegram") ? "Telegram" : "Email" }
    });
    edges.push({ id: "e4", source: "defi-node", target: "notify-node" });
  }

  // Set visual offsets if notify is present to balance the layout
  if (includeNotify) {
    nodes.forEach((n, idx) => {
      n.x = 60 + idx * 210;
      n.y = 200 + (idx % 2 === 0 ? -30 : 30); // staggered blueprint layout
    });
  } else {
    nodes.forEach((n, idx) => {
      n.x = 80 + idx * 240;
      n.y = 200 + (idx % 2 === 0 ? -35 : 35);
    });
  }

  const summary = `Successfully parsed strategy prompt. Compiled ${nodes.length} connected modules: ${nodes.map(n => n.label).join(" → ")}.`;

  return {
    nodes,
    edges,
    summary
  };
}
