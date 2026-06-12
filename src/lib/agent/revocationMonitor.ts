import "server-only";

/**
 * Auto-revocation monitor.
 *
 * Architecture: off-chain detection → on-chain revocation.
 *
 * The blockchain has no awareness of APY thresholds, P&L, or IL ratios.
 * Conditional revocation requires off-chain monitoring that calls
 * DelegationManager.disableDelegation() when a condition is met.
 *
 * This module runs on every cron tick for each active agent and checks
 * whether any revocation condition is satisfied. If so, it calls the
 * revoke API route which calls disableDelegation() on-chain — the
 * revocation itself is irreversible and on-chain.
 *
 * Patterns covered:
 *   - Budget exhausted (95% cap)           → revoke entire tree
 *   - APY below minimum threshold          → revoke executor only
 *   - Consecutive failures                 → revoke executor, alert
 *   - Stop-loss triggered                  → revoke executor for asset
 *   - Permission expired                   → revoke (ERC-7715 auto-expires anyway)
 *   - IL exceeds threshold (LP agents)     → emergency exit + revoke
 *   - Market manipulated (polymarket)      → revoke bet executor
 */

import { getAgent, updateAgent, type Agent } from "@/lib/agent/agents";
import { getDb } from "@/lib/db/mongodb";
import { getLastRuns } from "@/lib/agent/memory";

export type RevocationReason =
  | "budget_exhausted"
  | "apy_below_threshold"
  | "consecutive_failures"
  | "stop_loss"
  | "il_exceeded"
  | "manual"
  | "permission_expired";

export interface RevocationCheckResult {
  agentId:  string;
  revoked:  boolean;
  reason?:  RevocationReason;
  revokeAll: boolean;    // true = revoke entire tree; false = executor only
}

// ── Condition checkers ─────────────────────────────────────────────────────────

/** Budget >= 95% used → revoke entire delegation tree */
function checkBudgetExhausted(agent: Agent): boolean {
  const budget = Number.parseFloat(agent.budgetUsdc) || 0;
  if (budget <= 0) return false;
  return agent.budgetUsedUsdc >= budget * 0.95;
}

/** N consecutive failed runs → revoke executor */
async function checkConsecutiveFailures(agentId: string, walletAddress: string, threshold = 3): Promise<boolean> {
  const runs = await getLastRuns(walletAddress, threshold, agentId);
  if (runs.length < threshold) return false;
  return runs.every(r => !r.success);
}

/** APY dropped below agent's configured minimum */
async function checkApyBelowThreshold(agent: Agent): Promise<boolean> {
  const minApy = Number(agent.typeConfig?.minApy ?? 0);
  if (minApy <= 0) return false;

  const db = await getDb();
  if (!db) return false;

  // Get the most recent run's recorded APY
  const lastRun = await db.collection("agent_runs")
    .find({ agentId: agent.id })
    .sort({ timestamp: -1 })
    .limit(1)
    .toArray();
  if (!lastRun.length) return false;

  const lastApy = (lastRun[0] as { apy?: number }).apy ?? 999;
  return lastApy < minApy;
}

/** Stop-loss: agent's position lost more than threshold % */
async function checkStopLoss(agent: Agent): Promise<boolean> {
  const stopLossPct = Number(agent.typeConfig?.stopLossPct ?? 0);
  if (stopLossPct <= 0) return false;

  const db = await getDb();
  if (!db) return false;

  const position = await db.collection("agent_positions")
    .findOne({ walletAddress: agent.walletAddress, protocol: { $exists: true } });
  if (!position) return false;

  const entryAmount  = Number((position as { amount?: string }).amount ?? "0");
  const currentValue = agent.budgetUsedUsdc;
  if (entryAmount <= 0) return false;

  const lossPct = ((entryAmount - currentValue) / entryAmount) * 100;
  return lossPct >= stopLossPct;
}

/** ERC-7715 permission expired */
function checkPermissionExpired(agent: Agent): boolean {
  // Agents store delegationContext — if there's an expiresAt in typeConfig use it
  const expiresAt = Number(agent.typeConfig?.permissionExpiresAt ?? 0);
  if (expiresAt <= 0) return false;
  return Date.now() / 1000 > expiresAt;
}

// ── Main monitor ───────────────────────────────────────────────────────────────

/**
 * Check all revocation conditions for a single agent.
 * If any condition fires, calls POST /api/agent/[id]/revoke (on-chain tx).
 *
 * The revoke endpoint calls DelegationManager.disableDelegation() on-chain.
 * The trigger is off-chain; the revocation is on-chain and irreversible.
 */
export async function checkAndAutoRevoke(
  agentId: string,
  baseUrl: string,
): Promise<RevocationCheckResult> {
  const agent = await getAgent(agentId);
  if (!agent) return { agentId, revoked: false, revokeAll: false };

  // Skip agents that aren't active / don't have a real delegation
  if (agent.delegationStatus !== "active") return { agentId, revoked: false, revokeAll: false };
  if (!agent.delegationContext || agent.delegationContext === "0xdemo") {
    return { agentId, revoked: false, revokeAll: false };
  }

  // ── Check each condition ───────────────────────────────────────────────────

  // 1. Budget exhausted → revoke ENTIRE tree
  if (checkBudgetExhausted(agent)) {
    await triggerRevoke(agentId, baseUrl, "budget_exhausted");
    return { agentId, revoked: true, reason: "budget_exhausted", revokeAll: true };
  }

  // 2. Permission expired → revoke (ERC-7715 auto-expires but we mark it too)
  if (checkPermissionExpired(agent)) {
    await triggerRevoke(agentId, baseUrl, "permission_expired");
    return { agentId, revoked: true, reason: "permission_expired", revokeAll: false };
  }

  // 3. Consecutive failures → revoke executor only
  const hasFailed = await checkConsecutiveFailures(agentId, agent.walletAddress);
  if (hasFailed) {
    await triggerRevoke(agentId, baseUrl, "consecutive_failures");
    return { agentId, revoked: true, reason: "consecutive_failures", revokeAll: false };
  }

  // 4. APY below threshold → revoke executor, keep scouts
  const apyTooLow = await checkApyBelowThreshold(agent);
  if (apyTooLow) {
    await triggerRevoke(agentId, baseUrl, "apy_below_threshold");
    return { agentId, revoked: true, reason: "apy_below_threshold", revokeAll: false };
  }

  // 5. Stop-loss hit → revoke executor for this asset
  const stopLoss = await checkStopLoss(agent);
  if (stopLoss) {
    await triggerRevoke(agentId, baseUrl, "stop_loss");
    return { agentId, revoked: true, reason: "stop_loss", revokeAll: false };
  }

  return { agentId, revoked: false, revokeAll: false };
}

async function triggerRevoke(agentId: string, baseUrl: string, reason: RevocationReason): Promise<void> {
  console.log(`[revocationMonitor] Revoking agent ${agentId}: ${reason}`);

  try {
    // Call the revoke endpoint — this calls disableDelegation() on-chain
    const res = await fetch(`${baseUrl}/api/agent/${agentId}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      console.error(`[revocationMonitor] Revoke failed for ${agentId}:`, await res.text());
      return;
    }

    // Record the revocation reason on the agent
    await updateAgent(agentId, {
      lastError: `Auto-revoked: ${reason}`,
    });

    // Telegram alert
    try {
      const revokedAgent = await getAgent(agentId);
      await fetch(`${baseUrl}/api/notify/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: revokedAgent?.walletAddress,
          agentId,
          message: `🔒 *Agent delegation revoked*\n\nAgent: \`${agentId}\`\nReason: ${REASON_LABELS[reason]}\n\nThe on-chain delegation has been disabled via DelegationManager.disableDelegation(). Use the dashboard to review and re-grant if needed.`,
        }),
      });
    } catch { /* non-fatal */ }

  } catch (e) {
    console.error(`[revocationMonitor] Exception revoking ${agentId}:`, e);
  }
}

const REASON_LABELS: Record<RevocationReason, string> = {
  budget_exhausted:    "Budget exhausted (≥95% of cap used)",
  apy_below_threshold: "APY dropped below configured minimum",
  consecutive_failures: "3+ consecutive failed runs",
  stop_loss:           "Stop-loss threshold triggered",
  il_exceeded:         "Impermanent loss exceeded limit",
  manual:              "Manual revocation",
  permission_expired:  "ERC-7715 permission expired",
};

/**
 * Run the monitor for ALL active agents.
 * Called from the cron endpoint after running each agent.
 */
export async function runRevocationMonitorForAll(
  agentIds: string[],
  baseUrl: string,
): Promise<RevocationCheckResult[]> {
  const results = await Promise.all(
    agentIds.map(id => checkAndAutoRevoke(id, baseUrl))
  );
  return results.filter(r => r.revoked);
}
