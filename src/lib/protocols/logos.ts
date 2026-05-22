/**
 * Protocol logo URLs — all official CDN/favicon sources, no API key needed.
 * Using `onError` fallback on <img> elements in case a URL changes.
 */
export const PROTOCOL_LOGOS: Record<string, string> = {
  // DeFi protocols
  morpho:    "https://cdn.morpho.org/assets/logos/morpho.svg",
  uniswap:   "https://app.uniswap.org/favicon.png",
  aerodrome: "https://aerodrome.finance/favicon.ico",
  lido:      "https://stake.lido.fi/favicon.ico",
  sky:       "https://app.sky.money/favicon.ico",
  aave:      "https://app.aave.com/favicon.ico",
  // Intelligence
  venice:    "https://venice.ai/favicon.ico",
  tavily:    "https://tavily.com/favicon.ico",
  exa:       "https://exa.ai/favicon.ico",
  fal:       "https://fal.ai/favicon.ico",
  // Notifications
  telegram:  "https://telegram.org/favicon.ico",
  discord:   "https://discord.com/favicon.ico",
  // System
  "1shot":   "https://1shotapi.com/favicon.ico",
};

export function getProtocolLogo(protocol: string): string | undefined {
  return PROTOCOL_LOGOS[protocol.toLowerCase()];
}
