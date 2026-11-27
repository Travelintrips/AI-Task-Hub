import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";
import { db, customersTable, aiTasksTable } from "@workspace/db";
import { requireAuth, getCompanyId, type AuthUser } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Customer writes must use the authenticated numeric company, never a legacy
// alias, request-supplied tenant, or the read-only onboarding exception.
function resolveCrmCreateCompany(user: AuthUser | undefined, requestedCompany: unknown, body: Record<string, unknown>): number | null {
  if (!user || !["owner", "super_admin", "company_admin"].includes(user.role) ||
      user.id === undefined || user.id === null ||
      typeof user.email !== "string" || !user.email.trim()) return null;
  const raw = String(user.companyId ?? "");
  if (!/^[1-9][0-9]{0,9}$/.test(raw) || Number(raw) > 2147483647) return null;
  if (requestedCompany !== undefined && (typeof requestedCompany !== "string" || requestedCompany !== raw)) return null;
  if (Object.prototype.hasOwnProperty.call(body, "companyId") ||
      Object.prototype.hasOwnProperty.call(body, "company_id")) return null;
  return Number(raw);
}


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
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Data customer tidak valid" }); return;
    }
    const companyId = resolveCrmCreateCompany(req.user, req.query.companyId, body);
    if (companyId === null) {
      res.status(403).json({ error: "CRM_COMPANY_SCOPE_REQUIRED", message: "Akun pengelola harus terikat pada perusahaan yang sah; identitas perusahaan dari formulir tidak diterima." }); return;
    }
    const { companyName, picName, whatsapp, email, npwp, address, notes } = body;

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

    // Revalidate the live profile and company in the same SQL statement as
    // the insert. The old Drizzle customer schema does not match the numeric
    // shared company_id column. No legacy default -> numeric write mapping.
    // If the audit insert fails, the customer insert rolls back too.
    const insertResult = await db.execute(sql`
      WITH eligible AS (
        SELECT co.id
        FROM public.companies co
        JOIN public.users u ON u.company_id = co.id
        WHERE co.id = ${companyId} AND co.is_active IS TRUE
          AND u.id::text = ${String(req.user!.id)}
          AND lower(btrim(u.email)) = lower(btrim(${req.user!.email}))
          AND u.role = ${req.user!.role}
          AND u.is_active IS TRUE AND u.status = 'active'
      ), created AS (
        INSERT INTO public.customers
          (name, company_name, company_id, pic_name, whatsapp, email, npwp, address, notes, created_at, updated_at)
        SELECT ${String(companyName).trim()}, ${String(companyName).trim()}, id,
          ${picName ? String(picName) : null}, ${normalizedWa},
          ${email ? String(email) : null}, ${npwp ? String(npwp) : null},
          ${address ? String(address) : null}, ${notes ? String(notes) : null},
          NOW(), NOW()
        FROM eligible
        RETURNING id, company_id, company_name, pic_name, whatsapp, email, created_at
      ), logged AS (
        INSERT INTO public.audit_logs
          (action, entity_type, entity_id, company_id, module, user_email, after_data)
        SELECT 'customer_created', 'customer', id::text, company_id::text, 'customers',
          ${req.user!.email}, jsonb_build_object('customer_id', id, 'company_id', company_id)
        FROM created
        RETURNING entity_id
      )
      SELECT created.* FROM created JOIN logged ON logged.entity_id = created.id::text
    `);
    const created = (insertResult.rows as Record<string, unknown>[])[0];
    if (!created) {
      res.status(403).json({ error: "CRM_COMPANY_SCOPE_INACTIVE", message: "Profil atau perusahaan tidak aktif atau tidak cocok." }); return;
    }
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
