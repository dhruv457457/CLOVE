import "server-only";

export type TelegramIntent =
  | { type: "help" }
  | { type: "whoami" }
  | { type: "list_agents" }
  | { type: "list_workflows" }
  | { type: "portfolio" }
  | { type: "cap_status" }
  | { type: "latest_tx" }
  | { type: "run_agent"; target?: string }
  | { type: "run_workflow"; target?: string }
  | { type: "pause_agent"; target?: string }
  | { type: "resume_agent"; target?: string }
  | { type: "create_agent"; prompt: string }
  | { type: "unknown"; text: string };

export function parseTelegramIntent(text: string): TelegramIntent {
  const trimmed = text.trim();
  const [rawCmd, ...args] = trimmed.split(/\s+/);
  const cmd = rawCmd.toLowerCase().split("@")[0];
  const rest = args.join(" ").trim();

  if (trimmed.startsWith("/")) {
    switch (cmd) {
      case "/start":
      case "/help":
        return { type: "help" };
      case "/whoami":
        return { type: "whoami" };
      case "/agents":
      case "/status":
        return { type: "list_agents" };
      case "/workflows":
      case "/teams":
        return { type: "list_workflows" };
      case "/portfolio":
        return { type: "portfolio" };
      case "/cap":
      case "/budget":
        return { type: "cap_status" };
      case "/tx":
      case "/history":
        return { type: "latest_tx" };
      case "/run":
        return { type: "run_agent", target: rest || undefined };
      case "/team":
        return { type: "run_workflow", target: rest || undefined };
      case "/pause":
        return { type: "pause_agent", target: rest || undefined };
      case "/resume":
        return { type: "resume_agent", target: rest || undefined };
      case "/create":
      case "/new":
        return rest ? { type: "create_agent", prompt: rest } : { type: "unknown", text: trimmed };
      default:
        return { type: "unknown", text: trimmed };
    }
  }

  const lower = trimmed.toLowerCase();
  if (/\b(who am i|linked wallet|my wallet)\b/.test(lower)) return { type: "whoami" };
  if (/\b(agent|agents|status)\b/.test(lower)) return { type: "list_agents" };
  if (/\b(workflow|workflows|team|teams)\b/.test(lower)) return { type: "list_workflows" };
  if (/\b(portfolio|holdings|position|positions)\b/.test(lower)) return { type: "portfolio" };
  if (/\b(cap|budget|remaining|left|spent)\b/.test(lower)) return { type: "cap_status" };
  if (/\b(tx|transaction|transactions|history|latest run|runs)\b/.test(lower)) return { type: "latest_tx" };
  if (/^(run|start|execute)\b/.test(lower)) return { type: "run_agent", target: trimmed.replace(/^(run|start|execute)\s*/i, "").trim() || undefined };
  if (/^(pause|stop)\b/.test(lower)) return { type: "pause_agent", target: trimmed.replace(/^(pause|stop)\s*/i, "").trim() || undefined };
  if (/^(resume|continue)\b/.test(lower)) return { type: "resume_agent", target: trimmed.replace(/^(resume|continue)\s*/i, "").trim() || undefined };
  if (/\b(create|make|build|new)\b.*\bagent\b/.test(lower)) return { type: "create_agent", prompt: trimmed };

  return { type: "unknown", text: trimmed };
}
