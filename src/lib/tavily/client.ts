import "server-only";
import { tavily } from "@tavily/core";

export function getTavilyClient() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");
  return tavily({ apiKey });
}

export interface TavilyYieldResult {
  query: string;
  results: Array<{ title: string; url: string; content: string; score: number }>;
  answer?: string;
}

/** Search for current DeFi yield rates and crypto market intelligence. */
export async function searchCryptoYields(protocols: string[] = ["Morpho", "Aave", "Uniswap", "Aerodrome", "Lido"]): Promise<TavilyYieldResult> {
  const client = getTavilyClient();
  const query = `current DeFi yield rates APY ${protocols.join(" ")} Base mainnet 2025`;

  const response = await client.search(query, {
    searchDepth: "advanced",
    maxResults: 6,
    includeAnswer: true,
    includeDomains: ["defillama.com", "morpho.org", "aave.com", "coindesk.com", "theblock.co", "decrypt.co"],
  });

  return {
    query,
    results: response.results.map(r => ({
      title: r.title,
      url: r.url,
      content: r.content.slice(0, 400),
      score: r.score,
    })),
    answer: response.answer ?? undefined,
  };
}

/** Search for breaking crypto news relevant to a strategy. */
export async function searchCryptoNews(topic: string): Promise<TavilyYieldResult> {
  const client = getTavilyClient();
  const query = `${topic} DeFi news today crypto market`;

  const response = await client.search(query, {
    searchDepth: "basic",
    maxResults: 4,
    includeAnswer: true,
    topic: "news",
  });

  return {
    query,
    results: response.results.map(r => ({
      title: r.title,
      url: r.url,
      content: r.content.slice(0, 300),
      score: r.score,
    })),
    answer: response.answer ?? undefined,
  };
}
