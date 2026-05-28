import "server-only";

/**
 * In-memory LRU cache for expensive AI calls.
 *
 * Two layers:
 *   1. Intelligence cache — same {bestApy, recommended, news} result for ~5min
 *      (DeFi yields change slowly; no need to re-pay Tavily/Venice every run)
 *   2. Embedding cache — text → vector, never expires (text doesn't change)
 *
 * Process-local — resets on server restart. Good enough for hackathon scale.
 * For production: swap to Redis/Upstash.
 */

interface CacheEntry<T> {
  value:     T;
  expiresAt: number; // 0 = never expires
}

class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private maxSize: number;

  constructor(maxSize = 500) { this.maxSize = maxSize; }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > 0 && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // LRU touch — re-insert to bump
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs = 0): void {
    if (this.store.size >= this.maxSize) {
      // Evict oldest (first key in iteration order)
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(key, {
      value,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0,
    });
  }

  clear(): void { this.store.clear(); }
  size(): number { return this.store.size; }
}

// Intelligence results — TTL 5 minutes (APYs don't change faster than that)
export const intelligenceCache = new TTLCache<unknown>(100);
export const INTELLIGENCE_TTL_MS = 5 * 60 * 1000;

// Embeddings — never expire (the same text always produces the same vector)
export const embeddingCache = new TTLCache<number[]>(2000);

/** Hash a string to a 32-char cache key. */
export function cacheKey(s: string): string {
  let h1 = 0xdeadbeef ^ 0xfade, h2 = 0x41c6ce57 ^ 0xfade;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
