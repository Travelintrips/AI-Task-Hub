/**
 * Sprint 4C — AI Observability Dashboard
 * Read-only endpoints. Uses prediction_logs, performance_daily,
 * performance_by_intent, prompt_versions, ai_experiments, correction_queue.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  predictionLogsTable,
  performanceDailyTable,
  performanceByIntentTable,
  promptVersionsTable,
  aiExperimentsTable,
  correctionQueueTable,
  experimentResultsTable,
} from "@workspace/db/schema";
import { requireAuth } from "../middleware/auth";
import { sql, desc, and, gte, eq, count, avg, isNotNull } from "drizzle-orm";

const router = Router();

// ── Helper: company gate ───────────────────────────────────────────────────────

function companyId(req: any): string {
  return req.user?.companyId ?? "default";
}

// ── GET /api/observability/health ─────────────────────────────────────────────
// Predictions today, fallback %, confidence avg, latency p50/p95, top intents

router.get("/observability/health", requireAuth, async (req, res) => {
  try {
    const cid = companyId(req);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Predictions today from prediction_logs
    const [todayStats] = await db
      .select({
        total: count(),
        fallbacks: sql<number>`cast(sum(case when ${predictionLogsTable.isFallback} then 1 else 0 end) as int)`,
        corrected: sql<number>`cast(sum(case when ${predictionLogsTable.wasCorrected} then 1 else 0 end) as int)`,
        avgConfidence: avg(predictionLogsTable.predictedConfidenceNumeric),
        avgLlmLatency: avg(predictionLogsTable.llmLatencyMs),
        avgTotalLatency: avg(predictionLogsTable.totalLatencyMs),
      })
      .from(predictionLogsTable)
      .where(
        and(
          eq(predictionLogsTable.companyId, cid),
          gte(predictionLogsTable.predictedAt, todayStart),
        )
      );

    // p50/p95 latency (approximation via percentile_cont)
    const latencyRow = await db.execute(
      sql`SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY llm_latency_ms) AS p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY llm_latency_ms) AS p95
      FROM prediction_logs
      WHERE company_id = ${cid}
        AND predicted_at >= ${todayStart.toISOString()}
        AND llm_latency_ms IS NOT NULL`
    );

    const latency = (latencyRow.rows?.[0] ?? {}) as { p50?: string; p95?: string };

    // Top 10 intents today
    const topIntents = await db
      .select({
        intent: predictionLogsTable.predictedIntent,
        cnt: count(),
      })
      .from(predictionLogsTable)
      .where(
        and(
          eq(predictionLogsTable.companyId, cid),
          gte(predictionLogsTable.predictedAt, todayStart),
          isNotNull(predictionLogsTable.predictedIntent),
        )
      )
      .groupBy(predictionLogsTable.predictedIntent)
      .orderBy(desc(count()))
      .limit(10);

    // Last 7-day daily trend from performance_daily
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const trend = await db
      .select()
      .from(performanceDailyTable)
      .where(
        and(
          eq(performanceDailyTable.companyId, cid),
          gte(performanceDailyTable.date, sevenDaysAgo.toISOString().slice(0, 10)),
        )
      )
      .orderBy(performanceDailyTable.date);

    const total = Number(todayStats?.total ?? 0);
    const fallbacks = Number(todayStats?.fallbacks ?? 0);

    res.json({
      today: {
        total,
        fallbacks,
        corrected: Number(todayStats?.corrected ?? 0),
        fallbackRate: total > 0 ? ((fallbacks / total) * 100).toFixed(1) : "0.0",
        avgConfidence: todayStats?.avgConfidence
          ? parseFloat(String(todayStats.avgConfidence)).toFixed(2)
          : null,
        avgLlmLatencyMs: todayStats?.avgLlmLatency
          ? Math.round(Number(todayStats.avgLlmLatency))
          : null,
        p50LlmLatencyMs: latency.p50 ? Math.round(Number(latency.p50)) : null,
        p95LlmLatencyMs: latency.p95 ? Math.round(Number(latency.p95)) : null,
      },
      topIntents,
      trend: trend.map((r) => ({
        date: r.date,
        total: r.totalPredictions,
        fallbackRate: r.fallbackRate ? parseFloat(String(r.fallbackRate)).toFixed(1) : null,
        avgConfidence: r.avgConfidence ? parseFloat(String(r.avgConfidence)).toFixed(2) : null,
        avgLlmLatencyMs: r.avgLlmLatencyMs,
        p95LlmLatencyMs: r.p95LlmLatencyMs,
      })),
    });
  } catch (err) {
    console.error("/api/observability/health error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/observability/accuracy ──────────────────────────────────────────
// Top intents by accuracy, top corrected intents, correction breakdown

router.get("/observability/accuracy", requireAuth, async (req, res) => {
  try {
    const cid = companyId(req);
    const days = Math.min(Number(req.query.days ?? 30), 90);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    // Per-intent accuracy from performance_by_intent
    const byIntent = await db
      .select({
        intentCode: performanceByIntentTable.intentCode,
        sampleCount: sql<number>`cast(sum(${performanceByIntentTable.sampleCount}) as int)`,
        correctionCount: sql<number>`cast(sum(${performanceByIntentTable.correctionCount}) as int)`,
        fallbackCount: sql<number>`cast(sum(${performanceByIntentTable.fallbackCount}) as int)`,
        avgAccuracy: avg(performanceByIntentTable.accuracyRate),
        avgConfidence: avg(performanceByIntentTable.avgConfidence),
      })
      .from(performanceByIntentTable)
      .where(
        and(
          eq(performanceByIntentTable.companyId, cid),
          gte(performanceByIntentTable.date, sinceStr),
        )
      )
      .groupBy(performanceByIntentTable.intentCode)
      .orderBy(desc(sql`sum(${performanceByIntentTable.sampleCount})`))
      .limit(20);

    // Top corrected intents from correction_queue
    const topCorrected = await db
      .select({
        fieldCorrected: correctionQueueTable.fieldCorrected,
        originalValue: correctionQueueTable.originalValue,
        cnt: count(),
      })
      .from(correctionQueueTable)
      .where(
        and(
          eq(correctionQueueTable.companyId, cid),
          gte(correctionQueueTable.createdAt, since),
        )
      )
      .groupBy(correctionQueueTable.fieldCorrected, correctionQueueTable.originalValue)
      .orderBy(desc(count()))
      .limit(15);

    // Correction rate by field
    const byField = await db
      .select({
        fieldCorrected: correctionQueueTable.fieldCorrected,
        cnt: count(),
      })
      .from(correctionQueueTable)
      .where(
        and(
          eq(correctionQueueTable.companyId, cid),
          gte(correctionQueueTable.createdAt, since),
        )
      )
      .groupBy(correctionQueueTable.fieldCorrected)
      .orderBy(desc(count()));

    res.json({
      days,
      byIntent: byIntent.map((r) => ({
        intentCode: r.intentCode,
        sampleCount: Number(r.sampleCount),
        correctionCount: Number(r.correctionCount),
        fallbackCount: Number(r.fallbackCount),
        avgAccuracy: r.avgAccuracy ? parseFloat(String(r.avgAccuracy)).toFixed(1) : null,
        avgConfidence: r.avgConfidence ? parseFloat(String(r.avgConfidence)).toFixed(2) : null,
      })),
      topCorrected,
      byField,
    });
  } catch (err) {
    console.error("/api/observability/accuracy error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/observability/cost ───────────────────────────────────────────────
// Prompt version usage share, model distribution, estimated token costs

router.get("/observability/cost", requireAuth, async (req, res) => {
  try {
    const cid = companyId(req);
    const days = Math.min(Number(req.query.days ?? 30), 90);
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Predictions per prompt version
    const byVersion = await db
      .select({
        promptVersionId: predictionLogsTable.promptVersionId,
        model: predictionLogsTable.model,
        cnt: count(),
        avgLatency: avg(predictionLogsTable.llmLatencyMs),
      })
      .from(predictionLogsTable)
      .where(
        and(
          eq(predictionLogsTable.companyId, cid),
          gte(predictionLogsTable.predictedAt, since),
        )
      )
      .groupBy(predictionLogsTable.promptVersionId, predictionLogsTable.model)
      .orderBy(desc(count()));

    // Prompt version labels
    const versions = await db
      .select({
        id: promptVersionsTable.id,
        versionLabel: promptVersionsTable.versionLabel,
        model: promptVersionsTable.model,
        status: promptVersionsTable.status,
        activatedAt: promptVersionsTable.activatedAt,
      })
      .from(promptVersionsTable)
      .where(eq(promptVersionsTable.companyId, cid))
      .orderBy(desc(promptVersionsTable.id));

    // Model breakdown total
    const byModel = await db
      .select({
        model: predictionLogsTable.model,
        cnt: count(),
      })
      .from(predictionLogsTable)
      .where(
        and(
          eq(predictionLogsTable.companyId, cid),
          gte(predictionLogsTable.predictedAt, since),
        )
      )
      .groupBy(predictionLogsTable.model)
      .orderBy(desc(count()));

    // Daily predictions for sparkline
    const daily = await db
      .select({
        date: sql<string>`date_trunc('day', ${predictionLogsTable.predictedAt})::date::text`,
        cnt: count(),
        fallbacks: sql<number>`cast(sum(case when ${predictionLogsTable.isFallback} then 1 else 0 end) as int)`,
      })
      .from(predictionLogsTable)
      .where(
        and(
          eq(predictionLogsTable.companyId, cid),
          gte(predictionLogsTable.predictedAt, since),
        )
      )
      .groupBy(sql`date_trunc('day', ${predictionLogsTable.predictedAt})::date`)
      .orderBy(sql`date_trunc('day', ${predictionLogsTable.predictedAt})::date`);

    const versionMap = Object.fromEntries(versions.map((v) => [v.id, v]));
    const totalPredictions = byModel.reduce((acc, r) => acc + Number(r.cnt), 0);

    res.json({
      days,
      totalPredictions,
      byVersion: byVersion.map((r) => ({
        promptVersionId: r.promptVersionId,
        versionLabel: r.promptVersionId ? versionMap[r.promptVersionId]?.versionLabel ?? `v${r.promptVersionId}` : "(no version)",
        model: r.model,
        count: Number(r.cnt),
        pct: totalPredictions > 0 ? ((Number(r.cnt) / totalPredictions) * 100).toFixed(1) : "0",
        avgLatencyMs: r.avgLatency ? Math.round(Number(r.avgLatency)) : null,
      })),
      byModel,
      versions,
      daily: daily.map((d) => ({ date: d.date, count: Number(d.cnt), fallbacks: Number(d.fallbacks) })),
    });
  } catch (err) {
    console.error("/api/observability/cost error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/observability/errors ─────────────────────────────────────────────
// Fallback logs, low-confidence predictions, error breakdown

router.get("/observability/errors", requireAuth, async (req, res) => {
  try {
    const cid = companyId(req);
    const days = Math.min(Number(req.query.days ?? 7), 30);
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Recent fallback predictions
    const fallbacks = await db
      .select({
        id: predictionLogsTable.id,
        taskId: predictionLogsTable.taskId,
        model: predictionLogsTable.model,
        predictedIntent: predictionLogsTable.predictedIntent,
        predictedConfidence: predictionLogsTable.predictedConfidence,
        predictedConfidenceNumeric: predictionLogsTable.predictedConfidenceNumeric,
        isFallback: predictionLogsTable.isFallback,
        wasCorrected: predictionLogsTable.wasCorrected,
        llmLatencyMs: predictionLogsTable.llmLatencyMs,
        predictedAt: predictionLogsTable.predictedAt,
      })
      .from(predictionLogsTable)
      .where(
        and(
          eq(predictionLogsTable.companyId, cid),
          eq(predictionLogsTable.isFallback, true),
          gte(predictionLogsTable.predictedAt, since),
        )
      )
      .orderBy(desc(predictionLogsTable.predictedAt))
      .limit(50);

    // Low confidence (confidence = "low")
    const lowConf = await db
      .select({
        id: predictionLogsTable.id,
        taskId: predictionLogsTable.taskId,
        model: predictionLogsTable.model,
        predictedIntent: predictionLogsTable.predictedIntent,
        predictedConfidence: predictionLogsTable.predictedConfidence,
        predictedConfidenceNumeric: predictionLogsTable.predictedConfidenceNumeric,
        wasCorrected: predictionLogsTable.wasCorrected,
        llmLatencyMs: predictionLogsTable.llmLatencyMs,
        predictedAt: predictionLogsTable.predictedAt,
      })
      .from(predictionLogsTable)
      .where(
        and(
          eq(predictionLogsTable.companyId, cid),
          eq(predictionLogsTable.predictedConfidence, "low"),
          gte(predictionLogsTable.predictedAt, since),
        )
      )
      .orderBy(desc(predictionLogsTable.predictedAt))
      .limit(50);

    // Hourly fallback trend (last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hourlyFallbacks = await db.execute(
      sql`SELECT
        date_trunc('hour', predicted_at) AS hour,
        count(*) AS total,
        sum(case when is_fallback then 1 else 0 end) AS fallbacks
      FROM prediction_logs
      WHERE company_id = ${cid}
        AND predicted_at >= ${oneDayAgo.toISOString()}
      GROUP BY 1
      ORDER BY 1`
    );

    // Daily fallback rate trend
    const dailyErrors = await db
      .select({
        date: performanceDailyTable.date,
        totalPredictions: performanceDailyTable.totalPredictions,
        totalFallbacks: performanceDailyTable.totalFallbacks,
        totalLowConfidence: performanceDailyTable.totalLowConfidence,
        fallbackRate: performanceDailyTable.fallbackRate,
        correctionRate: performanceDailyTable.correctionRate,
      })
      .from(performanceDailyTable)
      .where(
        and(
          eq(performanceDailyTable.companyId, cid),
          gte(performanceDailyTable.date, since.toISOString().slice(0, 10)),
        )
      )
      .orderBy(performanceDailyTable.date);

    res.json({
      days,
      fallbacks,
      lowConf,
      hourlyTrend: (hourlyFallbacks.rows ?? []).map((r: any) => ({
        hour: r.hour,
        total: Number(r.total),
        fallbacks: Number(r.fallbacks),
        fallbackRate: Number(r.total) > 0 ? ((Number(r.fallbacks) / Number(r.total)) * 100).toFixed(1) : "0.0",
      })),
      dailyErrors: dailyErrors.map((r) => ({
        date: r.date,
        totalPredictions: r.totalPredictions,
        totalFallbacks: r.totalFallbacks,
        totalLowConfidence: r.totalLowConfidence,
        fallbackRate: r.fallbackRate ? parseFloat(String(r.fallbackRate)).toFixed(1) : null,
        correctionRate: r.correctionRate ? parseFloat(String(r.correctionRate)).toFixed(1) : null,
      })),
    });
  } catch (err) {
    console.error("/api/observability/errors error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/observability/experiments ───────────────────────────────────────
// Experiment list + results + observation count

router.get("/observability/experiments", requireAuth, async (req, res) => {
  try {
    const cid = companyId(req);

    const experiments = await db
      .select()
      .from(aiExperimentsTable)
      .where(eq(aiExperimentsTable.companyId, cid))
      .orderBy(desc(aiExperimentsTable.id));

    // Results per experiment
    const results = await db
      .select()
      .from(experimentResultsTable)
      .orderBy(desc(experimentResultsTable.id));

    const resultsMap = results.reduce<Record<number, typeof results>>((acc, r) => {
      acc[r.experimentId] = acc[r.experimentId] ?? [];
      acc[r.experimentId]!.push(r);
      return acc;
    }, {});

    // Prompt version labels for display
    const versions = await db
      .select({ id: promptVersionsTable.id, versionLabel: promptVersionsTable.versionLabel })
      .from(promptVersionsTable)
      .where(eq(promptVersionsTable.companyId, cid));
    const versionMap = Object.fromEntries(versions.map((v) => [v.id, v.versionLabel]));

    // Predictions per experiment (using experiment_id column in prediction_logs)
    const expPredictions = await db
      .select({
        experimentId: predictionLogsTable.experimentId,
        experimentGroup: predictionLogsTable.experimentGroup,
        cnt: count(),
        avgConfidence: avg(predictionLogsTable.predictedConfidenceNumeric),
        fallbacks: sql<number>`cast(sum(case when ${predictionLogsTable.isFallback} then 1 else 0 end) as int)`,
      })
      .from(predictionLogsTable)
      .where(
        and(
          eq(predictionLogsTable.companyId, cid),
          isNotNull(predictionLogsTable.experimentId),
        )
      )
      .groupBy(predictionLogsTable.experimentId, predictionLogsTable.experimentGroup);

    const predByExp = expPredictions.reduce<Record<number, typeof expPredictions>>((acc, r) => {
      if (r.experimentId != null) {
        acc[r.experimentId] = acc[r.experimentId] ?? [];
        acc[r.experimentId]!.push(r);
      }
      return acc;
    }, {});

    res.json({
      experiments: experiments.map((e) => ({
        ...e,
        controlLabel: versionMap[e.controlVersionId] ?? `v${e.controlVersionId}`,
        challengerLabel: versionMap[e.challengerVersionId] ?? `v${e.challengerVersionId}`,
        results: resultsMap[e.id] ?? [],
        predictions: predByExp[e.id] ?? [],
      })),
    });
  } catch (err) {
    console.error("/api/observability/experiments error", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
