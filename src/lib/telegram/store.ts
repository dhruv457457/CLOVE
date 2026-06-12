import "server-only";
import crypto from "crypto";
import { getDb } from "@/lib/db/mongodb";

const ACCOUNTS = "telegram_accounts";
const TOKENS = "telegram_link_tokens";
const TOKEN_TTL_MS = 10 * 60 * 1000;

export interface TelegramAccount {
  telegramUserId: string;
  chatId: string;
  username?: string;
  firstName?: string;
  walletAddress: string;
  linkedAt: Date;
  lastSeenAt: Date;
  status: "active" | "revoked";
  defaultWorkflowId?: string;
}

interface TelegramLinkToken {
  tokenHash: string;
  walletAddress: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date | null;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createTelegramLinkToken(walletAddress: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await db.collection<TelegramLinkToken>(TOKENS).insertOne({
    tokenHash: hashToken(token),
    walletAddress: walletAddress.toLowerCase(),
    createdAt: new Date(),
    expiresAt,
    usedAt: null,
  });

  return { token, expiresAt };
}

export async function consumeTelegramLinkToken(token: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const tokenHash = hashToken(token);
  const doc = await db.collection<TelegramLinkToken>(TOKENS).findOne({
    tokenHash,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!doc) return null;

  await db.collection<TelegramLinkToken>(TOKENS).updateOne(
    { tokenHash },
    { $set: { usedAt: new Date() } },
  );

  return doc.walletAddress;
}

export async function linkTelegramAccount(input: {
  telegramUserId: string;
  chatId: string;
  walletAddress: string;
  username?: string;
  firstName?: string;
}): Promise<TelegramAccount | null> {
  const db = await getDb();
  if (!db) return null;

  const account: TelegramAccount = {
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    username: input.username,
    firstName: input.firstName,
    walletAddress: input.walletAddress.toLowerCase(),
    linkedAt: new Date(),
    lastSeenAt: new Date(),
    status: "active",
  };

  await db.collection<TelegramAccount>(ACCOUNTS).updateOne(
    { telegramUserId: input.telegramUserId },
    { $set: account },
    { upsert: true },
  );

  return account;
}

export async function getTelegramAccountByChatId(chatId: string): Promise<TelegramAccount | null> {
  const db = await getDb();
  if (!db) return null;
  const account = await db.collection<TelegramAccount>(ACCOUNTS).findOne({ chatId, status: "active" });
  if (account) {
    await db.collection<TelegramAccount>(ACCOUNTS).updateOne(
      { telegramUserId: account.telegramUserId },
      { $set: { lastSeenAt: new Date() } },
    );
  }
  return account;
}

export async function getTelegramAccountForWallet(walletAddress: string): Promise<TelegramAccount | null> {
  const db = await getDb();
  if (!db) return null;
  return db.collection<TelegramAccount>(ACCOUNTS).findOne({
    walletAddress: walletAddress.toLowerCase(),
    status: "active",
  });
}

export async function unlinkTelegramWallet(walletAddress: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.collection<TelegramAccount>(ACCOUNTS).updateMany(
    { walletAddress: walletAddress.toLowerCase() },
    { $set: { status: "revoked", lastSeenAt: new Date() } },
  );
}

export function shortWallet(walletAddress: string): string {
  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}
