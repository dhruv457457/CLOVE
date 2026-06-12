import "server-only";
import { getAgent } from "@/lib/agent/agents";
import { getTelegramAccountForWallet } from "@/lib/telegram/store";

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  }).catch(() => null);

  return !!res?.ok;
}

export async function sendTelegramPhoto(chatId: string, photoUrl: string, caption?: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "Markdown",
    }),
  }).catch(() => null);

  return !!res?.ok;
}

export async function resolveTelegramChat(input: {
  chatId?: string;
  walletAddress?: string;
  agentId?: string;
}): Promise<string | null> {
  if (input.chatId) return input.chatId;

  let wallet = input.walletAddress;
  if (!wallet && input.agentId) {
    const agent = await getAgent(input.agentId);
    wallet = agent?.walletAddress;
  }
  if (wallet) {
    const account = await getTelegramAccountForWallet(wallet);
    if (account?.chatId) return account.chatId;
  }

  return process.env.TELEGRAM_CHAT_ID ?? null;
}

export function escapeTelegramMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, (m) => `\\${m}`);
}

export function formatRelativeTime(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${days}d ago`;
}
