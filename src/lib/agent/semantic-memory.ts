import "server-only";
import { embedText, rankBySimilarity } from "@/lib/agent/embeddings";
import { getInsightCandidates, type AgentInsight } from "@/lib/agent/memory";
import { getAgent } from "@/lib/agent/agents";

/**
 * Semantic memory retrieval — the brain stem of cross-agent learning.
 *
 * Given an agent's goal/query, walks the delegation chain to find the root
 * agent, then pulls all insights visible to this agent (own + team + wallet),
 * ranks them by cosine similarity to the query embedding, and returns the
 * top-K most relevant.
 *
 * This is what lets Scout's observation "Morpho APY is volatile this week"
 * surface in Executor's plan even though Executor never wrote that insight.
 */

/** Walk parentAgentId chain to find the root agent id (the one with parentAgentId === null). */
async function findRootAgentId(agentId: string): Promise<string | undefined> {
  let current = await getAgent(agentId);
  const visited = new Set<string>();
  while (current && current.parentAgentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = await getAgent(current.parentAgentId);
    if (!parent) break;
    current = parent;
  }
  return current?.id;
}

export interface SemanticInsight extends AgentInsight {
  _similarity: number;
}

/**
 * Get the top-K semantically relevant insights for an agent's current query.
 * Falls back to recency ordering if embeddings are missing.
 */
export async function getRelevantInsights(
  agentId: string,
  walletAddress: string,
  query: string,
  topK = 6,
): Promise<SemanticInsight[]> {
  const rootAgentId = await findRootAgentId(agentId);

  // Pull a wider candidate pool for multi-agent chains
  const candidates = await getInsightCandidates(agentId, walletAddress, rootAgentId, 150);
  if (candidates.length === 0) return [];

  // Always include the freshest team-data broadcast from the current cycle
  // (tagged "team-data" by the A2A-1 broadcaster in run-stream).
  // These are pinned to the top regardless of similarity score because
  // they contain the upstream agent's actual yield/risk findings.
  const now = Date.now();
  const freshTeamData = candidates
    .filter(c => {
      if (!c.tags?.includes("team-data")) return false;
      // Only "fresh" if it arrived in the last 10 minutes (one cron cycle)
      const age = now - new Date(c.createdAt).getTime();
      return age < 10 * 60 * 1000;
    })
    .slice(0, 2)  // pin at most 2 fresh team data messages
    .map(c => ({ ...c, _similarity: 1.0 } as SemanticInsight));  // max relevance

  const pinned = new Set(freshTeamData.map(c => c.agentId + c.runId + c.text.slice(0, 20)));
  const rest = candidates.filter(c => !pinned.has(c.agentId + c.runId + c.text.slice(0, 20)));

  // Compute query embedding once
  const queryEmbedding = await embedText(query);

  const withEmbeddings = rest.filter(c => c.embedding && c.embedding.length > 0);
  const without        = rest.filter(c => !c.embedding || c.embedding.length === 0);

  const remainingSlots = Math.max(0, topK - freshTeamData.length);
  const ranked = rankBySimilarity(withEmbeddings, queryEmbedding, remainingSlots);

  // Top up with recency-ordered no-embedding insights if slots remain
  const tail: SemanticInsight[] = without
    .slice(0, Math.max(0, remainingSlots - ranked.length))
    .map(c => ({ ...c, _similarity: 0 }));

  return [...freshTeamData, ...ranked, ...tail];
}

/** Format insights for injection into an LLM prompt. */
export function formatInsightsForPrompt(insights: SemanticInsight[]): string {
  if (insights.length === 0) return "(no relevant past insights)";
  return insights.map((i, idx) => {
    const scope = i.scope === "team"   ? "[TEAM]"
               : i.scope === "wallet" ? "[WALLET]"
               :                         "[OWN]";
    const sim = i.embedding ? ` (${(i._similarity * 100).toFixed(0)}% relevant)` : "";
    return `${idx + 1}. ${scope} ${i.text}${sim}`;
  }).join("\n");
}
