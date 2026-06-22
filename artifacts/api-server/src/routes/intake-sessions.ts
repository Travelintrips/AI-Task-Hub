/**
 * Intake Sessions API
 *
 * GET  /api/intake-sessions          — list sessions (admin)
 * GET  /api/intake-sessions/:id      — get session detail
 * PATCH /api/intake-sessions/:id/cancel — cancel session
 */

import { Router, type IRouter } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db, intakeSessionsTable } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";

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

export default router;
