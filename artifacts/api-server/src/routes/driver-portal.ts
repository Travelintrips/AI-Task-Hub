/**
 * Sprint 10A-4 — Driver Self-Service Portal
 *
 * Public (token-gated, no auth):
 *   GET  /api/public/driver/home/:token                 — dashboard data
 *   GET  /api/public/driver/profile/:token              — onboarding form schema + current data
 *   POST /api/public/driver/profile/:token              — submit/update driver profile
 *   GET  /api/public/driver/documents/:token            — document list + status
 *   POST /api/public/driver/documents/:token/upload     — upload SIM/KTP/medical/photo
 *   GET  /api/public/driver/trips/:token                — active trip
 *   POST /api/public/driver/trips/:token/start          — start trip
 *   POST /api/public/driver/trips/:token/end            — end trip
 *   GET  /api/public/driver/history/:token              — trip history
 *
 * Internal (from WA handler):
 *   POST /api/drivers/portal/generate-token             — generate 72h portal token
 *
 * Admin (requireAuth):
 *   GET  /api/drivers/admin                             — admin review dashboard
 *   POST /api/drivers/:id/approve-document              — approve/reject driver document
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

function baseUrl(): string {
  return process.env["BASE_URL"] ?? `https://${process.env["REPL_SLUG"] ?? "app"}.replit.app`;
}

interface TokenCheck {
  valid: boolean;
  error?: string;
  row?: Record<string, unknown>;
}

async function validatePortalToken(token: string): Promise<TokenCheck> {
  const rows = await db.execute(sql`
    SELECT id, driver_id, phone, expires_at, is_revoked
    FROM driver_portal_tokens WHERE token = ${token} LIMIT 1
  `);
  const row = (rows.rows as Record<string, unknown>[])[0];
  if (!row) return { valid: false, error: "Token tidak ditemukan" };
  if (row["is_revoked"]) return { valid: false, error: "Token sudah tidak aktif" };
  if (row["expires_at"] && new Date(row["expires_at"] as string) < new Date()) {
    return { valid: false, error: "Token sudah kadaluarsa. Kirim DAFTAR DRIVER via WhatsApp untuk token baru." };
  }
  return { valid: true, row };
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400_000);
}

// ─── POST /api/drivers/portal/generate-token ──────────────────────────────────

router.post("/drivers/portal/generate-token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, driver_id } = req.body as Record<string, unknown>;
    if (!phone) { res.status(400).json({ error: "phone wajib diisi" }); return; }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);

    // Auto-link driver_id if driver already exists with this phone
    let resolvedDriverId: number | null = (driver_id as number | null) ?? null;
    if (!resolvedDriverId) {
      const existing = await db.execute(sql`SELECT id FROM fleet_drivers WHERE phone = ${String(phone)} LIMIT 1`);
      const row = (existing.rows as Record<string, unknown>[])[0];
      if (row) resolvedDriverId = row["id"] as number;
    }

    await db.execute(sql`
      INSERT INTO driver_portal_tokens (token, driver_id, phone, expires_at)
      VALUES (${token}, ${resolvedDriverId}, ${String(phone)}, ${expiresAt.toISOString()})
    `);
    res.json({ token, expires_at: expiresAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "POST /drivers/portal/generate-token failed");
    res.status(500).json({ error: "Gagal membuat token" });
  }
});

// ─── GET /api/public/driver/home/:token ───────────────────────────────────────

router.get("/public/driver/home/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token);
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    const tokenRow = check.row!;
    const driverId = tokenRow["driver_id"] as number | null;
    const phone    = tokenRow["phone"] as string;

    // Look up driver by id or phone
    const drvRows = driverId
      ? await db.execute(sql`SELECT * FROM fleet_drivers WHERE id = ${driverId} LIMIT 1`)
      : await db.execute(sql`SELECT * FROM fleet_drivers WHERE phone = ${phone} LIMIT 1`);

    const driver = (drvRows.rows as Record<string, unknown>[])[0] ?? null;

    // Active trip
    let activeTrip: Record<string, unknown> | null = null;
    if (driver) {
      const tripRows = await db.execute(sql`
        SELECT u.id, u.destination, u.origin, u.actual_departure, u.status,
               f.plate_number AS vehicle_plate
        FROM fleet_utilization_logs u
        LEFT JOIN fleet_units f ON f.id = u.fleet_unit_id
        WHERE u.driver_id = ${driver["id"] as number} AND u.status = 'on_route'
        ORDER BY u.actual_departure DESC LIMIT 1
      `);
      activeTrip = (tripRows.rows as Record<string, unknown>[])[0] ?? null;
    }

    // Documents status
    let docSummary: Record<string, boolean> = {};
    if (driver) {
      const docRows = await db.execute(sql`
        SELECT document_type FROM driver_documents
        WHERE driver_id = ${driver["id"] as number} AND is_current = true
      `);
      const uploaded = new Set((docRows.rows as Record<string, unknown>[]).map(r => String(r["document_type"])));
      docSummary = { sim: uploaded.has("sim"), ktp: uploaded.has("ktp"), medical: uploaded.has("medical"), photo: uploaded.has("photo") };
    }

    // Last fuel log
    let lastFuel: Record<string, unknown> | null = null;
    if (driver?.["primary_vehicle_id"]) {
      const fuelRows = await db.execute(sql`
        SELECT liters_filled, km_per_liter, logged_at
        FROM fleet_fuel_logs WHERE fleet_unit_id = ${driver["primary_vehicle_id"] as number}
        ORDER BY logged_at DESC LIMIT 1
      `);
      lastFuel = (fuelRows.rows as Record<string, unknown>[])[0] ?? null;
    }

    const licExpiry = daysUntil(driver?.["license_expired"] as string | undefined);

    res.json({
      driver: driver ? {
        id: driver["id"],
        name: driver["full_name"],
        status: driver["status"],
        license_number: driver["license_number"],
        license_type: driver["license_type"],
        license_expired: driver["license_expired"],
        license_days_left: licExpiry,
        license_warning: licExpiry !== null && licExpiry <= 30,
        primary_vehicle_id: driver["primary_vehicle_id"],
        base_location: driver["base_location"],
      } : null,
      registered: !!driver,
      active_trip: activeTrip,
      documents: docSummary,
      documents_complete: Object.values(docSummary).every(Boolean),
      last_fuel: lastFuel,
      portal_links: {
        profile:   `${baseUrl()}/driver/profile/${token}`,
        documents: `${baseUrl()}/driver/documents/${token}`,
        trips:     `${baseUrl()}/driver/trips/${token}`,
        history:   `${baseUrl()}/driver/history/${token}`,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /public/driver/home failed");
    res.status(500).json({ error: "Gagal memuat data home" });
  }
});

// ─── GET /api/public/driver/profile/:token ────────────────────────────────────

router.get("/public/driver/profile/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token);
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    const tokenRow = check.row!;
    const driverId = tokenRow["driver_id"] as number | null;
    const phone    = tokenRow["phone"] as string;

    const drvRows = driverId
      ? await db.execute(sql`SELECT * FROM fleet_drivers WHERE id = ${driverId} LIMIT 1`)
      : await db.execute(sql`SELECT * FROM fleet_drivers WHERE phone = ${phone} LIMIT 1`);
    const driver = (drvRows.rows as Record<string, unknown>[])[0] ?? null;

    // Assigned vehicle
    const vehicleRows = driver?.["primary_vehicle_id"]
      ? await db.execute(sql`SELECT id, plate_number, vehicle_type, brand, model FROM fleet_units WHERE id = ${driver["primary_vehicle_id"] as number} LIMIT 1`)
      : { rows: [] };
    const vehicle = (vehicleRows.rows as Record<string, unknown>[])[0] ?? null;

    // Available vehicles for assignment
    const vehicleListRows = await db.execute(sql`
      SELECT id, plate_number, vehicle_type, brand, model FROM fleet_units
      WHERE status = 'available' OR id = ${driver?.["primary_vehicle_id"] ?? 0}
      ORDER BY plate_number LIMIT 20
    `);

    res.json({
      registered: !!driver,
      driver: driver ? {
        id: driver["id"],
        full_name: driver["full_name"],
        phone: driver["phone"],
        employee_id: driver["employee_id"],
        license_number: driver["license_number"],
        license_type: driver["license_type"],
        license_expired: driver["license_expired"],
        join_date: driver["join_date"],
        emergency_contact: driver["emergency_contact"],
        emergency_phone: driver["emergency_phone"],
        base_location: driver["base_location"],
        primary_vehicle_id: driver["primary_vehicle_id"],
        status: driver["status"],
      } : null,
      assigned_vehicle: vehicle,
      available_vehicles: vehicleListRows.rows as Record<string, unknown>[],
      fields: [
        { name: "full_name",         label: "Nama Lengkap",        type: "text",   required: true  },
        { name: "phone",             label: "Nomor HP",            type: "tel",    required: true  },
        { name: "license_number",    label: "Nomor SIM",           type: "text",   required: true  },
        { name: "license_type",      label: "Jenis SIM",           type: "select", required: true,
          options: ["SIM A", "SIM B1", "SIM B2", "SIM C"]               },
        { name: "license_expired",   label: "Masa Berlaku SIM",    type: "date",   required: true  },
        { name: "emergency_contact", label: "Kontak Darurat (Nama)", type: "text", required: false },
        { name: "emergency_phone",   label: "HP Kontak Darurat",   type: "tel",    required: false },
        { name: "base_location",     label: "Lokasi Tugas",        type: "text",   required: false },
      ],
    });
  } catch (err) {
    logger.error({ err }, "GET /public/driver/profile failed");
    res.status(500).json({ error: "Gagal memuat profil" });
  }
});

// ─── POST /api/public/driver/profile/:token ───────────────────────────────────

router.post("/public/driver/profile/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token);
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    const tokenRow = check.row!;
    const phone    = tokenRow["phone"] as string;
    const driverId = tokenRow["driver_id"] as number | null;

    const body = req.body as Record<string, unknown>;
    const fullName       = String(body["full_name"]      ?? "").trim();
    const licenseNumber  = String(body["license_number"] ?? "").trim();
    const licenseType    = String(body["license_type"]   ?? "SIM B2").trim();
    const licenseExpired = body["license_expired"] ? String(body["license_expired"]) : null;
    const emergencyContact = body["emergency_contact"] ? String(body["emergency_contact"]) : null;
    const emergencyPhone   = body["emergency_phone"] ? String(body["emergency_phone"]) : null;
    const baseLocation     = body["base_location"] ? String(body["base_location"]) : null;
    const primaryVehicleId = body["primary_vehicle_id"] ? Number(body["primary_vehicle_id"]) : null;

    if (!fullName)      { res.status(400).json({ error: "full_name wajib diisi" }); return; }
    if (!licenseNumber) { res.status(400).json({ error: "license_number wajib diisi" }); return; }

    // Check existing by id or phone
    const existRows = driverId
      ? await db.execute(sql`SELECT id FROM fleet_drivers WHERE id = ${driverId} LIMIT 1`)
      : await db.execute(sql`SELECT id FROM fleet_drivers WHERE phone = ${phone} LIMIT 1`);
    const existing = (existRows.rows as Record<string, unknown>[])[0] ?? null;

    let finalDriverId: number;

    if (existing) {
      // Update
      finalDriverId = existing["id"] as number;
      await db.execute(sql`
        UPDATE fleet_drivers SET
          full_name = ${fullName}, phone = ${phone},
          license_number = ${licenseNumber}, license_type = ${licenseType},
          license_expired = ${licenseExpired}, emergency_contact = ${emergencyContact},
          emergency_phone = ${emergencyPhone}, base_location = ${baseLocation},
          primary_vehicle_id = ${primaryVehicleId}, updated_at = NOW()
        WHERE id = ${finalDriverId}
      `);
    } else {
      // Insert
      const inserted = await db.execute(sql`
        INSERT INTO fleet_drivers (
          company_id, full_name, phone, license_number, license_type, license_expired,
          emergency_contact, emergency_phone, base_location, primary_vehicle_id,
          status, join_date, created_at, updated_at
        ) VALUES (
          'default', ${fullName}, ${phone}, ${licenseNumber}, ${licenseType}, ${licenseExpired},
          ${emergencyContact}, ${emergencyPhone}, ${baseLocation}, ${primaryVehicleId},
          'active', CURRENT_DATE, NOW(), NOW()
        ) RETURNING id
      `);
      finalDriverId = (inserted.rows as Record<string, unknown>[])[0]!["id"] as number;
    }

    // Bind driver_id to token
    await db.execute(sql`
      UPDATE driver_portal_tokens SET driver_id = ${finalDriverId} WHERE token = ${token}
    `);

    // Notify admin (non-blocking)
    (async () => {
      try {
        const adminRows = await db.execute(sql`
          SELECT phone FROM team_members
          WHERE role IN ('super_admin', 'company_admin', 'supervisor')
            AND phone IS NOT NULL AND is_active = true LIMIT 5
        `);
        const phones = (adminRows.rows as Record<string, unknown>[])
          .map(r => String(r["phone"] ?? "")).filter(p => p.length > 5);
        if (phones.length === 0 && process.env["ADMIN_PHONE"]) phones.push(process.env["ADMIN_PHONE"]);
        const msg = `🚛 *Driver ${existing ? "Profil Diperbarui" : "Baru Daftar"}*\n\nNama: ${fullName}\nSIM: ${licenseNumber} (${licenseType})\nHP: ${phone}\nStatus: Active`;
        await Promise.allSettled(phones.map(p => sendFonnte(p, msg)));
      } catch { /* non-fatal */ }
    })();

    res.json({
      success: true,
      driver_id: finalDriverId,
      action: existing ? "updated" : "created",
      message: existing ? "Profil berhasil diperbarui!" : "Pendaftaran berhasil! Lengkapi dokumen Anda.",
    });
  } catch (err) {
    logger.error({ err }, "POST /public/driver/profile failed");
    res.status(500).json({ error: "Gagal menyimpan profil" });
  }
});

// ─── GET /api/public/driver/documents/:token ──────────────────────────────────

router.get("/public/driver/documents/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token);
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    const driverId = check.row!["driver_id"] as number | null;
    if (!driverId) { res.status(404).json({ error: "Selesaikan pendaftaran profil dulu" }); return; }

    const docRows = await db.execute(sql`
      SELECT id, document_type, file_name, file_url, expiry_date, is_current, is_verified, verification_notes, uploaded_at
      FROM driver_documents WHERE driver_id = ${driverId} ORDER BY created_at DESC
    `);
    const docs = docRows.rows as Record<string, unknown>[];

    const REQUIRED = ["sim", "ktp", "medical", "photo"];
    const DOC_LABELS: Record<string, string> = {
      sim: "SIM (Surat Izin Mengemudi)", ktp: "KTP", medical: "Surat Keterangan Sehat", photo: "Foto Driver",
    };
    const uploaded = new Set(docs.filter(d => d["is_current"]).map(d => String(d["document_type"])));
    const missing = REQUIRED.filter(t => !uploaded.has(t));

    res.json({
      driver_id: driverId,
      uploaded_documents: docs.map(d => ({
        id: d["id"], type: d["document_type"], label: DOC_LABELS[String(d["document_type"])] ?? String(d["document_type"]),
        file_name: d["file_name"], file_url: d["file_url"],
        is_current: d["is_current"], is_verified: d["is_verified"],
        expiry_date: d["expiry_date"], notes: d["verification_notes"], uploaded_at: d["uploaded_at"],
      })),
      missing_documents: missing.map(t => ({ type: t, label: DOC_LABELS[t] ?? t })),
      required_documents: REQUIRED.map(t => ({ type: t, label: DOC_LABELS[t] ?? t, uploaded: uploaded.has(t) })),
      completion_pct: Math.round((REQUIRED.length - missing.length) / REQUIRED.length * 100),
    });
  } catch (err) {
    logger.error({ err }, "GET /public/driver/documents failed");
    res.status(500).json({ error: "Gagal memuat dokumen" });
  }
});

// ─── POST /api/public/driver/documents/:token/upload ──────────────────────────

router.post("/public/driver/documents/:token/upload", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token);
    if (!check.valid) { res.status(401).json({ error: check.error ?? "Token tidak valid atau sudah kadaluarsa" }); return; }

    const driverId = check.row!["driver_id"] as number | null;
    if (!driverId) { res.status(404).json({ error: "Selesaikan pendaftaran profil dulu" }); return; }

    const body = req.body as Record<string, unknown>;
    const documentType = String(body["document_type"] ?? "").trim().toLowerCase();
    const fileName     = String(body["file_name"]     ?? "").trim();
    const fileBase64   = String(body["file_base64"]   ?? "").trim();
    const mimeType     = String(body["mime_type"]     ?? "application/octet-stream");
    const expiryDate   = body["expiry_date"] ? String(body["expiry_date"]) : null;

    if (!documentType) { res.status(400).json({ error: "document_type wajib diisi" }); return; }
    if (!fileName)     { res.status(400).json({ error: "file_name wajib diisi" }); return; }
    if (!fileBase64)   { res.status(400).json({ error: "file_base64 wajib diisi" }); return; }

    const ALLOWED = ["sim", "ktp", "medical", "photo"];
    if (!ALLOWED.includes(documentType)) {
      res.status(400).json({ error: `Tipe dokumen tidak valid. Pilih: ${ALLOWED.join(", ")}` }); return;
    }

    const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!ALLOWED_MIME.includes(mimeType)) {
      res.status(400).json({ error: "Format tidak didukung. Gunakan PDF, JPG, atau PNG." }); return;
    }

    let fileBuffer: Buffer;
    try { fileBuffer = Buffer.from(fileBase64, "base64"); }
    catch { res.status(400).json({ error: "file_base64 tidak valid" }); return; }

    if (fileBuffer.byteLength > 8 * 1024 * 1024) {
      res.status(413).json({ error: "Ukuran file maksimal 8 MB" }); return;
    }

    const safeName   = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectPath = `driver-docs/${driverId}/${documentType}_${Date.now()}_${safeName}`;
    const { publicUrl } = await uploadBuffer(fileBuffer, objectPath, mimeType);

    // Mark old docs of same type as not current
    await db.execute(sql`
      UPDATE driver_documents SET is_current = false WHERE driver_id = ${driverId} AND document_type = ${documentType}
    `);

    // Insert new record
    const inserted = await db.execute(sql`
      INSERT INTO driver_documents (company_id, driver_id, document_type, file_name, file_url, object_path, mime_type, file_size_bytes, expiry_date, is_current, is_verified, uploaded_at, created_at)
      VALUES ('default', ${driverId}, ${documentType}, ${fileName}, ${publicUrl}, ${objectPath}, ${mimeType}, ${fileBuffer.byteLength}, ${expiryDate}, true, false, NOW(), NOW())
      RETURNING id
    `);
    const docId = (inserted.rows as Record<string, unknown>[])[0]!["id"] as number;

    // Trigger DocumentValidationEngine (async, non-blocking)
    let auditResult: { validationStatus: string; confidenceScore: number } | null = null;
    try {
      const vResult = await validateDocument({ companyId: "default", documentType, fileName, fileUrl: publicUrl, objectPath });
      auditResult = { validationStatus: vResult.validationStatus, confidenceScore: vResult.confidenceScore };
      await db.execute(sql`
        UPDATE driver_documents SET is_verified = ${vResult.validationStatus === "valid"}, verification_notes = ${vResult.issueSummary ?? null}
        WHERE id = ${docId}
      `);
    } catch (auditErr) {
      logger.warn({ auditErr, docId }, "driver-upload: audit non-fatal");
    }

    logger.info({ driverId, documentType, docId }, "driver-upload: success");

    res.json({
      success: true,
      document_id: docId,
      document_type: documentType,
      file_url: publicUrl,
      audit: auditResult
        ? { status: auditResult.validationStatus, score: auditResult.confidenceScore, passed: auditResult.validationStatus === "valid" }
        : { status: "pending", score: null, passed: null },
      message: auditResult?.validationStatus === "valid" ? "Dokumen terverifikasi ✅" : "Dokumen diupload — menunggu verifikasi admin",
    });
  } catch (err) {
    logger.error({ err }, "POST /public/driver/documents/upload failed");
    res.status(500).json({ error: "Gagal mengupload dokumen" });
  }
});

// ─── GET /api/public/driver/trips/:token ──────────────────────────────────────

router.get("/public/driver/trips/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token);
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    const driverId = check.row!["driver_id"] as number | null;
    if (!driverId) { res.status(404).json({ error: "Selesaikan pendaftaran profil dulu" }); return; }

    const activeRows = await db.execute(sql`
      SELECT u.id, u.origin, u.destination, u.trip_purpose, u.actual_departure, u.status,
             f.plate_number, f.vehicle_type, f.brand, f.model
      FROM fleet_utilization_logs u
      LEFT JOIN fleet_units f ON f.id = u.fleet_unit_id
      WHERE u.driver_id = ${driverId} AND u.status = 'on_route'
      ORDER BY u.actual_departure DESC LIMIT 1
    `);
    const activeTrip = (activeRows.rows as Record<string, unknown>[])[0] ?? null;

    // Assigned vehicle for starting a trip
    const drvRow = await db.execute(sql`SELECT primary_vehicle_id FROM fleet_drivers WHERE id = ${driverId} LIMIT 1`);
    const primaryVehicleId = (drvRow.rows as Record<string, unknown>[])[0]?.["primary_vehicle_id"] as number | null;

    let assignedVehicle: Record<string, unknown> | null = null;
    if (primaryVehicleId) {
      const vRow = await db.execute(sql`SELECT id, plate_number, vehicle_type, brand, model FROM fleet_units WHERE id = ${primaryVehicleId} LIMIT 1`);
      assignedVehicle = (vRow.rows as Record<string, unknown>[])[0] ?? null;
    }

    res.json({
      active_trip: activeTrip,
      assigned_vehicle: assignedVehicle,
      can_start_trip: !activeTrip && !!assignedVehicle,
    });
  } catch (err) {
    logger.error({ err }, "GET /public/driver/trips failed");
    res.status(500).json({ error: "Gagal memuat data trip" });
  }
});

// ─── POST /api/public/driver/trips/:token/start ───────────────────────────────

router.post("/public/driver/trips/:token/start", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token);
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    const driverId = check.row!["driver_id"] as number | null;
    if (!driverId) { res.status(404).json({ error: "Selesaikan pendaftaran profil dulu" }); return; }

    const body = req.body as Record<string, unknown>;
    const destination = String(body["destination"] ?? "").trim();
    const origin      = String(body["origin"]      ?? "").trim() || "Lokasi awal";
    const tripPurpose = String(body["trip_purpose"] ?? "pengiriman").trim();

    if (!destination) { res.status(400).json({ error: "destination wajib diisi" }); return; }

    // Check for already active trip
    const existingRows = await db.execute(sql`
      SELECT id FROM fleet_utilization_logs WHERE driver_id = ${driverId} AND status = 'on_route' LIMIT 1
    `);
    if ((existingRows.rows as Record<string, unknown>[]).length > 0) {
      res.status(409).json({ error: "Sudah ada trip aktif. Selesaikan trip sebelumnya terlebih dahulu." }); return;
    }

    // Get primary vehicle
    const drvRow = await db.execute(sql`SELECT primary_vehicle_id FROM fleet_drivers WHERE id = ${driverId} LIMIT 1`);
    const vehicleId = (drvRow.rows as Record<string, unknown>[])[0]?.["primary_vehicle_id"] as number | null;
    if (!vehicleId) { res.status(400).json({ error: "Belum ada kendaraan yang ditugaskan. Hubungi admin." }); return; }

    const inserted = await db.execute(sql`
      INSERT INTO fleet_utilization_logs (company_id, fleet_unit_id, driver_id, origin, destination, trip_purpose, actual_departure, status, created_at, updated_at)
      VALUES ('default', ${vehicleId}, ${driverId}, ${origin}, ${destination}, ${tripPurpose}, NOW(), 'on_route', NOW(), NOW())
      RETURNING id
    `);
    const tripId = (inserted.rows as Record<string, unknown>[])[0]!["id"] as number;

    // Update vehicle status
    await db.execute(sql`UPDATE fleet_units SET status = 'on_route', updated_at = NOW() WHERE id = ${vehicleId}`);

    logger.info({ driverId, vehicleId, tripId, destination }, "driver: MULAI TRIP via portal");

    res.json({
      success: true,
      trip_id: tripId,
      destination,
      started_at: new Date().toISOString(),
      message: `Trip ke ${destination} dimulai! Kirim SELESAI TRIP saat tiba.`,
    });
  } catch (err) {
    logger.error({ err }, "POST /public/driver/trips/start failed");
    res.status(500).json({ error: "Gagal memulai trip" });
  }
});

// ─── POST /api/public/driver/trips/:token/end ─────────────────────────────────

router.post("/public/driver/trips/:token/end", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token);
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    const driverId = check.row!["driver_id"] as number | null;
    if (!driverId) { res.status(404).json({ error: "Selesaikan pendaftaran profil dulu" }); return; }

    const body = req.body as Record<string, unknown>;
    const actualKm = body["actual_km"] ? Number(body["actual_km"]) : null;
    const notes    = body["notes"] ? String(body["notes"]) : null;

    const tripRows = await db.execute(sql`
      SELECT id, fleet_unit_id, actual_departure, destination FROM fleet_utilization_logs
      WHERE driver_id = ${driverId} AND status = 'on_route'
      ORDER BY actual_departure DESC LIMIT 1
    `);
    const trip = (tripRows.rows as Record<string, unknown>[])[0] ?? null;
    if (!trip) { res.status(404).json({ error: "Tidak ada trip aktif." }); return; }

    const durationMinutes = trip["actual_departure"]
      ? Math.round((Date.now() - new Date(trip["actual_departure"] as string).getTime()) / 60000)
      : null;

    await db.execute(sql`
      UPDATE fleet_utilization_logs SET status = 'completed', actual_arrival = NOW(),
        actual_km = ${actualKm}, delay_minutes = 0, notes = ${notes}, updated_at = NOW()
      WHERE id = ${trip["id"] as number}
    `);

    // Update vehicle status back to available
    await db.execute(sql`UPDATE fleet_units SET status = 'available', updated_at = NOW() WHERE id = ${trip["fleet_unit_id"] as number}`);

    // Update odometer if km provided
    if (actualKm) {
      await db.execute(sql`UPDATE fleet_units SET current_odometer_km = ${actualKm}, updated_at = NOW() WHERE id = ${trip["fleet_unit_id"] as number}`);
    }

    logger.info({ driverId, tripId: trip["id"], actualKm, durationMinutes }, "driver: SELESAI TRIP via portal");

    res.json({
      success: true,
      trip_id: trip["id"],
      destination: trip["destination"],
      duration_minutes: durationMinutes,
      actual_km: actualKm,
      message: `Trip ke ${trip["destination"]} selesai! Durasi: ${durationMinutes} menit.`,
    });
  } catch (err) {
    logger.error({ err }, "POST /public/driver/trips/end failed");
    res.status(500).json({ error: "Gagal menyelesaikan trip" });
  }
});

// ─── GET /api/public/driver/history/:token ────────────────────────────────────

router.get("/public/driver/history/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    const check = await validatePortalToken(token);
    if (!check.valid) { res.status(401).json({ error: check.error }); return; }

    const driverId = check.row!["driver_id"] as number | null;
    if (!driverId) { res.json({ trips: [], total: 0 }); return; }

    const tripRows = await db.execute(sql`
      SELECT u.id, u.origin, u.destination, u.trip_purpose, u.actual_departure, u.actual_arrival,
             u.actual_km, u.status, u.delay_minutes, u.notes,
             f.plate_number, f.vehicle_type
      FROM fleet_utilization_logs u
      LEFT JOIN fleet_units f ON f.id = u.fleet_unit_id
      WHERE u.driver_id = ${driverId} AND u.status IN ('completed', 'cancelled')
      ORDER BY u.actual_arrival DESC LIMIT 20
    `);

    res.json({
      trips: tripRows.rows as Record<string, unknown>[],
      total: (tripRows.rows as Record<string, unknown>[]).length,
    });
  } catch (err) {
    logger.error({ err }, "GET /public/driver/history failed");
    res.status(500).json({ error: "Gagal memuat riwayat" });
  }
});

// ─── GET /api/drivers/admin ───────────────────────────────────────────────────

router.get("/drivers/admin", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    // Drivers with onboarding status
    const driverRows = await db.execute(sql`
      SELECT d.id, d.full_name, d.phone, d.status, d.license_number, d.license_type, d.license_expired,
             d.primary_vehicle_id, d.base_location, d.created_at,
             f.plate_number,
             COUNT(DISTINCT dd.id) FILTER (WHERE dd.is_current = true) AS doc_count,
             COUNT(DISTINCT dd.id) FILTER (WHERE dd.is_verified = true AND dd.is_current = true) AS verified_count,
             COUNT(DISTINCT inc.id) FILTER (WHERE inc.status = 'open') AS open_incidents
      FROM fleet_drivers d
      LEFT JOIN fleet_units f ON f.id = d.primary_vehicle_id
      LEFT JOIN driver_documents dd ON dd.driver_id = d.id
      LEFT JOIN fleet_driver_incidents inc ON inc.driver_id = d.id
      GROUP BY d.id, f.plate_number
      ORDER BY d.created_at DESC LIMIT 100
    `);

    // Expiring SIMs (within 60 days)
    const expiringRows = await db.execute(sql`
      SELECT id, full_name, phone, license_number, license_expired
      FROM fleet_drivers
      WHERE license_expired IS NOT NULL AND license_expired <= CURRENT_DATE + INTERVAL '60 days'
      ORDER BY license_expired ASC LIMIT 20
    `);

    // Pending document verifications
    const pendingDocRows = await db.execute(sql`
      SELECT dd.id, dd.driver_id, dd.document_type, dd.file_name, dd.file_url, dd.uploaded_at,
             d.full_name AS driver_name, d.phone AS driver_phone
      FROM driver_documents dd
      JOIN fleet_drivers d ON d.id = dd.driver_id
      WHERE dd.is_current = true AND dd.is_verified = false AND dd.file_url IS NOT NULL
      ORDER BY dd.uploaded_at DESC LIMIT 50
    `);

    // Performance ranking (from fleet_driver_performance)
    const perfRows = await db.execute(sql`
      SELECT d.id, d.full_name, fp.overall_score, fp.period_month, fp.total_trips,
             fp.avg_fuel_efficiency, fp.incidents_count
      FROM fleet_driver_performance fp
      JOIN fleet_drivers d ON d.id = fp.driver_id
      ORDER BY fp.overall_score DESC NULLS LAST LIMIT 20
    `);

    res.json({
      drivers:           driverRows.rows as Record<string, unknown>[],
      expiring_licenses: expiringRows.rows as Record<string, unknown>[],
      pending_documents: pendingDocRows.rows as Record<string, unknown>[],
      performance:       perfRows.rows as Record<string, unknown>[],
      summary: {
        total_drivers:   (driverRows.rows as Record<string, unknown>[]).length,
        expiring_soon:   (expiringRows.rows as Record<string, unknown>[]).length,
        pending_doc_review: (pendingDocRows.rows as Record<string, unknown>[]).length,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /drivers/admin failed");
    res.status(500).json({ error: "Gagal memuat data admin driver" });
  }
});

// ─── POST /api/drivers/:id/approve-document ───────────────────────────────────

router.post("/drivers/:id/approve-document", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = Number(req.params["id"] as string);
    if (Number.isNaN(driverId)) { res.status(400).json({ error: "Invalid driver id" }); return; }

    const body = req.body as Record<string, unknown>;
    const docId     = Number(body["document_id"]);
    const action    = String(body["action"] ?? "");   // approve | reject
    const notes     = body["notes"] ? String(body["notes"]) : null;

    if (!["approve", "reject"].includes(action)) {
      res.status(400).json({ error: "action harus 'approve' atau 'reject'" }); return;
    }

    await db.execute(sql`
      UPDATE driver_documents
      SET is_verified = ${action === "approve"},
          verification_notes = ${notes},
          is_current = ${action === "approve"}
      WHERE id = ${docId} AND driver_id = ${driverId}
    `);

    // Notify driver via WA
    const drvRow = await db.execute(sql`SELECT full_name, phone FROM fleet_drivers WHERE id = ${driverId} LIMIT 1`);
    const driver = (drvRow.rows as Record<string, unknown>[])[0];
    if (driver?.["phone"]) {
      const msg = action === "approve"
        ? `✅ *Dokumen Disetujui*\n\nYth. ${driver["full_name"]},\nDokumen Anda telah diverifikasi dan disetujui.${notes ? "\n\nCatatan: " + notes : ""}`
        : `❌ *Dokumen Ditolak*\n\nYth. ${driver["full_name"]},\nDokumen Anda tidak dapat disetujui.${notes ? "\n\nAlasan: " + notes : ""}\n\nSilakan upload ulang dokumen yang valid.`;
      sendFonnte(String(driver["phone"]), msg).catch(() => {});
    }

    res.json({ success: true, driver_id: driverId, document_id: docId, action });
  } catch (err) {
    logger.error({ err }, "POST /drivers/:id/approve-document failed");
    res.status(500).json({ error: "Gagal memproses dokumen" });
  }
});

export default router;
