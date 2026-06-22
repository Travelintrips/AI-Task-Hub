/**
 * Intake Sessions API — Sprint 9A
 *
 * GET   /api/intake-sessions               — list sessions (admin)
 * GET   /api/intake-sessions/:id           — get session detail
 * PATCH /api/intake-sessions/:id/cancel    — cancel session
 * PATCH /api/intake-sessions/:id/mark-ready — manually mark ready for task
 * POST  /api/intake-sessions/:id/convert-to-task — admin: force create task
 */

import { Router, type IRouter } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db, intakeSessionsTable, aiTasksTable } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { createAdminNotification } from "../lib/admin-notifications";

const router: IRouter = Router();

// ── GET /intake-sessions ───────────────────────────────────────────────────────

router.get("/intake-sessions", requireAuth, async (req, res): Promise<void> => {
  try {
    const companyId = req.user?.companyId ?? "default";
    const { status, phone, limit: limitStr } = req.query as Record<string, string>;
    const limit = Math.min(parseInt(limitStr ?? "50", 10) || 50, 200);

    const conditions = [eq(intakeSessionsTable.companyId, companyId)];

    if (status) {
      const statuses = status.split(",").filter(Boolean);
      if (statuses.length > 0) {
        conditions.push(inArray(intakeSessionsTable.status, statuses as ("collecting" | "ready_for_task" | "submitted" | "cancelled" | "expired")[]));
      }
    }
    if (phone) {
      conditions.push(eq(intakeSessionsTable.phone, phone));
    }

    const sessions = await db
      .select()
      .from(intakeSessionsTable)
      .where(and(...conditions))
      .orderBy(desc(intakeSessionsTable.updatedAt))
      .limit(limit);

    res.json({ data: sessions, total: sessions.length });
  } catch (err) {
    logger.error({ err }, "GET /intake-sessions failed");
    res.status(500).json({ error: "Gagal mengambil data intake sessions" });
  }
});

// ── GET /intake-sessions/:id ───────────────────────────────────────────────────

router.get("/intake-sessions/:id", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const companyId = req.user?.companyId ?? "default";
    const [session] = await db
      .select()
      .from(intakeSessionsTable)
      .where(and(eq(intakeSessionsTable.id, id), eq(intakeSessionsTable.companyId, companyId)))
      .limit(1);

    if (!session) { res.status(404).json({ error: "Session tidak ditemukan" }); return; }
    res.json(session);
  } catch (err) {
    logger.error({ err }, "GET /intake-sessions/:id failed");
    res.status(500).json({ error: "Gagal mengambil detail session" });
  }
});

// ── PATCH /intake-sessions/:id/cancel ─────────────────────────────────────────

router.patch("/intake-sessions/:id/cancel", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const companyId = req.user?.companyId ?? "default";

    const [existing] = await db
      .select()
      .from(intakeSessionsTable)
      .where(and(eq(intakeSessionsTable.id, id), eq(intakeSessionsTable.companyId, companyId)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Session tidak ditemukan" }); return; }
    if (existing.status === "submitted") {
      res.status(400).json({ error: "Session yang sudah submitted tidak bisa dibatalkan" }); return;
    }

    const [updated] = await db
      .update(intakeSessionsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(intakeSessionsTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /intake-sessions/:id/cancel failed");
    res.status(500).json({ error: "Gagal membatalkan session" });
  }
});

// ── PATCH /intake-sessions/:id/mark-ready ─────────────────────────────────────

router.patch("/intake-sessions/:id/mark-ready", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const companyId = req.user?.companyId ?? "default";
    const [existing] = await db
      .select()
      .from(intakeSessionsTable)
      .where(and(eq(intakeSessionsTable.id, id), eq(intakeSessionsTable.companyId, companyId)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Session tidak ditemukan" }); return; }
    if (!["collecting", "form_sent"].includes(existing.status)) {
      res.status(400).json({ error: "Hanya session dengan status collecting/form_sent yang bisa ditandai siap" }); return;
    }

    const [updated] = await db
      .update(intakeSessionsTable)
      .set({ status: "ready_for_task", updatedAt: new Date() })
      .where(eq(intakeSessionsTable.id, id))
      .returning();

    logger.info({ id, adminId: req.user?.id }, "Intake session manually marked ready");
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /intake-sessions/:id/mark-ready failed");
    res.status(500).json({ error: "Gagal menandai session" });
  }
});

// ── POST /intake-sessions/:id/convert-to-task ─────────────────────────────────

router.post("/intake-sessions/:id/convert-to-task", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const companyId = req.user?.companyId ?? "default";
    const [session] = await db
      .select()
      .from(intakeSessionsTable)
      .where(and(eq(intakeSessionsTable.id, id), eq(intakeSessionsTable.companyId, companyId)))
      .limit(1);

    if (!session) { res.status(404).json({ error: "Session tidak ditemukan" }); return; }
    if (session.status === "submitted") {
      res.status(400).json({ error: "Session sudah disubmit" }); return;
    }
    if (session.status === "cancelled" || session.status === "expired") {
      res.status(400).json({ error: "Session tidak aktif" }); return;
    }

    const collectedFields = (session.collectedFields as Record<string, unknown>) ?? {};
    const fieldSummary = Object.entries(collectedFields)
      .slice(0, 10)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(", ");

    const now = new Date();
    const taskNumber = `WA-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${id}`;

    const [newTask] = await db
      .insert(aiTasksTable)
      .values({
        companyId,
        taskNumber,
        title: `[Admin Convert] ${session.intentCode} — ${session.phone}`,
        description: `Task dibuat manual oleh admin dari intake session #${id}.\n\nData terkumpul:\n${fieldSummary}`,
        status: "New Inquiry",
        priority: "medium",
        category: session.category ?? "General",
        customerPhone: session.phone,
        aiSummary: fieldSummary || "Data dari intake session",
        needsAdminReview: true,
        missingData: JSON.stringify(session.missingFields ?? []),
      })
      .returning();

    await db
      .update(intakeSessionsTable)
      .set({ status: "submitted", taskId: String(newTask!.id), updatedAt: new Date() })
      .where(eq(intakeSessionsTable.id, id));

    await createAdminNotification({
      type: "new_inquiry",
      title: `✅ Task Dibuat dari Intake #${id}`,
      body: `Admin membuat task dari intake session ${session.phone} (${session.intentCode}). Task #${taskNumber}`,
      customerPhone: session.phone,
      companyId,
    });

    logger.info({ sessionId: id, taskId: newTask!.id, taskNumber }, "Admin manually converted intake session to task");
    res.json({ taskId: newTask!.id, taskNumber });
  } catch (err) {
    logger.error({ err }, "POST /intake-sessions/:id/convert-to-task failed");
    res.status(500).json({ error: "Gagal membuat task dari session" });
  }
});

export default router;
