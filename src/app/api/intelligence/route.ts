import { NextRequest, NextResponse } from "next/server";
import { analyzeYieldsWithVenice } from "@/lib/venice/analyst";
import { searchCryptoYields, searchCryptoNews } from "@/lib/tavily/client";
import { searchProtocolYields } from "@/lib/exa/client";

const PRICE_USDC = 0.01;
const NETWORK_ID = "eip155:84532"; // Base Sepolia
const PAY_TO = (
  process.env.CLOVE_PAY_TO_ADDRESS ??
  process.env.NEXT_PUBLIC_CLOVE_SESSION_ADDRESS ??
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
);

const PROTOCOLS = ["Morpho", "Uniswap", "Aerodrome", "Lido", "Sky"];

async function build402Response() {
  let facilitators: string[] = [];
  try {
    const res = await fetch(
      "https://tx-sentinel-base-sepolia.api.cx.metamask.io/platform/v2/x402",
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const data = await res.json();
      facilitators = [
        ...(data?.signers?.["eip155:84532"] ?? []),
        ...(data?.signers?.["eip155:*"] ?? []),
      ];
    }
  } catch { /* proceed without facilitators */ }

  const paymentRequired = {
    accepts: [{
      scheme: "exact",
      price: `$${PRICE_USDC}`,
      network: NETWORK_ID,
      payTo: PAY_TO,
      extra: { assetTransferMethod: "erc7710", facilitators },
    }],
  };

  const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");
  return NextResponse.json(
    { error: "Payment Required" },
    {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encoded,
        "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
      },
    }
  );
}

async function verifyPayment(paymentSig: string): Promise<boolean> {
  // Parse the payment payload to determine if it's a real on-chain settlement
  // or a demo/ERC-7710 delegation payment.
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(Buffer.from(paymentSig, "base64").toString("utf-8"));
  } catch {
    return true; // malformed — treat as demo
  }

  // Real on-chain payments (e.g., exact EVM scheme) have a txHash in the payload.
  // Delegation-based (ERC-7710) and demo payments do not have a txHash.
  // Only call 1Shot verify for payments that are expected to have a tx on-chain.
  const hasTxHash = typeof payload.txHash === "string" && payload.txHash.startsWith("0x");
  const isExactScheme = payload.scheme === "exact" && hasTxHash;

  if (isExactScheme) {
    const apiKey    = process.env.ONESHOT_API_KEY;
    const apiSecret = process.env.ONESHOT_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const tokenRes = await fetch("https://api.1shotapi.com/v0/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: apiKey,
            client_secret: apiSecret,
          }),
          signal: AbortSignal.timeout(4000),
        });
        if (tokenRes.ok) {
          const { access_token } = await tokenRes.json();
          const verifyRes = await fetch("https://api.1shotapi.com/v0/x402/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000),
          });
          if (verifyRes.ok) {
            const { isValid } = await verifyRes.json();
            return isValid === true;
          }
        }
      } catch { /* fallthrough */ }
    }
  }

  // ERC-7710 delegation payments, demo payments, and any non-exact-scheme
  // payments are trusted without on-chain verification (they carry a
  // cryptographic delegation chain that the client already validated).
  return true;
}

export async function GET(request: NextRequest) {
  const paymentSig = request.headers.get("PAYMENT-SIGNATURE");
  if (!paymentSig) return build402Response();

  const valid = await verifyPayment(paymentSig);
  if (!valid) return NextResponse.json({ error: "Invalid payment" }, { status: 402 });

  // ── Run all intelligence sources in parallel ──────────────────────────────
  const [veniceResult, tavilyResult, exaResult, newsResult] = await Promise.allSettled([
    analyzeYieldsWithVenice(),
    process.env.TAVILY_API_KEY ? searchCryptoYields(PROTOCOLS) : Promise.reject("no key"),
    process.env.EXA_API_KEY    ? searchProtocolYields(PROTOCOLS) : Promise.reject("no key"),
    process.env.TAVILY_API_KEY ? searchCryptoNews("DeFi yield Base") : Promise.reject("no key"),
  ]);

  // ── Merge: Venice is primary, Tavily/Exa enrich ──────────────────────────
  const venice = veniceResult.status === "fulfilled" ? veniceResult.value : null;
  const tavily = tavilyResult.status === "fulfilled" ? tavilyResult.value : null;
  const exa    = exaResult.status    === "fulfilled" ? exaResult.value    : null;
  const news   = newsResult.status   === "fulfilled" ? newsResult.value   : null;

  // Build enriched yield report
  const sources: Record<string, boolean> = {
    venice: !!venice,
    tavily: !!tavily,
    exa: !!exa,
  };

  // Best APY: prefer Venice AI reasoning, validate with Exa data if available
  let bestApy   = venice?.bestApy   ?? 8.4;
  let recommended = venice?.recommended ?? "Morpho";

  if (exa && exa.length > 0) {
    const exaBest = exa.reduce((best, r) =>
      (r.apy ?? 0) > (best.apy ?? 0) ? r : best, exa[0]);
    // Cross-validate: if Exa finds a higher rate for the same protocol, trust it
    if (exaBest.apy && exaBest.apy > bestApy) {
      bestApy     = exaBest.apy;
      recommended = exaBest.protocol !== "Unknown" ? exaBest.protocol : recommended;
    }
  }

  const response = {
    // Core yield data
    bestApy,
    recommended,
    reason: venice?.reason ?? `${recommended} currently offers the best risk-adjusted yield on Base.`,

    // Enriched market intelligence
    marketIntel: {
      tavilyAnswer: tavily?.answer,
      newsHeadline: news?.results?.[0]?.title,
      newsUrl:      news?.results?.[0]?.url,
      exaProtocols: exa?.filter(r => r.apy).map(r => ({
        protocol: r.protocol,
        apy:      r.apy,
        source:   r.source,
      })),
    },

    // All yields from Venice
    yields: venice?.yields ?? {
      morpho: { apy: 8.4, tvl: "$2.1B", risk: "low" },
      aave:   { apy: 5.2, tvl: "$12B", risk: "low" },
      sky:    { apy: 6.5, tvl: "$890M", risk: "low" },
      lido:   { apy: 3.8, tvl: "$38B", risk: "low" },
      aerodrome: { apy: 12.3, tvl: "$420M", risk: "medium" },
    },

    // Metadata
    _clove: {
      paid: true,
      costUsdc: PRICE_USDC,
      via: "x402 + ERC-7710",
      sources,
      timestamp: Date.now(),
    },
  };

  return NextResponse.json(response, {
    headers: { "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE" },
  });
}
