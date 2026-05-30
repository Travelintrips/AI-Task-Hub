import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, aiTasksTable, taskCommentsTable, shipmentTrackingsTable, shipmentEventsTable, quotationsTable } from "@workspace/db";
import jwt from "jsonwebtoken";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const PORTAL_SECRET = process.env.SESSION_SECRET ?? "portal-secret";

// POST /api/portal/login
router.post("/portal/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, taskNumber } = req.body as { phone?: string; taskNumber?: string };
    if (!phone) { res.status(400).json({ error: "Nomor WhatsApp wajib diisi" }); return; }

    const conditions = [eq(aiTasksTable.customerPhone, phone.replace(/\D/g, ""))];
    if (taskNumber) conditions.push(eq(aiTasksTable.taskNumber, taskNumber));

    const tasks = await db.select({ id: aiTasksTable.id, companyId: aiTasksTable.companyId, customerName: aiTasksTable.customerName })
      .from(aiTasksTable)
      .where(and(...conditions))
      .limit(1);

    if (tasks.length === 0) {
      res.status(401).json({ error: "Data tidak ditemukan. Periksa nomor WhatsApp dan nomor task." });
      return;
    }

    const token = jwt.sign({ phone, companyId: tasks[0].companyId, customerName: tasks[0].customerName, role: "customer" }, PORTAL_SECRET, { expiresIn: "24h" });
    res.json({ token, customerName: tasks[0].customerName });
  } catch (err) {
    logger.error({ err }, "POST /portal/login failed");
    res.status(500).json({ error: "Login gagal" });
  }
});

function verifyPortalToken(token: string): { phone: string; companyId: string; customerName: string | null } | null {
  try { return jwt.verify(token, PORTAL_SECRET) as { phone: string; companyId: string; customerName: string | null }; } catch { return null; }
}

function portalAuth(req: Request, res: Response, next: () => void): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  const payload = verifyPortalToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "Token tidak valid atau kadaluarsa" }); return; }
  (req as Request & { portalUser?: typeof payload }).portalUser = payload;
  next();
}

// GET /api/portal/tasks
router.get("/portal/tasks", (req, res, next) => { portalAuth(req, res, next); }, async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, companyId } = (req as Request & { portalUser?: { phone: string; companyId: string } }).portalUser!;
    const normalizedPhone = phone.replace(/\D/g, "");

    const tasks = await db.select().from(aiTasksTable)
      .where(and(eq(aiTasksTable.companyId, companyId), eq(aiTasksTable.customerPhone, normalizedPhone)))
      .orderBy(desc(aiTasksTable.createdAt)).limit(20);

    res.json(tasks);
  } catch (err) {
    logger.error({ err }, "GET /portal/tasks failed");
    res.status(500).json({ error: "Failed to load portal tasks" });
  }
});

// GET /api/portal/tasks/:id
router.get("/portal/tasks/:id", (req, res, next) => { portalAuth(req, res, next); }, async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, companyId } = (req as Request & { portalUser?: { phone: string; companyId: string } }).portalUser!;
    const id = Number(req.params.id);
    const normalizedPhone = phone.replace(/\D/g, "");

    const [task] = await db.select().from(aiTasksTable)
      .where(and(eq(aiTasksTable.id, id), eq(aiTasksTable.companyId, companyId), eq(aiTasksTable.customerPhone, normalizedPhone)))
      .limit(1);
    if (!task) { res.status(404).json({ error: "Task tidak ditemukan" }); return; }

    const comments = await db.select().from(taskCommentsTable).where(eq(taskCommentsTable.taskId, id)).orderBy(taskCommentsTable.createdAt);
    const trackings = await db.select().from(shipmentTrackingsTable).where(eq(shipmentTrackingsTable.taskId, id));
    const events = await db.select().from(shipmentEventsTable).where(eq(shipmentEventsTable.taskId, id)).orderBy(desc(shipmentEventsTable.eventTime));
    const quotations = await db.select().from(quotationsTable).where(and(eq(quotationsTable.taskId, id), eq(quotationsTable.companyId, companyId)));

    res.json({ ...task, comments: comments.filter((c) => c.senderType !== "internal"), trackings, events, quotations: quotations.filter((q) => q.status !== "draft") });
  } catch (err) {
    logger.error({ err }, "GET /portal/tasks/:id failed");
    res.status(500).json({ error: "Failed to load task detail" });
  }
});

export default router;
