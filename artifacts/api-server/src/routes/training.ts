/**
 * Sprint 4B — /api/training/* routes
 * Correction Queue · Training Dataset · Accuracy · Prompt Versions ·
 * Experiments · Prediction Logs · Performance Metrics
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, gte, lte, sql, count, isNull, isNotNull } from "drizzle-orm";
import { createHash } from "crypto";
import {
  db,
  correctionQueueTable, insertCorrectionQueueSchema,
  correctionSessionsTable,
  trainingDatasetTable,
  datasetExportsTable,
  accuracySnapshotsTable,
  promptVersionsTable, insertPromptVersionSchema,
  promptTestResultsTable,
  aiExperimentsTable, insertAiExperimentSchema,
  experimentObservationsTable,
  experimentResultsTable,
  predictionLogsTable,
  performanceDailyTable,
  performanceByIntentTable,
  aiTasksTable,
  auditLogsTable,
} from "@workspace/db";
import {
  requireAuth,
  requireRole,
  getCompanyId,
  getCompanyIdForWrite,
} from "../middleware/auth";
import { logger } from "../lib/logger";
import { openai } from "../lib/openai";

const router: IRouter = Router();

// ── Express 5 params helper ────────────────────────────────────────────────────
// req.params values may be string | string[] in @types/express v5
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// ══════════════════════════════════════════════════════════════════════════════
// CORRECTION QUEUE
// ══════════════════════════════════════════════════════════════════════════════

// GET /training/corrections
router.get("/training/corrections", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const { field, status, corrected_by, limit = "50", offset = "0" } = req.query as Record<string, string>;

    let query = db.select().from(correctionQueueTable)
      .where(eq(correctionQueueTable.companyId, companyId))
      .$dynamic();

    const rows = await db.select().from(correctionQueueTable)
      .where(
        and(
          eq(correctionQueueTable.companyId, companyId),
          field ? eq(correctionQueueTable.fieldCorrected, field) : undefined,
          status ? eq(correctionQueueTable.status, status) : undefined,
          corrected_by ? eq(correctionQueueTable.correctedBy, corrected_by) : undefined,
        ),
      )
      .orderBy(desc(correctionQueueTable.createdAt))
      .limit(parseInt(limit, 10))
      .offset(parseInt(offset, 10));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /training/corrections failed");
    res.status(500).json({ error: "Gagal memuat correction queue" });
  }
});

// GET /training/corrections/pending-count
router.get("/training/corrections/pending-count", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const [row] = await db.select({ cnt: count() }).from(correctionQueueTable)
      .where(and(eq(correctionQueueTable.companyId, companyId), eq(correctionQueueTable.status, "pending")));
    res.json({ count: row?.cnt ?? 0 });
  } catch (err) {
    res.status(500).json({ error: "Gagal menghitung pending" });
  }
});

// GET /training/corrections/task/:taskId
router.get("/training/corrections/task/:taskId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = parseInt(firstParam(req.params["taskId"]) ?? "", 10);
    const companyId = getCompanyId(req) ?? "default";
    const rows = await db.select().from(correctionQueueTable)
      .where(and(eq(correctionQueueTable.taskId, taskId), eq(correctionQueueTable.companyId, companyId)))
      .orderBy(desc(correctionQueueTable.createdAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /training/corrections/task/:taskId failed");
    res.status(500).json({ error: "Gagal memuat koreksi task" });
  }
});

// GET /training/corrections/:id
router.get("/training/corrections/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const [row] = await db.select().from(correctionQueueTable).where(eq(correctionQueueTable.id, id));
    if (!row) { res.status(404).json({ error: "Koreksi tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat koreksi" });
  }
});

// POST /training/corrections  (supervisor+)
router.post("/training/corrections", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const user = (req as Request & { user?: { id: string; email: string; role: string } }).user;
    const role = user?.role ?? "supervisor";

    // RBAC: supervisor can only see their own corrections; company_admin+ can post for others
    const correctedBy = user?.email ?? user?.id ?? "unknown";

    const parsed = insertCorrectionQueueSchema.safeParse({
      ...req.body,
      companyId,
      correctedBy,
    });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

    // Fetch task snapshot
    const task = await db.select().from(aiTasksTable).where(eq(aiTasksTable.id, parsed.data.taskId)).limit(1);
    const taskSnapshot = task[0] ?? null;

    const [row] = await db.insert(correctionQueueTable).values({
      ...parsed.data,
      taskSnapshot: taskSnapshot as unknown as Record<string, unknown>,
    }).returning();

    // Audit
    await db.insert(auditLogsTable).values({
      companyId,
      action: "correction.created",
      module: "training",
      entityType: "correction_queue",
      entityId: row.id,
      after: JSON.stringify({ taskId: row.taskId, fieldCorrected: row.fieldCorrected, correctedBy }),
    }).catch(() => {});

    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /training/corrections failed");
    res.status(500).json({ error: "Gagal menyimpan koreksi" });
  }
});

// PATCH /training/corrections/:id/archive  (company_admin+)
router.patch("/training/corrections/:id/archive", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const [row] = await db.update(correctionQueueTable)
      .set({ status: "archived" })
      .where(eq(correctionQueueTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal archive koreksi" });
  }
});

// POST /training/corrections/bulk-export  (company_admin+)
// Exports pending corrections → creates training_dataset records
router.post("/training/corrections/bulk-export", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const user = (req as Request & { user?: { id: string; email: string } }).user;

    // Get pending corrections
    const pending = await db.select().from(correctionQueueTable)
      .where(and(eq(correctionQueueTable.companyId, companyId), eq(correctionQueueTable.status, "pending")))
      .limit(500);

    if (pending.length === 0) { res.json({ exported: 0 }); return; }

    // Fetch task messages for each correction
    const taskIds = [...new Set(pending.map((c) => c.taskId))];
    const tasks = await db.select().from(aiTasksTable)
      .where(sql`${aiTasksTable.id} = ANY(ARRAY[${sql.join(taskIds.map(id => sql`${id}`), sql`, `)}])`);
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    // Create dataset records
    const datasetRecords = pending.map((c) => {
      const task = taskMap.get(c.taskId);
      return {
        companyId,
        correctionId: c.id,
        sourceTaskId: c.taskId,
        originalMessage: (task as { customerMessage?: string; aiSummary?: string } | undefined)?.customerMessage ?? (task as { customerMessage?: string; aiSummary?: string } | undefined)?.aiSummary ?? "",
        predictedIntent: (c.taskSnapshot as { aiIntent?: string } | null)?.aiIntent ?? null,
        predictedRouting: (c.taskSnapshot as { assignedToId?: string } | null)?.assignedToId?.toString() ?? null,
        predictedPriority: (c.taskSnapshot as { priority?: string } | null)?.priority ?? null,
        fieldCorrected: c.fieldCorrected,
        correctValue: c.correctedValue,
        correctedBy: c.correctedBy,
        correctedAt: c.createdAt,
        splitTag: "train",
        isActive: true,
      };
    });

    await db.insert(trainingDatasetTable).values(datasetRecords);

    // Mark corrections as exported
    await db.update(correctionQueueTable)
      .set({ status: "exported_to_dataset", exportedAt: new Date() })
      .where(sql`${correctionQueueTable.id} = ANY(ARRAY[${sql.join(pending.map(c => sql`${c.id}`), sql`, `)}])`);

    await db.insert(auditLogsTable).values({
      companyId,
      action: "correction.bulk_exported",
      module: "training",
      entityType: "training_dataset",
      after: JSON.stringify({ count: pending.length, exportedBy: user?.email }),
    }).catch(() => {});

    res.json({ exported: pending.length });
  } catch (err) {
    logger.error({ err }, "POST /training/corrections/bulk-export failed");
    res.status(500).json({ error: "Gagal export koreksi" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// TRAINING DATASET
// ══════════════════════════════════════════════════════════════════════════════

// GET /training/dataset/exports
router.get("/training/dataset/exports", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const rows = await db.select().from(datasetExportsTable)
      .where(eq(datasetExportsTable.companyId, companyId))
      .orderBy(desc(datasetExportsTable.createdAt))
      .limit(20);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat exports" });
  }
});

// GET /training/dataset/stats
router.get("/training/dataset/stats", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const [totals] = await db.select({ total: count() }).from(trainingDatasetTable)
      .where(and(eq(trainingDatasetTable.companyId, companyId), eq(trainingDatasetTable.isActive, true)));
    const byField = await db.select({ field: trainingDatasetTable.fieldCorrected, cnt: count() })
      .from(trainingDatasetTable)
      .where(and(eq(trainingDatasetTable.companyId, companyId), eq(trainingDatasetTable.isActive, true)))
      .groupBy(trainingDatasetTable.fieldCorrected);
    const bySplit = await db.select({ split: trainingDatasetTable.splitTag, cnt: count() })
      .from(trainingDatasetTable)
      .where(and(eq(trainingDatasetTable.companyId, companyId), eq(trainingDatasetTable.isActive, true)))
      .groupBy(trainingDatasetTable.splitTag);
    res.json({ total: totals?.total ?? 0, byField, bySplit });
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat stats dataset" });
  }
});

// GET /training/dataset
router.get("/training/dataset", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const { field, split_tag, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const rows = await db.select().from(trainingDatasetTable)
      .where(
        and(
          eq(trainingDatasetTable.companyId, companyId),
          eq(trainingDatasetTable.isActive, true),
          field ? eq(trainingDatasetTable.fieldCorrected, field) : undefined,
          split_tag ? eq(trainingDatasetTable.splitTag, split_tag) : undefined,
        ),
      )
      .orderBy(desc(trainingDatasetTable.createdAt))
      .limit(parseInt(limit, 10))
      .offset(parseInt(offset, 10));

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat dataset" });
  }
});

// GET /training/dataset/:id
router.get("/training/dataset/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const [row] = await db.select().from(trainingDatasetTable).where(eq(trainingDatasetTable.id, id));
    if (!row) { res.status(404).json({ error: "Record tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat record" });
  }
});

// PATCH /training/dataset/:id/split  (company_admin+)
router.patch("/training/dataset/:id/split", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const { splitTag } = req.body as { splitTag: string };
    if (!["train", "validation", "test"].includes(splitTag)) {
      res.status(400).json({ error: "splitTag harus: train, validation, atau test" }); return;
    }
    const [row] = await db.update(trainingDatasetTable).set({ splitTag }).where(eq(trainingDatasetTable.id, id)).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal update split tag" });
  }
});

// PATCH /training/dataset/:id/exclude  (company_admin+)
router.patch("/training/dataset/:id/exclude", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const [row] = await db.update(trainingDatasetTable).set({ isActive: false }).where(eq(trainingDatasetTable.id, id)).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal exclude record" });
  }
});

// POST /training/dataset/export  (super_admin only) — returns JSONL as downloadable file
router.post("/training/dataset/export", requireAuth, requireRole("super_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const user = (req as Request & { user?: { id: string; email: string } }).user;
    const { format = "jsonl", field, split_tag } = req.body as { format?: string; field?: string; split_tag?: string };

    const rows = await db.select().from(trainingDatasetTable)
      .where(
        and(
          eq(trainingDatasetTable.companyId, companyId),
          eq(trainingDatasetTable.isActive, true),
          field ? eq(trainingDatasetTable.fieldCorrected, field) : undefined,
          split_tag ? eq(trainingDatasetTable.splitTag, split_tag) : undefined,
        ),
      )
      .orderBy(trainingDatasetTable.createdAt);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    let body: string;
    let contentType: string;
    let filename: string;

    if (format === "csv") {
      const header = "id,sourceTaskId,originalMessage,fieldCorrected,predictedIntent,correctValue,correctedBy,correctedAt,splitTag";
      const csvRows = rows.map((r) =>
        [r.id, r.sourceTaskId, `"${(r.originalMessage ?? "").replace(/"/g, '""')}"`,
          r.fieldCorrected, r.predictedIntent, `"${(r.correctValue ?? "").replace(/"/g, '""')}"`,
          r.correctedBy, r.correctedAt?.toISOString(), r.splitTag].join(","),
      );
      body = [header, ...csvRows].join("\n");
      contentType = "text/csv";
      filename = `training_export_${timestamp}.csv`;
    } else {
      body = rows.map((r) => JSON.stringify({
        id: r.id,
        sourceTaskId: r.sourceTaskId,
        originalMessage: r.originalMessage,
        fieldCorrected: r.fieldCorrected,
        predictedIntent: r.predictedIntent,
        predictedRouting: r.predictedRouting,
        predictedPriority: r.predictedPriority,
        correctValue: r.correctValue,
        correctedBy: r.correctedBy,
        correctedAt: r.correctedAt,
        splitTag: r.splitTag,
      })).join("\n");
      contentType = "application/x-ndjson";
      filename = `training_export_${timestamp}.jsonl`;
    }

    // Log the export
    await db.insert(datasetExportsTable).values({
      companyId,
      exportedBy: user?.email ?? "unknown",
      recordCount: rows.length,
      format,
      filterParams: { field, split_tag } as unknown as Record<string, unknown>,
    }).catch(() => {});

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(body);
  } catch (err) {
    logger.error({ err }, "POST /training/dataset/export failed");
    res.status(500).json({ error: "Gagal export dataset" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ACCURACY SNAPSHOTS
// ══════════════════════════════════════════════════════════════════════════════

// GET /training/accuracy/summary — compute on-the-fly from prediction_logs + corrections
router.get("/training/accuracy/summary", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const days = parseInt((req.query.days as string) ?? "30", 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get latest accuracy snapshot if exists
    const [latest] = await db.select().from(accuracySnapshotsTable)
      .where(eq(accuracySnapshotsTable.companyId, companyId))
      .orderBy(desc(accuracySnapshotsTable.snapshotAt))
      .limit(1);

    // Also compute live from prediction_logs
    const [stats] = await db.select({
      total: count(),
      fallbacks: sql<number>`COUNT(*) FILTER (WHERE ${predictionLogsTable.isFallback} = true)`,
      lowConf: sql<number>`COUNT(*) FILTER (WHERE ${predictionLogsTable.predictedConfidence} = 'low')`,
      corrected: sql<number>`COUNT(*) FILTER (WHERE ${predictionLogsTable.wasCorrected} = true)`,
    }).from(predictionLogsTable)
      .where(and(
        eq(predictionLogsTable.companyId, companyId),
        gte(predictionLogsTable.predictedAt, since),
      ));

    const total = Number(stats?.total ?? 0);
    const fallbacks = Number(stats?.fallbacks ?? 0);
    const lowConf = Number(stats?.lowConf ?? 0);
    const corrected = Number(stats?.corrected ?? 0);

    const pct = (n: number, d: number) => d > 0 ? parseFloat(((n / d) * 100).toFixed(2)) : null;

    // Per-field correction breakdown
    const corrections = await db.select({
      field: correctionQueueTable.fieldCorrected,
      cnt: count(),
    }).from(correctionQueueTable)
      .where(and(
        eq(correctionQueueTable.companyId, companyId),
        gte(correctionQueueTable.createdAt, since),
      ))
      .groupBy(correctionQueueTable.fieldCorrected);

    const byField = Object.fromEntries(corrections.map((c) => [c.field, Number(c.cnt)]));

    res.json({
      period: { days, since },
      totalPredictions: total,
      totalCorrections: corrected,
      intentAccuracy: pct(total - (byField["intent"] ?? 0), total),
      routingAccuracy: pct(total - (byField["routing_role"] ?? 0), total),
      priorityAccuracy: pct(total - (byField["priority"] ?? 0), total),
      approvalAccuracy: pct(total - (byField["approval_required"] ?? 0), total),
      slaAccuracy: pct(total - (byField["sla_hours"] ?? 0), total),
      fallbackRate: pct(fallbacks, total),
      lowConfidenceRate: pct(lowConf, total),
      correctionRate: pct(corrected, total),
      correctionsByField: byField,
      latestSnapshot: latest ?? null,
    });
  } catch (err) {
    logger.error({ err }, "GET /training/accuracy/summary failed");
    res.status(500).json({ error: "Gagal memuat akurasi" });
  }
});

// GET /training/accuracy/history
router.get("/training/accuracy/history", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const rows = await db.select().from(accuracySnapshotsTable)
      .where(eq(accuracySnapshotsTable.companyId, companyId))
      .orderBy(desc(accuracySnapshotsTable.snapshotAt))
      .limit(90);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat riwayat akurasi" });
  }
});

// POST /training/accuracy/snapshot  (super_admin only)
router.post("/training/accuracy/snapshot", requireAuth, requireRole("super_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const { days = 30 } = req.body as { days?: number };
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000);

    // Compute from prediction_logs
    const [stats] = await db.select({
      total: count(),
      fallbacks: sql<number>`COUNT(*) FILTER (WHERE ${predictionLogsTable.isFallback} = true)`,
      lowConf: sql<number>`COUNT(*) FILTER (WHERE ${predictionLogsTable.predictedConfidence} = 'low')`,
      corrected: sql<number>`COUNT(*) FILTER (WHERE ${predictionLogsTable.wasCorrected} = true)`,
    }).from(predictionLogsTable)
      .where(and(
        eq(predictionLogsTable.companyId, companyId),
        gte(predictionLogsTable.predictedAt, periodStart),
        lte(predictionLogsTable.predictedAt, periodEnd),
      ));

    const total = Number(stats?.total ?? 0);
    const pct = (n: number, d: number) => d > 0 ? ((n / d) * 100).toFixed(2) : "0.00";

    const corrections = await db.select({ field: correctionQueueTable.fieldCorrected, cnt: count() })
      .from(correctionQueueTable)
      .where(and(eq(correctionQueueTable.companyId, companyId), gte(correctionQueueTable.createdAt, periodStart)))
      .groupBy(correctionQueueTable.fieldCorrected);
    const byField = Object.fromEntries(corrections.map((c) => [c.field, Number(c.cnt)]));

    const [row] = await db.insert(accuracySnapshotsTable).values({
      companyId,
      periodStart,
      periodEnd,
      intentAccuracy: pct(total - (byField["intent"] ?? 0), total),
      routingAccuracy: pct(total - (byField["routing_role"] ?? 0), total),
      priorityAccuracy: pct(total - (byField["priority"] ?? 0), total),
      approvalAccuracy: pct(total - (byField["approval_required"] ?? 0), total),
      fallbackRate: pct(Number(stats?.fallbacks ?? 0), total),
      lowConfidenceRate: pct(Number(stats?.lowConf ?? 0), total),
      correctionRate: pct(Number(stats?.corrected ?? 0), total),
      totalTasksProcessed: total,
      totalCorrections: Number(stats?.corrected ?? 0),
      intentBreakdown: byField as unknown as Record<string, unknown>,
    }).returning();

    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /training/accuracy/snapshot failed");
    res.status(500).json({ error: "Gagal membuat snapshot akurasi" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PROMPT VERSIONS
// ══════════════════════════════════════════════════════════════════════════════

// GET /training/prompt-versions/active  (must come before /:id)
router.get("/training/prompt-versions/active", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const [row] = await db.select().from(promptVersionsTable)
      .where(and(eq(promptVersionsTable.companyId, companyId), eq(promptVersionsTable.status, "active")))
      .limit(1);
    res.json(row ?? null);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat active prompt" });
  }
});

// GET /training/prompt-versions
router.get("/training/prompt-versions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const { status } = req.query as { status?: string };
    const rows = await db.select().from(promptVersionsTable)
      .where(and(
        eq(promptVersionsTable.companyId, companyId),
        status ? eq(promptVersionsTable.status, status) : undefined,
      ))
      .orderBy(desc(promptVersionsTable.createdAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat prompt versions" });
  }
});

// POST /training/prompt-versions  (company_admin+)
router.post("/training/prompt-versions", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const user = (req as Request & { user?: { email: string } }).user;
    const promptHash = createHash("sha256").update(req.body.systemPrompt ?? "").digest("hex");

    const parsed = insertPromptVersionSchema.safeParse({
      ...req.body,
      companyId,
      status: "draft",
      promptHash,
      createdBy: user?.email ?? "unknown",
    });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

    const [row] = await db.insert(promptVersionsTable).values(parsed.data).returning();

    await db.insert(auditLogsTable).values({
      companyId, action: "prompt.created", module: "training",
      entityType: "prompt_versions", entityId: row.id,
      after: JSON.stringify({ label: row.versionLabel, status: "draft" }),
    }).catch(() => {});

    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /training/prompt-versions failed");
    res.status(500).json({ error: "Gagal membuat prompt version" });
  }
});

// GET /training/prompt-versions/:id
router.get("/training/prompt-versions/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const [row] = await db.select().from(promptVersionsTable).where(eq(promptVersionsTable.id, id));
    if (!row) { res.status(404).json({ error: "Prompt version tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat prompt version" });
  }
});

// PATCH /training/prompt-versions/:id  (company_admin+, draft only)
router.patch("/training/prompt-versions/:id", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const [existing] = await db.select().from(promptVersionsTable).where(eq(promptVersionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Tidak ditemukan" }); return; }
    if (existing.status !== "draft") { res.status(400).json({ error: "Hanya draft yang bisa diedit" }); return; }

    const promptHash = req.body.systemPrompt
      ? createHash("sha256").update(req.body.systemPrompt as string).digest("hex")
      : existing.promptHash;

    const [row] = await db.update(promptVersionsTable)
      .set({ ...req.body, promptHash, updatedAt: new Date() })
      .where(eq(promptVersionsTable.id, id))
      .returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal update prompt version" });
  }
});

// POST /training/prompt-versions/:id/promote  (company_admin for draft→testing; super_admin for testing→active)
router.post("/training/prompt-versions/:id/promote", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const user = (req as Request & { user?: { email: string; role: string } }).user;
    const role = user?.role ?? "supervisor";
    const companyId = getCompanyIdForWrite(req);

    const [existing] = await db.select().from(promptVersionsTable).where(eq(promptVersionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Tidak ditemukan" }); return; }

    const transitions: Record<string, string> = { draft: "testing", testing: "active" };
    const nextStatus = transitions[existing.status];
    if (!nextStatus) { res.status(400).json({ error: `Status ${existing.status} tidak bisa dipromote` }); return; }

    // RBAC check
    if (nextStatus === "active" && !["super_admin"].includes(role)) {
      res.status(403).json({ error: "Hanya super_admin yang bisa promote ke active" }); return;
    }
    if (nextStatus === "testing" && !["company_admin", "super_admin"].includes(role)) {
      res.status(403).json({ error: "Tidak ada akses" }); return;
    }

    const now = new Date();
    const updates: Record<string, unknown> = {
      status: nextStatus,
      updatedAt: now,
    };
    if (nextStatus === "testing") { updates.testingStartedAt = now; }
    if (nextStatus === "active") {
      updates.activatedBy = user?.email;
      updates.activatedAt = now;
      // Archive previous active
      await db.update(promptVersionsTable)
        .set({ status: "archived", archivedAt: now, archivedBy: user?.email ?? "system" })
        .where(and(eq(promptVersionsTable.companyId, companyId), eq(promptVersionsTable.status, "active")));
    }

    const [row] = await db.update(promptVersionsTable).set(updates).where(eq(promptVersionsTable.id, id)).returning();

    await db.insert(auditLogsTable).values({
      companyId, action: "prompt.promoted", module: "training",
      entityType: "prompt_versions", entityId: row.id,
      before: JSON.stringify({ status: existing.status }),
      after: JSON.stringify({ status: nextStatus }),
    }).catch(() => {});

    res.json(row);
  } catch (err) {
    logger.error({ err }, "POST /training/prompt-versions/:id/promote failed");
    res.status(500).json({ error: "Gagal promote prompt version" });
  }
});

// POST /training/prompt-versions/:id/archive  (super_admin)
router.post("/training/prompt-versions/:id/archive", requireAuth, requireRole("super_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const user = (req as Request & { user?: { email: string } }).user;
    const [row] = await db.update(promptVersionsTable)
      .set({ status: "archived", archivedAt: new Date(), archivedBy: user?.email ?? "system", updatedAt: new Date() })
      .where(eq(promptVersionsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal archive prompt version" });
  }
});

// POST /training/prompt-versions/:id/run-test  (company_admin+)
// Shadow-run the prompt against validation dataset records
router.post("/training/prompt-versions/:id/run-test", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const [version] = await db.select().from(promptVersionsTable).where(eq(promptVersionsTable.id, id));
    if (!version) { res.status(404).json({ error: "Tidak ditemukan" }); return; }
    if (version.status !== "testing") { res.status(400).json({ error: "Hanya version dengan status testing yang bisa diuji" }); return; }

    // Get validation dataset records (up to 20 samples)
    const samples = await db.select().from(trainingDatasetTable)
      .where(and(eq(trainingDatasetTable.splitTag, "validation"), eq(trainingDatasetTable.isActive, true)))
      .limit(20);

    if (samples.length === 0) {
      res.json({ tested: 0, message: "Tidak ada validation records" }); return;
    }

    const results: Array<typeof promptTestResultsTable.$inferInsert> = [];

    for (const sample of samples) {
      const t0 = Date.now();
      try {
        const resp = await openai.chat.completions.create({
          model: version.model ?? "gpt-4o-mini",
          messages: [
            { role: "system", content: version.systemPrompt },
            { role: "user", content: sample.originalMessage },
          ],
          max_tokens: 500,
          temperature: 0.15,
          response_format: { type: "json_object" },
        });
        const latencyMs = Date.now() - t0;
        const raw = resp.choices[0]?.message?.content?.trim() ?? "{}";
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch {}

        results.push({
          promptVersionId: id,
          datasetRecordId: sample.id,
          predictedIntent: parsed.intentCode as string ?? null,
          predictedConfidence: parsed.confidenceScore === "high" ? "90" : parsed.confidenceScore === "low" ? "35" : "65",
          intentCorrect: sample.fieldCorrected === "intent"
            ? (parsed.intentCode as string) === sample.correctValue
            : null,
          latencyMs,
        });
      } catch {
        results.push({ promptVersionId: id, datasetRecordId: sample.id, latencyMs: Date.now() - t0 });
      }
    }

    await db.insert(promptTestResultsTable).values(results);

    const correct = results.filter((r) => r.intentCorrect === true).length;
    const total = results.filter((r) => r.intentCorrect !== null).length;
    res.json({ tested: results.length, intentAccuracy: total > 0 ? ((correct / total) * 100).toFixed(2) : null });
  } catch (err) {
    logger.error({ err }, "POST /training/prompt-versions/:id/run-test failed");
    res.status(500).json({ error: "Gagal menjalankan test" });
  }
});

// GET /training/prompt-versions/:id/test-results
router.get("/training/prompt-versions/:id/test-results", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const rows = await db.select().from(promptTestResultsTable)
      .where(eq(promptTestResultsTable.promptVersionId, id))
      .orderBy(desc(promptTestResultsTable.runAt))
      .limit(100);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat test results" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// AI EXPERIMENTS
// ══════════════════════════════════════════════════════════════════════════════

// GET /training/experiments
router.get("/training/experiments", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const rows = await db.select().from(aiExperimentsTable)
      .where(eq(aiExperimentsTable.companyId, companyId))
      .orderBy(desc(aiExperimentsTable.createdAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat eksperimen" });
  }
});

// POST /training/experiments  (company_admin+)
router.post("/training/experiments", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const user = (req as Request & { user?: { email: string } }).user;
    const parsed = insertAiExperimentSchema.safeParse({ ...req.body, companyId, createdBy: user?.email ?? "unknown" });
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const [row] = await db.insert(aiExperimentsTable).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err }, "POST /training/experiments failed");
    res.status(500).json({ error: "Gagal membuat eksperimen" });
  }
});

// GET /training/experiments/:id
router.get("/training/experiments/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const [row] = await db.select().from(aiExperimentsTable).where(eq(aiExperimentsTable.id, id));
    if (!row) { res.status(404).json({ error: "Eksperimen tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat eksperimen" });
  }
});

// POST /training/experiments/:id/start  (super_admin)
router.post("/training/experiments/:id/start", requireAuth, requireRole("super_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const [row] = await db.update(aiExperimentsTable)
      .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(aiExperimentsTable.id, id), eq(aiExperimentsTable.status, "draft")))
      .returning();
    if (!row) { res.status(400).json({ error: "Eksperimen tidak dalam status draft" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal memulai eksperimen" });
  }
});

// POST /training/experiments/:id/pause  (company_admin+)
router.post("/training/experiments/:id/pause", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const [row] = await db.update(aiExperimentsTable)
      .set({ status: "paused", updatedAt: new Date() })
      .where(and(eq(aiExperimentsTable.id, id), eq(aiExperimentsTable.status, "running")))
      .returning();
    if (!row) { res.status(400).json({ error: "Eksperimen tidak sedang running" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal pause eksperimen" });
  }
});

// POST /training/experiments/:id/conclude  (super_admin)
router.post("/training/experiments/:id/conclude", requireAuth, requireRole("super_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const user = (req as Request & { user?: { email: string } }).user;
    const { conclusion, conclusionNotes } = req.body as { conclusion: string; conclusionNotes?: string };
    if (!["challenger_wins", "control_wins", "inconclusive"].includes(conclusion)) {
      res.status(400).json({ error: "conclusion harus: challenger_wins, control_wins, atau inconclusive" }); return;
    }
    const [row] = await db.update(aiExperimentsTable)
      .set({ status: "concluded", conclusion, conclusionNotes, endedAt: new Date(), concludedBy: user?.email, updatedAt: new Date() })
      .where(eq(aiExperimentsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Tidak ditemukan" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Gagal conclude eksperimen" });
  }
});

// GET /training/experiments/:id/results
router.get("/training/experiments/:id/results", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const [result] = await db.select().from(experimentResultsTable).where(eq(experimentResultsTable.experimentId, id));

    // Also compute live from observations if no stored result
    if (!result) {
      const obs = await db.select().from(experimentObservationsTable).where(eq(experimentObservationsTable.experimentId, id));
      const control = obs.filter((o) => o.groupTag === "control");
      const challenger = obs.filter((o) => o.groupTag === "challenger");
      const acc = (arr: typeof obs, field: "intentCorrect" | "routingCorrect") => {
        const known = arr.filter((o) => o[field] !== null);
        const correct = known.filter((o) => o[field] === true);
        return known.length > 0 ? parseFloat(((correct.length / known.length) * 100).toFixed(2)) : null;
      };
      res.json({
        experimentId: id,
        controlSampleSize: control.length,
        controlIntentAccuracy: acc(control, "intentCorrect"),
        controlRoutingAccuracy: acc(control, "routingCorrect"),
        challengerSampleSize: challenger.length,
        challengerIntentAccuracy: acc(challenger, "intentCorrect"),
        challengerRoutingAccuracy: acc(challenger, "routingCorrect"),
        computed: "live",
      });
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat hasil eksperimen" });
  }
});

// GET /training/experiments/:id/observations
router.get("/training/experiments/:id/observations", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(firstParam(req.params["id"]) ?? "", 10);
    const { group } = req.query as { group?: string };
    const rows = await db.select().from(experimentObservationsTable)
      .where(and(
        eq(experimentObservationsTable.experimentId, id),
        group ? eq(experimentObservationsTable.groupTag, group) : undefined,
      ))
      .orderBy(desc(experimentObservationsTable.observedAt))
      .limit(200);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat observations" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PREDICTION LOGS
// ══════════════════════════════════════════════════════════════════════════════

// GET /training/prediction-logs
router.get("/training/prediction-logs", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const { intent, is_fallback, had_correction, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const rows = await db.select().from(predictionLogsTable)
      .where(and(
        eq(predictionLogsTable.companyId, companyId),
        intent ? eq(predictionLogsTable.predictedIntent, intent) : undefined,
        is_fallback === "true" ? eq(predictionLogsTable.isFallback, true) : undefined,
        had_correction === "true" ? eq(predictionLogsTable.wasCorrected, true) : undefined,
      ))
      .orderBy(desc(predictionLogsTable.predictedAt))
      .limit(parseInt(limit, 10))
      .offset(parseInt(offset, 10));

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat prediction logs" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE METRICS
// ══════════════════════════════════════════════════════════════════════════════

// GET /training/performance/summary
router.get("/training/performance/summary", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";

    const now7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [today] = await db.select({
      total: count(),
      fallbacks: sql<number>`COUNT(*) FILTER (WHERE ${predictionLogsTable.isFallback} = true)`,
      corrected: sql<number>`COUNT(*) FILTER (WHERE ${predictionLogsTable.wasCorrected} = true)`,
      lowConf: sql<number>`COUNT(*) FILTER (WHERE ${predictionLogsTable.predictedConfidence} = 'low')`,
      avgLatency: sql<number>`AVG(${predictionLogsTable.llmLatencyMs})::int`,
    }).from(predictionLogsTable)
      .where(and(eq(predictionLogsTable.companyId, companyId), gte(predictionLogsTable.predictedAt, now7d)));

    const [month] = await db.select({ total: count(), corrected: sql<number>`COUNT(*) FILTER (WHERE ${predictionLogsTable.wasCorrected} = true)` })
      .from(predictionLogsTable)
      .where(and(eq(predictionLogsTable.companyId, companyId), gte(predictionLogsTable.predictedAt, now30d)));

    const pct = (n: number, d: number) => d > 0 ? parseFloat(((n / d) * 100).toFixed(2)) : null;
    const t7 = Number(today?.total ?? 0);
    const t30 = Number(month?.total ?? 0);

    res.json({
      last7Days: {
        totalPredictions: t7,
        fallbackRate: pct(Number(today?.fallbacks ?? 0), t7),
        correctionRate: pct(Number(today?.corrected ?? 0), t7),
        lowConfidenceRate: pct(Number(today?.lowConf ?? 0), t7),
        avgLlmLatencyMs: today?.avgLatency ?? null,
      },
      last30Days: {
        totalPredictions: t30,
        correctionRate: pct(Number(month?.corrected ?? 0), t30),
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat performance summary" });
  }
});

// GET /training/performance/daily
router.get("/training/performance/daily", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const rows = await db.select().from(performanceDailyTable)
      .where(eq(performanceDailyTable.companyId, companyId))
      .orderBy(desc(performanceDailyTable.date))
      .limit(90);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat performance daily" });
  }
});

// GET /training/performance/by-intent
router.get("/training/performance/by-intent", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? "default";
    const { days = "30" } = req.query as { days?: string };
    const since = new Date(Date.now() - parseInt(days, 10) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const rows = await db.select().from(performanceByIntentTable)
      .where(and(
        eq(performanceByIntentTable.companyId, companyId),
        gte(performanceByIntentTable.date, since),
      ))
      .orderBy(performanceByIntentTable.date, performanceByIntentTable.intentCode)
      .limit(200);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat performance by intent" });
  }
});

// POST /training/performance/rebuild  (super_admin) — rebuild daily aggregates from prediction_logs
router.post("/training/performance/rebuild", requireAuth, requireRole("super_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const { date: targetDate } = req.body as { date?: string };
    const dateStr = targetDate ?? new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const logs = await db.select().from(predictionLogsTable)
      .where(and(
        eq(predictionLogsTable.companyId, companyId),
        gte(predictionLogsTable.predictedAt, dayStart),
        lte(predictionLogsTable.predictedAt, dayEnd),
      ));

    const total = logs.length;
    const fallbacks = logs.filter((l) => l.isFallback).length;
    const corrected = logs.filter((l) => l.wasCorrected).length;
    const lowConf = logs.filter((l) => l.predictedConfidence === "low").length;
    const latencies = logs.map((l) => l.llmLatencyMs ?? 0).filter((l) => l > 0);
    const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
    const sortedLat = [...latencies].sort((a, b) => a - b);
    const p95Latency = sortedLat.length > 0 ? sortedLat[Math.floor(sortedLat.length * 0.95)] : null;

    const pct = (n: number, d: number) => d > 0 ? ((n / d) * 100).toFixed(2) : null;

    // Upsert performance_daily
    await db.delete(performanceDailyTable).where(
      and(eq(performanceDailyTable.companyId, companyId), eq(performanceDailyTable.date, dateStr)),
    );
    if (total > 0) {
      await db.insert(performanceDailyTable).values({
        companyId, date: dateStr,
        totalPredictions: total, totalCorrections: corrected,
        totalFallbacks: fallbacks, totalLowConfidence: lowConf,
        fallbackRate: pct(fallbacks, total), correctionRate: pct(corrected, total),
        lowConfidenceRate: pct(lowConf, total),
        avgLlmLatencyMs: avgLatency, p95LlmLatencyMs: p95Latency ?? undefined,
      });
    }

    // Per-intent
    const byIntent = new Map<string, { count: number; corrected: number }>();
    for (const l of logs) {
      const k = l.predictedIntent ?? "unknown";
      const curr = byIntent.get(k) ?? { count: 0, corrected: 0 };
      byIntent.set(k, { count: curr.count + 1, corrected: curr.corrected + (l.wasCorrected ? 1 : 0) });
    }
    await db.delete(performanceByIntentTable).where(
      and(eq(performanceByIntentTable.companyId, companyId), eq(performanceByIntentTable.date, dateStr)),
    );
    if (byIntent.size > 0) {
      await db.insert(performanceByIntentTable).values(
        [...byIntent.entries()].map(([intentCode, stats]) => ({
          companyId, date: dateStr, intentCode,
          sampleCount: stats.count, correctionCount: stats.corrected,
          accuracyRate: pct(stats.count - stats.corrected, stats.count),
        })),
      );
    }

    res.json({ rebuilt: true, date: dateStr, total });
  } catch (err) {
    logger.error({ err }, "POST /training/performance/rebuild failed");
    res.status(500).json({ error: "Gagal rebuild performance" });
  }
});

export default router;
