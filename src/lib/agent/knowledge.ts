import "server-only";
import { getDb } from "@/lib/db/mongodb";
import { embedText, embedTextBatch, rankBySimilarity } from "@/lib/agent/embeddings";

/**
 * Per-agent KNOWLEDGE BASE (RAG) — "give your agent your playbook".
 *
 * Users upload their own rules / strategy / watchlists. We chunk + embed the
 * text and store it scoped to the agent. Before every decision the planner
 * retrieves the most relevant chunks (cosine similarity over Venice embeddings)
 * and injects them into the reasoning prompt, so the agent follows the user's
 * own instructions — not just generic logic.
 *
 * Reuses the existing embeddings engine (embeddings.ts).
 */

const COLL = "agent_knowledge";

export interface KnowledgeChunk {
  agentId:       string;
  walletAddress: string;
  text:          string;
  embedding?:    number[];
  createdAt:     Date;
}

/** Split free text into ~500-char chunks on paragraph/sentence boundaries. */
export function chunkText(raw: string, maxLen = 500): string[] {
  const clean = raw.replace(/\r/g, "").trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/).flatMap(p => p.trim() ? [p.trim()] : []);
  const chunks: string[] = [];
  for (const p of paras) {
    if (p.length <= maxLen) { chunks.push(p); continue; }
    // Long paragraph → split on sentence ends, packing up to maxLen.
    const sentences = p.split(/(?<=[.!?])\s+/);
    let buf = "";
    for (const s of sentences) {
      if ((buf + " " + s).trim().length > maxLen) {
        if (buf) chunks.push(buf.trim());
        buf = s;
      } else { buf = (buf + " " + s).trim(); }
    }
    if (buf) chunks.push(buf.trim());
  }
  return chunks.filter(c => c.length > 0).slice(0, 200); // hard cap
}

/** Store knowledge for an agent (chunks + embeds). Returns chunk count. */
export async function saveKnowledge(agentId: string, walletAddress: string, raw: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const chunks = chunkText(raw);
  if (chunks.length === 0) return 0;
  const embeddings = await embedTextBatch(chunks);
  const docs: KnowledgeChunk[] = chunks.map((text, i) => ({
    agentId, walletAddress, text,
    embedding: embeddings[i],
    createdAt: new Date(),
  }));
  await db.collection<KnowledgeChunk>(COLL).insertMany(docs);
  return docs.length;
}

/** List an agent's stored knowledge chunks (newest first). */
export async function listKnowledge(agentId: string): Promise<{ text: string; createdAt: Date }[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.collection<KnowledgeChunk>(COLL)
    .find({ agentId }, { projection: { embedding: 0 } })
    .sort({ createdAt: -1 }).limit(100).toArray();
  return rows.map(r => ({ text: r.text, createdAt: r.createdAt }));
}

/** Clear all knowledge for an agent. */
export async function clearKnowledge(agentId: string): Promise<void> {
  const db = await getDb();
  if (db) await db.collection(COLL).deleteMany({ agentId });
}

/** Retrieve the top-K knowledge chunks most relevant to a query. */
export async function getRelevantKnowledge(
  agentId: string,
  query: string,
  topK = 5,
): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const candidates = await db.collection<KnowledgeChunk>(COLL)
    .find({ agentId }).limit(300).toArray();
  if (candidates.length === 0) return [];
  const q = await embedText(query);
  const ranked = rankBySimilarity(candidates.filter(c => c.embedding?.length), q, topK);
  return ranked.map(r => r.text);
}

/** Format retrieved knowledge for injection into the planner prompt. */
export function formatKnowledgeForPrompt(chunks: string[]): string {
  if (chunks.length === 0) return "";
  return `\n\nUSER'S PLAYBOOK (follow these rules — they override generic logic):\n` +
    chunks.map((c, i) => `${i + 1}. ${c}`).join("\n");
}
