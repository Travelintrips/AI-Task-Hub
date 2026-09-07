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
import { eq, desc, and, inArray, gte, sql } from "drizzle-orm";
import { db, intakeSessionsTable, aiTasksTable, dataTemplatesTable } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { createAdminNotification } from "../lib/admin-notifications";
import { sendFonnte } from "../lib/fonnte";
import { generateSecureToken } from "../lib/tokens";
import { getFormConfig, inferFormType } from "../lib/mini-form-config";

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

// ── GET /intake-sessions/stats ── (must be BEFORE /:id) ──────────────────────

router.get("/intake-sessions/stats", requireAuth, async (req, res): Promise<void> => {
  try {
    const companyId = req.user?.companyId ?? "default";
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const all = await db
      .select({
        status: intakeSessionsTable.status,
        createdAt: intakeSessionsTable.createdAt,
      })
      .from(intakeSessionsTable)
      .where(eq(intakeSessionsTable.companyId, companyId));

    const active    = all.filter((s) => s.status === "collecting" || s.status === "form_sent").length;
    const waitingUser = all.filter((s) => s.status === "collecting").length;
    const waitingDocument = all.filter((s) => s.status === "form_sent").length;
    const completedToday = all.filter(
      (s) => (s.status === "submitted" || s.status === "ready_for_task") && new Date(s.createdAt) >= todayStart,
    ).length;
    const expiredToday = all.filter(
      (s) => s.status === "expired" && new Date(s.createdAt) >= todayStart,
    ).length;

    res.json({ active, waitingUser, waitingDocument, completedToday, expiredToday });
  } catch (err) {
    logger.error({ err }, "GET /intake-sessions/stats failed");
    res.status(500).json({ error: "Gagal mengambil statistik" });
  }
});

// ── GET /intake-sessions/analytics ── Sprint 9B (must be BEFORE /:id) ─────────

router.get("/intake-sessions/analytics", requireAuth, async (req, res): Promise<void> => {
  try {
    const companyId = req.user?.companyId ?? "default";
    const { days: daysStr } = req.query as Record<string, string>;
    const days = Math.min(parseInt(daysStr ?? "30", 10) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const sessions = await db
      .select({
        id: intakeSessionsTable.id,
        status: intakeSessionsTable.status,
        miniFormType: intakeSessionsTable.miniFormType,
        intentCode: intakeSessionsTable.intentCode,
        category: intakeSessionsTable.category,
        createdAt: intakeSessionsTable.createdAt,
        formSentAt: intakeSessionsTable.formSentAt,
        updatedAt: intakeSessionsTable.updatedAt,
      })
      .from(intakeSessionsTable)
      .where(and(eq(intakeSessionsTable.companyId, companyId), gte(intakeSessionsTable.createdAt, since)));

    const total = sessions.length;
    const byStatus: Record<string, number> = {};
    for (const s of sessions) {
      byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    }

    const miniFormTotal = sessions.filter((s) => s.miniFormType && s.formSentAt).length;
    const conversationTotal = sessions.filter((s) => !s.miniFormType && !s.formSentAt).length;
    const hybridTotal = sessions.filter((s) => s.miniFormType && !s.formSentAt).length;

    const miniFormSubmitted = sessions.filter(
      (s) => s.miniFormType && s.formSentAt && s.status === "submitted",
    ).length;
    const submissionRate = miniFormTotal > 0 ? Math.round((miniFormSubmitted / miniFormTotal) * 100) : 0;

    const byFormType: Record<string, { sent: number; submitted: number; expired: number; pending: number }> = {};
    for (const s of sessions.filter((s) => s.miniFormType)) {
      const ft = s.miniFormType!;
      if (!byFormType[ft]) byFormType[ft] = { sent: 0, submitted: 0, expired: 0, pending: 0 };
      byFormType[ft].sent++;
      if (s.status === "submitted") byFormType[ft].submitted++;
      else if (s.status === "expired") byFormType[ft].expired++;
      else if (s.status === "form_sent" || s.status === "collecting") byFormType[ft].pending++;
    }

    const daily: { date: string; conversation: number; mini_form: number; submitted: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      const dayStart = new Date(dateStr + "T00:00:00.000Z");
      const dayEnd = new Date(dateStr + "T23:59:59.999Z");
      const daySessions = sessions.filter((s) => {
        const t = new Date(s.createdAt);
        return t >= dayStart && t <= dayEnd;
      });
      daily.push({
        date: dateStr,
        conversation: daySessions.filter((s) => !s.miniFormType).length,
        mini_form: daySessions.filter((s) => !!s.miniFormType).length,
        submitted: daySessions.filter((s) => s.status === "submitted").length,
      });
    }

    const intentCounts: Record<string, number> = {};
    for (const s of sessions) {
      intentCounts[s.intentCode] = (intentCounts[s.intentCode] ?? 0) + 1;
    }
    const topIntents = Object.entries(intentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code, count]) => ({ intentCode: code, count }));

    res.json({
      period: { days, since: since.toISOString() },
      summary: { total, miniFormTotal, conversationTotal, hybridTotal, miniFormSubmitted, submissionRate, byStatus },
      byFormType,
      topIntents,
      daily: days <= 30 ? daily : daily.filter((_, i) => i % Math.ceil(days / 30) === 0),
    });
  } catch (err) {
    logger.error({ err }, "GET /intake-sessions/analytics failed");
    res.status(500).json({ error: "Gagal mengambil analytics" });
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

// ── POST /intake-sessions/:id/send-form ──────────────────────────────────────

router.post("/intake-sessions/:id/send-form", requireAuth, async (req, res): Promise<void> => {
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
    if (["submitted", "cancelled", "expired"].includes(session.status)) {
      res.status(400).json({ error: "Session tidak aktif" }); return;
    }

    // Determine form type
    const { formType: requestedType } = req.body as { formType?: string };
    let formType = requestedType ?? session.miniFormType ?? "";
    if (!formType || !getFormConfig(formType)) {
      formType = inferFormType(session.intentCode, session.category);
    }

    const formCfg = getFormConfig(formType)!;

    // Generate or reuse token
    let token = session.formToken;
    if (!token) {
      token = generateSecureToken();
    }

    // Build form URL
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim()
      ?? process.env.REPLIT_DEV_DOMAIN
      ?? "localhost:5000";
    const scheme = domain.includes("localhost") ? "http" : "https";
    const basePath = (process.env.BASE_PATH ?? "/").replace(/\/$/, "");
    const formUrl = `${scheme}://${domain}${basePath}/mini-form/${formType}/${token}`;

    // WhatsApp message
    const isUrgent = session.category?.toLowerCase().includes("komplain") || formType === "complaint";
    const waTmpl = isUrgent && formCfg.urgentWaMessage
      ? formCfg.urgentWaMessage
      : formCfg.waMessageTemplate;
    const waMessage = waTmpl.replace("{mini_form_url}", formUrl);

    // Update session
    await db
      .update(intakeSessionsTable)
      .set({
        status: "form_sent",
        miniFormType: formType,
        formToken: token,
        formSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(intakeSessionsTable.id, id));

    // Send WhatsApp
    const waResult = await sendFonnte(session.phone, waMessage);

    logger.info(
      { sessionId: id, formType, formUrl, waSuccess: waResult.success },
      "Mini form link sent via WhatsApp",
    );

    res.json({
      ok: true,
      formType,
      formUrl,
      token,
      waSuccess: waResult.success,
      waError: waResult.error,
      message: waResult.success
        ? `Link form ${formCfg.title} berhasil dikirim ke ${session.phone}`
        : `Link dibuat, tapi gagal kirim WA: ${waResult.error}`,
    });
  } catch (err) {
    logger.error({ err }, "POST /intake-sessions/:id/send-form failed");
    res.status(500).json({ error: "Gagal mengirim form" });
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
