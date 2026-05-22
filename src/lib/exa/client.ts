import "server-only";
import Exa from "exa-js";

export function getExaClient(): Exa {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error("EXA_API_KEY not set");
  return new Exa(apiKey);
}

export interface ExaProtocolResult {
  protocol: string;
  apy?: number;
  tvl?: string;
  source: string;
  summary: string;
}

/** Semantic search for protocol yield data across DeFi research sites. */
export async function searchProtocolYields(protocols: string[]): Promise<ExaProtocolResult[]> {
  const exa = getExaClient();

  const query = `${protocols.join(" OR ")} DeFi yield APY TVL current rates Base Ethereum`;

  const response = await exa.searchAndContents(query, {
    numResults: 5,
    type: "neural",
    includeDomains: ["defillama.com", "morpho.org", "docs.aave.com", "info.uniswap.org"],
    useAutoprompt: true,
    text: { maxCharacters: 500 },
  });

  return response.results.map(r => {
    // Try to extract APY from content
    const apyMatch = r.text?.match(/(\d+\.?\d*)\s*%\s*(APY|apy|apr|APR)/i);
    const tvlMatch = r.text?.match(/TVL[:\s]+\$?([\d,.]+[MBK]?)/i);

    return {
      protocol: protocols.find(p => r.title?.toLowerCase().includes(p.toLowerCase())) ?? "Unknown",
      apy: apyMatch ? parseFloat(apyMatch[1]) : undefined,
      tvl: tvlMatch?.[1],
      source: r.url,
      summary: (r.text ?? "").slice(0, 300),
    };
  });
}
