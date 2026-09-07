/**
 * Sprint 9D — Quality Gate API Routes
 *
 * POST   /api/quality-gate/run        — trigger a new certification run       (company_admin+)
 * GET    /api/quality-gate/runs       — list all runs                          (requireAuth)
 * GET    /api/quality-gate/runs/:id   — get single run with results            (requireAuth)
 * GET    /api/quality-gate/latest     — latest run summary (for widget)        (requireAuth)
 * GET    /api/quality-gate/report     — full certification report (latest run) (requireAuth)
 */

import { Router, type IRouter } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { supabaseQuery } from "../lib/supabase-db";
import { runQualityGate, getLatestRunSummary } from "../lib/quality-gate-engine";

const router: IRouter = Router();

// ─── POST /quality-gate/run ───────────────────────────────────────────────────

router.post(
  "/quality-gate/run",
  requireRole("company_admin", "owner", "super_admin"),
  async (req, res): Promise<void> => {
    try {
      const runName =
        (req.body as { runName?: string }).runName ??
        `Run ${new Date().toLocaleString("id-ID")}`;
      const triggeredBy = req.user?.email ?? req.user?.name ?? "admin";

      // Run asynchronously — respond immediately with run_id placeholder
      // then kick off the gate in the background
      logger.info({ runName, triggeredBy }, "QualityGate: starting run");

      // Fire and forget — the run stores its own results
      runQualityGate(runName, triggeredBy)
        .then((report) => {
          logger.info({ runId: report.runId, certified: report.certified }, "QualityGate: background run complete");
        })
        .catch((err) => {
          logger.error({ err }, "QualityGate: background run failed");
        });

      res.status(202).json({
        message: "Quality gate run started",
        runName,
        triggeredBy,
        note: "Cek GET /api/quality-gate/latest setelah ~30 detik untuk hasil",
      });
    } catch (err) {
      logger.error({ err }, "POST /quality-gate/run failed");
      res.status(500).json({ error: "Failed to start quality gate run" });
    }
  },
);

// ─── GET /quality-gate/latest ─────────────────────────────────────────────────

router.get("/quality-gate/latest", requireAuth, async (req, res): Promise<void> => {
  try {
    const summary = await getLatestRunSummary();
    res.json({ data: summary });
  } catch (err) {
    logger.error({ err }, "GET /quality-gate/latest failed");
    res.status(500).json({ error: "Failed to load latest run" });
  }
});

// ─── GET /quality-gate/runs ───────────────────────────────────────────────────

router.get("/quality-gate/runs", requireAuth, async (req, res): Promise<void> => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10) || 20, 100);
    const rows = await supabaseQuery<Record<string, unknown>>(
      `SELECT id, run_name, suite_name, triggered_by, status,
              total_scenarios, passed, failed, skipped, success_rate,
              critical_failures, rbac_failures, certified, go_decision,
              duration_ms, started_at, completed_at, created_at
       FROM quality_gate_runs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );
    const mapped = rows.map((r) => ({
      id: r.id,
      runName: r.run_name,
      suiteName: r.suite_name,
      triggeredBy: r.triggered_by,
      status: r.status,
      totalScenarios: r.total_scenarios,
      passed: r.passed,
      failed: r.failed,
      skipped: r.skipped,
      successRate: r.success_rate,
      criticalFailures: r.critical_failures,
      rbacFailures: r.rbac_failures,
      certified: r.certified,
      goDecision: r.go_decision,
      durationMs: r.duration_ms,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      createdAt: r.created_at,
    }));
    res.json({ data: mapped, total: mapped.length });
  } catch (err) {
    logger.error({ err }, "GET /quality-gate/runs failed");
    res.status(500).json({ error: "Failed to load runs" });
  }
});

// ─── GET /quality-gate/runs/:id ───────────────────────────────────────────────

router.get("/quality-gate/runs/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const runRows = await supabaseQuery<Record<string, unknown>>(
      `SELECT id, run_name, suite_name, triggered_by, status,
              total_scenarios, passed, failed, skipped, success_rate,
              critical_failures, rbac_failures, certified, go_decision,
              duration_ms, started_at, completed_at, created_at
       FROM quality_gate_runs WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!runRows[0]) { res.status(404).json({ error: "Run not found" }); return; }
    const r = runRows[0];

    const resultRows = await supabaseQuery<Record<string, unknown>>(
      `SELECT id, scenario_name, phase, service_type, status,
              duration_ms, error_message, checks, created_at
       FROM quality_gate_results WHERE run_id = $1 ORDER BY id`,
      [id],
    );

    res.json({
      data: {
        id: r.id, runName: r.run_name, suiteName: r.suite_name,
        triggeredBy: r.triggered_by, status: r.status,
        totalScenarios: r.total_scenarios, passed: r.passed, failed: r.failed,
        skipped: r.skipped, successRate: r.success_rate,
        criticalFailures: r.critical_failures, rbacFailures: r.rbac_failures,
        certified: r.certified, goDecision: r.go_decision,
        durationMs: r.duration_ms, startedAt: r.started_at,
        completedAt: r.completed_at, createdAt: r.created_at,
        results: resultRows.map((rr) => ({
          id: rr.id,
          scenarioName: rr.scenario_name,
          phase: rr.phase,
          serviceType: rr.service_type,
          status: rr.status,
          durationMs: rr.duration_ms,
          errorMessage: rr.error_message,
          checks: rr.checks,
          createdAt: rr.created_at,
        })),
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /quality-gate/runs/:id failed");
    res.status(500).json({ error: "Failed to load run" });
  }
});

// ─── GET /quality-gate/report ─────────────────────────────────────────────────
// Full certification report for the latest completed run

router.get("/quality-gate/report", requireAuth, async (req, res): Promise<void> => {
  try {
    const runRows = await supabaseQuery<Record<string, unknown>>(
      `SELECT id, run_name, suite_name, triggered_by, status,
              total_scenarios, passed, failed, skipped, success_rate,
              critical_failures, rbac_failures, certified, go_decision,
              duration_ms, started_at, completed_at, created_at
       FROM quality_gate_runs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1`,
      [],
    );

    if (!runRows[0]) {
      res.json({
        data: null,
        message: "Belum ada run yang selesai. Jalankan POST /api/quality-gate/run terlebih dahulu.",
      });
      return;
    }

    const r = runRows[0];
    const resultRows = await supabaseQuery<Record<string, unknown>>(
      `SELECT id, scenario_name, phase, service_type, status,
              duration_ms, error_message, checks, created_at
       FROM quality_gate_results WHERE run_id = $1 ORDER BY id`,
      [r.id],
    );

    // Phase summary
    const phases = new Map<string, { total: number; passed: number; failed: number }>();
    for (const rr of resultRows) {
      const phase = String(rr.phase);
      if (!phases.has(phase)) phases.set(phase, { total: 0, passed: 0, failed: 0 });
      const p = phases.get(phase)!;
      p.total++;
      if (rr.status === "passed") p.passed++;
      if (rr.status === "failed") p.failed++;
    }

    const report = {
      runId: r.id,
      runName: r.run_name,
      suiteName: r.suite_name,
      triggeredBy: r.triggered_by,
      status: r.status,
      totalScenarios: r.total_scenarios,
      passed: r.passed,
      failed: r.failed,
      skipped: r.skipped,
      successRate: r.success_rate,
      criticalFailures: r.critical_failures,
      rbacFailures: r.rbac_failures,
      certified: r.certified,
      goDecision: r.go_decision,
      durationMs: r.duration_ms,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      phaseSummary: Object.fromEntries(phases),
      releaseCriteria: {
        successRateRequired: 95,
        successRateActual: Number(r.success_rate ?? 0),
        criticalFailuresRequired: 0,
        criticalFailuresActual: r.critical_failures,
        rbacFailuresRequired: 0,
        rbacFailuresActual: r.rbac_failures,
        certificationMet: r.certified,
      },
      scenarios: resultRows.map((rr) => ({
        scenarioName: rr.scenario_name,
        phase: rr.phase,
        serviceType: rr.service_type,
        status: rr.status,
        durationMs: rr.duration_ms,
        errorMessage: rr.error_message,
        checks: rr.checks,
      })),
    };

    res.json({ data: report });
  } catch (err) {
    logger.error({ err }, "GET /quality-gate/report failed");
    res.status(500).json({ error: "Failed to generate report" });
  }
});

export default router;
