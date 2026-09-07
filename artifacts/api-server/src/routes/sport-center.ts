/**
 * Sport Center Booking Management Routes — Admin (auth required)
 *
 * GET    /api/sport-center/bookings         — list bookings (filter: date, field_type, status)
 * GET    /api/sport-center/bookings/:id     — get single booking
 * POST   /api/sport-center/bookings         — manually create booking
 * PATCH  /api/sport-center/bookings/:id     — update status / notes / payment
 * DELETE /api/sport-center/bookings/:id     — delete booking
 * GET    /api/sport-center/stats            — summary counts & today schedule
 * GET    /api/sport-center/availability     — check slot availability
 */

import { Router, type Request, type Response } from "express";
import { supabasePool } from "../lib/supabase-db";
import { logger } from "../lib/logger";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  checkSportCenterAvailability,
  saveSportCenterBooking,
  normalizeDateString,
} from "../lib/sport-center-availability";

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

function getCompanyId(req: Request): string {
  return (req.user as { companyId?: string } | undefined)?.companyId ?? "default";
}

function safeRows<T = Record<string, unknown>>(result: { rows: T[] } | T[]): T[] {
  if (Array.isArray(result)) return result;
  return result.rows ?? [];
}

// ── GET /sport-center/bookings ────────────────────────────────────────────────

router.get("/sport-center/bookings", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const pool = supabasePool;
  if (!pool) { res.status(503).json({ error: "DB not available" }); return; }

  const companyId = getCompanyId(req);
  const { date, field_type, status, from, to, search, limit = "100", offset = "0" } = req.query as Record<string, string>;

  try {
    const conditions: string[] = ["company_id = $1"];
    const params: unknown[] = [companyId];
    let idx = 2;

    if (date) {
      conditions.push(`booking_date = $${idx++}`);
      params.push(normalizeDateString(date) ?? date);
    }
    if (from) {
      conditions.push(`booking_date >= $${idx++}`);
      params.push(normalizeDateString(from) ?? from);
    }
    if (to) {
      conditions.push(`booking_date <= $${idx++}`);
      params.push(normalizeDateString(to) ?? to);
    }
    if (field_type && field_type !== "all") {
      conditions.push(`LOWER(field_type) = LOWER($${idx++})`);
      params.push(field_type);
    }
    if (status && status !== "all") {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }
    if (search) {
      conditions.push(`(customer_name ILIKE ${idx} OR phone ILIKE ${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.join(" AND ");
    const lim = Math.min(parseInt(limit, 10) || 100, 500);
    const off = parseInt(offset, 10) || 0;

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT id, company_id, ai_task_id, intake_session_id,
                booking_number, facility_name, field_type,
                booking_date, start_time, end_time, duration_hours,
                customer_name, phone, notes, status,
                total_price, price_per_hour,
                payment_status, payment_proof_url, payment_proof_token,
                payment_deadline, admin_notes,
                created_at, updated_at
         FROM sport_center_bookings
         WHERE ${where}
         ORDER BY booking_date DESC, start_time ASC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, lim, off],
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM sport_center_bookings WHERE ${where}`,
        params,
      ),
    ]);

    res.json({
      data: safeRows(dataRes),
      total: parseInt((safeRows(countRes)[0] as { total: string } | undefined)?.total ?? "0", 10),
      limit: lim,
      offset: off,
    });
  } catch (err) {
    logger.error({ err }, "GET /sport-center/bookings failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /sport-center/bookings/:id ───────────────────────────────────────────

router.get("/sport-center/bookings/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const pool = supabasePool;
  if (!pool) { res.status(503).json({ error: "DB not available" }); return; }

  const companyId = getCompanyId(req);
  try {
    const result = await pool.query(
      `SELECT * FROM sport_center_bookings WHERE id = $1 AND company_id = $2`,
      [req.params.id, companyId],
    );
    const rows = safeRows(result);
    if (!rows.length) { res.status(404).json({ error: "Booking not found" }); return; }
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "GET /sport-center/bookings/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /sport-center/bookings ───────────────────────────────────────────────

router.post(
  "/sport-center/bookings",
  requireAuth,
  requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const pool = supabasePool;
    if (!pool) { res.status(503).json({ error: "DB not available" }); return; }

    const companyId = getCompanyId(req);
    const { fieldType, bookingDate, startTime, endTime, durationHours, bookerName, phone, notes } =
      req.body as Record<string, string>;

    if (!fieldType || !bookingDate || !startTime) {
      res.status(400).json({ error: "fieldType, bookingDate, startTime wajib diisi" });
      return;
    }

    const durHours = durationHours ? parseFloat(durationHours) : 1;

    try {
      const saved = await saveSportCenterBooking({
        companyId,
        fieldType,
        bookingDate,
        startTime,
        endTime: endTime || null,
        durationHours: durHours,
        bookerName: bookerName || null,
        phone: phone || null,
        notes: notes || null,
      });
      if (!saved) throw new Error("saveSportCenterBooking returned null");
      logger.info({ id: saved.id, bookingNumber: saved.bookingNumber, companyId }, "sport_center_booking created manually");
      res.status(201).json(saved);
    } catch (err) {
      logger.error({ err }, "POST /sport-center/bookings failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /sport-center/bookings/:id ─────────────────────────────────────────

router.patch(
  "/sport-center/bookings/:id",
  requireAuth,
  requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const pool = supabasePool;
    if (!pool) { res.status(503).json({ error: "DB not available" }); return; }

    const companyId = getCompanyId(req);
    const { status, notes, bookerName, phone, startTime, endTime, bookingDate, fieldType, paymentStatus, adminNotes } =
      req.body as Record<string, string>;

    const VALID_STATUS = ["pending", "confirmed", "cancelled", "completed"];
    const VALID_PAYMENT = ["unpaid", "waiting_verification", "paid", "cancelled"];
    if (status && !VALID_STATUS.includes(status)) {
      res.status(400).json({ error: `Status tidak valid. Gunakan: ${VALID_STATUS.join(", ")}` });
      return;
    }
    if (paymentStatus && !VALID_PAYMENT.includes(paymentStatus)) {
      res.status(400).json({ error: `Payment status tidak valid. Gunakan: ${VALID_PAYMENT.join(", ")}` });
      return;
    }

    try {
      const sets: string[] = ["updated_at = NOW()"];
      const params: unknown[] = [];
      let idx = 1;

      const addSet = (col: string, val: unknown) => {
        sets.push(`${col} = $${idx++}`);
        params.push(val);
      };

      if (status)                   addSet("status",          status);
      if (paymentStatus)            addSet("payment_status",  paymentStatus);
      if (notes !== undefined)      addSet("notes",           notes);
      if (adminNotes !== undefined) addSet("admin_notes",     adminNotes);
      if (bookerName)               addSet("customer_name",   bookerName);
      if (phone)                    addSet("phone",           phone);
      if (startTime)                addSet("start_time",      startTime);
      if (endTime)                  addSet("end_time",        endTime);
      if (fieldType)                addSet("field_type",      fieldType);
      if (bookingDate)              addSet("booking_date",    normalizeDateString(bookingDate) ?? bookingDate);

      if (sets.length === 1) { res.status(400).json({ error: "Tidak ada field yang diupdate" }); return; }

      params.push(req.params.id, companyId);
      const result = await pool.query(
        `UPDATE sport_center_bookings SET ${sets.join(", ")}
         WHERE id = $${idx} AND company_id = $${idx + 1}
         RETURNING *`,
        params,
      );
      const rows = safeRows(result);
      if (!rows.length) { res.status(404).json({ error: "Booking not found" }); return; }
      res.json(rows[0]);
    } catch (err) {
      logger.error({ err }, "PATCH /sport-center/bookings/:id failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── DELETE /sport-center/bookings/:id ────────────────────────────────────────

router.delete(
  "/sport-center/bookings/:id",
  requireAuth,
  requireRole("company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const pool = supabasePool;
    if (!pool) { res.status(503).json({ error: "DB not available" }); return; }

    const companyId = getCompanyId(req);
    try {
      const result = await pool.query(
        `DELETE FROM sport_center_bookings WHERE id = $1 AND company_id = $2 RETURNING id`,
        [req.params.id, companyId],
      );
      const rows = safeRows(result);
      if (!rows.length) { res.status(404).json({ error: "Booking not found" }); return; }
      res.json({ success: true, id: (rows[0] as { id: number }).id });
    } catch (err) {
      logger.error({ err }, "DELETE /sport-center/bookings/:id failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── GET /sport-center/stats ───────────────────────────────────────────────────

router.get("/sport-center/stats", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const pool = supabasePool;
  if (!pool) { res.status(503).json({ error: "DB not available" }); return; }

  const companyId = getCompanyId(req);
  try {
    const [statusRes, todayRes, weekRes, fieldRes] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*) AS count FROM sport_center_bookings WHERE company_id = $1 GROUP BY status`,
        [companyId],
      ),
      pool.query(
        `SELECT id, booking_number, facility_name, field_type, start_time, end_time,
                customer_name, phone, status, payment_status, total_price
         FROM sport_center_bookings
         WHERE company_id = $1 AND booking_date = CURRENT_DATE
         ORDER BY start_time ASC`,
        [companyId],
      ),
      pool.query(
        `SELECT COUNT(*) AS count FROM sport_center_bookings
         WHERE company_id = $1 AND booking_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`,
        [companyId],
      ),
      pool.query(
        `SELECT field_type, COUNT(*) AS count FROM sport_center_bookings
         WHERE company_id = $1 AND booking_date >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY field_type ORDER BY count DESC`,
        [companyId],
      ),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const row of safeRows(statusRes)) {
      const r = row as { status: string; count: string };
      statusCounts[r.status] = parseInt(r.count, 10);
    }

    res.json({
      statusCounts,
      todayBookings: safeRows(todayRes),
      weekAheadTotal: parseInt((safeRows(weekRes)[0] as { count: string } | undefined)?.count ?? "0", 10),
      fieldTypeCounts: safeRows(fieldRes),
    });
  } catch (err) {
    logger.error({ err }, "GET /sport-center/stats failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /sport-center/availability ───────────────────────────────────────────

router.get("/sport-center/availability", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { fieldType, bookingDate, startTime, durationHours } = req.query as Record<string, string>;
  const companyId = getCompanyId(req);

  if (!fieldType || !bookingDate || !startTime) {
    res.status(400).json({ error: "fieldType, bookingDate, startTime wajib" });
    return;
  }

  try {
    const result = await checkSportCenterAvailability({
      fieldType,
      bookingDate,
      startTime,
      durationHours: durationHours ? parseFloat(durationHours) : undefined,
      companyId,
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "GET /sport-center/availability failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
