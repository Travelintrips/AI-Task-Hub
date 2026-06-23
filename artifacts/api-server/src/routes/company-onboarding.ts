/**
 * Sprint 10B-2 — Company Onboarding Factory
 * Routes: /api/company-onboarding/*
 *
 * GET  /api/company-onboarding/templates           — 4 industry templates
 * GET  /api/company-onboarding/sessions            — all sessions (super_admin)
 * POST /api/company-onboarding/create              — Step 1: create company profile
 * GET  /api/company-onboarding/:companyId/session  — get session state
 * POST /api/company-onboarding/:companyId/admin    — Step 2: create first admin user
 * POST /api/company-onboarding/:companyId/whatsapp — Step 3: WA setup
 * POST /api/company-onboarding/:companyId/modules  — Step 4: module selection
 * POST /api/company-onboarding/:companyId/seed     — Step 5: initial data seed
 * GET  /api/company-onboarding/:companyId/readiness — Step 6: readiness check
 * POST /api/company-onboarding/:companyId/go-live  — Step 7: go live
 */

import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { supabaseQuery } from "../lib/supabase-db";
import { logger } from "../lib/logger";

export const companyOnboardingRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function safeRows<T = Record<string, unknown>>(
  query: string, params: unknown[] = [],
): Promise<T[]> {
  try { return await supabaseQuery<T>(query, params); }
  catch (e) { logger.warn({ e }, "safeRows failed"); return []; }
}

async function safeCount(query: string, params: unknown[] = []): Promise<number> {
  try {
    const rows = await supabaseQuery<{ cnt: string }>(query, params);
    return parseInt(rows[0]?.cnt ?? "0", 10);
  } catch { return 0; }
}

async function upsertSession(companyId: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const values = [companyId, ...Object.values(patch)];
  await supabaseQuery(
    `INSERT INTO company_onboarding_sessions (company_id, ${keys.join(", ")}, updated_at)
     VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}, NOW())
     ON CONFLICT (company_id) DO UPDATE SET ${setClause}, updated_at = NOW()`,
    values,
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATES: Record<string, {
  label: string; description: string; industry: string;
  modules: string[]; defaultSettings: Record<string, unknown>;
  starterIntents: string[];
}> = {
  logistics: {
    label: "Logistics Company",
    description: "Perusahaan pengiriman, ekspedisi, trucking, freight forwarding",
    industry: "logistics",
    modules: ["ai_tasks", "fleet", "purchasing", "executive", "vendor_portal", "driver_portal"],
    defaultSettings: { dispatcherEnabled: true, autoAssignEnabled: true, followUpEnabled: true, aiEnabled: true },
    starterIntents: ["pengiriman_barang", "status_muatan", "dokumen_ekspor", "laporan_armada", "maintenance_kendaraan"],
  },
  trading: {
    label: "Trading Company",
    description: "Perusahaan dagang, distribusi, grosir, importir",
    industry: "trading",
    modules: ["ai_tasks", "purchasing", "crm", "executive"],
    defaultSettings: { dispatcherEnabled: false, autoAssignEnabled: true, followUpEnabled: true, aiEnabled: true },
    starterIntents: ["purchase_order", "inquiry_harga", "stok_barang", "pembayaran", "retur_barang"],
  },
  sport_center: {
    label: "Sport Center",
    description: "Pusat olahraga, gym, lapangan futsal, badminton, kolam renang",
    industry: "sport_center",
    modules: ["ai_tasks", "crm", "executive"],
    defaultSettings: { dispatcherEnabled: false, autoAssignEnabled: false, followUpEnabled: true, aiEnabled: true },
    starterIntents: ["booking_lapangan", "info_jadwal", "daftar_member", "pembayaran_member", "info_fasilitas"],
  },
  tenant: {
    label: "Tenant Management",
    description: "Pengelola properti, mall, gedung perkantoran, ruko",
    industry: "tenant_management",
    modules: ["ai_tasks", "crm", "purchasing", "executive"],
    defaultSettings: { dispatcherEnabled: false, autoAssignEnabled: true, followUpEnabled: true, aiEnabled: true },
    starterIntents: ["laporan_kerusakan", "perpanjangan_sewa", "tagihan_utilitas", "izin_renovasi", "komplain_tenant"],
  },
};

const ALL_MODULES = [
  { key: "ai_tasks",      label: "AI Task Center",      description: "Task management berbasis AI + WhatsApp" },
  { key: "fleet",         label: "Fleet Management",    description: "Manajemen armada, maintenance, GPS tracking" },
  { key: "purchasing",    label: "Purchasing",          description: "Pembelian, vendor, approval workflow" },
  { key: "crm",           label: "CRM",                 description: "Manajemen pelanggan & pipeline" },
  { key: "vendor_portal", label: "Vendor Portal",       description: "Self-service portal untuk vendor" },
  { key: "driver_portal", label: "Driver Portal",       description: "Self-service portal untuk pengemudi" },
  { key: "executive",     label: "Executive Command",   description: "Dashboard eksekutif lintas modul" },
];

// ── GET /api/company-onboarding/templates ────────────────────────────────────

companyOnboardingRouter.get(
  "/api/company-onboarding/templates",
  requireAuth,
  async (_req: Request, res: Response) => {
    return res.json({ templates: TEMPLATES, modules: ALL_MODULES });
  },
);

// ── GET /api/company-onboarding/sessions ─────────────────────────────────────

companyOnboardingRouter.get(
  "/api/company-onboarding/sessions",
  requireAuth,
  requireRole("super_admin", "company_admin"),
  async (req: Request, res: Response) => {
    try {
      const isSuperAdmin = req.user?.role === "super_admin";
      const whereClause = isSuperAdmin ? "" : `WHERE s.company_id = '${req.user?.companyId}'`;

      const sessions = await safeRows<{
        company_id: string; company_name: string | null; template_used: string | null;
        current_step: number; profile_done: boolean; admin_done: boolean;
        wa_done: boolean; modules_done: boolean; seed_done: boolean;
        readiness_pct: number; went_live_at: string | null; created_at: string; updated_at: string;
      }>(
        `SELECT s.*, cs.company_name
         FROM company_onboarding_sessions s
         LEFT JOIN company_settings cs ON cs.company_id = s.company_id
         ${whereClause}
         ORDER BY s.created_at DESC`,
      );

      return res.json({ sessions });
    } catch (err) {
      logger.error({ err }, "GET /company-onboarding/sessions failed");
      return res.status(500).json({ error: "Gagal memuat sesi onboarding" });
    }
  },
);

// ── POST /api/company-onboarding/create — Step 1: Company Profile ─────────────

companyOnboardingRouter.post(
  "/api/company-onboarding/create",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    try {
      const {
        companyId, companyName, industry, phone, email, website, address, templateKey,
      } = req.body as {
        companyId?: string; companyName?: string; industry?: string;
        phone?: string; email?: string; website?: string; address?: string; templateKey?: string;
      };

      if (!companyId || !companyName) {
        return res.status(400).json({ error: "companyId dan companyName wajib diisi" });
      }

      const slug = companyId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

      const existing = await safeRows(
        "SELECT company_id FROM company_settings WHERE company_id = $1", [slug],
      );
      if (existing.length > 0) {
        return res.status(409).json({ error: `Perusahaan dengan ID '${slug}' sudah ada` });
      }

      const template = templateKey ? TEMPLATES[templateKey] : null;
      const defaultSettings = template?.defaultSettings ?? {};

      await supabaseQuery(
        `INSERT INTO company_settings
          (company_id, company_name, industry_type, company_phone, company_email,
           ai_enabled, dispatcher_enabled, auto_assign_enabled, follow_up_enabled,
           timezone, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Asia/Jakarta',NOW(),NOW())`,
        [
          slug, companyName, industry ?? null, phone ?? null, email ?? null,
          (defaultSettings.aiEnabled ?? true) as boolean,
          (defaultSettings.dispatcherEnabled ?? false) as boolean,
          (defaultSettings.autoAssignEnabled ?? false) as boolean,
          (defaultSettings.followUpEnabled ?? true) as boolean,
        ],
      );

      if (website || address) {
        await supabaseQuery(
          `UPDATE company_settings SET company_address = $1 WHERE company_id = $2`,
          [address ?? null, slug],
        ).catch(() => null);
      }

      await upsertSession(slug, {
        template_used: templateKey ?? null,
        current_step: 2,
        profile_done: true,
      });

      logger.info({ companyId: slug, template: templateKey }, "Company profile created");
      return res.json({ companyId: slug, companyName, message: "Profil perusahaan berhasil dibuat" });
    } catch (err) {
      logger.error({ err }, "POST /company-onboarding/create failed");
      return res.status(500).json({ error: "Gagal membuat profil perusahaan" });
    }
  },
);

// ── GET /api/company-onboarding/:companyId/session ───────────────────────────

companyOnboardingRouter.get(
  "/api/company-onboarding/:companyId/session",
  requireAuth,
  requireRole("super_admin", "company_admin"),
  async (req: Request, res: Response) => {
    try {
      const companyId = req.params.companyId as string;
      const sessions = await safeRows<Record<string, unknown>>(
        `SELECT s.*, cs.company_name, cs.industry_type, cs.company_phone, cs.company_email,
                cs.fonnte_token, cs.ai_enabled, cs.dispatcher_enabled, cs.auto_assign_enabled
         FROM company_onboarding_sessions s
         LEFT JOIN company_settings cs ON cs.company_id = s.company_id
         WHERE s.company_id = $1`,
        [companyId],
      );

      const modules = await safeRows<{ module_key: string; is_enabled: boolean }>(
        "SELECT module_key, is_enabled FROM company_modules WHERE company_id = $1", [companyId],
      );

      if (sessions.length === 0) {
        return res.json({ session: null, modules: [] });
      }

      return res.json({ session: sessions[0], modules });
    } catch (err) {
      logger.error({ err }, "GET session failed");
      return res.status(500).json({ error: "Gagal memuat sesi" });
    }
  },
);

// ── POST /api/company-onboarding/:companyId/admin — Step 2 ───────────────────

companyOnboardingRouter.post(
  "/api/company-onboarding/:companyId/admin",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    try {
      const companyId = req.params.companyId as string;
      const { name, email, role = "owner", password } = req.body as {
        name?: string; email?: string; role?: string; password?: string;
      };

      if (!name || !email) {
        return res.status(400).json({ error: "name dan email wajib diisi" });
      }

      const tempPassword = password ?? `Tmp${Math.random().toString(36).slice(2, 8).toUpperCase()}!`;
      const passwordHash = await bcrypt.hash(tempPassword, 12);

      const validRole = ["owner", "company_admin"].includes(role) ? role : "owner";

      const existing = await safeRows(
        "SELECT id FROM users WHERE email = $1", [email],
      );
      if (existing.length > 0) {
        return res.status(409).json({ error: `Email ${email} sudah terdaftar` });
      }

      const created = await db.insert(usersTable).values({
        companyId,
        name,
        email,
        passwordHash,
        role: validRole,
        isActive: true,
      }).returning();

      await upsertSession(companyId, { current_step: 3, admin_done: true });

      const activationLink = `${process.env.FRONTEND_URL ?? ""}/login?hint=${encodeURIComponent(email)}`;

      logger.info({ companyId, email, role: validRole }, "Admin user created");
      return res.json({
        userId: created[0]?.id,
        email,
        role: validRole,
        temporaryPassword: tempPassword,
        activationLink,
        message: "Admin user berhasil dibuat",
      });
    } catch (err) {
      logger.error({ err }, "POST /admin failed");
      return res.status(500).json({ error: "Gagal membuat admin user" });
    }
  },
);

// ── POST /api/company-onboarding/:companyId/whatsapp — Step 3 ────────────────

companyOnboardingRouter.post(
  "/api/company-onboarding/:companyId/whatsapp",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    try {
      const companyId = req.params.companyId as string;
      const { fonnteToken, skip = false } = req.body as { fonnteToken?: string; skip?: boolean };

      if (!skip && !fonnteToken) {
        return res.status(400).json({ error: "fonnteToken wajib diisi, atau kirim skip:true" });
      }

      if (!skip && fonnteToken) {
        await supabaseQuery(
          "UPDATE company_settings SET fonnte_token = $1, updated_at = NOW() WHERE company_id = $2",
          [fonnteToken, companyId],
        );
      }

      await upsertSession(companyId, { current_step: 4, wa_done: !skip });

      return res.json({
        waConfigured: !skip,
        skipped: skip,
        message: skip ? "WhatsApp dilewati (dapat dikonfigurasi nanti)" : "WhatsApp berhasil dikonfigurasi",
      });
    } catch (err) {
      logger.error({ err }, "POST /whatsapp failed");
      return res.status(500).json({ error: "Gagal mengkonfigurasi WhatsApp" });
    }
  },
);

// ── POST /api/company-onboarding/:companyId/modules — Step 4 ─────────────────

companyOnboardingRouter.post(
  "/api/company-onboarding/:companyId/modules",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    try {
      const companyId = req.params.companyId as string;
      const { modules } = req.body as { modules?: string[] };

      if (!modules || modules.length === 0) {
        return res.status(400).json({ error: "Pilih minimal satu modul" });
      }

      const validKeys = ALL_MODULES.map(m => m.key);
      const selectedModules = modules.filter(m => validKeys.includes(m));

      await supabaseQuery(
        "DELETE FROM company_modules WHERE company_id = $1", [companyId],
      );

      for (const moduleKey of selectedModules) {
        await supabaseQuery(
          `INSERT INTO company_modules (company_id, module_key, is_enabled, enabled_at)
           VALUES ($1, $2, true, NOW())
           ON CONFLICT (company_id, module_key) DO UPDATE SET is_enabled = true, enabled_at = NOW()`,
          [companyId, moduleKey],
        );
      }

      await upsertSession(companyId, { current_step: 5, modules_done: true });

      return res.json({
        selectedModules,
        count: selectedModules.length,
        message: `${selectedModules.length} modul berhasil dikonfigurasi`,
      });
    } catch (err) {
      logger.error({ err }, "POST /modules failed");
      return res.status(500).json({ error: "Gagal mengkonfigurasi modul" });
    }
  },
);

// ── POST /api/company-onboarding/:companyId/seed — Step 5 ────────────────────

companyOnboardingRouter.post(
  "/api/company-onboarding/:companyId/seed",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    try {
      const companyId = req.params.companyId as string;
      const { customers = [], vendors = [], teamMembers = [], fleetUnits = [], skip = false } = req.body as {
        customers?: Array<{ name: string; phone?: string; email?: string }>;
        vendors?: Array<{ name: string; category?: string; phone?: string }>;
        teamMembers?: Array<{ name: string; role?: string; division?: string; phone?: string }>;
        fleetUnits?: Array<{ plateNumber: string; vehicleType?: string }>;
        skip?: boolean;
      };

      if (skip) {
        await upsertSession(companyId, { current_step: 6, seed_done: true });
        return res.json({ skipped: true, message: "Data awal dilewati (dapat diisi nanti)" });
      }

      const results = { customers: 0, vendors: 0, teamMembers: 0, fleetUnits: 0 };

      for (const c of customers) {
        if (!c.name) continue;
        await supabaseQuery(
          `INSERT INTO customers (company_id, name, company_name, phone, email, created_at, updated_at)
           VALUES ($1,$2,$2,$3,$4,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [companyId, c.name, c.phone ?? null, c.email ?? null],
        ).catch(() => null);
        results.customers++;
      }

      for (const v of vendors) {
        if (!v.name) continue;
        await supabaseQuery(
          `INSERT INTO suppliers (company_id, name, category, phone, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'active',NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [companyId, v.name, v.category ?? null, v.phone ?? null],
        ).catch(() => null);
        results.vendors++;
      }

      for (const t of teamMembers) {
        if (!t.name) continue;
        await supabaseQuery(
          `INSERT INTO team_members (company_id, name, role, division, phone, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [companyId, t.name, t.role ?? "staff", t.division ?? null, t.phone ?? null],
        ).catch(() => null);
        results.teamMembers++;
      }

      for (const f of fleetUnits) {
        if (!f.plateNumber) continue;
        await supabaseQuery(
          `INSERT INTO fleet_units (company_id, plate_number, vehicle_type, status, created_at, updated_at)
           VALUES ($1,$2,$3,'available',NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [companyId, f.plateNumber.toUpperCase(), f.vehicleType ?? null],
        ).catch(() => null);
        results.fleetUnits++;
      }

      await upsertSession(companyId, { current_step: 6, seed_done: true });

      return res.json({ results, message: "Data awal berhasil diseed", skipped: false });
    } catch (err) {
      logger.error({ err }, "POST /seed failed");
      return res.status(500).json({ error: "Gagal menseed data awal" });
    }
  },
);

// ── GET /api/company-onboarding/:companyId/readiness — Step 6 ────────────────

companyOnboardingRouter.get(
  "/api/company-onboarding/:companyId/readiness",
  requireAuth,
  requireRole("super_admin", "company_admin"),
  async (req: Request, res: Response) => {
    try {
      const companyId = req.params.companyId as string;

      const [settingsRows, userCount, moduleCount, sessionRows] = await Promise.all([
        safeRows<{
          company_name: string | null; company_phone: string | null; company_email: string | null;
          industry_type: string | null; fonnte_token: string | null; ai_enabled: boolean;
        }>(
          `SELECT company_name, company_phone, company_email, industry_type,
                  fonnte_token, ai_enabled FROM company_settings WHERE company_id = $1`,
          [companyId],
        ),
        safeCount("SELECT COUNT(*) AS cnt FROM users WHERE company_id = $1 AND role IN ('owner','company_admin')", [companyId]),
        safeCount("SELECT COUNT(*) AS cnt FROM company_modules WHERE company_id = $1 AND is_enabled = true", [companyId]),
        safeRows<{ profile_done: boolean; admin_done: boolean; wa_done: boolean; modules_done: boolean }>(
          "SELECT * FROM company_onboarding_sessions WHERE company_id = $1", [companyId],
        ),
      ]);

      const s = settingsRows[0] ?? {};
      const session = sessionRows[0] ?? {};

      const checks = [
        { name: "Profil Perusahaan",     passed: !!(s.company_name && s.industry_type),                 weight: 20, detail: s.company_name ? `${s.company_name} (${s.industry_type})` : "Belum diisi" },
        { name: "Kontak Perusahaan",     passed: !!(s.company_phone || s.company_email),                 weight: 10, detail: s.company_phone ?? s.company_email ?? "Belum diisi" },
        { name: "Admin User",            passed: userCount >= 1,                                          weight: 25, detail: `${userCount} admin terdaftar` },
        { name: "WhatsApp",              passed: !!s.fonnte_token,                                        weight: 20, detail: s.fonnte_token ? "Fonnte token terkonfigurasi" : "Belum dikonfigurasi" },
        { name: "Modul Aktif",           passed: moduleCount >= 1,                                        weight: 15, detail: `${moduleCount} modul aktif` },
        { name: "AI Enabled",            passed: !!(s.ai_enabled),                                        weight: 10, detail: s.ai_enabled ? "AI aktif" : "AI nonaktif" },
      ];

      const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
      const earnedWeight = checks.filter(c => c.passed).reduce((s, c) => s + c.weight, 0);
      const readinessPct = Math.round((earnedWeight / totalWeight) * 100);
      const isReady = readinessPct >= 80;

      await supabaseQuery(
        `UPDATE company_onboarding_sessions SET readiness_pct = $1, updated_at = NOW()
         WHERE company_id = $2`,
        [readinessPct, companyId],
      ).catch(() => null);

      return res.json({
        companyId,
        readinessPct,
        isReady,
        checks,
        session,
        message: isReady
          ? "✅ Perusahaan siap Go Live (≥80%)"
          : `⚠️ Belum siap — ${readinessPct}% terpenuhi. Lengkapi item yang belum passed.`,
      });
    } catch (err) {
      logger.error({ err }, "GET /readiness failed");
      return res.status(500).json({ error: "Gagal menghitung readiness" });
    }
  },
);

// ── POST /api/company-onboarding/:companyId/go-live — Step 7 ─────────────────

companyOnboardingRouter.post(
  "/api/company-onboarding/:companyId/go-live",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response) => {
    try {
      const companyId = req.params.companyId as string;

      const settingsRows = await safeRows<{ company_name: string | null }>(
        "SELECT company_name FROM company_settings WHERE company_id = $1", [companyId],
      );
      if (settingsRows.length === 0) {
        return res.status(404).json({ error: "Perusahaan tidak ditemukan" });
      }

      const readinessPct = await (async () => {
        const r = await safeRows<{ readiness_pct: number }>(
          "SELECT readiness_pct FROM company_onboarding_sessions WHERE company_id = $1", [companyId],
        );
        return r[0]?.readiness_pct ?? 0;
      })();

      if (readinessPct < 80) {
        return res.status(400).json({
          error: `Readiness ${readinessPct}% belum memenuhi minimum 80% untuk Go Live`,
          readinessPct,
        });
      }

      const companyName = settingsRows[0]?.company_name ?? companyId;
      const now = new Date().toISOString();

      const welcomeChecklist = [
        { item: "Login ke dashboard dengan akun admin", done: false },
        { item: "Atur WhatsApp webhook (jika belum)", done: false },
        { item: "Tambah anggota tim dan assign role", done: false },
        { item: "Upload template pesan WhatsApp", done: false },
        { item: "Aktifkan AI dispatcher (opsional)", done: false },
        { item: "Mulai menerima pesan WhatsApp pertama", done: false },
      ];

      const activationAudit = {
        activatedAt: now,
        activatedBy: req.user?.email ?? "system",
        readinessPct,
        companyId,
        companyName,
      };

      await supabaseQuery(
        `UPDATE company_onboarding_sessions
         SET went_live_at = NOW(), current_step = 7, readiness_pct = $1,
             welcome_checklist = $2::jsonb, activation_audit = $3::jsonb, updated_at = NOW()
         WHERE company_id = $4`,
        [readinessPct, JSON.stringify(welcomeChecklist), JSON.stringify(activationAudit), companyId],
      );

      await supabaseQuery(
        `INSERT INTO audit_logs (company_id, module, action, entity_type, entity_id, actor_email, description, created_at)
         VALUES ($1, 'onboarding', 'go_live', 'company', 0, $2, $3, NOW())`,
        [companyId, req.user?.email ?? "system", `Go Live: ${companyName} (${readinessPct}% readiness)`],
      ).catch(() => null);

      logger.info({ companyId, readinessPct, activatedBy: req.user?.email }, "Company went live");

      return res.json({
        companyId,
        companyName,
        wentLiveAt: now,
        readinessPct,
        welcomeChecklist,
        activationAudit,
        message: `🚀 ${companyName} berhasil Go Live!`,
      });
    } catch (err) {
      logger.error({ err }, "POST /go-live failed");
      return res.status(500).json({ error: "Gagal melakukan Go Live" });
    }
  },
);
