/**
 * Sprint 5E — Intelligence Readiness Layer Refresh Engine
 *
 * Each refresh function:
 *   1. Aggregates data from Supabase source tables (via supabaseQuery)
 *   2. Computes readiness scores via intel-readiness.ts (pure functions)
 *   3. Upserts rows to intel_* tables in Supabase (via drizzle db)
 *   4. Returns { rowsWritten, readinessScoreAvg }
 *
 * Architecture note:
 *   Source tables (ai_tasks, quotations, shipment_trackings, vendor_*, customers, etc.)
 *   live in Supabase → read via supabaseQuery().
 *   Intel materialized tables (intel_*) also live in Supabase → write via db.execute().
 *
 * 5C/5D extension points are marked with TODO comments.
 * Uses rolling 90-day period by default.
 */

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  intelRoutesTable,
  intelVendorsTable,
  intelCustomersTable,
  intelProfitTable,
  intelQuotationsTable,
  intelReadinessScoresTable,
  intelRefreshLogTable,
  INTEL_DATASET_VERSION,
  type IntelDatasetName,
} from "@workspace/db/schema";
import {
  computeRouteReadiness,
  computeVendorReadiness,
  computeCustomerReadiness,
  computeProfitReadiness,
  computeQuotationReadiness,
  aggregateReadiness,
  type ReadinessResult,
} from "./intel-readiness";
import { supabaseQuery } from "./supabase-db";
import { logger } from "./logger";

// ── Source-table helper ───────────────────────────────────────────────────────
// Wraps supabaseQuery (which reads from Supabase where all app data lives)
// and returns the familiar { rows } shape used throughout this file.
// supabaseQuery already catches errors and returns [] — so missing tables
// (e.g. customer_memory_snapshots before Sprint 5A is pushed) fail gracefully.

async function srcQ(text: string, params?: unknown[]): Promise<{ rows: any[] }> {
  const rows = await supabaseQuery(text, params);
  return { rows };
}

// ── Period helpers ────────────────────────────────────────────────────────────

export function getPeriodDates(daysBack = 90): { periodStart: Date; periodEnd: Date } {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - daysBack * 86_400_000);
  return { periodStart, periodEnd };
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Serialize a JS string[] to PostgreSQL text-array literal '{val1,val2}'.
// Drizzle's sql template expands arrays into multiple params — this avoids that.
function pgArr(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return "{}";
  return "{" + arr.map((s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + "}";
}

// ── Refresh log helpers ───────────────────────────────────────────────────────

async function startRefreshLog(
  companyId: string,
  datasetName: IntelDatasetName,
  trigger: string,
  triggeredBy: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ jobId: string }> {
  const jobId = randomUUID();
  await db.insert(intelRefreshLogTable).values({
    companyId,
    jobId,
    datasetName,
    trigger,
    triggeredBy,
    periodStart: toDateStr(periodStart),
    periodEnd: toDateStr(periodEnd),
    status: "running",
  });
  return { jobId };
}

async function completeRefreshLog(
  jobId: string,
  rowsWritten: number,
  rowsStaleCleared: number,
  readinessScoreAvg: number,
  durationMs: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE intel_refresh_log
    SET status = 'completed',
        rows_written = ${rowsWritten},
        rows_stale_cleared = ${rowsStaleCleared},
        readiness_score_avg = ${readinessScoreAvg},
        duration_ms = ${durationMs},
        completed_at = NOW()
    WHERE job_id = ${jobId}
  `);
}

async function failRefreshLog(jobId: string, errorMessage: string, durationMs: number): Promise<void> {
  await db.execute(sql`
    UPDATE intel_refresh_log
    SET status = 'failed',
        error_message = ${errorMessage},
        duration_ms = ${durationMs},
        completed_at = NOW()
    WHERE job_id = ${jobId}
  `);
}

// ── Dataset 1: intel_routes ───────────────────────────────────────────────────

export async function refreshIntelRoutes(
  companyId: string,
  trigger = "scheduled",
  triggeredBy = "system",
): Promise<{ rowsWritten: number; readinessScoreAvg: number; jobId: string }> {
  const { periodStart, periodEnd } = getPeriodDates();
  const { jobId } = await startRefreshLog(companyId, "routes", trigger, triggeredBy, periodStart, periodEnd);
  const t0 = Date.now();

  try {
    // Aggregate route data from shipment_trackings + ai_tasks + quotations (Supabase)
    const rows = await srcQ(`
      SELECT
        st.company_id,
        COALESCE(st.port_of_loading, 'unknown')  AS origin,
        COALESCE(st.port_of_discharge, 'unknown') AS destination,
        COALESCE(at.category, 'general')          AS service_category,
        COUNT(DISTINCT st.id)::int                AS task_count,
        COUNT(DISTINCT at.customer_id)::int       AS unique_customers,
        AVG(
          EXTRACT(EPOCH FROM (st.eta - st.etd)) / 86400.0
        )::real                                   AS avg_eta_days,
        AVG(
          CASE WHEN st.ata IS NOT NULL AND st.atd IS NOT NULL
               THEN EXTRACT(EPOCH FROM (st.ata - st.atd)) / 86400.0
          END
        )::real                                   AS avg_actual_days,
        (
          COUNT(CASE WHEN st.ata IS NOT NULL AND st.eta IS NOT NULL
                          AND st.ata <= st.eta THEN 1 END)::float /
          NULLIF(COUNT(CASE WHEN st.ata IS NOT NULL THEN 1 END), 0)
        )::real                                   AS on_time_delivery_rate,
        AVG(CASE WHEN q.status = 'accepted' THEN q.total_amount END)::real AS avg_quoted_amount,
        MAX(GREATEST(st.updated_at, at.updated_at, q.updated_at)) AS source_last_updated_at
      FROM shipment_trackings st
      LEFT JOIN ai_tasks at ON at.id = st.task_id AND at.company_id = st.company_id
      LEFT JOIN quotations q ON q.task_id = st.task_id AND q.company_id = st.company_id
      WHERE st.company_id = $1
        AND st.created_at >= $2
        AND st.created_at <= $3
        AND st.port_of_loading IS NOT NULL
        AND st.port_of_discharge IS NOT NULL
      GROUP BY st.company_id, st.port_of_loading, st.port_of_discharge, at.category
      HAVING COUNT(DISTINCT st.id) >= 1
    `, [companyId, periodStart, periodEnd]);

    // Get service catalog prices for benchmark (Supabase)
    const catalog = await srcQ(`
      SELECT category, base_price::real AS base_price, estimated_days
      FROM service_catalog
      WHERE company_id = $1 AND is_active = true
    `, [companyId]);
    const catalogMap = new Map<string, { basePrice: number | null; estimatedDays: string | null }>();
    for (const c of catalog.rows as any[]) {
      if (c.category) catalogMap.set(c.category, { basePrice: c.base_price ? Number(c.base_price) : null, estimatedDays: c.estimated_days });
    }

    const totalRoutes = (rows.rows as any[]).length;
    const routesWithMinTasks = (rows.rows as any[]).filter((r) => Number(r.task_count) >= 3).length;

    const readinessResults: ReadinessResult[] = [];
    let rowsWritten = 0;

    for (const row of rows.rows as any[]) {
      const catInfo = catalogMap.get(row.service_category) ?? { basePrice: null, estimatedDays: null };
      const sourceLastUpdatedAt = row.source_last_updated_at ? new Date(row.source_last_updated_at) : null;

      const readiness = computeRouteReadiness({
        taskCount: Number(row.task_count ?? 0),
        vendorCount: 0, // enriched from vendor_capabilities below
        priceSignalCount: 0, // TODO: populate from purchasing_signals (Sprint 5D)
        onTimeDeliveryRate: row.on_time_delivery_rate ? Number(row.on_time_delivery_rate) : null,
        avgActualCost: null, // TODO: from purchasing_signals (Sprint 5D)
        avgQuotedAmount: row.avg_quoted_amount ? Number(row.avg_quoted_amount) : null,
        successRate: null, // TODO: from recommendation_outcomes (Sprint 5D)
        avgCustomerSatisfaction: null, // TODO: from recommendation_outcomes (Sprint 5D)
        sourceLastUpdatedAt,
        totalRouteCount: totalRoutes,
        routesWithMinTasks,
      });
      readinessResults.push(readiness);

      const monthsInPeriod = 3;
      const avgTasksPerMonth = Number(row.task_count ?? 0) / monthsInPeriod;
      const uniqueCustomers = Number(row.unique_customers ?? 0);
      const repeatRate = uniqueCustomers > 0
        ? Math.min(1, Number(row.task_count ?? 0) / uniqueCustomers - 1)
        : null;

      await db.execute(sql`
        INSERT INTO intel_routes (
          company_id, origin, destination, service_category,
          period_start, period_end, dataset_version,
          source_count, source_last_updated_at,
          task_count, unique_customers, repeat_customer_rate, avg_tasks_per_month,
          avg_eta_days, avg_actual_days, on_time_delivery_rate, catalog_estimated_days,
          catalog_base_price, avg_quoted_amount,
          vendor_count,
          readiness_score, confidence_tier, readiness_flags,
          refreshed_at, is_stale
        ) VALUES (
          ${companyId}, ${String(row.origin)}, ${String(row.destination)}, ${String(row.service_category)},
          ${toDateStr(periodStart)}, ${toDateStr(periodEnd)}, ${INTEL_DATASET_VERSION},
          ${2}, ${sourceLastUpdatedAt},
          ${Number(row.task_count ?? 0)}, ${uniqueCustomers}, ${repeatRate}, ${avgTasksPerMonth},
          ${row.avg_eta_days ? Number(row.avg_eta_days) : null},
          ${row.avg_actual_days ? Number(row.avg_actual_days) : null},
          ${row.on_time_delivery_rate ? Number(row.on_time_delivery_rate) : null},
          ${catInfo.estimatedDays},
          ${catInfo.basePrice},
          ${row.avg_quoted_amount ? Number(row.avg_quoted_amount) : null},
          ${0},
          ${readiness.score}, ${readiness.confidenceTier}, ${pgArr(readiness.flags)},
          NOW(), false
        )
        ON CONFLICT DO NOTHING
      `);
      rowsWritten++;
    }

    const readinessScoreAvg = readinessResults.length > 0
      ? Math.round(readinessResults.reduce((s, r) => s + r.score, 0) / readinessResults.length)
      : 0;

    await completeRefreshLog(jobId, rowsWritten, 0, readinessScoreAvg, Date.now() - t0);
    logger.info({ companyId, dataset: "routes", rowsWritten, readinessScoreAvg }, "IRL routes refresh complete");
    return { rowsWritten, readinessScoreAvg, jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRefreshLog(jobId, msg, Date.now() - t0);
    logger.error({ companyId, dataset: "routes", err }, "IRL routes refresh failed");
    throw err;
  }
}

// ── Dataset 2: intel_vendors ──────────────────────────────────────────────────

export async function refreshIntelVendors(
  companyId: string,
  trigger = "scheduled",
  triggeredBy = "system",
): Promise<{ rowsWritten: number; readinessScoreAvg: number; jobId: string }> {
  const { periodStart, periodEnd } = getPeriodDates();
  const { jobId } = await startRefreshLog(companyId, "vendors", trigger, triggeredBy, periodStart, periodEnd);
  const t0 = Date.now();

  try {
    // Latest performance snapshot per vendor (Supabase)
    const perfRows = await srcQ(`
      SELECT DISTINCT ON (vendor_id)
        vendor_id,
        on_time_rate,
        response_rate,
        cancel_rate,
        performance_score,
        performance_grade,
        avg_response_hours,
        jobs_total,
        jobs_completed,
        created_at
      FROM vendor_performance_snapshots
      WHERE company_id = $1
        AND snapshot_date >= $2
      ORDER BY vendor_id, snapshot_date DESC
    `, [companyId, toDateStr(periodStart)]);

    // Latest active risk assessment per vendor (Supabase)
    const riskRows = await srcQ(`
      SELECT vendor_id, risk_score, tier AS risk_tier, factors, assessed_at
      FROM vendor_risk_assessments
      WHERE company_id = $1 AND is_active = true
    `, [companyId]);
    const riskMap = new Map<number, any>();
    for (const r of riskRows.rows as any[]) riskMap.set(Number(r.vendor_id), r);

    // Capabilities per vendor (Supabase)
    const capRows = await srcQ(`
      SELECT
        vendor_id,
        ARRAY_AGG(DISTINCT service_type) AS service_types,
        ARRAY_AGG(DISTINCT cargo_type)   AS cargo_types,
        ARRAY_AGG(DISTINCT unnest(origin_cities)) AS coverage_origins,
        ARRAY_AGG(DISTINCT unnest(destination_cities)) AS coverage_destinations,
        ARRAY_AGG(DISTINCT unnest(certifications)) AS certifications,
        bool_or(dangerous_goods) AS has_hazmat,
        bool_or(cold_chain) AS has_cold_chain,
        MAX(updated_at) AS caps_updated_at
      FROM vendor_capabilities
      WHERE company_id = $1 AND is_active = true
      GROUP BY vendor_id
    `, [companyId]);
    const capMap = new Map<number, any>();
    for (const c of capRows.rows as any[]) capMap.set(Number(c.vendor_id), c);

    // Document status per vendor (Supabase)
    const docRows = await srcQ(`
      SELECT
        vendor_id,
        COUNT(*)::int                                                     AS total_docs,
        COUNT(CASE WHEN is_verified = true THEN 1 END)::int               AS verified_docs,
        COUNT(CASE WHEN expiry_date < NOW() THEN 1 END)::int              AS expired_docs,
        COUNT(CASE WHEN risk_level = 'high' AND is_current = true
                        AND (expiry_date IS NULL OR expiry_date < NOW()) THEN 1 END)::int AS critical_missing,
        ARRAY_AGG(DISTINCT CASE WHEN is_current = false OR expiry_date < NOW()
                                THEN document_type END) AS missing_doc_types,
        MAX(created_at) AS doc_updated_at
      FROM vendor_document_registry
      WHERE company_id = $1
      GROUP BY vendor_id
    `, [companyId]);
    const docMap = new Map<number, any>();
    for (const d of docRows.rows as any[]) docMap.set(Number(d.vendor_id), d);

    const totalActiveVendors = perfRows.rows.length;
    const readinessResults: ReadinessResult[] = [];
    let rowsWritten = 0;

    for (const perf of perfRows.rows as any[]) {
      const vid = Number(perf.vendor_id);
      const risk = riskMap.get(vid);
      const cap = capMap.get(vid);
      const doc = docMap.get(vid);

      const riskAssessmentAge = risk?.assessed_at
        ? Math.round((Date.now() - new Date(risk.assessed_at).getTime()) / 86_400_000)
        : null;

      const docCompleteness = doc && Number(doc.total_docs) > 0
        ? Number(doc.verified_docs) / Number(doc.total_docs)
        : null;
      const criticalDocsMissing = doc ? Number(doc.critical_missing) > 0 : false;

      const sourceLastUpdatedAt = [
        perf.created_at ? new Date(perf.created_at) : null,
        risk?.assessed_at ? new Date(risk.assessed_at) : null,
        cap?.caps_updated_at ? new Date(cap.caps_updated_at) : null,
      ].filter(Boolean).sort((a: any, b: any) => b - a)[0] ?? null;

      const readiness = computeVendorReadiness({
        onTimeRate: perf.on_time_rate ? Number(perf.on_time_rate) : null,
        riskScore: risk?.risk_score ? Number(risk.risk_score) : null,
        documentCompleteness: docCompleteness,
        criticalDocsMissing,
        selectionRate: null, // TODO: from recommendation_performance_by_vendor (Sprint 5D)
        performanceScore: perf.performance_score ? Number(perf.performance_score) : null,
        purchasingSignalCount: 0, // TODO: from purchasing_signals (Sprint 5D)
        avgCustomerSatisfaction: null, // TODO: from recommendation_outcomes (Sprint 5D)
        riskAssessmentAge,
        performanceSnapshotLastUpdated: perf.created_at ? new Date(perf.created_at) : null,
        riskLastUpdated: risk?.assessed_at ? new Date(risk.assessed_at) : null,
        capabilitiesLastUpdated: cap?.caps_updated_at ? new Date(cap.caps_updated_at) : null,
        totalActiveVendors,
        vendorsWithSignals: 0, // no purchasing_signals yet
      });
      readinessResults.push(readiness);

      const sourceCount = [perf, risk, cap, doc].filter(Boolean).length;

      await db.execute(sql`
        INSERT INTO intel_vendors (
          company_id, vendor_id,
          period_start, period_end, dataset_version,
          source_count, source_last_updated_at,
          service_types, cargo_types, certifications, has_hazmat, has_cold_chain,
          on_time_rate, response_rate, cancel_rate, performance_score, performance_grade,
          avg_response_hours, jobs_total, jobs_completed,
          risk_score, risk_tier, risk_assessment_age,
          document_completeness, expired_doc_count, missing_doc_types, critical_docs_missing,
          times_recommended, times_recommended_rank1, times_selected,
          recommendation_acceptance_rate, recommendation_win_rate,
          purchasing_signal_count,
          readiness_score, confidence_tier, readiness_flags,
          refreshed_at, is_stale
        ) VALUES (
          ${companyId}, ${vid},
          ${toDateStr(periodStart)}, ${toDateStr(periodEnd)}, ${INTEL_DATASET_VERSION},
          ${sourceCount}, ${sourceLastUpdatedAt},
          ${pgArr(cap?.service_types)}, ${pgArr(cap?.cargo_types)},
          ${pgArr(cap?.certifications)}, ${cap?.has_hazmat ?? false}, ${cap?.has_cold_chain ?? false},
          ${perf.on_time_rate ? Number(perf.on_time_rate) : null},
          ${perf.response_rate ? Number(perf.response_rate) : null},
          ${perf.cancel_rate ? Number(perf.cancel_rate) : null},
          ${perf.performance_score ? Number(perf.performance_score) : null},
          ${perf.performance_grade ?? null},
          ${perf.avg_response_hours ? Number(perf.avg_response_hours) : null},
          ${Number(perf.jobs_total ?? 0)}, ${Number(perf.jobs_completed ?? 0)},
          ${risk ? Number(risk.risk_score) : null},
          ${risk?.risk_tier ?? null},
          ${riskAssessmentAge},
          ${docCompleteness}, ${Number(doc?.expired_docs ?? 0)},
          ${pgArr(doc?.missing_doc_types)}, ${criticalDocsMissing},
          ${0}, ${0}, ${0},
          ${null}, ${null},
          ${0},
          ${readiness.score}, ${readiness.confidenceTier}, ${pgArr(readiness.flags)},
          NOW(), false
        )
        ON CONFLICT DO NOTHING
      `);
      rowsWritten++;
    }

    const readinessScoreAvg = readinessResults.length > 0
      ? Math.round(readinessResults.reduce((s, r) => s + r.score, 0) / readinessResults.length)
      : 0;

    await completeRefreshLog(jobId, rowsWritten, 0, readinessScoreAvg, Date.now() - t0);
    logger.info({ companyId, dataset: "vendors", rowsWritten, readinessScoreAvg }, "IRL vendors refresh complete");
    return { rowsWritten, readinessScoreAvg, jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRefreshLog(jobId, msg, Date.now() - t0);
    logger.error({ companyId, dataset: "vendors", err }, "IRL vendors refresh failed");
    throw err;
  }
}

// ── Dataset 3: intel_customers ────────────────────────────────────────────────

export async function refreshIntelCustomers(
  companyId: string,
  trigger = "scheduled",
  triggeredBy = "system",
): Promise<{ rowsWritten: number; readinessScoreAvg: number; jobId: string }> {
  const { periodStart, periodEnd } = getPeriodDates();
  const { jobId } = await startRefreshLog(companyId, "customers", trigger, triggeredBy, periodStart, periodEnd);
  const t0 = Date.now();

  try {
    // Customer base (Supabase)
    const customers = await srcQ(`
      SELECT id, company_name, tier, industry, preferred_channel, preferred_language,
             typical_cargo_types, typical_routes, risk_score, risk_tier,
             last_task_at, updated_at
      FROM customers
      WHERE company_id = $1
    `, [companyId]);

    // Task aggregation per customer (Supabase)
    const taskAgg = await srcQ(`
      SELECT
        customer_id,
        COUNT(*)::int                                                                AS task_count,
        COUNT(CASE WHEN status = 'completed' THEN 1 END)::float /
          NULLIF(COUNT(*), 0)                                                        AS completion_rate,
        COUNT(CASE WHEN sla_status = 'on_track' THEN 1 END)::float /
          NULLIF(COUNT(*), 0)                                                        AS on_track_rate,
        COUNT(CASE WHEN sla_status = 'overdue' THEN 1 END)::float /
          NULLIF(COUNT(*), 0)                                                        AS sla_breach_rate,
        AVG(follow_up_count)::real                                                   AS avg_follow_up_count,
        AVG(CASE WHEN customer_sentiment = 'positive' THEN 1
                 WHEN customer_sentiment = 'neutral' THEN 0
                 WHEN customer_sentiment IN ('frustrated','negative') THEN -1 END)::real AS avg_sentiment,
        COUNT(CASE WHEN customer_sentiment = 'positive' THEN 1 END)::float /
          NULLIF(COUNT(CASE WHEN customer_sentiment IS NOT NULL THEN 1 END), 0)     AS positive_sentiment_pct,
        COUNT(CASE WHEN missing_data IS NOT NULL THEN 1 END)::float /
          NULLIF(COUNT(*), 0)                                                        AS missing_doc_frequency,
        ARRAY_AGG(DISTINCT category) FILTER (WHERE category IS NOT NULL)            AS frequent_services,
        MAX(created_at)                                                              AS tasks_last_updated
      FROM ai_tasks
      WHERE company_id = $1
        AND created_at >= $2
        AND created_at <= $3
        AND customer_id IS NOT NULL
      GROUP BY customer_id
    `, [companyId, periodStart, periodEnd]);
    const taskMap = new Map<number, any>();
    for (const t of taskAgg.rows as any[]) taskMap.set(Number(t.customer_id), t);

    // Latest memory snapshot per customer (Supabase — graceful if table doesn't exist yet)
    const memSnapshots = await srcQ(`
      SELECT DISTINCT ON (customer_id)
        customer_id, sentiment_trend, frequent_services, ai_context_block, created_at
      FROM customer_memory_snapshots
      WHERE company_id = $1
      ORDER BY customer_id, created_at DESC
    `, [companyId]);
    const memMap = new Map<number, any>();
    for (const m of memSnapshots.rows as any[]) memMap.set(Number(m.customer_id), m);

    // Active risk assessment per customer (Supabase — graceful if table doesn't exist yet)
    const riskRows = await srcQ(`
      SELECT customer_id, risk_score, tier AS risk_tier, factors,
             credit_limit, assessed_at
      FROM customer_risk_assessments
      WHERE company_id = $1 AND is_active = true
    `, [companyId]);
    const riskMap = new Map<number, any>();
    for (const r of riskRows.rows as any[]) riskMap.set(Number(r.customer_id), r);

    const totalActiveCustomers = (customers.rows as any[]).length;
    const customersWithTasks = taskMap.size;

    const readinessResults: ReadinessResult[] = [];
    let rowsWritten = 0;

    for (const cust of customers.rows as any[]) {
      const cid = Number(cust.id);
      const task = taskMap.get(cid);
      const mem = memMap.get(cid);
      const risk = riskMap.get(cid);

      const riskAssessmentAge = risk?.assessed_at
        ? Math.round((Date.now() - new Date(risk.assessed_at).getTime()) / 86_400_000)
        : null;

      const lastTaskAt = cust.last_task_at ? new Date(cust.last_task_at) : null;
      const daysSinceLastTask = lastTaskAt
        ? Math.round((Date.now() - lastTaskAt.getTime()) / 86_400_000)
        : null;

      const sourceLastUpdatedAt = [
        task?.tasks_last_updated ? new Date(task.tasks_last_updated) : null,
        mem?.created_at ? new Date(mem.created_at) : null,
        risk?.assessed_at ? new Date(risk.assessed_at) : null,
        cust.updated_at ? new Date(cust.updated_at) : null,
      ].filter(Boolean).sort((a: any, b: any) => b - a)[0] ?? null;

      const readiness = computeCustomerReadiness({
        riskScore: risk ? Number(risk.risk_score) : null,
        sentimentTrend: mem?.sentiment_trend ?? null,
        frequentServices: (task?.frequent_services ?? mem?.frequent_services) ?? null,
        completionRate: task ? Number(task.completion_rate) : null,
        taskCount: task ? Number(task.task_count) : 0,
        riskAssessmentAge,
        satisfactionSampleCount: 0, // TODO: from recommendation_outcomes (Sprint 5D)
        memorySnapshotLastUpdated: mem?.created_at ? new Date(mem.created_at) : null,
        riskLastUpdated: risk?.assessed_at ? new Date(risk.assessed_at) : null,
        tasksLastUpdated: task?.tasks_last_updated ? new Date(task.tasks_last_updated) : null,
        totalActiveCustomers,
        customersWithOutcomes: customersWithTasks,
      });
      readinessResults.push(readiness);

      const sourceCount = [cust, task, mem, risk].filter(Boolean).length;
      const monthsInPeriod = 3;
      const avgTasksPerMonth = task ? Number(task.task_count) / monthsInPeriod : null;
      const riskFactors = risk?.factors ? (Array.isArray(risk.factors) ? risk.factors.map((f: any) => f.code ?? String(f)) : []) : null;

      await db.execute(sql`
        INSERT INTO intel_customers (
          company_id, customer_id, customer_name,
          period_start, period_end, dataset_version,
          source_count, source_last_updated_at,
          tier, industry, preferred_channel, preferred_language,
          frequent_services, typical_routes, typical_cargo_types,
          avg_tasks_per_month, task_count, last_task_at, days_since_last_task,
          completion_rate, on_track_rate, sla_breach_rate, avg_follow_up_count,
          sentiment_trend, avg_sentiment_score, positive_sentiment_pct,
          risk_score, risk_tier, credit_limit, risk_factor_codes, risk_assessment_age,
          satisfaction_sample_count,
          missing_doc_frequency,
          readiness_score, confidence_tier, readiness_flags,
          refreshed_at, is_stale
        ) VALUES (
          ${companyId}, ${cid}, ${cust.company_name ?? null},
          ${toDateStr(periodStart)}, ${toDateStr(periodEnd)}, ${INTEL_DATASET_VERSION},
          ${sourceCount}, ${sourceLastUpdatedAt},
          ${cust.tier ?? null}, ${cust.industry ?? null},
          ${cust.preferred_channel ?? null}, ${cust.preferred_language ?? null},
          ${pgArr(task?.frequent_services)},
          ${pgArr(cust.typical_routes)}, ${pgArr(cust.typical_cargo_types)},
          ${avgTasksPerMonth}, ${task ? Number(task.task_count) : 0},
          ${lastTaskAt}, ${daysSinceLastTask},
          ${task ? Number(task.completion_rate) : null},
          ${task ? Number(task.on_track_rate) : null},
          ${task ? Number(task.sla_breach_rate) : null},
          ${task ? Number(task.avg_follow_up_count) : null},
          ${mem?.sentiment_trend ?? null},
          ${task?.avg_sentiment !== null && task?.avg_sentiment !== undefined ? Number(task.avg_sentiment) : null},
          ${task?.positive_sentiment_pct !== null && task?.positive_sentiment_pct !== undefined ? Number(task.positive_sentiment_pct) : null},
          ${risk ? Number(risk.risk_score) : null},
          ${risk?.risk_tier ?? null},
          ${risk?.credit_limit ? Number(risk.credit_limit) : null},
          ${pgArr(riskFactors)}, ${riskAssessmentAge},
          ${0},
          ${task?.missing_doc_frequency !== null && task?.missing_doc_frequency !== undefined ? Number(task.missing_doc_frequency) : null},
          ${readiness.score}, ${readiness.confidenceTier}, ${pgArr(readiness.flags)},
          NOW(), false
        )
        ON CONFLICT DO NOTHING
      `);
      rowsWritten++;
    }

    const readinessScoreAvg = readinessResults.length > 0
      ? Math.round(readinessResults.reduce((s, r) => s + r.score, 0) / readinessResults.length)
      : 0;

    await completeRefreshLog(jobId, rowsWritten, 0, readinessScoreAvg, Date.now() - t0);
    logger.info({ companyId, dataset: "customers", rowsWritten, readinessScoreAvg }, "IRL customers refresh complete");
    return { rowsWritten, readinessScoreAvg, jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRefreshLog(jobId, msg, Date.now() - t0);
    logger.error({ companyId, dataset: "customers", err }, "IRL customers refresh failed");
    throw err;
  }
}

// ── Dataset 4: intel_profit ───────────────────────────────────────────────────

export async function refreshIntelProfit(
  companyId: string,
  trigger = "scheduled",
  triggeredBy = "system",
): Promise<{ rowsWritten: number; readinessScoreAvg: number; jobId: string }> {
  const { periodStart, periodEnd } = getPeriodDates();
  const { jobId } = await startRefreshLog(companyId, "profit", trigger, triggeredBy, periodStart, periodEnd);
  const t0 = Date.now();

  try {
    // Base quotation aggregation with margin computation (Supabase)
    const baseAgg = await srcQ(`
      SELECT
        COALESCE(at.category, 'unknown')       AS dim_value,
        COUNT(q.id)::int                        AS quotation_count,
        COUNT(CASE WHEN q.status = 'accepted' THEN 1 END)::int AS accepted_count,
        COUNT(CASE WHEN q.status = 'rejected' THEN 1 END)::int AS rejected_count,
        SUM(CASE WHEN q.status = 'accepted' THEN q.total_amount END)::real AS total_quoted,
        AVG(CASE WHEN q.status = 'accepted' THEN q.total_amount END)::real AS avg_quoted,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY q.total_amount) AS median_amount,
        PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY q.total_amount) AS p10_amount,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY q.total_amount) AS p90_amount,
        STDDEV(q.total_amount)::real            AS margin_std_dev,
        COUNT(CASE WHEN q.total_amount <= 0 THEN 1 END)::int AS below_floor_count,
        COUNT(at.id)::int                       AS task_count,
        MAX(q.updated_at)                       AS quotations_last_updated,
        MAX(at.updated_at)                      AS tasks_last_updated
      FROM quotations q
      LEFT JOIN ai_tasks at ON at.id = q.task_id AND at.company_id = q.company_id
      WHERE q.company_id = $1
        AND q.created_at >= $2
        AND q.created_at <= $3
      GROUP BY COALESCE(at.category, 'unknown')
    `, [companyId, periodStart, periodEnd]);

    // Service catalog for base price benchmarks (Supabase)
    const catalog = await srcQ(`
      SELECT category, base_price::real AS base_price
      FROM service_catalog
      WHERE company_id = $1 AND is_active = true
    `, [companyId]);
    const catalogMap = new Map<string, number | null>();
    for (const c of catalog.rows as any[]) {
      catalogMap.set(c.category, c.base_price ? Number(c.base_price) : null);
    }

    // Total quotation count for coverage computation
    const totalCats = (baseAgg.rows as any[]).length;
    const catsWithMinQuotes = (baseAgg.rows as any[]).filter((r) => Number(r.quotation_count) >= 5).length;

    const readinessResults: ReadinessResult[] = [];
    let rowsWritten = 0;

    // Dimensions: total + by_category
    const dimensions: Array<{ dimension: string; dimValue: string | null; rows: any[] }> = [
      { dimension: "total", dimValue: null, rows: baseAgg.rows as any[] },
      ...((baseAgg.rows as any[]).map((r) => ({
        dimension: "by_category",
        dimValue: String(r.dim_value),
        rows: [r],
      }))),
    ];

    for (const { dimension, dimValue, rows } of dimensions) {
      const totalQuoted = rows.reduce((s, r) => s + Number(r.total_quoted ?? 0), 0);
      const totalTasks = rows.reduce((s, r) => s + Number(r.task_count ?? 0), 0);
      const totalQuotations = rows.reduce((s, r) => s + Number(r.quotation_count ?? 0), 0);
      const acceptedCount = rows.reduce((s, r) => s + Number(r.accepted_count ?? 0), 0);
      const belowFloor = rows.reduce((s, r) => s + Number(r.below_floor_count ?? 0), 0);
      const winRate = totalQuotations > 0 ? acceptedCount / totalQuotations : null;
      const avgMarginPct = totalQuoted > 0 ? 0.15 : null; // placeholder until purchasing_signals
      const catBasePrice = dimValue ? catalogMap.get(dimValue) ?? null : null;
      const avgRevPerTask = totalTasks > 0 ? totalQuoted / totalTasks : null;
      const quotationsLastUpdated = rows
        .map((r) => r.quotations_last_updated ? new Date(r.quotations_last_updated) : null)
        .filter(Boolean)
        .sort((a: any, b: any) => b - a)[0] ?? null;
      const tasksLastUpdated = rows
        .map((r) => r.tasks_last_updated ? new Date(r.tasks_last_updated) : null)
        .filter(Boolean)
        .sort((a: any, b: any) => b - a)[0] ?? null;

      const readiness = computeProfitReadiness({
        signalCount: 0, // TODO: from purchasing_signals (Sprint 5D)
        taskCount: totalTasks,
        quotationCount: totalQuotations,
        totalActualRevenue: totalQuoted,
        avgMarginPct: avgMarginPct,
        belowFloorPct: totalQuotations > 0 ? belowFloor / totalQuotations : null,
        quotationsLastUpdated,
        tasksLastUpdated,
        dimension,
        dimensionCoverage: totalCats > 0 ? catsWithMinQuotes / totalCats : 0,
      });
      readinessResults.push(readiness);

      const sourceLastUpdatedAt = [quotationsLastUpdated, tasksLastUpdated]
        .filter(Boolean)
        .sort((a: any, b: any) => b - a)[0] ?? null;

      await db.execute(sql`
        INSERT INTO intel_profit (
          company_id, dimension, dimension_value,
          period_start, period_end, dataset_version,
          source_count, source_last_updated_at,
          signal_count, task_count, quotation_count, quotation_accepted_count, quotation_win_rate,
          total_quoted_amount, avg_revenue_per_task,
          below_floor_count, below_floor_pct, below_margin_floor_count,
          readiness_score, confidence_tier, readiness_flags,
          refreshed_at, is_stale
        ) VALUES (
          ${companyId}, ${dimension}, ${dimValue},
          ${toDateStr(periodStart)}, ${toDateStr(periodEnd)}, ${INTEL_DATASET_VERSION},
          ${2}, ${sourceLastUpdatedAt},
          ${0}, ${totalTasks}, ${totalQuotations}, ${acceptedCount}, ${winRate},
          ${totalQuoted}, ${avgRevPerTask},
          ${belowFloor}, ${winRate !== null ? belowFloor / Math.max(1, totalQuotations) : null}, ${belowFloor},
          ${readiness.score}, ${readiness.confidenceTier}, ${pgArr(readiness.flags)},
          NOW(), false
        )
        ON CONFLICT DO NOTHING
      `);
      rowsWritten++;
    }

    const readinessScoreAvg = readinessResults.length > 0
      ? Math.round(readinessResults.reduce((s, r) => s + r.score, 0) / readinessResults.length)
      : 0;

    await completeRefreshLog(jobId, rowsWritten, 0, readinessScoreAvg, Date.now() - t0);
    logger.info({ companyId, dataset: "profit", rowsWritten, readinessScoreAvg }, "IRL profit refresh complete");
    return { rowsWritten, readinessScoreAvg, jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRefreshLog(jobId, msg, Date.now() - t0);
    logger.error({ companyId, dataset: "profit", err }, "IRL profit refresh failed");
    throw err;
  }
}

// ── Dataset 5: intel_quotations ───────────────────────────────────────────────

export async function refreshIntelQuotations(
  companyId: string,
  trigger = "scheduled",
  triggeredBy = "system",
): Promise<{ rowsWritten: number; readinessScoreAvg: number; jobId: string }> {
  const { periodStart, periodEnd } = getPeriodDates();
  const { jobId } = await startRefreshLog(companyId, "quotations", trigger, triggeredBy, periodStart, periodEnd);
  const t0 = Date.now();

  try {
    // Quotation aggregation per service category (Supabase)
    const quotAgg = await srcQ(`
      SELECT
        COALESCE(at.category, 'unknown')                                              AS service_category,
        COUNT(q.id)::int                                                               AS quotations_issued,
        COUNT(CASE WHEN q.status IN ('sent','accepted','rejected') THEN 1 END)::int   AS quotations_sent,
        COUNT(CASE WHEN q.status = 'accepted' THEN 1 END)::int                        AS quotations_accepted,
        COUNT(CASE WHEN q.status = 'rejected' THEN 1 END)::int                        AS quotations_rejected,
        COUNT(CASE WHEN q.ai_generated IS NOT NULL THEN 1 END)::int                   AS ai_generated_count,
        COUNT(CASE WHEN q.ai_generated IS NULL THEN 1 END)::int                       AS manual_count,
        AVG(q.total_amount)::real                                                      AS avg_total_amount,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY q.total_amount)                   AS median_total_amount,
        PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY q.total_amount)                   AS p10_total_amount,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY q.total_amount)                   AS p90_total_amount,
        AVG(
          CASE WHEN q.sent_at IS NOT NULL
               THEN EXTRACT(EPOCH FROM (q.sent_at - at.created_at)) / 3600.0 END
        )::real                                                                        AS avg_hours_to_send,
        AVG(
          CASE WHEN q.responded_at IS NOT NULL AND q.sent_at IS NOT NULL
               THEN EXTRACT(EPOCH FROM (q.responded_at - q.sent_at)) / 3600.0 END
        )::real                                                                        AS avg_hours_to_respond,
        COUNT(CASE WHEN q.ai_generated IS NOT NULL AND q.status = 'accepted' THEN 1 END)::float /
          NULLIF(COUNT(CASE WHEN q.ai_generated IS NOT NULL
                             AND q.status IN ('accepted','rejected') THEN 1 END), 0)   AS ai_win_rate,
        COUNT(CASE WHEN q.ai_generated IS NULL AND q.status = 'accepted' THEN 1 END)::float /
          NULLIF(COUNT(CASE WHEN q.ai_generated IS NULL
                             AND q.status IN ('accepted','rejected') THEN 1 END), 0)   AS manual_win_rate,
        AVG(CASE WHEN q.ai_generated IS NOT NULL THEN q.total_amount END)::real        AS ai_avg_amount,
        AVG(CASE WHEN q.ai_generated IS NULL THEN q.total_amount END)::real            AS manual_avg_amount,
        AVG(CASE WHEN q.ai_generated IS NOT NULL AND q.sent_at IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (q.sent_at - at.created_at)) / 3600.0 END
        )::real                                                                        AS ai_avg_hours_to_send,
        AVG(CASE WHEN q.ai_generated IS NULL AND q.sent_at IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (q.sent_at - at.created_at)) / 3600.0 END
        )::real                                                                        AS manual_avg_hours_to_send,
        MAX(q.updated_at)                                                              AS quotations_last_updated
      FROM quotations q
      LEFT JOIN ai_tasks at ON at.id = q.task_id AND at.company_id = q.company_id
      WHERE q.company_id = $1
        AND q.created_at >= $2
        AND q.created_at <= $3
      GROUP BY COALESCE(at.category, 'unknown')
    `, [companyId, periodStart, periodEnd]);

    // Service catalog for base price (Supabase)
    const catalog = await srcQ(`
      SELECT category, base_price::real AS base_price
      FROM service_catalog WHERE company_id = $1 AND is_active = true
    `, [companyId]);
    const catalogMap = new Map<string, number | null>();
    for (const c of catalog.rows as any[]) catalogMap.set(c.category, c.base_price ? Number(c.base_price) : null);

    const totalCategories = (quotAgg.rows as any[]).length;
    const catsWithMinQuotes = (quotAgg.rows as any[]).filter((r) => Number(r.quotations_issued) >= 20).length;

    const readinessResults: ReadinessResult[] = [];
    let rowsWritten = 0;

    for (const row of quotAgg.rows as any[]) {
      const issued = Number(row.quotations_issued ?? 0);
      const sent = Number(row.quotations_sent ?? 0);
      const accepted = Number(row.quotations_accepted ?? 0);
      const winRate = sent > 0 ? accepted / sent : null;
      const catBase = catalogMap.get(String(row.service_category)) ?? null;
      const avgPremium = catBase && row.avg_total_amount
        ? (Number(row.avg_total_amount) - catBase) / catBase
        : null;
      const avgCycleDays = row.avg_hours_to_send && row.avg_hours_to_respond
        ? (Number(row.avg_hours_to_send) + Number(row.avg_hours_to_respond)) / 24
        : null;
      const quotationsLastUpdated = row.quotations_last_updated ? new Date(row.quotations_last_updated) : null;

      const readiness = computeQuotationReadiness({
        quotationsIssued: issued,
        winRate,
        avgTotalAmount: row.avg_total_amount ? Number(row.avg_total_amount) : null,
        avgHoursToSend: row.avg_hours_to_send ? Number(row.avg_hours_to_send) : null,
        quotationsLastUpdated,
        totalCategories,
        categoriesWithMinQuotes: catsWithMinQuotes,
      });
      readinessResults.push(readiness);

      await db.execute(sql`
        INSERT INTO intel_quotations (
          company_id, service_category,
          period_start, period_end, dataset_version,
          source_count, source_last_updated_at,
          quotations_issued, quotations_sent, quotations_accepted, quotations_rejected,
          win_rate, ai_generated_count, manual_count,
          avg_total_amount, median_total_amount, p10_total_amount, p90_total_amount,
          catalog_base_price, avg_premium_over_catalog,
          avg_hours_to_send, avg_hours_to_respond, avg_total_cycle_days,
          ai_win_rate, manual_win_rate, ai_avg_amount, manual_avg_amount,
          ai_avg_hours_to_send, manual_avg_hours_to_send,
          readiness_score, confidence_tier, readiness_flags,
          refreshed_at, is_stale
        ) VALUES (
          ${companyId}, ${String(row.service_category)},
          ${toDateStr(periodStart)}, ${toDateStr(periodEnd)}, ${INTEL_DATASET_VERSION},
          ${1}, ${quotationsLastUpdated},
          ${issued}, ${sent}, ${accepted}, ${Number(row.quotations_rejected ?? 0)},
          ${winRate}, ${Number(row.ai_generated_count ?? 0)}, ${Number(row.manual_count ?? 0)},
          ${row.avg_total_amount ? Number(row.avg_total_amount) : null},
          ${row.median_total_amount ? Number(row.median_total_amount) : null},
          ${row.p10_total_amount ? Number(row.p10_total_amount) : null},
          ${row.p90_total_amount ? Number(row.p90_total_amount) : null},
          ${catBase}, ${avgPremium},
          ${row.avg_hours_to_send ? Number(row.avg_hours_to_send) : null},
          ${row.avg_hours_to_respond ? Number(row.avg_hours_to_respond) : null},
          ${avgCycleDays},
          ${row.ai_win_rate ? Number(row.ai_win_rate) : null},
          ${row.manual_win_rate ? Number(row.manual_win_rate) : null},
          ${row.ai_avg_amount ? Number(row.ai_avg_amount) : null},
          ${row.manual_avg_amount ? Number(row.manual_avg_amount) : null},
          ${row.ai_avg_hours_to_send ? Number(row.ai_avg_hours_to_send) : null},
          ${row.manual_avg_hours_to_send ? Number(row.manual_avg_hours_to_send) : null},
          ${readiness.score}, ${readiness.confidenceTier}, ${pgArr(readiness.flags)},
          NOW(), false
        )
        ON CONFLICT DO NOTHING
      `);
      rowsWritten++;
    }

    const readinessScoreAvg = readinessResults.length > 0
      ? Math.round(readinessResults.reduce((s, r) => s + r.score, 0) / readinessResults.length)
      : 0;

    await completeRefreshLog(jobId, rowsWritten, 0, readinessScoreAvg, Date.now() - t0);
    logger.info({ companyId, dataset: "quotations", rowsWritten, readinessScoreAvg }, "IRL quotations refresh complete");
    return { rowsWritten, readinessScoreAvg, jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failRefreshLog(jobId, msg, Date.now() - t0);
    logger.error({ companyId, dataset: "quotations", err }, "IRL quotations refresh failed");
    throw err;
  }
}

// ── Readiness scores summary ──────────────────────────────────────────────────
// Reads from intel_* tables (Supabase via drizzle db) — same DB, no separate connection needed.

export async function refreshReadinessScores(
  companyId: string,
): Promise<void> {
  const { periodStart, periodEnd } = getPeriodDates();

  const datasets: Array<{ name: IntelDatasetName; table: string }> = [
    { name: "routes", table: "intel_routes" },
    { name: "vendors", table: "intel_vendors" },
    { name: "customers", table: "intel_customers" },
    { name: "profit", table: "intel_profit" },
    { name: "quotations", table: "intel_quotations" },
  ];

  for (const { name, table } of datasets) {
    const agg = await db.execute(sql`
      SELECT
        COUNT(*)::int                                                      AS row_count,
        AVG(readiness_score)::real                                         AS avg_score,
        COUNT(CASE WHEN readiness_score >= 80 THEN 1 END)::int             AS above_80,
        COUNT(CASE WHEN readiness_score >= 60 THEN 1 END)::int             AS above_60,
        COUNT(CASE WHEN readiness_score < 40 THEN 1 END)::int              AS below_40
      FROM ${sql.raw(table)}
      WHERE company_id = ${companyId}
        AND period_start = ${toDateStr(periodStart)}
    `);

    const row = (agg.rows as any[])[0];
    if (!row || Number(row.row_count) === 0) continue;

    const overallScore = Math.round(Number(row.avg_score ?? 0));

    await db.execute(sql`
      INSERT INTO intel_readiness_scores (
        company_id, dataset_name, period_start, period_end, dataset_version,
        overall_readiness_score, overall_confidence_tier,
        row_count, rows_above_80, rows_above_60, rows_below_40,
        computed_at
      ) VALUES (
        ${companyId}, ${name}, ${toDateStr(periodStart)}, ${toDateStr(periodEnd)}, ${INTEL_DATASET_VERSION},
        ${overallScore}, ${overallScore >= 80 ? "high" : overallScore >= 60 ? "medium" : overallScore >= 40 ? "low" : "insufficient"},
        ${Number(row.row_count)}, ${Number(row.above_80 ?? 0)},
        ${Number(row.above_60 ?? 0)}, ${Number(row.below_40 ?? 0)},
        NOW()
      )
      ON CONFLICT DO NOTHING
    `);
  }
}

// ── Full refresh orchestrator ─────────────────────────────────────────────────

export type RefreshResult = {
  dataset: IntelDatasetName;
  rowsWritten: number;
  readinessScoreAvg: number;
  durationMs: number;
  error?: string;
};

export async function refreshAllDatasets(
  companyId: string,
  trigger = "scheduled",
  triggeredBy = "system",
): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];

  const runners: Array<{ name: IntelDatasetName; fn: () => Promise<{ rowsWritten: number; readinessScoreAvg: number; jobId: string }> }> = [
    { name: "vendors",    fn: () => refreshIntelVendors(companyId, trigger, triggeredBy) },
    { name: "customers",  fn: () => refreshIntelCustomers(companyId, trigger, triggeredBy) },
    { name: "routes",     fn: () => refreshIntelRoutes(companyId, trigger, triggeredBy) },
    { name: "profit",     fn: () => refreshIntelProfit(companyId, trigger, triggeredBy) },
    { name: "quotations", fn: () => refreshIntelQuotations(companyId, trigger, triggeredBy) },
  ];

  for (const { name, fn } of runners) {
    const t0 = Date.now();
    try {
      const { rowsWritten, readinessScoreAvg } = await fn();
      results.push({ dataset: name, rowsWritten, readinessScoreAvg, durationMs: Date.now() - t0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ dataset: name, rowsWritten: 0, readinessScoreAvg: 0, durationMs: Date.now() - t0, error: msg });
      logger.error({ companyId, dataset: name, err }, "IRL dataset refresh failed");
    }
  }

  // Write aggregate readiness scores after all datasets complete
  try {
    await refreshReadinessScores(companyId);
  } catch (err) {
    logger.error({ companyId, err }, "IRL readiness scores summary failed");
  }

  logger.info({ companyId, trigger, results }, "IRL full refresh complete");
  return results;
}
