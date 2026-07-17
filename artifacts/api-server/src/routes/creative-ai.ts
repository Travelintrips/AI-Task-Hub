/**
 * Creative AI Routes — logo generation jobs dashboard
 * GET  /api/creative-ai/jobs           — list semua jobs
 * GET  /api/creative-ai/jobs/:taskId   — detail job per task
 * POST /api/creative-ai/retry/:taskId  — retry job yang failed
 * GET  /api/creative-ai/status         — cek status API key
 */

import { Router } from "express";
import { db, aiTasksTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { supabaseQuery } from "../lib/supabase-db";
import { triggerCreativeAiJob } from "../lib/creative-ai-engine";
import { logger as rootLogger } from "../lib/logger";
import { requireRole } from "../middleware/auth";

const logger = rootLogger.child({ module: "creative-ai-routes" });
const router = Router();

// ─── GET /api/creative-ai/jobs ─────────────────────────────────────────────

router.get("/creative-ai/jobs", requireRole(["staff", "company_admin", "super_admin", "owner"]), async (req, res) => {
  try {
    // Ambil semua ai_tasks dengan category "Creative AI" + service request terkait
    const tasks = await db
      .select()
      .from(aiTasksTable)
      .where(eq(aiTasksTable.category, "Creative AI"))
      .orderBy(desc(aiTasksTable.createdAt))
      .limit(100);

    // Enrich dengan data dari ai_platform.ai_service_requests
    const enriched = await Promise.all(
      tasks.map(async (task) => {
        const [sr] = await supabaseQuery<{
          id: number;
          status: string;
          completion_links: { logo_url?: string } | null;
          brief_json: { prompt?: string } | null;
          created_at: string;
        }>(
          `SELECT id, status, completion_links, brief_json, created_at
           FROM ai_platform.ai_service_requests
           WHERE request_id = $1
           ORDER BY id DESC
           LIMIT 1`,
          [task.taskNumber],
        );

        return {
          taskId:       task.id,
          taskNumber:   task.taskNumber,
          title:        task.title,
          taskStatus:   task.status,
          category:     task.category,
          customerPhone: task.customerPhone,
          createdAt:    task.createdAt,
          // ai_platform data
          serviceRequestId: sr?.id ?? null,
          aiStatus:     sr?.status ?? null,
          imageUrl:     sr?.completion_links?.logo_url ?? null,
          prompt:       sr?.brief_json?.prompt ?? null,
          aiCreatedAt:  sr?.created_at ?? null,
        };
      }),
    );

    return res.json({ jobs: enriched });
  } catch (err) {
    logger.error({ err }, "GET /api/creative-ai/jobs error");
    return res.status(500).json({ error: "Gagal mengambil daftar creative AI jobs" });
  }
});

// ─── GET /api/creative-ai/jobs/:taskId ─────────────────────────────────────

router.get("/creative-ai/jobs/:taskId", async (req, res) => {
  const taskId = Number(req.params.taskId as string);
  if (isNaN(taskId)) return res.status(400).json({ error: "taskId tidak valid" });

  try {
    const [task] = await db
      .select()
      .from(aiTasksTable)
      .where(eq(aiTasksTable.id, taskId));

    if (!task) return res.status(404).json({ error: "Task tidak ditemukan" });

    const serviceRequests = await supabaseQuery<{
      id: number;
      status: string;
      completion_links: { logo_url?: string } | null;
      brief_json: { prompt?: string; task_number?: string } | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, status, completion_links, brief_json, notes, created_at, updated_at
       FROM ai_platform.ai_service_requests
       WHERE request_id = $1
       ORDER BY id DESC`,
      [task.taskNumber],
    );

    const sr = serviceRequests[0] ?? null;

    return res.json({
      taskId:       task.id,
      taskNumber:   task.taskNumber,
      title:        task.title,
      taskStatus:   task.status,
      customerPhone: task.customerPhone,
      createdAt:    task.createdAt,
      updatedAt:    task.updatedAt,
      // AI result
      imageUrl:     sr?.completion_links?.logo_url ?? null,
      prompt:       sr?.brief_json?.prompt ?? null,
      aiStatus:     sr?.status ?? null,
      errorMessage: sr?.notes ?? null,
      aiHistory:    serviceRequests,
    });
  } catch (err) {
    logger.error({ err }, "GET /api/creative-ai/jobs/:taskId error");
    return res.status(500).json({ error: "Gagal mengambil detail job" });
  }
});

// ─── POST /api/creative-ai/retry/:taskId ──────────────────────────────────

router.post(
  "/creative-ai/retry/:taskId",
  requireRole(["company_admin", "super_admin", "owner"]),
  async (req, res) => {
    const taskId = Number(req.params.taskId as string);
    if (isNaN(taskId)) return res.status(400).json({ error: "taskId tidak valid" });

    try {
      const [task] = await db
        .select()
        .from(aiTasksTable)
        .where(eq(aiTasksTable.id, taskId));

      if (!task) return res.status(404).json({ error: "Task tidak ditemukan" });
      if (task.category !== "Creative AI")
        return res.status(400).json({ error: "Task ini bukan Creative AI job" });

      // Ambil collected fields dari ai_service_requests terakhir
      const [sr] = await supabaseQuery<{ brief_json: Record<string, unknown> | null }>(
        `SELECT brief_json FROM ai_platform.ai_service_requests WHERE request_id = $1 ORDER BY id DESC LIMIT 1`,
        [task.taskNumber],
      );

      const briefFields = (sr?.brief_json as Record<string, unknown>) ?? {};

      // Fire and forget
      triggerCreativeAiJob({
        taskId:         task.id,
        taskNumber:     task.taskNumber ?? "",
        customerName:   task.customerName ?? "Customer",
        customerPhone:  task.customerPhone ?? "",
        companyId:      task.companyId ?? "default",
        collectedFields: briefFields,
      }).catch((e) => logger.error({ e }, "creative-ai retry failed"));

      return res.json({ ok: true, message: "Retry dimulai, logo sedang diproses ulang" });
    } catch (err) {
      logger.error({ err }, "POST /api/creative-ai/retry error");
      return res.status(500).json({ error: "Gagal memulai retry" });
    }
  },
);

// ─── GET /api/creative-ai/status ──────────────────────────────────────────

router.get(
  "/creative-ai/status",
  requireRole(["company_admin", "super_admin", "owner"]),
  (_req, res) => {
    const hasKey = Boolean(process.env.TOGETHER_AI_API_KEY);
    return res.json({
      provider:    "Together.ai",
      model:       "black-forest-labs/FLUX.1-schnell-Free",
      apiKeySet:   hasKey,
      status:      hasKey ? "ready" : "missing_api_key",
      message:     hasKey
        ? "API key tersedia, siap generate logo"
        : "TOGETHER_AI_API_KEY belum di-set di Replit Secrets",
    });
  },
);

export default router;
