import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";
import { db, customersTable, aiTasksTable } from "@workspace/db";
import { requireAuth, getCompanyId, type AuthUser } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Owner approval, 27 Nov 2026 WIB: one existing Google Super Admin
// may CREATE customers for CST company 1 in this exact DEV application.
// This is NOT the onboarding alias, an account change or an edit/delete grant.
function isApprovedLegacyCrmProfile(user: AuthUser | undefined, env: Record<string, string | undefined> = process.env, nowMs: number = Date.now()): boolean {
  if (env.NODE_ENV !== "development" ||
      (env.APP_ENV !== undefined && env.APP_ENV !== "development") ||
      env.PUBLIC_APP_BASE_URL !== "https://dev-ai-task.cstlogistic.co.id" ||
      env.SUPABASE_URL_DEV !== "https://xssrfshdrtdfupgqwfdw.supabase.co" ||
      typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32 ||
      env.SESSION_SECRET === "fallback-secret-change-in-production") return false;
  if (!user || user.role !== "super_admin" ||
      String(user.id) !== "google_103728868378401731050" ||
      (user.companyId !== null && user.companyId !== "default") ||
      user.authSource !== "supabase_google_identity" ||
      user.authSupabaseId !== "75a7c311-3f6e-4c95-8a66-9b98f6dd26ad" ||
      typeof user.email !== "string" || !user.email.trim()) return false;
  const verifiedAt = user.authVerifiedAt;
  // Use the existing signed app-session lifetime, not a new session.
  return typeof verifiedAt === "number" && Number.isSafeInteger(verifiedAt) &&
    verifiedAt >= nowMs - 7 * 24 * 60 * 60_000 && verifiedAt <= nowMs + 30_000;
}

function resolveCrmCreateCompany(user: AuthUser | undefined, requestedCompany: unknown, body: Record<string, unknown>, env: Record<string, string | undefined> = process.env, nowMs: number = Date.now()): number | null {
  if (!user || !["owner", "super_admin", "company_admin"].includes(user.role) ||
      user.id === undefined || user.id === null ||
      typeof user.email !== "string" || !user.email.trim()) return null;
  if (Object.prototype.hasOwnProperty.call(body, "companyId") ||
      Object.prototype.hasOwnProperty.call(body, "company_id")) return null;
  const raw = String(user.companyId ?? "");
  const scope = isApprovedLegacyCrmProfile(user, env, nowMs) ? "1" : raw;
  if (!/^[1-9][0-9]{0,9}$/.test(scope) || Number(scope) > 2147483647) return null;
  if (requestedCompany !== undefined && (typeof requestedCompany !== "string" || requestedCompany !== scope)) return null;
  return Number(scope);
}

// Current profile and Auth pin must match in the same SQL as the operation.
// Numeric profiles keep the original JOIN and do not query auth.users.
function crmProfileCompanyPredicate(user: AuthUser) {
  if (!isApprovedLegacyCrmProfile(user)) return sql`u.company_id = co.id`;
  return sql`co.id = 1 AND co.code = 'CST' AND u.company_id IS NULL
    AND EXISTS (
      SELECT 1 FROM auth.users a
      WHERE a.id = ${user.authSupabaseId}::uuid
        AND lower(btrim(a.email)) = lower(btrim(u.email))
        AND a.email_confirmed_at IS NOT NULL
        AND a.deleted_at IS NULL AND (a.banned_until IS NULL OR a.banned_until <= now())
        AND a.raw_app_meta_data->>'ai_task_user_id' = u.id::text
        AND a.raw_app_meta_data->>'ai_task_role' = 'super_admin'
        AND a.raw_app_meta_data->>'ai_task_company_id' = '@NULL@'
        AND a.raw_app_meta_data->>'provider' = 'google'
    )`;
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

// GET /api/crm/customer-create-companies
// Read-only discovery of the bound company or separate Owner-approved CST CREATE capability.
router.get("/crm/customer-create-companies", requireAuth, async (req: Request, res: Response): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  try {
    const companyId = resolveCrmCreateCompany(req.user, undefined, {});
    if (companyId === null) {
      res.json({ companies: [], status: "no_authorized_company" }); return;
    }
    const profileCompany = crmProfileCompanyPredicate(req.user!);
    const result = await db.execute(sql`
      SELECT co.id, co.code, co.name
      FROM public.companies co
      JOIN public.users u ON ${profileCompany}
      WHERE co.id = ${companyId} AND co.is_active IS TRUE
        AND u.id::text = ${String(req.user!.id)}
        AND lower(btrim(u.email)) = lower(btrim(${req.user!.email}))
        AND u.role = ${req.user!.role}
        AND u.is_active IS TRUE AND u.status = 'active'
      LIMIT 2
    `);
    const rows = result.rows as Record<string, unknown>[];
    if (rows.length !== 1 || Number(rows[0]?.id) !== companyId) {
      res.json({ companies: [], status: "no_authorized_company" }); return;
    }
    res.json({
      companies: [{ id: companyId, code: String(rows[0]?.code ?? ""), name: String(rows[0]?.name ?? "") }],
      status: "ok",
      mode: isApprovedLegacyCrmProfile(req.user) ? "owner_approved_cst_create" : "bound_company",
    });
  } catch (err) {
    logger.error({ err }, "GET /crm/customer-create-companies failed");
    res.status(503).json({ error: "CRM_COMPANY_SCOPE_UNAVAILABLE" });
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
    // The extra legacy permission requires an explicit CST selection.
    if (companyId === null ||
        (isApprovedLegacyCrmProfile(req.user) && req.query.companyId !== "1")) {
      res.status(403).json({ error: "CRM_COMPANY_SCOPE_REQUIRED", message: "Pilih perusahaan yang diizinkan oleh server." }); return;
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
    // shared company_id column. The one approved legacy CST case has its
    // own current Auth pin check. Audit and customer commit together.
    const profileCompany = crmProfileCompanyPredicate(req.user!);
    const createAuthority = isApprovedLegacyCrmProfile(req.user) ? "owner_approved_cst_create" : "bound_company";
    const insertResult = await db.execute(sql`
      WITH eligible AS (
        SELECT co.id
        FROM public.companies co
        JOIN public.users u ON ${profileCompany}
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
          ${req.user!.email}, jsonb_build_object('customer_id', id, 'company_id', company_id,
            'create_authority', ${createAuthority}::text, 'actor_profile_id', ${String(req.user!.id)}::text)
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
