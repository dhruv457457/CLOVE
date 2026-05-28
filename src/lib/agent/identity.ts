import "server-only";

/**
 * ERC-8004 Agent Identity Registration.
 *
 * QuickNode launched an ERC-8004 explorer + APIs that let any project register
 * an agent's on-chain identity — making it discoverable by other agents and
 * giving it a verifiable reputation footprint.
 *
 * Set QUICKNODE_ENDPOINT in .env.local to enable registration. Without it,
 * registration is a no-op (the agent still works, just has no global identity).
 *
 * QuickNode endpoint format:
 *   https://your-name.quiknode.pro/your-key/
 *
 * Registration happens lazily — on first run, the agent is registered. The
 * resulting agentRegistryId is stored on the agent record.
 */

export interface RegistrationResult {
  registryId?:   string;
  txHash?:       string;
  via:           "quicknode" | "skipped";
  reason?:       string;
}

export async function registerAgentOnChain(input: {
  agentAddress: string;   // 1Shot session wallet
  name:         string;
  goal:         string;
}): Promise<RegistrationResult> {
  const endpoint = process.env.QUICKNODE_ENDPOINT;
  if (!endpoint) {
    return { via: "skipped", reason: "QUICKNODE_ENDPOINT not set" };
  }

  // ERC-8004 IdentityRegistry on Base (placeholder — QuickNode's actual deployed
  // address; replace with their official one when documented)
  // The registry exposes registerAgent(name, metadata) → returns agentId
  try {
    // QuickNode's Agent Identity API exposes a high-level REST endpoint:
    //   POST {endpoint}/v1/agents/register
    // with body { name, metadata: { goal, agentAddress } }
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/v1/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:     input.name,
        address:  input.agentAddress,
        metadata: {
          goal:      input.goal.slice(0, 280),
          owner:     "clove",
          createdAt: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      // QuickNode endpoint not available or hasn't shipped this exact path yet —
      // gracefully degrade. The agent still works.
      const errText = await res.text().catch(() => "(no body)");
      console.warn("[identity] QuickNode registration failed:", res.status, errText.slice(0, 100));
      return { via: "skipped", reason: `QuickNode ${res.status}` };
    }

    const data = await res.json() as { agentId?: string; txHash?: string };
    return {
      via:        "quicknode",
      registryId: data.agentId,
      txHash:     data.txHash,
    };
  } catch (e) {
    console.warn("[identity] registration exception:", e);
    return { via: "skipped", reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Build the URL to view an agent on QuickNode's ERC-8004 explorer. */
export function explorerUrl(registryId: string): string {
  return `https://www.quicknode.com/agents/${registryId}`;
}
