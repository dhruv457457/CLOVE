import { NextRequest, NextResponse } from "next/server";
import { fetchLiveYields } from "@/lib/defi/llamaYields";

/**
 * GET /api/yields/live?chain=Base&minTvl=1000000&limit=15&asset=USDC
 *
 * Thin wrapper over the shared DeFiLlama fetcher (src/lib/defi/llamaYields.ts).
 * REAL, live yield data — not CLOVE's own /api/intelligence proxy.
 */
export type { LiveYield } from "@/lib/defi/llamaYields";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const result = await fetchLiveYields({
    chain:      sp.get("chain")  ?? "Base",
    minTvl:     Number(sp.get("minTvl") ?? "500000"),
    limit:      Number(sp.get("limit")  ?? "15"),
    asset:      sp.get("asset") ?? "",
    stableOnly: sp.get("stableOnly") === "true",
  });
  return NextResponse.json(result);
}
