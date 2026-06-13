import "server-only";
import { getDb } from "@/lib/db/mongodb";

/**
 * Wallet-scoped conversational memory, shared between the web chat panel and the
 * Telegram bot (same wallet → same threads). MULTIPLE threads per wallet — each
 * "New workflow / New chat" starts a fresh thread, and prior threads are kept so
 * the user can reopen them (ChatGPT-style history).
 *
 * Mongo collection: `chat_threads`, one doc per (walletAddress, threadId).
 * Like the rest of the memory layer, all writes are fire-and-forget and degrade
 * to a no-op when MONGODB_URI is unset.
 */
export interface ChatMessage {
  role:     "user" | "assistant";
  content:  string;
  ts:       string;            // ISO timestamp
  source?:  "web" | "telegram";
}

interface ChatThreadDoc {
  walletAddress: string;       // lowercased
  threadId:      string;
  title:         string;       // first user message, trimmed — the list label
  messages:      ChatMessage[];
  createdAt:     string;
  updatedAt:     string;
}

/** Lightweight thread summary for the "previous chats" list. */
export interface ThreadSummary {
  threadId:  string;
  title:     string;
  updatedAt: string;
  count:     number;
}

const COLLECTION = "chat_threads";
const MAX_STORED = 50;         // cap messages per thread

function key(wallet: string): string {
  return wallet.trim().toLowerCase();
}

/** Messages for one thread (oldest → newest). Empty if none / no DB. */
export async function getThread(wallet: string, threadId: string): Promise<ChatMessage[]> {
  const db = await getDb();
  if (!db || !wallet || !threadId) return [];
  try {
    const doc = await db.collection<ChatThreadDoc>(COLLECTION).findOne({ walletAddress: key(wallet), threadId });
    return doc?.messages ?? [];
  } catch {
    return [];
  }
}

/** All of a wallet's threads, newest first — for the history list. */
export async function listThreads(wallet: string): Promise<ThreadSummary[]> {
  const db = await getDb();
  if (!db || !wallet) return [];
  try {
    const docs = await db.collection<ChatThreadDoc>(COLLECTION)
      .find({ walletAddress: key(wallet) }, { projection: { messages: 0 } })
      .sort({ updatedAt: -1 })
      .limit(40)
      .toArray();
    // messages excluded from projection, so derive count from a second cheap field
    return docs.map(d => ({
      threadId:  d.threadId,
      title:     d.title || "New chat",
      updatedAt: d.updatedAt,
      count:     0,
    }));
  } catch {
    return [];
  }
}

/** Append turns to a thread, creating it (with a title) on first write. */
export async function appendMessages(wallet: string, threadId: string, msgs: ChatMessage[]): Promise<void> {
  const db = await getDb();
  if (!db || !wallet || !threadId || msgs.length === 0) return;
  try {
    const now   = new Date().toISOString();
    // Title = first user message of the thread (trimmed). Only set on insert.
    const firstUser = msgs.find(m => m.role === "user")?.content ?? "New chat";
    const title = firstUser.slice(0, 80);
    await db.collection<ChatThreadDoc>(COLLECTION).updateOne(
      { walletAddress: key(wallet), threadId },
      {
        $push: { messages: { $each: msgs, $slice: -MAX_STORED } },
        $set:  { updatedAt: now },
        // walletAddress + threadId come from the equality filter on upsert;
        // adding them to $setOnInsert would conflict, so only seed the extras.
        $setOnInsert: { title, createdAt: now },
      },
      { upsert: true },
    );
  } catch {
    /* non-fatal — chat persistence is best-effort */
  }
}
