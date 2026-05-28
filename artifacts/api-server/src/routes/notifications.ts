import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, count } from "drizzle-orm";
import { db, adminNotificationsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { registerSseClient } from "../lib/sse";

const router: IRouter = Router();

// ─── GET /api/events — Server-Sent Events stream ────────────────────────────

router.get("/events", (req: Request, res: Response): void => {
  const companyId = (req.query.companyId as string | undefined) ?? "default";

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, companyId })}\n\n`);

  // Register client; get cleanup function
  const cleanup = registerSseClient(res, companyId);

  // Clean up when the client disconnects
  req.on("close", cleanup);
  req.on("error", cleanup);
});

// GET /api/notifications
router.get("/notifications", async (req, res): Promise<void> => {
  const companyId = (req.headers["x-company-id"] as string | undefined) ?? "default";
  const unreadOnly = req.query.unreadOnly === "true";
  const limit = Math.min(parseInt(req.query.limit as string ?? "50", 10), 100);

  try {
    const conditions = [eq(adminNotificationsTable.companyId, companyId)];
    if (unreadOnly) conditions.push(eq(adminNotificationsTable.isRead, false));

    const rows = await db
      .select()
      .from(adminNotificationsTable)
      .where(and(...conditions))
      .orderBy(desc(adminNotificationsTable.createdAt))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Failed to list notifications");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/notifications/unread-count
router.get("/notifications/unread-count", async (req, res): Promise<void> => {
  const companyId = (req.headers["x-company-id"] as string | undefined) ?? "default";

  try {
    const [row] = await db
      .select({ count: count() })
      .from(adminNotificationsTable)
      .where(and(eq(adminNotificationsTable.companyId, companyId), eq(adminNotificationsTable.isRead, false)));

    res.json({ count: row?.count ?? 0 });
  } catch (err) {
    logger.error({ err }, "Failed to count unread notifications");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/notifications/:id/read
router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);

  try {
    const [updated] = await db
      .update(adminNotificationsTable)
      .set({ isRead: true })
      .where(eq(adminNotificationsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    logger.error({ err, id }, "Failed to mark notification as read");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/notifications/read-all
router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const companyId = (req.headers["x-company-id"] as string | undefined) ?? "default";

  try {
    await db
      .update(adminNotificationsTable)
      .set({ isRead: true })
      .where(and(eq(adminNotificationsTable.companyId, companyId), eq(adminNotificationsTable.isRead, false)));

    res.json({ count: 0 });
  } catch (err) {
    logger.error({ err }, "Failed to mark all notifications as read");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
