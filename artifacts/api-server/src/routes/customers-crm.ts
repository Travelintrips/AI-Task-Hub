import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, ilike, or } from "drizzle-orm";
import { db, customersTable, aiTasksTable, auditLogsTable } from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/crm/customers
router.get("/crm/customers", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { search } = req.query as Record<string, string | undefined>;

    let rows = await db.select().from(customersTable).where(eq(customersTable.companyId, companyId)).orderBy(desc(customersTable.updatedAt)).limit(300);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.companyName.toLowerCase().includes(q) || (r.picName ?? "").toLowerCase().includes(q) || (r.whatsapp ?? "").includes(q) || (r.email ?? "").toLowerCase().includes(q));
    }
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /crm/customers failed");
    res.status(500).json({ error: "Failed to load customers" });
  }
});

// GET /api/crm/customers/:id
router.get("/crm/customers/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId))).limit(1);
    if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

    const tasks = await db.select().from(aiTasksTable)
      .where(and(eq(aiTasksTable.companyId, companyId), or(eq(aiTasksTable.customerPhone, customer.whatsapp ?? ""), eq(aiTasksTable.customerName, customer.companyName))))
      .orderBy(desc(aiTasksTable.createdAt))
      .limit(50);

    res.json({ ...customer, tasks });
  } catch (err) {
    logger.error({ err }, "GET /crm/customers/:id failed");
    res.status(500).json({ error: "Failed to load customer" });
  }
});

// POST /api/crm/customers
router.post("/crm/customers", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { companyName, picName, whatsapp, email, npwp, address, notes } = req.body as Record<string, unknown>;
    if (!companyName) { res.status(400).json({ error: "companyName wajib diisi" }); return; }

    const [created] = await db.insert(customersTable).values({
      companyId, companyName: String(companyName),
      picName: picName ? String(picName) : null,
      whatsapp: whatsapp ? String(whatsapp) : null,
      email: email ? String(email) : null,
      npwp: npwp ? String(npwp) : null,
      address: address ? String(address) : null,
      notes: notes ? String(notes) : null,
    }).returning();

    await db.insert(auditLogsTable).values({ action: "customer_created", module: "customers", before: `Customer baru: ${created.companyName}`, entityId: created.id });
    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "POST /crm/customers failed");
    res.status(500).json({ error: "Failed to create customer" });
  }
});

// PATCH /api/crm/customers/:id
router.patch("/crm/customers/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;

    const updates: Record<string, unknown> = {};
    const fields = ["companyName", "picName", "whatsapp", "email", "npwp", "address", "notes", "aiSummary"];
    for (const f of fields) { if (body[f] !== undefined) updates[f] = body[f]; }

    const [updated] = await db.update(customersTable).set(updates).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId))).returning();
    if (!updated) { res.status(404).json({ error: "Customer not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /crm/customers/:id failed");
    res.status(500).json({ error: "Failed to update customer" });
  }
});

// DELETE /api/crm/customers/:id
router.delete("/crm/customers/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const id = Number(req.params.id);
    await db.delete(customersTable).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId)));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "DELETE /crm/customers/:id failed");
    res.status(500).json({ error: "Failed to delete customer" });
  }
});

export default router;
