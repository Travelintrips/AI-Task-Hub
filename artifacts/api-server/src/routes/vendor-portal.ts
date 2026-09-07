/**
 * Sprint 10A-3 — Vendor Self-Service Portal
 * Sprint 10A-3.1 — Vendor Portal Hardening
 *
 * Public (token-gated, no auth):
 *   GET  /api/public/vendor/register/:token           — form schema
 *   POST /api/public/vendor/register/:token           — submit registration
 *   GET  /api/public/vendor/status/:token             — vendor status page data
 *   GET  /api/public/vendor/documents/:token          — document list + status
 *   POST /api/public/vendor/documents/:token/upload   — upload document file
 *
 * Internal (from WA handler):
 *   POST /api/vendors/portal/generate-token  — generate portal token
 *
 * Admin (requireAuth):
 *   GET  /api/vendors/pending-review         — list pending submissions
 *   POST /api/vendors/:id/review             — approve / reject / revision
 *   GET  /api/vendors/adoption-metrics       — self-service adoption stats
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { sendFonnte } from "../lib/fonnte";
import { uploadBuffer } from "../lib/supabase";
import { validateDocument } from "../lib/document-validation-engine";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateToken(): string {
  return randomBytes(24).toString("hex");
}

async function validatePortalToken(token: string, purpose?: string) {
  const rows = await db.execute(sql`
    SELECT id, vendor_id, phone, token_purpose, expires_at, used_at, is_revoked
    FROM vendor_portal_tokens
    WHERE token = ${token}
    LIMIT 1
  `);
  const row = (rows.rows as Record<string, unknown>[])[0];
  if (!row) return { valid: false, error: "Token tidak ditemukan" };
  if (row["is_revoked"]) return { valid: false, error: "Token telah dicabut" };
  if (row["expires_at"] && new Date(row["expires_at"] as string) < new Date())
    return { valid: false, error: "Token sudah kedaluwarsa" };
  if (purpose && row["token_purpose"] !== purpose)
    return { valid: false, error: "Token tidak sesuai tujuan" };
  return { valid: true, row };
}

const REQUIRED_DOCS_BY_SERVICE: Record<string, string[]> = {
  trucking:   ["npwp", "nib", "stnk", "kir"],
  sea_freight:["npwp", "nib", "siup", "company_profile"],
  air_freight:["npwp", "nib", "siup"],
  warehousing:["npwp", "nib", "siup"],
  customs:    ["npwp", "nib", "siup", "pkc"],
  default:    ["npwp", "nib"],
};

function getRequiredDocs(serviceType: string): string[] {
  const key = Object.keys(REQUIRED_DOCS_BY_SERVICE).find(k =>
    serviceType?.toLowerCase().includes(k)
  );
  return REQUIRED_DOCS_BY_SERVICE[key ?? "default"];
}

// ─── POST /api/vendors/portal/generate-token (internal) ──────────────────────

router.post("/vendors/portal/generate-token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, purpose = "register", vendor_id } = req.body as Record<string, unknown>;
    if (!phone) { res.status(400).json({ error: "phone wajib diisi" }); return; }

    const token = generateToken();
    const expiryHours = purpose === "register" ? 72 : 24; // 72h for register, 24h for others
    const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000);

    await db.execute(sql`
      INSERT INTO vendor_portal_tokens (token, vendor_id, phone, token_purpose, expires_at)
      VALUES (${token}, ${vendor_id ?? null}, ${String(phone)}, ${String(purpose)}, ${expiresAt.toISOString()})
    `);

    res.json({ token, expires_at: expiresAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "generate-token failed");
    res.status(500).json({ error: "Gagal membuat token" });
  }
});

// ─── GET /api/public/vendor/register/:token ───────────────────────────────────

router.get("/public/vendor/register/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token, "register");
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    // If vendor_id exists, prefill existing data
    const vendorId = (check.row as Record<string, unknown>)["vendor_id"] as number | null;
    let prefill: Record<string, unknown> = {};
    if (vendorId) {
      const vRows = await db.execute(sql`
        SELECT name, service_type, phone, contact_person, contact_email,
               note, nib, npwp, coverage_area, vehicle_type, service_capacity, registration_status
        FROM suppliers WHERE id = ${vendorId} LIMIT 1
      `);
      prefill = (vRows.rows as Record<string, unknown>[])[0] ?? {};
    }

    res.json({
      status: "ok",
      phone: (check.row as Record<string, unknown>)["phone"],
      prefill,
      fields: [
        { name: "company_name",      label: "Nama Perusahaan",        type: "text",   required: true,  help: "Nama PT/CV/UD lengkap" },
        { name: "pic_name",          label: "Nama PIC (Kontak)",       type: "text",   required: true,  help: "Nama penanggung jawab" },
        { name: "phone",             label: "Nomor WhatsApp PIC",      type: "text",   required: true,  help: "Nomor aktif untuk notifikasi" },
        { name: "email",             label: "Email Perusahaan",        type: "text",   required: false, help: "Email untuk korespondensi" },
        { name: "service_type",      label: "Jenis Layanan Utama",     type: "select", required: true,
          options: ["Trucking Darat","Sea Freight","Air Freight","Warehousing","Customs Clearance","Project Cargo","Cold Chain","Lainnya"],
          help: "Pilih layanan yang paling utama" },
        { name: "coverage_area",     label: "Area Operasional",        type: "text",   required: true,  help: "Kota-kota yang dapat dilayani, contoh: Jakarta, Surabaya, Semarang" },
        { name: "vehicle_type",      label: "Jenis Kendaraan / Kapal", type: "text",   required: false, help: "Contoh: Fuso CDD, Tronton, Kontainer 20ft" },
        { name: "service_capacity",  label: "Kapasitas Layanan",       type: "text",   required: false, help: "Contoh: 50 ton/bulan, 20 unit truck" },
        { name: "npwp",              label: "Nomor NPWP",              type: "text",   required: false, help: "Format: XX.XXX.XXX.X-XXX.XXX" },
        { name: "nib",               label: "Nomor NIB",               type: "text",   required: false, help: "Nomor Induk Berusaha dari OSS" },
        { name: "notes",             label: "Catatan Tambahan",        type: "textarea", required: false, help: "Info lain yang perlu diketahui tim kami" },
      ],
    });
  } catch (err) {
    logger.error({ err }, "GET /public/vendor/register failed");
    res.status(500).json({ error: "Gagal memuat form" });
  }
});

// ─── POST /api/public/vendor/register/:token ──────────────────────────────────

router.post("/public/vendor/register/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token, "register");
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    const tokenRow = check.row as Record<string, unknown>;
    const phone = tokenRow["phone"] as string;
    const existingVendorId = tokenRow["vendor_id"] as number | null;

    const {
      company_name, pic_name, phone: submittedPhone, email,
      service_type, coverage_area, vehicle_type, service_capacity,
      npwp, nib, notes,
    } = req.body as Record<string, string | undefined>;

    if (!company_name?.trim()) {
      res.status(400).json({ error: "Nama perusahaan wajib diisi" });
      return;
    }
    if (!service_type) {
      res.status(400).json({ error: "Jenis layanan wajib dipilih" });
      return;
    }

    const contactPhone = submittedPhone ?? phone;
    let vendorId: number;

    // Check if supplier already exists for this phone
    const existingByPhone = await db.execute(sql`
      SELECT id FROM suppliers WHERE portal_phone = ${phone} OR phone = ${phone} LIMIT 1
    `);
    const existingRow = (existingByPhone.rows as Record<string, unknown>[])[0];

    if (existingRow || existingVendorId) {
      const id = existingVendorId ?? (existingRow!["id"] as number);
      await db.execute(sql`
        UPDATE suppliers SET
          name             = ${company_name.trim()},
          service_type     = ${service_type},
          phone            = ${contactPhone},
          contact_person   = ${pic_name ?? null},
          contact_email    = ${email ?? null},
          note             = ${notes ?? null},
          nib              = ${nib ?? null},
          npwp             = ${npwp ?? null},
          coverage_area    = ${coverage_area ?? null},
          vehicle_type     = ${vehicle_type ?? null},
          service_capacity = ${service_capacity ?? null},
          portal_phone     = ${phone},
          registration_status = 'pending_review'
        WHERE id = ${id}
      `);
      vendorId = id;
    } else {
      const inserted = await db.execute(sql`
        INSERT INTO suppliers (
          name, service_type, phone, contact_person, contact_email, note,
          nib, npwp, coverage_area, vehicle_type, service_capacity, portal_phone,
          registration_status, is_active, logo, sort_order, created_at
        ) VALUES (
          ${company_name.trim()}, ${service_type}, ${contactPhone},
          ${pic_name ?? null}, ${email ?? null}, ${notes ?? null},
          ${nib ?? null}, ${npwp ?? null}, ${coverage_area ?? null},
          ${vehicle_type ?? null}, ${service_capacity ?? null}, ${phone},
          'pending_review', false, '', 100, NOW()
        ) RETURNING id
      `);
      vendorId = (inserted.rows as Record<string, unknown>[])[0]!["id"] as number;
    }

    // Update token with vendor_id
    await db.execute(sql`
      UPDATE vendor_portal_tokens
      SET vendor_id = ${vendorId}, used_at = NOW()
      WHERE token = ${token}
    `);

    // Create ai_task for procurement review
    try {
      await db.execute(sql`
        INSERT INTO ai_tasks (
          task_number, title, description, status, priority, category,
          customer_name, customer_phone, source, created_at
        ) VALUES (
          'VND-' || LPAD(${vendorId}::text, 5, '0'),
          ${'Vendor Baru: ' + company_name.trim()},
          ${'Pendaftaran vendor baru via portal self-service. Service: ' + service_type + '. Area: ' + (coverage_area ?? '-')},
          'open', 'medium', 'vendor_onboarding',
          ${company_name.trim()}, ${contactPhone}, 'vendor_portal', NOW()
        )
        ON CONFLICT (task_number) DO UPDATE
          SET title = EXCLUDED.title, description = EXCLUDED.description
      `);
    } catch (taskErr) {
      logger.warn({ taskErr }, "Failed to create ai_task for vendor registration");
    }

    // Notify admin via Fonnte (non-blocking) — query team_members for active admins
    (async () => {
      try {
        const adminRows = await db.execute(sql`
          SELECT phone FROM team_members
          WHERE role IN ('super_admin', 'company_admin', 'owner')
            AND phone IS NOT NULL AND is_active = true
          LIMIT 10
        `);
        const adminPhones = (adminRows.rows as Record<string, unknown>[])
          .map(r => String(r["phone"] ?? "")).filter(p => p.length > 5);
        if (adminPhones.length === 0 && process.env["ADMIN_PHONE"]) {
          adminPhones.push(process.env["ADMIN_PHONE"]);
        }
        const requiredForNotif = getRequiredDocs(service_type);
        const msg =
          `🏢 *Vendor Baru Terdaftar — Perlu Review*\n\n` +
          `Perusahaan: ${(company_name as string).trim()}\n` +
          `Layanan: ${service_type ?? "-"}\n` +
          `PIC: ${pic_name ?? "-"} (${contactPhone})\n` +
          `Dokumen wajib: ${requiredForNotif.join(", ").toUpperCase()}\n` +
          `Status: Pending Review\n\n` +
          `👉 Review di halaman admin vendor portal.`;
        await Promise.allSettled(adminPhones.map(p => sendFonnte(p, msg)));
      } catch (notifErr) {
        logger.warn({ notifErr }, "vendor-portal: admin WA notification failed");
      }
    })();

    const requiredDocs = getRequiredDocs(service_type);
    const _domains = process.env["REPLIT_DOMAINS"] ?? "";
    const _devDomain = process.env["REPLIT_DEV_DOMAIN"] ?? "";
    const BASE_URL = process.env["BASE_URL"]
      ?? (_domains ? `https://${_domains.split(",")[0]?.trim()}` : null)
      ?? (_devDomain ? `https://${_devDomain}` : null)
      ?? "http://localhost:5000";
    const statusToken = generateToken();
    const statusExpires = new Date(Date.now() + 30 * 24 * 3600 * 1000); // 30 days
    await db.execute(sql`
      INSERT INTO vendor_portal_tokens (token, vendor_id, phone, token_purpose, expires_at)
      VALUES (${statusToken}, ${vendorId}, ${phone}, 'status', ${statusExpires.toISOString()})
    `);
    const statusUrl = `${BASE_URL}/vendor/status/${statusToken}`;

    res.json({
      success: true,
      vendor_id: vendorId,
      message: "Pendaftaran berhasil! Tim kami akan mereview dalam 1-2 hari kerja.",
      registration_status: "pending_review",
      required_docs: requiredDocs,
      status_url: statusUrl,
    });
  } catch (err) {
    logger.error({ err }, "POST /public/vendor/register failed");
    res.status(500).json({ error: "Gagal menyimpan pendaftaran" });
  }
});

// ─── GET /api/public/vendor/status/:token ─────────────────────────────────────

router.get("/public/vendor/status/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token, "status");
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    const tokenRow = check.row as Record<string, unknown>;
    const vendorId = tokenRow["vendor_id"] as number | null;
    if (!vendorId) { res.status(404).json({ error: "Vendor belum terdaftar" }); return; }

    const vRows = await db.execute(sql`
      SELECT id, name, service_type, phone, contact_person, contact_email,
             registration_status, review_notes, nib, npwp, coverage_area,
             vehicle_type, service_capacity, is_active, created_at
      FROM suppliers WHERE id = ${vendorId} LIMIT 1
    `);
    const vendor = (vRows.rows as Record<string, unknown>[])[0];
    if (!vendor) { res.status(404).json({ error: "Vendor tidak ditemukan" }); return; }

    // Get documents
    const docRows = await db.execute(sql`
      SELECT document_type, file_url, expiry_date, is_verified, is_current, created_at
      FROM vendor_document_registry
      WHERE vendor_id = ${vendorId}
      ORDER BY created_at DESC
    `);
    const docs = docRows.rows as Record<string, unknown>[];

    const serviceType = String(vendor["service_type"] ?? "");
    const requiredDocs = getRequiredDocs(serviceType);
    const uploadedDocTypes = docs.map(d => String(d["document_type"] ?? ""));
    const missingDocs = requiredDocs.filter(d => !uploadedDocTypes.includes(d));

    // Capability completeness
    const caps = [];
    if (vendor["service_type"]) caps.push("Jenis Layanan");
    if (vendor["coverage_area"]) caps.push("Area Operasional");
    if (vendor["vehicle_type"]) caps.push("Kendaraan");
    if (vendor["service_capacity"]) caps.push("Kapasitas");
    if (vendor["npwp"]) caps.push("NPWP");
    if (vendor["nib"]) caps.push("NIB");
    const capScore = Math.round((caps.length / 6) * 100);

    const statusLabels: Record<string, string> = {
      unregistered: "Belum Terdaftar",
      pending_review: "Menunggu Review",
      approved: "Disetujui",
      rejected: "Ditolak",
      needs_revision: "Perlu Revisi",
    };

    const nextAction: Record<string, string> = {
      unregistered: "Lakukan pendaftaran via tautan yang kami kirim",
      pending_review: "Tunggu konfirmasi dari tim kami (1-2 hari kerja)",
      approved: "Selamat! Akun vendor Anda telah aktif",
      rejected: "Hubungi admin untuk informasi lebih lanjut",
      needs_revision: "Perbarui informasi sesuai catatan review dan hubungi admin",
    };

    res.json({
      vendor: {
        id: vendor["id"],
        name: vendor["name"],
        service_type: vendor["service_type"],
        registration_status: vendor["registration_status"],
        status_label: statusLabels[String(vendor["registration_status"] ?? "unregistered")],
        review_notes: vendor["review_notes"],
        capability_score: capScore,
        completed_capabilities: caps,
      },
      documents: {
        uploaded: docs.map(d => ({
          type: d["document_type"],
          is_verified: d["is_verified"],
          expiry_date: d["expiry_date"],
        })),
        missing: missingDocs,
        required: requiredDocs,
      },
      next_action: nextAction[String(vendor["registration_status"] ?? "unregistered")],
    });
  } catch (err) {
    logger.error({ err }, "GET /public/vendor/status failed");
    res.status(500).json({ error: "Gagal memuat status" });
  }
});

// ─── GET /api/public/vendor/documents/:token ──────────────────────────────────

router.get("/public/vendor/documents/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token, "documents");
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    const tokenRow = check.row as Record<string, unknown>;
    const vendorId = tokenRow["vendor_id"] as number | null;
    if (!vendorId) { res.status(404).json({ error: "Vendor belum terdaftar" }); return; }

    const vRows = await db.execute(sql`
      SELECT id, name, service_type FROM suppliers WHERE id = ${vendorId} LIMIT 1
    `);
    const vendor = (vRows.rows as Record<string, unknown>[])[0];
    if (!vendor) { res.status(404).json({ error: "Vendor tidak ditemukan" }); return; }

    const docRows = await db.execute(sql`
      SELECT id, document_type, file_url, file_name, expiry_date,
             is_verified, is_current, created_at
      FROM vendor_document_registry
      WHERE vendor_id = ${vendorId}
      ORDER BY created_at DESC
    `);
    const docs = docRows.rows as Record<string, unknown>[];

    const serviceType = String(vendor["service_type"] ?? "");
    const requiredDocs = getRequiredDocs(serviceType);
    const uploadedDocTypes = new Set(docs.map(d => String(d["document_type"] ?? "")));
    const missingDocs = requiredDocs.filter(d => !uploadedDocTypes.has(d));

    const docLabels: Record<string, string> = {
      npwp: "NPWP Perusahaan",
      nib: "NIB (Nomor Induk Berusaha)",
      siup: "SIUP / Izin Usaha",
      stnk: "STNK Kendaraan",
      kir: "Surat KIR / Uji Berkala",
      company_profile: "Company Profile",
      pkc: "PKC (Persetujuan Kelayakan Kepabeanan)",
      insurance: "Sertifikat Asuransi",
    };

    res.json({
      vendor_name: vendor["name"],
      uploaded_documents: docs.map(d => ({
        id: d["id"],
        type: d["document_type"],
        label: docLabels[String(d["document_type"] ?? "")] ?? String(d["document_type"]),
        file_name: d["file_name"],
        file_url: d["file_url"],
        is_verified: d["is_verified"],
        expiry_date: d["expiry_date"],
        status: d["status"],
        uploaded_at: d["created_at"],
      })),
      missing_documents: missingDocs.map(d => ({
        type: d,
        label: docLabels[d] ?? d,
      })),
      required_documents: requiredDocs.map(d => ({
        type: d,
        label: docLabels[d] ?? d,
        uploaded: uploadedDocTypes.has(d),
      })),
      _meta: { total_required: requiredDocs.length, total_uploaded: docs.length },
    });
  } catch (err) {
    logger.error({ err }, "GET /public/vendor/documents failed");
    res.status(500).json({ error: "Gagal memuat dokumen" });
  }
});

// ─── POST /api/public/vendor/documents/:token/upload ──────────────────────────
// Body (JSON): { document_type, file_name, file_base64, mime_type?, expiry_date? }
// Max file: 8 MB (base64 ~10.7 MB JSON body)

router.post("/public/vendor/documents/:token/upload", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };

    // ── Token validation ────────────────────────────────────────────────────────
    const check = await validatePortalToken(token, "documents");
    if (!check.valid) {
      res.status(401).json({ error: check.error ?? "Token tidak valid atau sudah kadaluarsa" });
      return;
    }

    const tokenRow = check.row as Record<string, unknown>;
    const vendorId = tokenRow["vendor_id"] as number | null;
    if (!vendorId) {
      res.status(404).json({ error: "Vendor belum terdaftar" });
      return;
    }

    // ── Input validation ────────────────────────────────────────────────────────
    const body = req.body as Record<string, unknown>;
    const documentType = String(body["document_type"] ?? "").trim().toLowerCase();
    const fileName     = String(body["file_name"]     ?? "").trim();
    const fileBase64   = String(body["file_base64"]   ?? "").trim();
    const mimeType     = String(body["mime_type"]     ?? "application/octet-stream");
    const expiryDate   = body["expiry_date"] ? String(body["expiry_date"]) : null;

    if (!documentType) { res.status(400).json({ error: "document_type wajib diisi" }); return; }
    if (!fileName)     { res.status(400).json({ error: "file_name wajib diisi" }); return; }
    if (!fileBase64)   { res.status(400).json({ error: "file_base64 wajib diisi" }); return; }

    const ALLOWED_TYPES = ["npwp", "nib", "siup", "stnk", "kir", "company_profile", "pkc", "insurance"];
    if (!ALLOWED_TYPES.includes(documentType)) {
      res.status(400).json({ error: `Tipe dokumen tidak valid. Pilih: ${ALLOWED_TYPES.join(", ")}` });
      return;
    }

    const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!ALLOWED_MIME.includes(mimeType)) {
      res.status(400).json({ error: "Format file tidak didukung. Gunakan PDF, JPG, atau PNG." });
      return;
    }

    // ── Decode + size check (max 8 MB) ──────────────────────────────────────────
    let fileBuffer: Buffer;
    try {
      fileBuffer = Buffer.from(fileBase64, "base64");
    } catch {
      res.status(400).json({ error: "file_base64 tidak valid" });
      return;
    }
    const MAX_BYTES = 8 * 1024 * 1024;
    if (fileBuffer.byteLength > MAX_BYTES) {
      res.status(413).json({ error: "Ukuran file maksimal 8 MB" });
      return;
    }

    // ── Upload ke Supabase Storage ──────────────────────────────────────────────
    const safeName    = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectPath  = `vendor-docs/${vendorId}/${documentType}_${Date.now()}_${safeName}`;
    const { publicUrl } = await uploadBuffer(fileBuffer, objectPath, mimeType);

    // ── Mark dokumen lama sebagai tidak aktif ───────────────────────────────────
    await db.execute(sql`
      UPDATE vendor_document_registry
      SET is_current = false
      WHERE vendor_id = ${vendorId} AND document_type = ${documentType}
    `);

    // ── Insert record baru ──────────────────────────────────────────────────────
    const inserted = await db.execute(sql`
      INSERT INTO vendor_document_registry (
        company_id, vendor_id, document_type, file_name, file_url,
        object_path, mime_type, file_size_bytes, source_type,
        expiry_date, is_current, is_verified, uploaded_at, created_at
      ) VALUES (
        'default', ${vendorId}, ${documentType}, ${fileName}, ${publicUrl},
        ${objectPath}, ${mimeType}, ${fileBuffer.byteLength}, 'portal',
        ${expiryDate}, true, false, NOW(), NOW()
      ) RETURNING id
    `);
    const docId = (inserted.rows as Record<string, unknown>[])[0]!["id"] as number;

    // ── Trigger DocumentValidationEngine (async — tidak blokir response) ─────────
    let auditResult: { validationStatus: string; confidenceScore: number; issues: string[] } | null = null;
    try {
      const vResult = await validateDocument({
        companyId: "default",
        documentType,
        fileName,
        fileUrl: publicUrl,
        objectPath,
        vendorId,
      });

      auditResult = {
        validationStatus: vResult.validationStatus,
        confidenceScore:  vResult.confidenceScore,
        issues:           vResult.missingFields ?? [],
      };

      // Update registry dengan hasil audit
      await db.execute(sql`
        UPDATE vendor_document_registry
        SET is_verified = ${vResult.validationStatus === "valid"},
            verification_notes = ${vResult.issueSummary ?? null}
        WHERE id = ${docId}
      `);
    } catch (auditErr) {
      logger.warn({ auditErr, docId }, "vendor-upload: DocumentValidationEngine gagal (non-fatal)");
    }

    logger.info({ vendorId, documentType, docId, fileSize: fileBuffer.byteLength }, "vendor-upload: dokumen berhasil diupload");

    res.json({
      success:         true,
      document_id:     docId,
      document_type:   documentType,
      file_url:        publicUrl,
      file_size_bytes: fileBuffer.byteLength,
      audit:           auditResult
        ? {
            status:     auditResult.validationStatus,
            score:      auditResult.confidenceScore,
            passed:     auditResult.validationStatus === "valid",
            issues:     auditResult.issues,
          }
        : { status: "pending", score: null, passed: null, issues: [] },
      message: auditResult?.validationStatus === "valid"
        ? "Dokumen berhasil diupload dan terverifikasi ✅"
        : "Dokumen berhasil diupload — menunggu verifikasi admin",
    });
  } catch (err) {
    logger.error({ err }, "POST /public/vendor/documents/:token/upload failed");
    res.status(500).json({ error: "Gagal mengupload dokumen" });
  }
});

// ─── GET /api/vendors/pending-review (admin) ──────────────────────────────────

router.get("/vendors/pending-review", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.execute(sql`
      SELECT s.id, s.name, s.service_type, s.phone, s.contact_person, s.contact_email,
             s.nib, s.npwp, s.coverage_area, s.vehicle_type, s.service_capacity,
             s.registration_status, s.review_notes, s.created_at,
             COUNT(vdr.id)::int AS doc_count
      FROM suppliers s
      LEFT JOIN vendor_document_registry vdr ON vdr.vendor_id = s.id
      WHERE s.registration_status IN ('pending_review','needs_revision')
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT 50
    `);
    res.json(rows.rows);
  } catch (err) {
    logger.error({ err }, "GET /vendors/pending-review failed");
    res.status(500).json({ error: "Gagal memuat daftar review" });
  }
});

// ─── POST /api/vendors/:id/review (admin) ─────────────────────────────────────

router.post("/vendors/:id/review", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const { action, notes } = req.body as { action?: string; notes?: string };
    const validActions = ["approve", "reject", "request_revision"];
    if (!action || !validActions.includes(action)) {
      res.status(400).json({ error: "Action tidak valid. Gunakan: approve | reject | request_revision" });
      return;
    }

    const statusMap: Record<string, string> = {
      approve: "approved",
      reject: "rejected",
      request_revision: "needs_revision",
    };
    const newStatus = statusMap[action];

    await db.execute(sql`
      UPDATE suppliers
      SET registration_status = ${newStatus},
          review_notes        = ${notes ?? null},
          is_active           = ${action === "approve"}
      WHERE id = ${id}
    `);

    // Get vendor phone to notify
    const vRows = await db.execute(sql`
      SELECT name, phone, portal_phone FROM suppliers WHERE id = ${id} LIMIT 1
    `);
    const vendor = (vRows.rows as Record<string, unknown>[])[0];
    const notifyPhone = String((vendor?.["portal_phone"] ?? vendor?.["phone"]) ?? "");
    const vendorName = String(vendor?.["name"] ?? "");

    const waMessages: Record<string, string> = {
      approve: `🎉 *Selamat! Pendaftaran Vendor Disetujui*\n\nYth. ${vendorName},\n\nAkun vendor Anda telah *disetujui*. Anda kini dapat menerima permintaan dari tim kami.\n\nTerima kasih telah bergabung!`,
      reject: `❌ *Pendaftaran Vendor Tidak Disetujui*\n\nYth. ${vendorName},\n\nMohon maaf, pendaftaran Anda tidak dapat kami setujui saat ini.\n\n${notes ? "Alasan: " + notes + "\n\n" : ""}Untuk informasi lebih lanjut, hubungi tim admin kami.`,
      request_revision: `📝 *Pendaftaran Vendor — Perlu Revisi*\n\nYth. ${vendorName},\n\nPendaftaran Anda memerlukan perbaikan:\n\n${notes ?? "(lihat catatan admin)"}\n\nSilakan perbarui dan hubungi admin kami.`,
    };

    if (notifyPhone && notifyPhone !== "admin") {
      sendFonnte(notifyPhone, waMessages[action]).catch(() => {});
    }

    res.json({ success: true, vendor_id: id, new_status: newStatus });
  } catch (err) {
    logger.error({ err }, "POST /vendors/:id/review failed");
    res.status(500).json({ error: "Gagal memproses review" });
  }
});

// ─── GET /api/vendors/adoption-metrics (admin) ────────────────────────────────

router.get("/vendors/adoption-metrics", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const statsRows = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE registration_status != 'unregistered')::int AS self_service_registrations,
        COUNT(*) FILTER (WHERE registration_status = 'pending_review')::int AS pending_review,
        COUNT(*) FILTER (WHERE registration_status = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE registration_status = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE registration_status = 'needs_revision')::int AS needs_revision,
        COUNT(*) FILTER (WHERE registration_status = 'approved' AND nib IS NOT NULL AND npwp IS NOT NULL)::int AS fully_complete,
        COUNT(*)::int AS total_vendors
      FROM suppliers
    `);

    const docStats = await db.execute(sql`
      SELECT COUNT(*)::int AS total_docs_uploaded,
             COUNT(DISTINCT vendor_id)::int AS vendors_with_docs,
             AVG(CASE WHEN is_verified THEN 1 ELSE 0 END)::numeric AS verification_rate
      FROM vendor_document_registry
    `);

    const tokenStats = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE token_purpose = 'register')::int AS register_tokens_sent,
        COUNT(*) FILTER (WHERE token_purpose = 'register' AND used_at IS NOT NULL)::int AS registrations_completed,
        COUNT(*) FILTER (WHERE token_purpose = 'register' AND expires_at < NOW() AND used_at IS NULL)::int AS expired_unused
      FROM vendor_portal_tokens
    `);

    const stats = (statsRows.rows as Record<string, unknown>[])[0] ?? {};
    const docs = (docStats.rows as Record<string, unknown>[])[0] ?? {};
    const tokens = (tokenStats.rows as Record<string, unknown>[])[0] ?? {};

    const completedReg = Number(tokens["registrations_completed"] ?? 0);
    const sentTokens = Number(tokens["register_tokens_sent"] ?? 0);
    const conversionRate = sentTokens > 0 ? Math.round((completedReg / sentTokens) * 100) : 0;

    const approved = Number(stats["approved"] ?? 0);
    const total = Number(stats["self_service_registrations"] ?? 0);
    const completionRate = total > 0 ? Math.round((approved / total) * 100) : 0;

    res.json({
      registrations: {
        total_self_service: stats["self_service_registrations"],
        pending_review: stats["pending_review"],
        approved: stats["approved"],
        rejected: stats["rejected"],
        needs_revision: stats["needs_revision"],
        fully_complete: stats["fully_complete"],
      },
      documents: {
        total_uploaded: docs["total_docs_uploaded"],
        vendors_with_docs: docs["vendors_with_docs"],
        verification_rate: Math.round(Number(docs["verification_rate"] ?? 0) * 100),
      },
      funnel: {
        tokens_sent: tokens["register_tokens_sent"],
        registrations_completed: tokens["registrations_completed"],
        expired_unused: tokens["expired_unused"],
        conversion_rate: conversionRate,
      },
      onboarding_completion_pct: completionRate,
    });
  } catch (err) {
    logger.error({ err }, "GET /vendors/adoption-metrics failed");
    res.status(500).json({ error: "Gagal memuat metrics" });
  }
});

export default router;
