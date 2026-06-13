import "server-only";
import { getDb } from "@/lib/db/mongodb";

/**
 * Wallet-scoped conversational memory, shared between the web chat panel and the
 * Telegram bot (same wallet → same thread). One thread per wallet (the plan's
 * recommended persistence scope).
 *
 * Mongo collection: `chat_threads`. Like the rest of the memory layer, all writes
 * are fire-and-forget and degrade to a no-op when MONGODB_URI is unset.
 */
export interface ChatMessage {
  role:     "user" | "assistant";
  content:  string;
  ts:       string;            // ISO timestamp
  source?:  "web" | "telegram";
}

interface ChatThreadDoc {
  walletAddress: string;       // lowercased — the thread key
  messages:      ChatMessage[];
  updatedAt:     string;
}

const COLLECTION = "chat_threads";
/** Cap stored history so a thread can't grow unbounded. */
const MAX_STORED = 50;

function key(wallet: string): string {
  return wallet.trim().toLowerCase();
}

/** Load a wallet's thread (oldest → newest). Empty array if none / no DB. */
export async function getThread(wallet: string): Promise<ChatMessage[]> {
  const db = await getDb();
  if (!db || !wallet) return [];
  try {
    const doc = await db.collection<ChatThreadDoc>(COLLECTION).findOne({ walletAddress: key(wallet) });
    return doc?.messages ?? [];
  } catch {
    return [];
  }
}

/** Append one or more turns to a wallet's thread, keeping only the last MAX_STORED. */
export async function appendMessages(wallet: string, msgs: ChatMessage[]): Promise<void> {
  const db = await getDb();
  if (!db || !wallet || msgs.length === 0) return;
  try {
    await db.collection<ChatThreadDoc>(COLLECTION).updateOne(
      { walletAddress: key(wallet) },
      {
        // $slice keeps the tail (most recent MAX_STORED) after each push.
        $push: { messages: { $each: msgs, $slice: -MAX_STORED } },
        $set:  { updatedAt: new Date().toISOString() },
        // NOTE: walletAddress is set automatically from the equality filter on
        // upsert — adding it to $setOnInsert would conflict, so we don't.
      },
      { upsert: true },
    );
  } catch {
    /* non-fatal — chat persistence is best-effort */
  }
}
