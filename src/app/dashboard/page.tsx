"use client";

import React, { useState, useEffect } from "react";
import {
  Play, Pause, LayoutDashboard, Workflow, BarChart2, DollarSign,
  BookUser, HelpCircle, MessageSquare, FileText, AlertCircle,
  Plus, Wallet, ChevronDown, RefreshCw, Layers
} from "lucide-react";
import BlueprintCanvas from "@/components/BlueprintCanvas";
import InteractiveTerminal from "@/components/InteractiveTerminal";
import EmulatorPanel from "@/components/EmulatorPanel";
import { walletEmulator, EmulatorState, TerminalLog } from "@/lib/walletEmulator";
import { compilePromptToWorkflow, BlueprintNode, BlueprintEdge } from "@/lib/aiCompiler";

const NAV_ITEMS = [
  { icon: <LayoutDashboard size={18} />, label: "Hub", href: "#hub" },
  { icon: <Workflow size={18} />, label: "Workflows", href: "#workflows" },
  { icon: <BarChart2 size={18} />, label: "Analytics", href: "#analytics" },
  { icon: <DollarSign size={18} />, label: "Earnings", href: "#earnings" },
  { icon: <BookUser size={18} />, label: "Address Book", href: "#address-book" },
];

const BOTTOM_NAV = [
  { icon: <MessageSquare size={16} />, label: "Join Discord" },
  { icon: <FileText size={16} />, label: "Documentation" },
  { icon: <AlertCircle size={16} />, label: "Report an Issue" },
];

export default function Dashboard() {
  const [emulatorState, setEmulatorState] = useState<EmulatorState>(walletEmulator.getState());
  const [terminalLogs, setTerminalLogs] = useState<TerminalLog[]>(walletEmulator.getLogs());
  const [nodes, setNodes] = useState<BlueprintNode[]>([]);
  const [edges, setEdges] = useState<BlueprintEdge[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState("Hub");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [pendingPermissionRequest, setPendingPermissionRequest] = useState<{
    to: string;
    tokenSymbol: string;
    amount: string;
    justification: string;
    onApprove: () => void;
    onReject: () => void;
  } | null>(null);

  useEffect(() => {
    const unsub = walletEmulator.addListener(() => {
      setEmulatorState({ ...walletEmulator.getState() });
      setTerminalLogs([...walletEmulator.getLogs()]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const imported = localStorage.getItem("clove_imported_prompt");
      if (imported) {
        localStorage.removeItem("clove_imported_prompt");
        handleCompileStrategy(imported);
        setActiveNav("Workflows");
      } else {
        handleCompileStrategy("Hourly check, daily allowance of 10.00 USDC, pay 0.01 USDC to premium intelligence API, yield compound to Aave, notify via Telegram.");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCompileStrategy = (prompt: string) => {
    walletEmulator.addLog("info", "AI strategy prompt submitted. Compiling workflow...");
    const compiled = compilePromptToWorkflow(prompt);
    setNodes(compiled.nodes);
    setEdges(compiled.edges);
    walletEmulator.addLog("success", compiled.summary);
  };

  const handleActivateAgent = async () => {
    if (isExecuting) {
      setIsExecuting(false);
      setActiveNodeId(null);
      walletEmulator.addLog("warning", "Autonomous DeFi Agent paused by user.");
      return;
    }

    const budgetNode = nodes.find(n => n.type === "budget");
    const apiNode = nodes.find(n => n.type === "intelligence");
    const defiNode = nodes.find(n => n.type === "defi");
    const budgetLimit = budgetNode ? budgetNode.config.amount : "10.00";
    const apiCost = apiNode ? parseFloat(apiNode.config.cost) : 0.01;
    const workCost = defiNode ? parseFloat(defiNode.config.amount) : 50.00;
    const totalCost = apiCost + workCost;

    const hasPermission = emulatorState.permissions.some(
      p => parseFloat(p.permission.data.periodAmount) >= totalCost
    );

    const triggerCycle = async () => {
      setIsExecuting(true);
      try {
        setActiveNodeId("trigger-node"); await new Promise(r => setTimeout(r, 1200));
        setActiveNodeId("budget-node");  await new Promise(r => setTimeout(r, 1200));
        setActiveNodeId("api-node");     await new Promise(r => setTimeout(r, 1500));
        setActiveNodeId("defi-node");

        const actionResult = await walletEmulator.executeAgentAction(
          defiNode ? defiNode.label : "Lend USDC to Aave",
          totalCost,
          defiNode ? defiNode.description : "Successfully supplied USDC into Aave liquidity pool."
        );

        if (!actionResult.success) { setIsExecuting(false); setActiveNodeId(null); return; }

        const notifyNode = nodes.find(n => n.type === "notify");
        if (notifyNode) {
          setActiveNodeId("notify-node");
          await new Promise(r => setTimeout(r, 1000));
          walletEmulator.addLog("success", `[Notification Engine] Push delivered via ${notifyNode.config.channel}.`);
        }

        setIsExecuting(false);
        setActiveNodeId(null);
        walletEmulator.addLog("info", "Strategy cycle completed. Returning to monitoring loop.");
      } catch {
        setIsExecuting(false);
        setActiveNodeId(null);
        walletEmulator.addLog("error", "Unexpected error in strategy loop.");
      }
    };

    if (!hasPermission) {
      walletEmulator.addLog("warning", "Execution Blocked: ERC-7715 daily budget insufficient.");
      setPendingPermissionRequest({
        to: "0xC104E948493d5c9e2F60d26f5321C6Af5E92402",
        tokenSymbol: "USDC",
        amount: budgetLimit,
        justification: "Allow CLOVE Agent to scout yields, settle analytics via x402, and execute swaps gaslessly.",
        onApprove: async () => {
          setPendingPermissionRequest(null);
          await walletEmulator.requestPermissions(
            "0xC104E948493d5c9e2F60d26f5321C6Af5E92402",
            "0x036C000000000000000000000000000000000000",
            "USDC", budgetLimit,
            "Approved recurring DeFi strategy budget allowance."
          );
          triggerCycle();
        },
        onReject: () => {
          setPendingPermissionRequest(null);
          walletEmulator.addLog("error", "ERC-7715 Permission Rejected. Strategy aborted.");
        }
      });
    } else {
      triggerCycle();
    }
  };

  return (
    <div className="flex h-screen bg-[#060a08] text-[#edfaf5] font-sans overflow-hidden">

      {/* ══ SIDEBAR ══ */}
      <aside
        className={`flex flex-col border-r border-[rgba(21,133,105,0.15)] bg-[#080d0a] transition-all duration-300 ${sidebarCollapsed ? "w-14" : "w-56"}`}
      >
        {/* Top: Logo + New Workflow */}
        <div className="p-3 border-b border-[rgba(21,133,105,0.12)]">
          {!sidebarCollapsed && (
            <button
              onClick={() => handleCompileStrategy("Hourly check, daily allowance of 15 USDC, pay 0.01 USDC to yield API, compound to Aave, notify Telegram.")}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(21,133,105,0.12)] border border-[rgba(21,133,105,0.3)] text-[#1aad89] text-xs font-bold font-mono hover:bg-[rgba(21,133,105,0.22)] transition-colors"
            >
              <Plus size={13} />
              New Workflow
            </button>
          )}
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-[rgba(21,133,105,0.12)] text-[#1aad89] hover:bg-[rgba(21,133,105,0.22)] mx-auto transition-colors"
            >
              <Plus size={14} />
            </button>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => (
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
              {!sidebarCollapsed && (
                <span className="text-[12px] font-medium">{item.label}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Bottom nav */}
        <div className="py-3 px-2 border-t border-[rgba(21,133,105,0.12)] space-y-0.5">
          {BOTTOM_NAV.map((item) => (
            <button
              key={item.label}
              className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left text-[#3d6655] hover:text-[#7aad97] hover:bg-[rgba(255,255,255,0.03)] transition-all"
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!sidebarCollapsed && (
                <span className="text-[11px]">{item.label}</span>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* ══ MAIN CONTENT ══ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top Bar */}
        <header className="h-12 border-b border-[rgba(21,133,105,0.15)] bg-[rgba(6,10,8,0.92)] flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="w-7 h-7 flex items-center justify-center rounded-md text-[#3d6655] hover:text-[#7aad97] hover:bg-[rgba(255,255,255,0.05)] transition-all"
            >
              <Layers size={15} />
            </button>
            {/* Workspace selector */}
            <div className="flex items-center gap-1.5 bg-[rgba(10,15,12,0.8)] border border-[rgba(21,133,105,0.2)] rounded-lg px-3 py-1.5 cursor-pointer hover:border-[rgba(21,133,105,0.4)] transition-colors">
              <div className="w-3.5 h-3.5 rounded-sm bg-[#158569]" />
              <span className="text-[11px] font-mono text-[#7aad97]">CLOVE Workspace</span>
              <ChevronDown size={11} className="text-[#3d6655]" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Run button */}
            <button
              onClick={handleActivateAgent}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${
                isExecuting
                  ? "bg-[rgba(21,133,105,0.15)] border border-[rgba(21,133,105,0.4)] text-[#1aad89]"
                  : "bg-[#158569] hover:bg-[#1aad89] text-[#edfaf5] shadow-[0_0_16px_rgba(21,133,105,0.3)]"
              }`}
            >
              {isExecuting
                ? <><RefreshCw size={11} className="animate-spin" /> RUNNING</>
                : <><Play size={11} fill="white" /> Run</>}
            </button>

            {/* Wallet chip */}
            <div className="flex items-center gap-1.5 bg-[rgba(10,15,12,0.8)] border border-[rgba(21,133,105,0.2)] rounded-lg px-3 py-1.5">
              <Wallet size={12} className="text-[#158569]" />
              <span className="text-[10px] font-mono text-[#7aad97]">
                {emulatorState.smartAccountAddress
                  ? `${emulatorState.smartAccountAddress.slice(0, 6)}...${emulatorState.smartAccountAddress.slice(-4)}`
                  : "0x554b...9b78"}
              </span>
            </div>
          </div>
        </header>

        {/* Workspace Body */}
        <main className="flex-1 flex gap-4 p-4 overflow-hidden">

          {/* Left: Canvas + Terminal */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">

            {/* Properties / Canvas header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  {["Properties", "Code", "Runs"].map((tab) => (
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
                  {isExecuting ? "Strategy executing..." : "Idle"}
                </span>
              </div>
            </div>

            {/* Blueprint Canvas */}
            <div className="flex-1 rounded-xl border border-[rgba(21,133,105,0.18)] bg-[#0a0f0c] overflow-hidden min-h-0">
              <BlueprintCanvas
                nodes={nodes}
                edges={edges}
                onNodesChange={setNodes}
                onEdgesChange={setEdges}
                isExecuting={isExecuting}
                activeNodeId={activeNodeId}
              />
            </div>

            {/* Terminal */}
            <div className="h-48 flex-shrink-0">
              <InteractiveTerminal
                logs={terminalLogs}
                onClear={() => walletEmulator.clearLogs()}
              />
            </div>
          </div>

          {/* Right: Wallet Emulator (narrower) */}
          <div className="w-72 flex-shrink-0">
            <EmulatorPanel
              state={emulatorState}
              onUpgrade={() => walletEmulator.triggerEip7702Upgrade()}
              onDeposit={(amount) => walletEmulator.depositUsdc(amount)}
              onReset={() => walletEmulator.reset()}
              pendingPermissionRequest={pendingPermissionRequest}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
