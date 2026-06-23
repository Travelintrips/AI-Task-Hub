/**
 * Sprint 10A-1.2 — Task 1: Vendor Master
 *
 * DECISION: OPTION A — Reuse `suppliers` table as single source of truth.
 *
 * suppliers = canonical vendor master (28 records, used by purchasing flows)
 * vendor_* tables = behavioral intelligence layer (enrichment only)
 *
 * NOTE: GET /api/vendors and GET /api/vendors/:id/... are handled by vendor-memory.ts
 *       which already correctly queries the suppliers table as canonical source.
 *       This router adds WRITE operations (POST, PATCH) to suppliers via /api/vendors.
 *
 * POST  /api/vendors         — create vendor (inserts into suppliers)
 * PATCH /api/vendors/:id     — update vendor in suppliers
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── POST /api/vendors ─────────────────────────────────────────────────────────

router.post("/vendors", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, service_type, phone, country, contact_person, contact_email, note } = req.body as Record<string, string | undefined>;

    if (!name || !name.trim()) {
      res.status(400).json({ error: "Nama vendor wajib diisi" });
      return;
    }

    const rows = await db.execute(sql`
      INSERT INTO suppliers (name, service_type, phone, country, contact_person, contact_email, note, is_active, logo, sort_order, created_at)
      VALUES (${name.trim()}, ${service_type ?? null}, ${phone ?? null}, ${country ?? null}, ${contact_person ?? null}, ${contact_email ?? null}, ${note ?? null}, true, '', 100, NOW())
      RETURNING id, name, service_type, phone, country, is_active, created_at
    `);

    res.status(201).json((rows.rows as Record<string, unknown>[])[0]);
  } catch (err) {
    logger.error({ err }, "POST /vendors failed");
    res.status(500).json({ error: "Gagal membuat vendor" });
  }
});

// ── PATCH /api/vendors/:id ────────────────────────────────────────────────────

router.patch("/vendors/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params["id"] as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: "ID tidak valid" }); return; }

    const { name, service_type, phone, country, contact_person, contact_email, note, is_active } = req.body as Record<string, unknown>;

    await db.execute(sql`
      UPDATE suppliers SET
        name            = COALESCE(${name as string ?? null}, name),
        service_type    = COALESCE(${service_type as string ?? null}, service_type),
        phone           = COALESCE(${phone as string ?? null}, phone),
        country         = COALESCE(${country as string ?? null}, country),
        contact_person  = COALESCE(${contact_person as string ?? null}, contact_person),
        contact_email   = COALESCE(${contact_email as string ?? null}, contact_email),
        note            = COALESCE(${note as string ?? null}, note),
        is_active       = COALESCE(${is_active as boolean ?? null}, is_active)
      WHERE id = ${id}
    `);

    const updated = await db.execute(sql`SELECT id, name, service_type, phone, is_active FROM suppliers WHERE id = ${id} LIMIT 1`);
    res.json((updated.rows as Record<string, unknown>[])[0] ?? { id });
  } catch (err) {
    logger.error({ err }, "PATCH /vendors/:id failed");
    res.status(500).json({ error: "Gagal update vendor" });
  }
});

export default router;
