"use client";

import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { BlueprintNode, BlueprintEdge } from "@/lib/aiCompiler";

interface Props {
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
}

function nodeToCode(node: BlueprintNode): string {
  const cfg = node.config ?? {};

  switch (node.type) {
    case "trigger":
      return `  // ── Trigger: ${node.label}
  await clove.trigger({
    schedule: ${JSON.stringify(cfg.schedule ?? "Hourly")},
    condition: ${JSON.stringify(cfg.condition ?? null)},
  });`;

    case "budget":
      return `  // ── Budget: ERC-7715 Permission
  const permission = await clove.checkPermission({
    amount: ${JSON.stringify(cfg.amount ?? "10.00")},
    token: "USDC",
    standard: "ERC-7715",
  });
  if (!permission.active) throw new Error("No active ERC-7715 permission");`;

    case "intelligence-tavily":
      return `  // ── Research: Tavily Web Search (x402)
  const research = await clove.x402.call({
    provider: "tavily",
    query: ${JSON.stringify(cfg.query ?? "DeFi yield rates market")},
    cost: ${JSON.stringify(cfg.cost ?? "0.005")},
    permissionsContext: permission.context,
  });`;

    case "intelligence":
      return `  // ── Intelligence: Venice AI (x402)
  const intel = await clove.x402.call({
    provider: "venice",
    endpoint: "/api/intelligence",
    cost: ${JSON.stringify(cfg.cost ?? "0.01")},
    permissionsContext: permission.context,
  });
  // Returns: { bestApy, recommended, reason, yields }`;

    case "risk-check":
      return `  // ── Risk Check: Evaluate Tavily signals
  const risk = clove.evaluateRisk({
    source: research?.answer ?? intel?.reason,
    threshold: ${JSON.stringify(cfg.threshold ?? "medium")},
  });
  if (risk.level === "high") {
    await clove.notify.telegram(\`⚠️ Risk HIGH — pausing agent: \${risk.reason}\`);
    return;
  }`;

    case "sentiment-check":
      return `  // ── Sentiment Gate: Only act on bullish/neutral
  const sentiment = clove.analyzeSentiment(research?.answer);
  if (sentiment === "bearish") {
    await clove.notify.telegram("🔴 Bearish sentiment — skipping rebalance.");
    return;
  }`;

    case "compare-apy":
      return `  // ── Compare APY: Select highest yield
  const best = await clove.compareProtocols({
    protocols: ${JSON.stringify(cfg.protocols ?? ["morpho", "sky", "aerodrome"])},
    metric: "apy",
  });
  // best = { protocol: "morpho", apy: 8.4 }`;

    case "defi-swap":
      return `  // ── Uniswap V3: Token Swap
  await clove.protocols.uniswap.swap({
    tokenIn: "USDC",
    tokenOut: "ETH",
    amountIn: permission.budgetUsdc,
    network: "base",
    via: "1shot",                          // gas-free via ERC-7710
    permissionsContext: permission.context,
  });`;

    case "defi-lend":
      return `  // ── Morpho: Vault Deposit
  await clove.protocols.morpho.deposit({
    vault: "moonwell-usdc",               // 0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca
    amount: permission.budgetUsdc,
    network: "base",
    via: "1shot",
    permissionsContext: permission.context,
  });`;

    case "defi-stake":
      return `  // ── Lido: Wrap stETH → wstETH
  await clove.protocols.lido.wrap({
    amount: permission.budgetUsdc,
    network: "base",
    via: "1shot",
    permissionsContext: permission.context,
  });`;

    case "defi-save":
      return `  // ── Sky (MakerDAO): sUSDS Deposit
  await clove.protocols.sky.deposit({
    token: "USDS",
    amount: permission.budgetUsdc,
    network: "base",
    via: "1shot",
    permissionsContext: permission.context,
  });`;

    case "defi-lp":
      return `  // ── Aerodrome: Add Liquidity
  await clove.protocols.aerodrome.addLiquidity({
    tokenA: "USDC",
    tokenB: "ETH",
    amount: permission.budgetUsdc,
    network: "base",
    via: "1shot",
    permissionsContext: permission.context,
  });`;

    case "intelligence-fal":
      return `  // ── fal.ai: Generate Strategy Visualization
  const visual = await clove.x402.call({
    provider: "fal.ai",
    model: "flux/schnell",
    prompt: \`DeFi strategy visualization: \${intel?.recommended} \${intel?.bestApy}% APY\`,
    cost: "0.02",
    permissionsContext: permission.context,
  });
  // visual.imageUrl → sent to Telegram`;

    case "notify":
      return `  // ── Notify: ${node.config.channel ?? "Telegram"}
  await clove.notify.telegram({
    message: [
      \`✅ Cycle complete — Best APY: \${intel?.bestApy}% on \${intel?.recommended}\`,
      \`Risk: \${risk?.level ?? "low"} · Sentiment: \${sentiment ?? "neutral"}\`,
      intel?.reason,
    ].filter(Boolean).join("\\n"),
  });`;

    default:
      return `  // ── ${node.label}
  await clove.step(${JSON.stringify({ type: node.type, config: cfg }, null, 2).split("\n").join("\n  ")});`;
  }
}

function generateCode(nodes: BlueprintNode[], _edges: BlueprintEdge[]): string {
  if (nodes.length === 0) return "// No workflow compiled yet.";

  const imports = [
    `import { clove } from "@clove/agent";`,
    `// ERC-7715 permission · x402 payments · 1Shot relay · Venice AI`,
  ].join("\n");

  const fnName = "cloveStrategy";
  const body = nodes.map(n => nodeToCode(n)).join("\n\n");

  return `${imports}

export async function ${fnName}() {
  "use clove-workflow";

${body}
}`;
}

export default function WorkflowCodeViewer({ nodes, edges }: Props) {
  const [copied, setCopied] = useState(false);
  const code = generateCode(nodes, edges);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[rgba(21,133,105,0.15)] flex-shrink-0">
        <span className="text-[9px] font-mono text-[#3d6655] uppercase tracking-wider">
          workflows/strategy.ts
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[8px] font-mono text-[#3d6655] hover:text-[#1aad89] transition-colors"
        >
          {copied ? <Check size={9} className="text-[#1aad89]" /> : <Copy size={9} />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <pre className="text-[9px] font-mono leading-5 p-3 text-[#7aad97] whitespace-pre-wrap break-words">
          {code.split("\n").map((line, i) => (
            <div key={i} className="flex">
              <span className="w-6 flex-shrink-0 text-[#3d6655] text-right mr-3 select-none">{i + 1}</span>
              <span className={
                line.trim().startsWith("//") ? "text-[#3d6655] italic" :
                line.includes("await clove") ? "text-[#1aad89]" :
                line.includes("import") ? "text-violet-400" :
                line.includes("const ") || line.includes("export ") ? "text-sky-400" :
                line.includes('"use clove') ? "text-amber-400" :
                "text-[#7aad97]"
              }>{line}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
