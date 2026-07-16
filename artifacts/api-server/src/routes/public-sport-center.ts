/**
 * Public Sport Center Routes — no auth required, token-based access
 *
 * GET  /api/public/sc/status/:token         — check booking status by payment_proof_token (globally unique)
 * GET  /api/public/sc/my-bookings           — list bookings by phone + company (?phone=...&company=...)
 * POST /api/public/sc/bukti/:token          — upload payment proof URL (by payment_proof_token)
 *
 * Multi-tenant safety:
 *  - status / bukti use payment_proof_token which has a global UNIQUE constraint → no cross-tenant leak
 *  - my-bookings requires `company` param and scopes by company_id
 */

import { Router, type Request, type Response } from "express";
import { supabasePool } from "../lib/supabase-db";
import { logger } from "../lib/logger";

const router = Router();

function safeRows<T = Record<string, unknown>>(result: { rows: T[] } | T[]): T[] {
  if (Array.isArray(result)) return result;
  return result.rows ?? [];
}

function sanitizeBooking(row: Record<string, unknown>) {
  return {
    id:               row.id,
    bookingNumber:    row.booking_number,
    facilityName:     row.facility_name ?? row.field_type,
    fieldType:        row.field_type,
    bookingDate:      String(row.booking_date ?? "").slice(0, 10),
    startTime:        row.start_time,
    endTime:          row.end_time,
    durationHours:    row.duration_hours != null ? Number(row.duration_hours) : null,
    bookerName:       row.customer_name,
    phone:            row.phone,
    status:           row.status,
    paymentStatus:    row.payment_status ?? "unpaid",
    totalPrice:       row.total_price != null ? Number(row.total_price) : null,
    paymentDeadline:  row.payment_deadline,
    paymentProofUrl:   row.payment_proof_url,
    paymentProofToken: row.payment_proof_token,
    adminNotes:        row.admin_notes,
    createdAt:         row.created_at,
  };
}

// ── GET /api/public/sc/status/:token ─────────────────────────────────────────
// Uses payment_proof_token which is globally UNIQUE — no cross-tenant risk.

router.get("/public/sc/status/:token", async (req: Request, res: Response): Promise<void> => {
  const pool = supabasePool;
  if (!pool) { res.status(503).json({ error: "DB not available" }); return; }

  const { token } = req.params;
  if (!token || token.length < 4) {
    res.status(400).json({ error: "Token tidak valid" });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT * FROM sport_center_bookings WHERE payment_proof_token = $1 LIMIT 1`,
      [token],
    );
    const rows = safeRows(result);
    if (!rows.length) { res.status(404).json({ error: "Booking tidak ditemukan" }); return; }
    res.json({ data: sanitizeBooking(rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err }, "GET /public/sc/status/:token failed");
    res.status(500).json({ error: "Terjadi kesalahan" });
  }
});

// ── GET /api/public/sc/my-bookings?phone=628xxx&company=default ───────────────
// Scoped by company_id to prevent cross-tenant data disclosure.

router.get("/public/sc/my-bookings", async (req: Request, res: Response): Promise<void> => {
  const pool = supabasePool;
  if (!pool) { res.status(503).json({ error: "DB not available" }); return; }

  const raw     = String(req.query.phone   ?? "").trim();
  const company = String(req.query.company ?? "default").trim();

  if (!raw || raw.length < 5) {
    res.status(400).json({ error: "Parameter phone wajib diisi" });
    return;
  }
  if (!company) {
    res.status(400).json({ error: "Parameter company wajib diisi" });
    return;
  }

  // Normalize phone: strip non-digits then produce both 62xxx and 0xxx forms
  const digits     = raw.replace(/\D/g, "");
  const normalized = digits.startsWith("62") ? digits : `62${digits.replace(/^0/, "")}`;
  const withZero   = `0${normalized.slice(2)}`;

  try {
    const result = await pool.query(
      `SELECT * FROM sport_center_bookings
       WHERE company_id = $1
         AND (phone = $2 OR phone = $3)
       ORDER BY booking_date DESC, start_time ASC
       LIMIT 50`,
      [company, normalized, withZero],
    );
    const rows = safeRows(result) as Record<string, unknown>[];
    res.json({ data: rows.map(sanitizeBooking), total: rows.length });
  } catch (err) {
    logger.error({ err }, "GET /public/sc/my-bookings failed");
    res.status(500).json({ error: "Terjadi kesalahan" });
  }
});

// ── POST /api/public/sc/bukti/:token ─────────────────────────────────────────
// payment_proof_token is globally UNIQUE — no cross-tenant risk.

router.post("/public/sc/bukti/:token", async (req: Request, res: Response): Promise<void> => {
  const pool = supabasePool;
  if (!pool) { res.status(503).json({ error: "DB not available" }); return; }

  const { token }   = req.params;
  const { proofUrl } = req.body as { proofUrl?: string };

  if (!token) { res.status(400).json({ error: "Token tidak valid" }); return; }
  if (!proofUrl) { res.status(400).json({ error: "proofUrl wajib diisi" }); return; }

  // Basic URL validation
  try { new URL(proofUrl); } catch {
    res.status(400).json({ error: "proofUrl harus berupa URL yang valid" });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE sport_center_bookings
       SET payment_proof_url = $1,
           payment_status    = 'waiting_verification',
           updated_at        = NOW()
       WHERE payment_proof_token = $2
       RETURNING id, booking_number, payment_status`,
      [proofUrl, token],
    );
    const rows = safeRows(result);
    if (!rows.length) { res.status(404).json({ error: "Token tidak ditemukan atau sudah expired" }); return; }
    const row = rows[0] as Record<string, unknown>;
    logger.info({ bookingNumber: row.booking_number, token }, "Payment proof uploaded");
    res.json({
      success: true,
      message: "Bukti transfer berhasil diunggah. Admin akan segera memverifikasi pembayaran Anda.",
      bookingNumber: row.booking_number,
      paymentStatus: row.payment_status,
    });
  } catch (err) {
    logger.error({ err }, "POST /public/sc/bukti failed");
    res.status(500).json({ error: "Terjadi kesalahan" });
  }
});

export default router;
