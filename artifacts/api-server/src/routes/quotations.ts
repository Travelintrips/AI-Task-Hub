import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, quotationsTable, aiTasksTable, auditLogsTable, adminNotificationsTable } from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function genQuotationNumber(companyId: string): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `QUO/${yy}${mm}/${rand}`;
}

// GET /api/quotations
router.get("/quotations", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { status, taskId } = req.query as Record<string, string | undefined>;

    let rows = await db.select().from(quotationsTable).where(eq(quotationsTable.companyId, companyId)).orderBy(desc(quotationsTable.createdAt)).limit(300);
    if (status) rows = rows.filter((r) => r.status === status);
    if (taskId) rows = rows.filter((r) => r.taskId === Number(taskId));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /quotations failed");
    res.status(500).json({ error: "Failed to load quotations" });
  }
});

// GET /api/quotations/:id
router.get("/quotations/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const id = Number(req.params.id);
    const [row] = await db.select().from(quotationsTable).where(and(eq(quotationsTable.id, id), eq(quotationsTable.companyId, companyId))).limit(1);
    if (!row) { res.status(404).json({ error: "Quotation not found" }); return; }
    res.json(row);
  } catch (err) {
    logger.error({ err }, "GET /quotations/:id failed");
    res.status(500).json({ error: "Failed to load quotation" });
  }
});

// POST /api/quotations
router.post("/quotations", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { title, taskId, customerId, customerName, customerPhone, description,
      freightCost, customsCost, truckingCost, handlingCost, otherCharges, currency, validUntil, notes } = req.body as Record<string, unknown>;

    if (!title) { res.status(400).json({ error: "title wajib diisi" }); return; }

    const freight = Number(freightCost) || 0;
    const customs = Number(customsCost) || 0;
    const trucking = Number(truckingCost) || 0;
    const handling = Number(handlingCost) || 0;
    const other = Number(otherCharges) || 0;
    const total = freight + customs + trucking + handling + other;

    const [created] = await db.insert(quotationsTable).values({
      companyId,
      quotationNumber: genQuotationNumber(companyId),
      title: String(title),
      taskId: taskId ? Number(taskId) : null,
      customerId: customerId ? Number(customerId) : null,
      customerName: customerName ? String(customerName) : null,
      customerPhone: customerPhone ? String(customerPhone) : null,
      description: description ? String(description) : null,
      freightCost: freight,
      customsCost: customs,
      truckingCost: trucking,
      handlingCost: handling,
      otherCharges: other,
      totalAmount: total,
      currency: String(currency || "IDR"),
      validUntil: validUntil ? new Date(String(validUntil)) : null,
      notes: notes ? String(notes) : null,
      status: "draft",
      createdBy: req.user?.name ?? null,
    }).returning();

    await db.insert(auditLogsTable).values({ action: "quotation_created", module: "quotations", before: `Quotation ${created.quotationNumber} dibuat`, entityId: created.id });
    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "POST /quotations failed");
    res.status(500).json({ error: "Failed to create quotation" });
  }
});

// PATCH /api/quotations/:id
router.patch("/quotations/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    const fields = ["title", "description", "freightCost", "customsCost", "truckingCost", "handlingCost", "otherCharges", "currency", "validUntil", "notes", "status"];
    for (const f of fields) { if (body[f] !== undefined) updates[f] = body[f]; }

    const costFields = ["freightCost", "customsCost", "truckingCost", "handlingCost", "otherCharges"] as const;
    const existing = costFields.some((f) => updates[f] !== undefined);
    if (existing) {
      const [cur] = await db.select().from(quotationsTable).where(eq(quotationsTable.id, id)).limit(1);
      if (cur) {
        updates.totalAmount =
          (Number(updates.freightCost ?? cur.freightCost) || 0) +
          (Number(updates.customsCost ?? cur.customsCost) || 0) +
          (Number(updates.truckingCost ?? cur.truckingCost) || 0) +
          (Number(updates.handlingCost ?? cur.handlingCost) || 0) +
          (Number(updates.otherCharges ?? cur.otherCharges) || 0);
      }
    }

    if (body.status === "sent") updates.sentAt = new Date();
    if (body.status === "accepted" || body.status === "rejected") updates.respondedAt = new Date();

    const [updated] = await db.update(quotationsTable).set(updates).where(and(eq(quotationsTable.id, id), eq(quotationsTable.companyId, companyId))).returning();
    if (!updated) { res.status(404).json({ error: "Quotation not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /quotations/:id failed");
    res.status(500).json({ error: "Failed to update quotation" });
  }
});

// DELETE /api/quotations/:id
router.delete("/quotations/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const id = Number(req.params.id);
    await db.delete(quotationsTable).where(and(eq(quotationsTable.id, id), eq(quotationsTable.companyId, companyId)));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "DELETE /quotations/:id failed");
    res.status(500).json({ error: "Failed to delete quotation" });
  }
});

export default router;
