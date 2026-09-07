/**
 * Sprint 7B — Fleet Drivers API
 *
 * GET    /api/fleet/drivers            — list pengemudi
 * POST   /api/fleet/drivers            — tambah pengemudi
 * GET    /api/fleet/drivers/:id        — detail pengemudi
 * PATCH  /api/fleet/drivers/:id        — update pengemudi
 * GET    /api/fleet/drivers/:id/performance — riwayat performa
 * GET    /api/fleet/drivers/license-expiring — SIM akan expired
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  fleetDriversTable,
  fleetDriverPerformanceTable,
  fleetDriverIncidentsTable,
  fleetUnitsTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, desc, ilike, or, sql, lte } from "drizzle-orm";

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
    entityType: "fleet_driver",
    before: before ? JSON.stringify(before) : null,
    after: after ? JSON.stringify(after) : null,
    ipAddress: req.ip,
  }).catch(e => logger.warn({ e }, "audit log failed"));
}

// ── GET /api/fleet/drivers/license-expiring ───────────────────────────────────
// Must be declared BEFORE /:id to avoid route conflict

router.get("/fleet/drivers/license-expiring", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const days = parseInt((req.query.days as string) || "30");
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + days);
    const thresholdStr = threshold.toISOString().split("T")[0];

    const drivers = await db
      .select()
      .from(fleetDriversTable)
      .where(and(
        eq(fleetDriversTable.companyId, companyId),
        eq(fleetDriversTable.status, "active"),
        lte(fleetDriversTable.licenseExpired, thresholdStr!),
      ))
      .orderBy(fleetDriversTable.licenseExpired);

    res.json({ data: drivers, total: drivers.length });
  } catch (err) {
    logger.error({ err }, "fleet/drivers license-expiring error");
    res.status(500).json({ error: "Gagal mengambil data SIM" });
  }
});

// ── GET /api/fleet/drivers ────────────────────────────────────────────────────

router.get("/fleet/drivers", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { status, search, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const conditions = [eq(fleetDriversTable.companyId, companyId)];
    if (status) conditions.push(eq(fleetDriversTable.status, status));
    if (search) {
      conditions.push(
        or(
          ilike(fleetDriversTable.fullName, `%${search}%`),
          ilike(fleetDriversTable.phone, `%${search}%`),
          ilike(fleetDriversTable.licenseNumber, `%${search}%`),
        )!
      );
    }

    const drivers = await db
      .select({
        driver: fleetDriversTable,
        vehiclePlate: fleetUnitsTable.plateNumber,
        vehicleUnit: fleetUnitsTable.unitNumber,
      })
      .from(fleetDriversTable)
      .leftJoin(fleetUnitsTable, eq(fleetDriversTable.primaryVehicleId, fleetUnitsTable.id))
      .where(and(...conditions))
      .orderBy(desc(fleetDriversTable.createdAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(fleetDriversTable)
      .where(and(...conditions));

    res.json({
      data: drivers.map(r => ({
        ...r.driver,
        vehiclePlate: r.vehiclePlate,
        vehicleUnit: r.vehicleUnit,
      })),
      total: Number(total[0]?.count ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "fleet/drivers list error");
    res.status(500).json({ error: "Gagal mengambil data pengemudi" });
  }
});

// ── POST /api/fleet/drivers ───────────────────────────────────────────────────

router.post("/fleet/drivers", requireAuth, requireRole("supervisor", "company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const body = req.body as Record<string, unknown>;

    if (!body.fullName || !body.licenseNumber) {
      return res.status(400).json({ error: "fullName dan licenseNumber wajib diisi" });
    }

    const [driver] = await db.insert(fleetDriversTable).values({
      companyId,
      employeeId: body.employeeId as string | undefined,
      fullName: body.fullName as string,
      phone: body.phone as string | undefined,
      email: body.email as string | undefined,
      licenseNumber: body.licenseNumber as string,
      licenseType: (body.licenseType as string) || "SIM B2",
      licenseExpired: body.licenseExpired as string | undefined,
      joinDate: body.joinDate as string | undefined,
      status: (body.status as string) || "active",
      primaryVehicleId: body.primaryVehicleId as number | undefined,
      baseLocation: body.baseLocation as string | undefined,
      emergencyContact: body.emergencyContact as string | undefined,
      emergencyPhone: body.emergencyPhone as string | undefined,
      notes: body.notes as string | undefined,
      createdBy: null,
    }).returning();

    await audit(req, "fleet.driver.created", driver.id, null, driver);
    return res.status(201).json(driver);
  } catch (err) {
    logger.error({ err }, "fleet/drivers create error");
    return res.status(500).json({ error: "Gagal membuat data pengemudi" });
  }
});

// ── GET /api/fleet/drivers/:id ────────────────────────────────────────────────

router.get("/fleet/drivers/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);

    const [row] = await db
      .select({
        driver: fleetDriversTable,
        vehiclePlate: fleetUnitsTable.plateNumber,
        vehicleUnit: fleetUnitsTable.unitNumber,
      })
      .from(fleetDriversTable)
      .leftJoin(fleetUnitsTable, eq(fleetDriversTable.primaryVehicleId, fleetUnitsTable.id))
      .where(and(eq(fleetDriversTable.id, id), eq(fleetDriversTable.companyId, companyId)))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Pengemudi tidak ditemukan" });

    const latestPerf = await db
      .select()
      .from(fleetDriverPerformanceTable)
      .where(and(
        eq(fleetDriverPerformanceTable.driverId, id),
        eq(fleetDriverPerformanceTable.companyId, companyId),
      ))
      .orderBy(desc(fleetDriverPerformanceTable.periodMonth))
      .limit(3);

    const incidents = await db
      .select()
      .from(fleetDriverIncidentsTable)
      .where(and(
        eq(fleetDriverIncidentsTable.driverId, id),
        eq(fleetDriverIncidentsTable.companyId, companyId),
      ))
      .orderBy(desc(fleetDriverIncidentsTable.incidentDate))
      .limit(5);

    return res.json({
      ...row.driver,
      vehiclePlate: row.vehiclePlate,
      vehicleUnit: row.vehicleUnit,
      recentPerformance: latestPerf,
      recentIncidents: incidents,
    });
  } catch (err) {
    logger.error({ err }, "fleet/drivers detail error");
    return res.status(500).json({ error: "Gagal mengambil detail pengemudi" });
  }
});

// ── PATCH /api/fleet/drivers/:id ──────────────────────────────────────────────

router.patch("/fleet/drivers/:id", requireAuth, requireRole("supervisor", "company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);
    const body = req.body as Record<string, unknown>;

    const [existing] = await db
      .select()
      .from(fleetDriversTable)
      .where(and(eq(fleetDriversTable.id, id), eq(fleetDriversTable.companyId, companyId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Pengemudi tidak ditemukan" });

    const allowed = [
      "employeeId", "fullName", "phone", "email", "licenseNumber", "licenseType",
      "licenseExpired", "joinDate", "status", "primaryVehicleId", "baseLocation",
      "emergencyContact", "emergencyPhone", "photoUrl", "notes",
    ];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }

    const [updated] = await db
      .update(fleetDriversTable)
      .set(updates)
      .where(and(eq(fleetDriversTable.id, id), eq(fleetDriversTable.companyId, companyId)))
      .returning();

    await audit(req, "fleet.driver.updated", id, existing, updated);
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "fleet/drivers update error");
    return res.status(500).json({ error: "Gagal update pengemudi" });
  }
});

// ── GET /api/fleet/drivers/:id/performance ────────────────────────────────────

router.get("/fleet/drivers/:id/performance", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);

    const perf = await db
      .select()
      .from(fleetDriverPerformanceTable)
      .where(and(
        eq(fleetDriverPerformanceTable.driverId, id),
        eq(fleetDriverPerformanceTable.companyId, companyId),
      ))
      .orderBy(desc(fleetDriverPerformanceTable.periodMonth))
      .limit(12);

    res.json({ data: perf, total: perf.length });
  } catch (err) {
    logger.error({ err }, "fleet/drivers performance error");
    res.status(500).json({ error: "Gagal mengambil data performa" });
  }
});

export default router;
