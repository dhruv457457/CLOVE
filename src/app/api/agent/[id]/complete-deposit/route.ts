import { NextRequest, NextResponse } from "next/server";
import { getAgent } from "@/lib/agent/agents";

export const maxDuration = 120;

/**
 * Complete a PENDING deposit — the "forward()" step of the CloveAutoDeposit
 * pattern.
 *
 * The relayer moves USDC into the CloveAutoDeposit contract (step 1, gas in
 * USDC). A normal Base tx then calls forward() to deposit that USDC into the
 * protocol (step 2). If a run times out before step 2 finishes, the USDC sits
 * in the contract. This endpoint completes step 2 on demand — the SERVER signs
 * forward() with the session key (user-initiated, in-app, authorized).
 *
 * POST { protocol? }  → forwards whatever USDC the contract holds into `protocol`.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  let body: { protocol?: string } = {};
  try { body = await req.json(); } catch { /* optional */ }

  // Resolve protocol: explicit → goal → default morpho.
  const goal = (agent.goal ?? "").toLowerCase();
  const protocol =
    body.protocol?.toLowerCase()
    ?? (["morpho", "aave", "lido", "uniswap", "aerodrome"].find(p => goal.includes(p)))
    ?? "morpho";

  try {
    const { getContractUsdcBalance, forwardToProtocol } = await import("@/lib/web3/cloveAutoDeposit");
    const pending = await getContractUsdcBalance();
    if (pending <= 0n) {
      return NextResponse.json({ ok: true, pending: "0", note: "No pending deposit in the contract." });
    }

    const txHash = await forwardToProtocol(agent.walletAddress as `0x${string}`, protocol, pending);
    return NextResponse.json({
      ok: true,
      txHash,
      protocol,
      depositedUsdc: Number(pending) / 1e6,
      basescan: `https://basescan.org/tx/${txHash}`,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
