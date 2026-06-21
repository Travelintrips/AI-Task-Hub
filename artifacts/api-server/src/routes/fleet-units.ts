/**
 * Sprint 7B — Fleet Units API
 *
 * GET    /api/fleet/units              — list kendaraan
 * POST   /api/fleet/units              — tambah kendaraan
 * GET    /api/fleet/units/:id          — detail kendaraan
 * PATCH  /api/fleet/units/:id          — update kendaraan
 * POST   /api/fleet/units/:id/deactivate — nonaktifkan kendaraan
 * PATCH  /api/fleet/units/:id/odometer — update odometer
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  fleetUnitsTable,
  fleetDriversTable,
  fleetDocumentsTable,
  fleetMaintenanceRecordsTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";

const router: IRouter = Router();
function cid(req: Request): string { return req.user?.companyId ?? "default"; }

async function audit(req: Request, action: string, entityId: number, before?: unknown, after?: unknown) {
  await db.insert(auditLogsTable).values({
    companyId: cid(req),
    userId: req.user?.id,
    userName: req.user?.name,
    userEmail: req.user?.email,
    action,
    module: "fleet",
    entityId,
    entityType: "fleet_unit",
    before: before ? JSON.stringify(before) : null,
    after: after ? JSON.stringify(after) : null,
    ipAddress: req.ip,
  }).catch(e => logger.warn({ e }, "audit log failed"));
}

// ── GET /api/fleet/units ───────────────────────────────────────────────────────

router.get("/fleet/units", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { status, vehicleType, search, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const conditions = [
      eq(fleetUnitsTable.companyId, companyId),
      eq(fleetUnitsTable.isActive, true),
    ];
    if (status) conditions.push(eq(fleetUnitsTable.status, status));
    if (vehicleType) conditions.push(eq(fleetUnitsTable.vehicleType, vehicleType));
    if (search) {
      conditions.push(
        or(
          ilike(fleetUnitsTable.plateNumber, `%${search}%`),
          ilike(fleetUnitsTable.unitNumber, `%${search}%`),
          ilike(fleetUnitsTable.brand, `%${search}%`),
        )!
      );
    }

    const units = await db
      .select({
        unit: fleetUnitsTable,
        driverName: fleetDriversTable.fullName,
        driverPhone: fleetDriversTable.phone,
      })
      .from(fleetUnitsTable)
      .leftJoin(fleetDriversTable, eq(fleetUnitsTable.assignedDriverId, fleetDriversTable.id))
      .where(and(...conditions))
      .orderBy(desc(fleetUnitsTable.createdAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(fleetUnitsTable)
      .where(and(...conditions));

    res.json({
      data: units.map(r => ({ ...r.unit, driverName: r.driverName, driverPhone: r.driverPhone })),
      total: Number(total[0]?.count ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "fleet/units list error");
    res.status(500).json({ error: "Gagal mengambil data kendaraan" });
  }
});

// ── POST /api/fleet/units ─────────────────────────────────────────────────────

router.post("/fleet/units", requireAuth, requireRole("supervisor", "company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const body = req.body as Record<string, unknown>;

    if (!body.plateNumber || !body.unitNumber || !body.vehicleType) {
      return res.status(400).json({ error: "plateNumber, unitNumber, vehicleType wajib diisi" });
    }

    const existing = await db
      .select({ id: fleetUnitsTable.id })
      .from(fleetUnitsTable)
      .where(and(
        eq(fleetUnitsTable.companyId, companyId),
        eq(fleetUnitsTable.plateNumber, body.plateNumber as string),
        eq(fleetUnitsTable.isActive, true),
      ))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({ error: "Nomor polisi sudah terdaftar" });
    }

    const [unit] = await db.insert(fleetUnitsTable).values({
      companyId,
      unitNumber: body.unitNumber as string,
      plateNumber: body.plateNumber as string,
      vehicleType: (body.vehicleType as string) || "truck",
      brand: body.brand as string | undefined,
      model: body.model as string | undefined,
      year: body.year as number | undefined,
      engineNumber: body.engineNumber as string | undefined,
      chassisNumber: body.chassisNumber as string | undefined,
      color: body.color as string | undefined,
      capacityKg: body.capacityKg as number | undefined,
      capacityM3: body.capacityM3 as number | undefined,
      fuelType: (body.fuelType as string) || "solar",
      ownershipType: (body.ownershipType as string) || "own",
      baseLocation: body.baseLocation as string | undefined,
      notes: body.notes as string | undefined,
      createdBy: null,
    }).returning();

    await audit(req, "fleet.unit.created", unit.id, null, unit);
    res.status(201).json(unit);
  } catch (err) {
    logger.error({ err }, "fleet/units create error");
    res.status(500).json({ error: "Gagal membuat data kendaraan" });
  }
});

// ── GET /api/fleet/units/:id ──────────────────────────────────────────────────

router.get("/fleet/units/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);

    const [unit] = await db
      .select({
        unit: fleetUnitsTable,
        driverName: fleetDriversTable.fullName,
        driverPhone: fleetDriversTable.phone,
        driverLicenseType: fleetDriversTable.licenseType,
      })
      .from(fleetUnitsTable)
      .leftJoin(fleetDriversTable, eq(fleetUnitsTable.assignedDriverId, fleetDriversTable.id))
      .where(and(eq(fleetUnitsTable.id, id), eq(fleetUnitsTable.companyId, companyId)))
      .limit(1);

    if (!unit) return res.status(404).json({ error: "Kendaraan tidak ditemukan" });

    const documents = await db
      .select()
      .from(fleetDocumentsTable)
      .where(and(eq(fleetDocumentsTable.fleetUnitId, id), eq(fleetDocumentsTable.companyId, companyId)))
      .orderBy(desc(fleetDocumentsTable.createdAt));

    const maintenance = await db
      .select()
      .from(fleetMaintenanceRecordsTable)
      .where(and(eq(fleetMaintenanceRecordsTable.fleetUnitId, id), eq(fleetMaintenanceRecordsTable.companyId, companyId)))
      .orderBy(desc(fleetMaintenanceRecordsTable.createdAt))
      .limit(10);

    res.json({
      ...unit.unit,
      driverName: unit.driverName,
      driverPhone: unit.driverPhone,
      driverLicenseType: unit.driverLicenseType,
      documents,
      recentMaintenance: maintenance,
    });
  } catch (err) {
    logger.error({ err }, "fleet/units detail error");
    res.status(500).json({ error: "Gagal mengambil detail kendaraan" });
  }
});

// ── PATCH /api/fleet/units/:id ────────────────────────────────────────────────

router.patch("/fleet/units/:id", requireAuth, requireRole("supervisor", "company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);
    const body = req.body as Record<string, unknown>;

    const [existing] = await db
      .select()
      .from(fleetUnitsTable)
      .where(and(eq(fleetUnitsTable.id, id), eq(fleetUnitsTable.companyId, companyId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Kendaraan tidak ditemukan" });

    const allowed = [
      "unitNumber", "plateNumber", "vehicleType", "brand", "model", "year",
      "engineNumber", "chassisNumber", "color", "capacityKg", "capacityM3",
      "fuelType", "ownershipType", "status", "baseLocation", "assignedDriverId",
      "photoUrl", "notes",
    ];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }

    const [updated] = await db
      .update(fleetUnitsTable)
      .set(updates)
      .where(and(eq(fleetUnitsTable.id, id), eq(fleetUnitsTable.companyId, companyId)))
      .returning();

    await audit(req, "fleet.unit.updated", id, existing, updated);
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "fleet/units update error");
    res.status(500).json({ error: "Gagal update kendaraan" });
  }
});

// ── POST /api/fleet/units/:id/deactivate ─────────────────────────────────────

router.post("/fleet/units/:id/deactivate", requireAuth, requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);

    const [existing] = await db
      .select()
      .from(fleetUnitsTable)
      .where(and(eq(fleetUnitsTable.id, id), eq(fleetUnitsTable.companyId, companyId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Kendaraan tidak ditemukan" });

    const [updated] = await db
      .update(fleetUnitsTable)
      .set({ isActive: false, status: "inactive" })
      .where(and(eq(fleetUnitsTable.id, id), eq(fleetUnitsTable.companyId, companyId)))
      .returning();

    await audit(req, "fleet.unit.deactivated", id, existing, updated);
    res.json({ success: true, unit: updated });
  } catch (err) {
    logger.error({ err }, "fleet/units deactivate error");
    res.status(500).json({ error: "Gagal menonaktifkan kendaraan" });
  }
});

// ── PATCH /api/fleet/units/:id/odometer ──────────────────────────────────────

router.patch("/fleet/units/:id/odometer", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);
    const { odometerKm } = req.body as { odometerKm: number };

    if (!odometerKm || isNaN(odometerKm)) {
      return res.status(400).json({ error: "odometerKm wajib diisi" });
    }

    const [existing] = await db
      .select()
      .from(fleetUnitsTable)
      .where(and(eq(fleetUnitsTable.id, id), eq(fleetUnitsTable.companyId, companyId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Kendaraan tidak ditemukan" });
    if (odometerKm < (existing.currentOdometerKm ?? 0)) {
      return res.status(400).json({ error: "Odometer tidak boleh lebih kecil dari nilai sebelumnya" });
    }

    const [updated] = await db
      .update(fleetUnitsTable)
      .set({ currentOdometerKm: odometerKm })
      .where(and(eq(fleetUnitsTable.id, id), eq(fleetUnitsTable.companyId, companyId)))
      .returning();

    await audit(req, "fleet.unit.odometer_updated", id, { odometerKm: existing.currentOdometerKm }, { odometerKm });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "fleet/units odometer error");
    res.status(500).json({ error: "Gagal update odometer" });
  }
});

export default router;
