import "server-only";
import { getVeniceClient } from "@/lib/venice/client";
import { embeddingCache, cacheKey } from "./cache";

/**
 * Venice-powered embeddings for semantic memory retrieval.
 *
 * Uses Venice's OpenAI-compatible /embeddings endpoint with text-embedding-3-small
 * (1536 dimensions). Costs ~$0.02 per 1M tokens.
 *
 * Cached in-memory by text hash — same text produces same vector, so re-embedding
 * is wasted compute. With cache, a typical run goes from 1 embed call → 0.1 calls.
 */

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIM   = 1536;

/** Generate an embedding vector for a single text string. Cached forever. */
export async function embedText(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) return new Array(EMBED_DIM).fill(0);

  const key = cacheKey(trimmed);
  const cached = embeddingCache.get(key);
  if (cached) return cached;

  try {
    const client = getVeniceClient();
    const res = await client.embeddings.create({
      model: EMBED_MODEL,
      input: trimmed.slice(0, 8000),
    });
    const vec = res.data[0]?.embedding ?? new Array(EMBED_DIM).fill(0);
    embeddingCache.set(key, vec);
    return vec;
  } catch (e) {
    console.warn("[embeddings] Venice failed, returning zero vector:", e);
    return new Array(EMBED_DIM).fill(0);
  }
}

/** Embed multiple strings in one batch call (cheaper). */
export async function embedTextBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  try {
    const client = getVeniceClient();
    const res = await client.embeddings.create({
      model: EMBED_MODEL,
      input: texts.map(t => t.slice(0, 8000)),
    });
    return res.data.map(d => d.embedding);
  } catch (e) {
    console.warn("[embeddings] batch failed:", e);
    return texts.map(() => new Array(EMBED_DIM).fill(0));
  }
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Rank candidates by cosine similarity to the query embedding. */
export function rankBySimilarity<T extends { embedding?: number[] }>(
  items: T[],
  queryEmbedding: number[],
  topK = 5,
): Array<T & { _similarity: number }> {
  return items
    .map((item) => ({
      ...item,
      _similarity: item.embedding ? cosineSimilarity(item.embedding, queryEmbedding) : 0,
    }))
    .filter((x) => x._similarity > 0)
    .sort((a, b) => b._similarity - a._similarity)
    .slice(0, topK);
}
