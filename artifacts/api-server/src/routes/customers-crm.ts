import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";
import { db, customersTable, aiTasksTable, auditLogsTable } from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/crm/customers
router.get("/crm/customers", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { search } = req.query as Record<string, string | undefined>;

    // company_id is INTEGER in DB — use raw SQL to avoid type mismatch
    const result = await db.execute(sql`
      SELECT * FROM customers WHERE company_id = ${Number(companyId) || 0}
      ORDER BY updated_at DESC LIMIT 300
    `);
    let rows = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? result as unknown as Record<string, unknown>[]);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => String(r.company_name ?? "").toLowerCase().includes(q) || String(r.pic_name ?? "").toLowerCase().includes(q) || String(r.whatsapp ?? "").includes(q) || String(r.email ?? "").toLowerCase().includes(q));
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
    const { companyName, picName, whatsapp, email, npwp, address, notes } = req.body as Record<string, unknown>;

    // Task 3: mandatory fields validation
    if (!companyName || !String(companyName).trim()) {
      res.status(400).json({ error: "companyName wajib diisi" }); return;
    }
    if (!whatsapp || !String(whatsapp).trim()) {
      res.status(400).json({ error: "Nomor WhatsApp wajib diisi — diperlukan untuk pengiriman notifikasi dan intent detection" }); return;
    }
    // Normalize WhatsApp: strip non-digits, convert leading 0 to 62
    const normalizedWa = String(whatsapp).replace(/\D/g, "").replace(/^0/, "62");
    if (normalizedWa.length < 10) {
      res.status(400).json({ error: "Nomor WhatsApp tidak valid (minimal 10 digit)" }); return;
    }

    // NOTE: customers.company_id is INTEGER in DB (nullable), not TEXT.
    // Drizzle schema drift: schema says text("company_id") but DB is integer.
    // We use raw SQL and pass NULL for company_id (super_admin has no integer company id).
    const insertResult = await db.execute(sql`
      INSERT INTO customers (name, company_name, pic_name, whatsapp, email, npwp, address, notes, created_at, updated_at)
      VALUES (
        ${String(companyName).trim()},
        ${String(companyName).trim()},
        ${picName ? String(picName) : null},
        ${normalizedWa},
        ${email ? String(email) : null},
        ${npwp ? String(npwp) : null},
        ${address ? String(address) : null},
        ${notes ? String(notes) : null},
        NOW(), NOW()
      )
      RETURNING id, company_name, pic_name, whatsapp, email, created_at
    `);
    const created = (insertResult.rows as Record<string, unknown>[])[0];
    if (!created) { res.status(500).json({ error: "Gagal menyimpan customer" }); return; }

    await db.insert(auditLogsTable).values({ action: "customer_created", module: "customers", before: `Customer baru: ${String(companyName).trim()}`, entityId: Number(created["id"]) }).catch(() => {});
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
