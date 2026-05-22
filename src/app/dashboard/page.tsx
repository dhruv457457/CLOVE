"use client";

import React, { useState, useEffect } from "react";
import {
  Play, LayoutDashboard, Workflow, BarChart2, DollarSign,
  BookUser, MessageSquare, FileText, AlertCircle,
  Plus, Wallet, ChevronDown, RefreshCw, Layers, Sparkles, Send,
} from "lucide-react";
import BlueprintCanvas from "@/components/BlueprintCanvas";
import InteractiveTerminal from "@/components/InteractiveTerminal";
import PermissionPanel from "@/components/EmulatorPanel";
import NodeInspector from "@/components/NodeInspector";
import ExecutionSummary, { type ExecutionResult } from "@/components/ExecutionSummary";
import WorkflowCodeViewer from "@/components/WorkflowCodeViewer";
import RunsHistory, { type RunRecord } from "@/components/RunsHistory";
import ScheduleManager from "@/components/ScheduleManager";
import ProtocolSidebar from "@/components/ProtocolSidebar";
import { compilePromptToWorkflow, BlueprintNode, BlueprintEdge } from "@/lib/aiCompiler";
import { terminalStore, TerminalLog } from "@/lib/walletEmulator";
import { metamaskStore } from "@/lib/web3/metamaskStore";

const NAV_ITEMS = [
  { icon: <LayoutDashboard size={18} />, label: "Hub"          },
  { icon: <Workflow       size={18} />, label: "Workflows"     },
  { icon: <BarChart2      size={18} />, label: "Analytics"     },
  { icon: <DollarSign     size={18} />, label: "Earnings"      },
  { icon: <BookUser       size={18} />, label: "Address Book"  },
];

const BOTTOM_NAV = [
  { icon: <MessageSquare size={16} />, label: "Join Discord"    },
  { icon: <FileText      size={16} />, label: "Documentation"   },
  { icon: <AlertCircle   size={16} />, label: "Report an Issue" },
];

export default function Dashboard() {
  const [terminalLogs, setTerminalLogs]   = useState<TerminalLog[]>(terminalStore.getLogs());
  const [nodes, setNodes]                 = useState<BlueprintNode[]>([]);
  const [edges, setEdges]                 = useState<BlueprintEdge[]>([]);
  const [isExecuting, setIsExecuting]     = useState(false);
  const [isCompiling, setIsCompiling]     = useState(false);
  const [activeNodeId, setActiveNodeId]   = useState<string | null>(null);
  const [activeNav, setActiveNav]         = useState("Hub");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedNode, setSelectedNode]   = useState<BlueprintNode | null>(null);
  const [lastResult, setLastResult]       = useState<ExecutionResult | null>(null);
  const [rightTab, setRightTab]           = useState<"Properties" | "Code" | "Runs" | "Schedule" | "Protocols">("Properties");
  const [runs, setRuns]                   = useState<RunRecord[]>([]);
  const [aiPrompt, setAiPrompt]           = useState("");
  const [liveApys, setLiveApys]           = useState<Record<string, number>>({});

  // Subscribe to terminal log changes
  useEffect(() => {
    const unsub = terminalStore.addListener(() => setTerminalLogs([...terminalStore.getLogs()]));
    return () => { unsub(); };
  }, []);

  // Fetch live APYs for the protocol sidebar (best-effort)
  useEffect(() => {
    fetch("/api/intelligence", { headers: { "PAYMENT-SIGNATURE": "sidebar-prefetch" } })
      .then(r => r.ok ? r.json() : null)
      .then((data: { yields?: Record<string, { apy: number }> } | null) => {
        if (!data?.yields) return;
        const apys: Record<string, number> = {};
        for (const [k, v] of Object.entries(data.yields)) apys[k] = v.apy;
        setLiveApys(apys);
      })
      .catch(() => {});
  }, []);

  // Compile default strategy on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const imported = localStorage.getItem("clove_imported_prompt");
    const prompt = imported ?? "Hourly check, daily allowance of 10 USDC, scout yields via Venice AI (x402), rebalance to highest Morpho vault, notify via Telegram.";
    if (imported) { localStorage.removeItem("clove_imported_prompt"); setActiveNav("Workflows"); }
    void handleCompileStrategy(prompt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Strategy compiler ────────────────────────────────────────────────────────

  const handleCompileStrategy = async (prompt: string) => {
    setIsCompiling(true);
    setSelectedNode(null);
    terminalStore.addLog("info", "Compiling strategy via Venice AI…");
    try {
      const mmState = metamaskStore.getState();
      const res = await fetch("/api/agent/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Include walletAddress so the workflow is saved to MongoDB for cron re-execution
        body: JSON.stringify({ prompt, walletAddress: mmState.userAddress ?? undefined }),
      });
      if (res.ok) {
        const compiled = await res.json();
        setNodes(compiled.nodes);
        setEdges(compiled.edges);
        if (compiled.marketContext) {
          terminalStore.addLog("meta", `[Tavily] ${compiled.marketContext.slice(0, 90)}…`);
        }
        terminalStore.addLog("success", compiled.summary ?? "Workflow compiled by Venice AI.");
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      const compiled = compilePromptToWorkflow(prompt);
      setNodes(compiled.nodes);
      setEdges(compiled.edges);
      terminalStore.addLog("warning", "Venice unavailable — compiled locally.");
    } finally {
      setIsCompiling(false);
    }
  };

  // ── Agent execution (server-side AgentExecutor) ─────────────────────────────

  const handleRun = async () => {
    if (isExecuting) {
      setIsExecuting(false);
      setActiveNodeId(null);
      terminalStore.addLog("warning", "Agent paused by user.");
      return;
    }

    const mmState = metamaskStore.getState();

    if (!mmState.userAddress) {
      terminalStore.addLog("error", "Connect MetaMask first (see Permission panel →).");
      return;
    }
    if (!mmState.permission) {
      terminalStore.addLog("error", "No ERC-7715 permission. Grant one in the Permission panel →");
      return;
    }

    const permission = mmState.permission;
    setIsExecuting(true);
    terminalStore.addLog("info", "Agent starting — sending workflow to server-side executor…");

    try {
      // Animate nodes as agent progresses (optimistic — real execution on server)
      const canvasNodeIds = nodes.map(n => n.id);
      let animIdx = 0;
      const animInterval = setInterval(() => {
        if (animIdx < canvasNodeIds.length) setActiveNodeId(canvasNodeIds[animIdx++]);
      }, 1200);

      // ── Call Vercel AI SDK agent (Venice decides tool calls) ───
      const res = await fetch("/api/agent/run-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress:      mmState.userAddress,
          budgetUsdc:         permission.budgetUsdc,
          permissionsContext: permission.permissionsContext,
          delegationManager:  permission.delegationManager,
          delegationId:       permission.delegationId,
          goal:               nodes.find(n => n.type === "intelligence")?.config?.resource
                                ? "Maximize stablecoin yield on Base using x402 intelligence"
                                : "Maximize stablecoin yield on Base",
        }),
      });

      clearInterval(animInterval);

      if (!res.ok) throw new Error(`Agent run failed: HTTP ${res.status}`);

      // AI SDK agent returns flat result
      const run = await res.json() as {
        success:   boolean; durationMs: number; finalText: string; error?: string;
        steps:     Array<{ tool: string; result: string }>;
        bestApy?:  number; protocol?: string; txHash?: string; costPaid: number;
      };

      // ── Stream AI agent tool calls into terminal ───────────────
      terminalStore.addLog("info", "🤖 Venice AI agent reasoning…");
      await sleep(400);

      const toolNodeIds = nodes.map(n => n.id);
      let nodeIdx = 0;

      for (const step of run.steps) {
        // Light up next canvas node as each tool fires
        if (nodeIdx < toolNodeIds.length) setActiveNodeId(toolNodeIds[nodeIdx++]);
        await sleep(500);

        // Parse result for display
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(step.result) as Record<string, unknown>; } catch { /**/ }

        switch (step.tool) {
          case "checkYields":
            terminalStore.addLog("success", `[Venice Tool] checkYields ✓`);
            if (parsed.bestApy)    terminalStore.addLog("meta", `Best APY: ${parsed.bestApy}% on ${parsed.recommended ?? "—"}`);
            if (parsed.marketNews) terminalStore.addLog("info",  `[Intel] ${String(parsed.marketNews).slice(0, 80)}…`);
            break;
          case "checkRisk":
            terminalStore.addLog("success", `[Venice Tool] checkRisk ✓`);
            terminalStore.addLog("meta", `Risk level: ${parsed.riskLevel ?? "LOW"} · Safe: ${parsed.safeToExecute ? "YES" : "NO"}`);
            break;
          case "payForIntelligence":
            terminalStore.addLog("success", `[Venice Tool] payForIntelligence ✓ — $0.01 USDC paid via x402`);
            break;
          case "executeDefi":
            if (parsed.txHash)   terminalStore.addLog("success", `[Venice Tool] executeDefi ✓ — TxHash: ${parsed.txHash}`);
            else if (parsed.prepared || parsed.calldata) terminalStore.addLog("warning", `[Venice Tool] executeDefi — calldata prepared`);
            else                 terminalStore.addLog("success", `[Venice Tool] executeDefi ✓`);
            break;
          case "notifyUser":
            terminalStore.addLog("success", `[Venice Tool] notifyUser ✓ — Telegram sent`);
            break;
          default:
            terminalStore.addLog("info", `[Venice Tool] ${step.tool} ✓`);
        }
      }

      // Final Venice reasoning
      if (run.finalText) {
        terminalStore.addLog("info", `Venice: ${run.finalText.slice(0, 120)}`);
      }

      const result: ExecutionResult = {
        timestamp:   Date.now(),
        success:     run.success,
        error:       run.error,
        bestApy:     run.bestApy,
        recommended: run.protocol,
        costUsdc:    run.costPaid ?? 0.01,
        txHash:      run.txHash,
      };
      setLastResult(result);

      // Store in runs history
      const runRecord: RunRecord = {
        runId:     `run_${Date.now()}`,
        timestamp:  Date.now(),
        success:    run.success,
        durationMs: run.durationMs,
        steps: run.steps.map(s => ({
          nodeId:     s.tool,
          nodeType:   s.tool,
          label:      s.tool,
          status:     "done" as const,
          durationMs: 0,
          output:     { result: s.result },
        })),
        error: run.error,
      };
      setRuns(prev => [runRecord, ...prev].slice(0, 20));
      setRightTab("Runs");

      terminalStore.addLog(run.success ? "info" : "warning",
        run.success
          ? `Agent cycle complete in ${run.durationMs}ms.`
          : `Agent ended: ${run.error ?? "unknown error"}`
      );

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResult({ timestamp: Date.now(), success: false, error: msg });
      terminalStore.addLog("error", `Agent error: ${msg}`);
    } finally {
      setIsExecuting(false);
      setActiveNodeId(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const mmState = metamaskStore.getState();

  return (
    <div className="flex h-screen bg-[#060a08] text-[#edfaf5] font-sans overflow-hidden">

      {/* Sidebar */}
      <aside className={`flex flex-col border-r border-[rgba(21,133,105,0.15)] bg-[#080d0a] transition-all duration-300 ${sidebarCollapsed ? "w-14" : "w-56"}`}>
        <div className="p-3 border-b border-[rgba(21,133,105,0.12)]">
          {!sidebarCollapsed ? (
            <button
              onClick={() => handleCompileStrategy("Hourly check, daily allowance of 15 USDC, scout yields via Venice AI, rebalance to best Morpho vault, notify Telegram.")}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(21,133,105,0.12)] border border-[rgba(21,133,105,0.3)] text-[#1aad89] text-xs font-bold font-mono hover:bg-[rgba(21,133,105,0.22)] transition-colors"
            >
              <Plus size={13} /> New Workflow
            </button>
          ) : (
            <button onClick={() => setSidebarCollapsed(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-[rgba(21,133,105,0.12)] text-[#1aad89] hover:bg-[rgba(21,133,105,0.22)] mx-auto transition-colors">
              <Plus size={14} />
            </button>
          )}
        </div>

        <nav className="py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map(item => (
            <button
              key={item.label}
              onClick={() => setActiveNav(item.label)}
              className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-all ${
                activeNav === item.label
                  ? "bg-[rgba(21,133,105,0.15)] text-[#1aad89] border-l-2 border-[#158569]"
                  : "text-[#3d6655] hover:text-[#7aad97] hover:bg-[rgba(255,255,255,0.03)]"
              }`}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!sidebarCollapsed && <span className="text-[12px] font-medium">{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* ── AI Prompt section ───────────────────────────────────────── */}
        {!sidebarCollapsed ? (
          <div className="mx-2 mb-2 rounded-xl border border-[rgba(21,133,105,0.2)] bg-[rgba(21,133,105,0.04)] overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[rgba(21,133,105,0.12)]">
              <Sparkles size={10} className="text-[#1aad89]" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#7aad97] font-mono">Ask AI</span>
            </div>
            <div className="p-2 space-y-2">
              <textarea
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && aiPrompt.trim()) {
                    e.preventDefault();
                    void handleCompileStrategy(aiPrompt.trim());
                    setAiPrompt("");
                  }
                }}
                placeholder="Describe your DeFi strategy…"
                rows={2}
                className="w-full resize-none bg-[rgba(0,0,0,0.4)] border border-[rgba(21,133,105,0.15)] rounded-lg px-2.5 py-2 text-[10px] font-mono text-[#c4c4e8] placeholder-[#3d6655] focus:outline-none focus:border-[rgba(21,133,105,0.4)] leading-relaxed"
              />
              <button
                onClick={() => { if (aiPrompt.trim()) { void handleCompileStrategy(aiPrompt.trim()); setAiPrompt(""); } }}
                disabled={!aiPrompt.trim() || isCompiling}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[#158569] hover:bg-[#1aad89] disabled:opacity-40 text-[9px] font-bold font-mono text-white transition-all"
              >
                {isCompiling
                  ? <><RefreshCw size={9} className="animate-spin" /> Compiling…</>
                  : <><Send size={9} /> Generate Workflow</>
                }
              </button>
              {/* Quick prompt chips */}
              <div className="flex flex-wrap gap-1">
                {["Morpho yield", "ETH DCA", "Protect funds", "Best APY"].map(chip => (
                  <button
                    key={chip}
                    onClick={() => void handleCompileStrategy(`${chip} strategy: check yields via Venice AI, assess risk, execute on best protocol, notify via Telegram.`)}
                    className="text-[8px] font-mono px-2 py-0.5 rounded-full border border-[rgba(21,133,105,0.2)] text-[#3d6655] hover:text-[#7aad97] hover:border-[rgba(21,133,105,0.4)] transition-colors"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Collapsed: just sparkle icon */
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[rgba(21,133,105,0.12)] text-[#1aad89] hover:bg-[rgba(21,133,105,0.22)] mx-auto mb-2 transition-colors"
            title="Ask AI"
          >
            <Sparkles size={13} />
          </button>
        )}

        <div className="py-3 px-2 border-t border-[rgba(21,133,105,0.12)] space-y-0.5">
          {BOTTOM_NAV.map(item => (
            <button key={item.label} className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left text-[#3d6655] hover:text-[#7aad97] hover:bg-[rgba(255,255,255,0.03)] transition-all">
              <span className="flex-shrink-0">{item.icon}</span>
              {!sidebarCollapsed && <span className="text-[11px]">{item.label}</span>}
            </button>
          ))}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <header className="h-12 border-b border-[rgba(21,133,105,0.15)] bg-[rgba(6,10,8,0.92)] flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="w-7 h-7 flex items-center justify-center rounded-md text-[#3d6655] hover:text-[#7aad97] hover:bg-[rgba(255,255,255,0.05)] transition-all">
              <Layers size={15} />
            </button>
            <div className="flex items-center gap-1.5 bg-[rgba(10,15,12,0.8)] border border-[rgba(21,133,105,0.2)] rounded-lg px-3 py-1.5 cursor-pointer hover:border-[rgba(21,133,105,0.4)] transition-colors">
              <div className="w-3.5 h-3.5 rounded-sm bg-[#158569]" />
              <span className="text-[11px] font-mono text-[#7aad97]">CLOVE Workspace</span>
              <ChevronDown size={11} className="text-[#3d6655]" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Permission status dot */}
            <div className={`flex items-center gap-1.5 text-[10px] font-mono ${mmState.permission ? "text-[#1aad89]" : "text-[#3d6655]"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${mmState.permission ? "bg-[#1aad89] animate-pulse" : "bg-[#3d6655]"}`} />
              {mmState.permission ? `${mmState.permission.budgetUsdc} USDC / ${mmState.permission.periodDays}d` : "No permission"}
            </div>

            {/* Run button */}
            <button
              onClick={handleRun}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${
                isExecuting
                  ? "bg-[rgba(21,133,105,0.15)] border border-[rgba(21,133,105,0.4)] text-[#1aad89]"
                  : "bg-[#158569] hover:bg-[#1aad89] text-[#edfaf5] shadow-[0_0_16px_rgba(21,133,105,0.3)]"
              }`}
            >
              {isExecuting
                ? <><RefreshCw size={11} className="animate-spin" /> RUNNING</>
                : <><Play size={11} fill="white" /> Run</>
              }
            </button>

            {/* Wallet chip */}
            <div className="flex items-center gap-1.5 bg-[rgba(10,15,12,0.8)] border border-[rgba(21,133,105,0.2)] rounded-lg px-3 py-1.5">
              <Wallet size={12} className="text-[#158569]" />
              <span className="text-[10px] font-mono text-[#7aad97]">
                {mmState.userAddress
                  ? `${mmState.userAddress.slice(0, 6)}…${mmState.userAddress.slice(-4)}`
                  : "Not connected"}
              </span>
            </div>
          </div>
        </header>

        {/* Workspace */}
        <main className="flex-1 flex gap-4 p-4 overflow-hidden">

          {/* Left: prompt bar + canvas + execution summary + terminal */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">

            {/* Canvas header */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                {["Properties", "Code", "Runs"].map(tab => (
                  <button
                    key={tab}
                    className={`text-[11px] font-mono px-3 py-1 rounded-md transition-all ${
                      tab === "Properties"
                        ? "bg-[rgba(21,133,105,0.15)] text-[#1aad89] border border-[rgba(21,133,105,0.3)]"
                        : "text-[#3d6655] hover:text-[#7aad97]"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <span className={`flex items-center gap-1.5 text-[10px] font-mono ${isExecuting ? "text-[#1aad89]" : "text-[#3d6655]"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isExecuting ? "bg-[#1aad89] animate-ping" : "bg-[#3d6655]"}`} />
                {isExecuting ? "Executing strategy…" : isCompiling ? "Compiling…" : "Idle"}
              </span>
              {selectedNode && (
                <span className="text-[9px] font-mono text-[#7aad97] ml-auto">
                  {selectedNode.label} selected
                </span>
              )}
            </div>

            {/* Canvas with NodeInspector overlay */}
            <div className="flex-1 relative rounded-xl border border-[rgba(21,133,105,0.18)] bg-[#0a0f0c] overflow-hidden min-h-0">
              <BlueprintCanvas
                nodes={nodes}
                edges={edges}
                onNodesChange={setNodes}
                onEdgesChange={setEdges}
                isExecuting={isExecuting}
                activeNodeId={activeNodeId}
                onNodeClick={(node) => setSelectedNode(prev => prev?.id === node.id ? null : node)}
              />
              {selectedNode && (
                <NodeInspector node={selectedNode} onClose={() => setSelectedNode(null)} />
              )}
            </div>

            {/* Execution summary */}
            {lastResult && (
              <div className="flex-shrink-0">
                <ExecutionSummary result={lastResult} onClose={() => setLastResult(null)} />
              </div>
            )}

            {/* Terminal — drag top edge to resize, click ↓ to collapse */}
            <InteractiveTerminal
              logs={terminalLogs}
              onClear={() => terminalStore.clearLogs()}
            />
          </div>

          {/* Right: tabbed panel — Properties / Code / Runs / Schedule / Protocols */}
          <div className="w-72 flex-shrink-0 min-w-0 overflow-hidden flex flex-col border border-[rgba(21,133,105,0.2)] bg-[#0a0f0c] rounded-xl">
            {/* Tab bar — 5 tabs, 2 rows */}
            <div className="grid grid-cols-5 border-b border-[rgba(21,133,105,0.15)] flex-shrink-0">
              {(["Properties", "Code", "Runs", "Schedule", "Protocols"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setRightTab(tab)}
                  className={`py-2 text-[8px] font-mono font-bold transition-all ${
                    rightTab === tab
                      ? "text-[#1aad89] border-b-2 border-[#1aad89] bg-[rgba(21,133,105,0.06)]"
                      : "text-[#3d6655] hover:text-[#7aad97]"
                  }`}
                >
                  {tab === "Properties" ? "Props" : tab}
                  {tab === "Runs" && runs.length > 0 && (
                    <span className="ml-0.5 text-[6px] px-1 py-0.5 rounded-full bg-[rgba(21,133,105,0.2)] text-[#1aad89]">
                      {runs.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {rightTab === "Properties" && <PermissionPanel />}
              {rightTab === "Code"       && <WorkflowCodeViewer nodes={nodes} edges={edges} />}
              {rightTab === "Runs"       && <RunsHistory runs={runs} />}
              {rightTab === "Schedule"   && (
                <ScheduleManager onScheduledRun={() => {
                  terminalStore.addLog("info", "⏰ Scheduled trigger fired — running agent…");
                  void handleRun();
                }} />
              )}
              {rightTab === "Protocols"  && (
                <ProtocolSidebar
                  liveApys={liveApys}
                  onAddNode={(node) => {
                    setNodes(prev => {
                      // Position new node after the last one
                      const lastX = prev.length > 0 ? Math.max(...prev.map(n => n.x)) : 80;
                      const newNode = { ...node, x: lastX + 220, y: 200 };
                      const newEdges: BlueprintEdge[] = prev.length > 0
                        ? [{ id: `e-${Date.now()}`, source: prev[prev.length - 1].id, target: newNode.id }]
                        : [];
                      setEdges(e => [...e, ...newEdges]);
                      return [...prev, newNode];
                    });
                    terminalStore.addLog("info", `Added ${node.label} node to workflow.`);
                  }}
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
