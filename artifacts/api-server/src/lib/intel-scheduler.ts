/**
 * Sprint 5E — Intelligence Readiness Layer Scheduler
 *
 * Runs a full dataset refresh nightly at 00:30 (after performance_daily at 00:00).
 * Exported start function is registered in app.ts alongside other schedulers.
 *
 * Refresh order: vendors → customers → routes → profit → quotations → readiness scores
 * This order preserves dependency: vendor + customer intel feeds route + profit intel.
 */

import { refreshAllDatasets } from "./intel-refresh";
import { logger } from "./logger";

const DEFAULT_COMPANY_ID = process.env["COMPANY_ID"] ?? "default";

// ── Nightly schedule ──────────────────────────────────────────────────────────

function msUntilNext0030(): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(0, 30, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

async function runNightlyRefresh(): Promise<void> {
  logger.info({ trigger: "scheduled" }, "IRL nightly refresh starting");
  const t0 = Date.now();

  try {
    const results = await refreshAllDatasets(DEFAULT_COMPANY_ID, "scheduled", "system");

    const totalRows = results.reduce((s, r) => s + r.rowsWritten, 0);
    const failed = results.filter((r) => r.error);
    const avgReadiness = results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.readinessScoreAvg, 0) / results.length)
      : 0;

    logger.info(
      {
        totalRows,
        avgReadiness,
        durationMs: Date.now() - t0,
        failed: failed.map((r) => r.dataset),
        results: results.map((r) => ({
          dataset: r.dataset,
          rows: r.rowsWritten,
          score: r.readinessScoreAvg,
          ms: r.durationMs,
          error: r.error,
        })),
      },
      "IRL nightly refresh complete",
    );
  } catch (err) {
    logger.error({ err, durationMs: Date.now() - t0 }, "IRL nightly refresh fatal error");
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the IRL nightly scheduler.
 * Returns a cleanup function that cancels any pending timers (for graceful shutdown).
 */
export function startIntelScheduler(): () => void {
  let nightlyTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleNext(): void {
    const delay = msUntilNext0030();
    const nextRun = new Date(Date.now() + delay);
    logger.info({ nextRun: nextRun.toISOString() }, "IRL scheduler: next nightly refresh scheduled");

    nightlyTimer = setTimeout(async () => {
      await runNightlyRefresh();
      scheduleNext(); // re-schedule for the following night
    }, delay);
  }

  scheduleNext();

  return function cleanup() {
    if (nightlyTimer) clearTimeout(nightlyTimer);
  };
}

/**
 * Trigger a one-off refresh for a company.
 * Used by the manual refresh API endpoint (POST /api/intel/refresh).
 */
export async function triggerManualRefresh(
  companyId: string,
  triggeredBy: string,
) {
  logger.info({ companyId, triggeredBy }, "IRL manual refresh triggered");
  return refreshAllDatasets(companyId, "manual", triggeredBy);
}
