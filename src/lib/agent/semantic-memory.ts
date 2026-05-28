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
  topK = 5,
): Promise<SemanticInsight[]> {
  const rootAgentId = await findRootAgentId(agentId);

  // Pull a wider candidate pool (last 100) than we'll return
  const candidates = await getInsightCandidates(agentId, walletAddress, rootAgentId, 100);
  if (candidates.length === 0) return [];

  // Compute query embedding once
  const queryEmbedding = await embedText(query);

  // Rank candidates that have embeddings; for the rest, give them low score
  // (the legacy / pre-embedding insights still show up via recency tail)
  const withEmbeddings = candidates.filter(c => c.embedding && c.embedding.length > 0);
  const without       = candidates.filter(c => !c.embedding || c.embedding.length === 0);

  const ranked = rankBySimilarity(withEmbeddings, queryEmbedding, topK);

  // If we have room, top up with most-recent insights that have no embedding
  const remaining = topK - ranked.length;
  if (remaining > 0 && without.length > 0) {
    const tail: SemanticInsight[] = without.slice(0, remaining).map(c => ({ ...c, _similarity: 0 }));
    return [...ranked, ...tail];
  }
  return ranked;
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
