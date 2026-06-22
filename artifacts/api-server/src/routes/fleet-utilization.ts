/**
 * Sprint 7C — Fleet Utilization & Availability API
 *
 * POST  /api/fleet/utilization          — buat trip log
 * GET   /api/fleet/utilization          — list trip logs
 * PATCH /api/fleet/utilization/:id     — update trip (actual KM, arrival, status)
 * GET   /api/fleet/utilization/analytics — analitik utilisasi kendaraan
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  fleetUtilizationLogsTable,
  fleetUnitsTable,
  fleetDriversTable,
  aiTasksTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, desc, gte, lte, sql, or, isNull, lt } from "drizzle-orm";

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
    entityType: "fleet_utilization",
    before: before ? JSON.stringify(before) : null,
    after: after ? JSON.stringify(after) : null,
    ipAddress: req.ip,
  }).catch(e => logger.warn({ e }, "audit log failed"));
}

// ── GET /api/fleet/utilization/analytics ──────────────────────────────────────
// Must be before /:id

router.get("/fleet/utilization/analytics", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { fromDate, toDate } = req.query as Record<string, string>;

    const conditions = [eq(fleetUtilizationLogsTable.companyId, companyId)];
    if (fromDate) conditions.push(gte(fleetUtilizationLogsTable.plannedDeparture, new Date(fromDate)));
    if (toDate) conditions.push(lte(fleetUtilizationLogsTable.plannedDeparture, new Date(toDate)));

    const trips = await db.select().from(fleetUtilizationLogsTable)
      .where(and(...conditions));

    const allUnits = await db.select().from(fleetUnitsTable)
      .where(and(eq(fleetUnitsTable.companyId, companyId), eq(fleetUnitsTable.isActive, true)));

    // Idle: units with no completed/on_route trip in last 3 days
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const recentlyActiveUnitIds = new Set(
      trips.filter(t =>
        ["on_route", "completed"].includes(t.status) &&
        (t.actualDeparture ?? t.plannedDeparture ?? new Date(0)) >= threeDaysAgo
      ).map(t => t.fleetUnitId)
    );
    const idleUnits = allUnits.filter(u => u.status === "available" && !recentlyActiveUnitIds.has(u.id));

    // By unit utilization
    const byUnit: Record<number, { unitId: number; totalTrips: number; totalKm: number; completedTrips: number; cancelledTrips: number; avgDelay: number; onTimeRate: number }> = {};
    for (const t of trips) {
      const uid = t.fleetUnitId;
      if (!byUnit[uid]) byUnit[uid] = { unitId: uid, totalTrips: 0, totalKm: 0, completedTrips: 0, cancelledTrips: 0, avgDelay: 0, onTimeRate: 0 };
      byUnit[uid].totalTrips++;
      byUnit[uid].totalKm += t.actualKm ?? t.plannedKm ?? 0;
      if (t.status === "completed") byUnit[uid].completedTrips++;
      if (t.status === "cancelled") byUnit[uid].cancelledTrips++;
    }

    const totalTrips = trips.length;
    const completedTrips = trips.filter(t => t.status === "completed").length;
    const onTimeTrips = trips.filter(t => t.status === "completed" && (t.delayMinutes ?? 0) <= 15).length;
    const totalActualKm = trips.reduce((s, t) => s + (t.actualKm ?? t.plannedKm ?? 0), 0);
    const avgCapacityUsed = trips.filter(t => t.capacityUsedPct !== null).length > 0
      ? trips.reduce((s, t) => s + (t.capacityUsedPct ?? 0), 0) / trips.filter(t => t.capacityUsedPct !== null).length
      : null;

    res.json({
      totalTrips,
      completedTrips,
      onTimeRate: totalTrips > 0 ? Math.round((onTimeTrips / Math.max(completedTrips, 1)) * 100) : 0,
      totalActualKm: Math.round(totalActualKm),
      avgCapacityUsed: avgCapacityUsed ? Math.round(avgCapacityUsed) : null,
      idleUnitsCount: idleUnits.length,
      idleUnits: idleUnits.map(u => ({ id: u.id, plateNumber: u.plateNumber, unitNumber: u.unitNumber, status: u.status })),
      byUnit: Object.values(byUnit),
      overUtilizedCount: Object.values(byUnit).filter(u => u.totalKm > 5000).length,
    });
  } catch (err) {
    logger.error({ err }, "fleet/utilization/analytics error");
    res.status(500).json({ error: "Gagal mengambil analitik utilisasi" });
  }
});

// ── POST /api/fleet/utilization ───────────────────────────────────────────────

router.post("/fleet/utilization", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const body = req.body as Record<string, unknown>;

    if (!body.fleetUnitId) {
      return res.status(400).json({ error: "fleetUnitId wajib diisi" });
    }

    const unit = await db.select().from(fleetUnitsTable)
      .where(and(eq(fleetUnitsTable.id, body.fleetUnitId as number), eq(fleetUnitsTable.companyId, companyId)))
      .limit(1);
    if (!unit[0]) return res.status(404).json({ error: "Unit tidak ditemukan" });

    const [trip] = await db.insert(fleetUtilizationLogsTable).values({
      companyId,
      fleetUnitId: body.fleetUnitId as number,
      driverId: body.driverId as number | undefined,
      aiTaskId: body.aiTaskId as number | undefined,
      origin: body.origin as string | undefined,
      destination: body.destination as string | undefined,
      tripPurpose: body.tripPurpose as string | undefined,
      plannedKm: body.plannedKm as number | undefined,
      actualKm: body.actualKm as number | undefined,
      plannedDeparture: body.plannedDeparture ? new Date(body.plannedDeparture as string) : undefined,
      actualDeparture: body.actualDeparture ? new Date(body.actualDeparture as string) : undefined,
      plannedArrival: body.plannedArrival ? new Date(body.plannedArrival as string) : undefined,
      actualArrival: body.actualArrival ? new Date(body.actualArrival as string) : undefined,
      capacityUsedPct: body.capacityUsedPct as number | undefined,
      cargoWeightKg: body.cargoWeightKg as number | undefined,
      status: (body.status as string) || "planned",
      notes: body.notes as string | undefined,
      createdBy: null,
    }).returning();

    // Update unit status to on_route if trip starts
    if (trip.status === "on_route") {
      await db.update(fleetUnitsTable).set({ status: "on_route" }).where(eq(fleetUnitsTable.id, unit[0].id));
    }

    await audit(req, "fleet.utilization.trip_created", trip.id, null, trip);
    return res.status(201).json({ success: true, trip });
  } catch (err) {
    logger.error({ err }, "fleet/utilization create error");
    return res.status(500).json({ error: "Gagal membuat trip log" });
  }
});

// ── GET /api/fleet/utilization ────────────────────────────────────────────────

router.get("/fleet/utilization", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { unitId, driverId, status, fromDate, toDate, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const conditions = [eq(fleetUtilizationLogsTable.companyId, companyId)];
    if (unitId) conditions.push(eq(fleetUtilizationLogsTable.fleetUnitId, parseInt(unitId)));
    if (driverId) conditions.push(eq(fleetUtilizationLogsTable.driverId, parseInt(driverId)));
    if (status) conditions.push(eq(fleetUtilizationLogsTable.status, status));
    if (fromDate) conditions.push(gte(fleetUtilizationLogsTable.plannedDeparture, new Date(fromDate)));
    if (toDate) conditions.push(lte(fleetUtilizationLogsTable.plannedDeparture, new Date(toDate)));

    const rows = await db
      .select({
        trip: fleetUtilizationLogsTable,
        plateNumber: fleetUnitsTable.plateNumber,
        unitNumber: fleetUnitsTable.unitNumber,
        driverName: fleetDriversTable.fullName,
      })
      .from(fleetUtilizationLogsTable)
      .leftJoin(fleetUnitsTable, eq(fleetUtilizationLogsTable.fleetUnitId, fleetUnitsTable.id))
      .leftJoin(fleetDriversTable, eq(fleetUtilizationLogsTable.driverId, fleetDriversTable.id))
      .where(and(...conditions))
      .orderBy(desc(fleetUtilizationLogsTable.createdAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    const totalQ = await db.select({ count: sql<number>`count(*)::int` })
      .from(fleetUtilizationLogsTable).where(and(...conditions));

    res.json({
      trips: rows.map(r => ({ ...r.trip, plateNumber: r.plateNumber, unitNumber: r.unitNumber, driverName: r.driverName })),
      total: totalQ[0]?.count ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "fleet/utilization list error");
    res.status(500).json({ error: "Gagal mengambil trip log" });
  }
});

// ── PATCH /api/fleet/utilization/:id ──────────────────────────────────────────

router.patch("/fleet/utilization/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);
    const body = req.body as Record<string, unknown>;

    const existing = await db.select().from(fleetUtilizationLogsTable)
      .where(and(eq(fleetUtilizationLogsTable.id, id), eq(fleetUtilizationLogsTable.companyId, companyId)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: "Trip tidak ditemukan" });

    const before = existing[0];
    const newStatus = (body.status as string) || before.status;

    // Calculate delay if completing
    let delayMinutes = before.delayMinutes;
    if (newStatus === "completed" && body.actualArrival && before.plannedArrival) {
      const actual = new Date(body.actualArrival as string).getTime();
      const planned = before.plannedArrival.getTime();
      delayMinutes = Math.max(0, Math.round((actual - planned) / 60000));
    }

    const [updated] = await db.update(fleetUtilizationLogsTable)
      .set({
        ...(body.status !== undefined && { status: body.status as string }),
        ...(body.actualKm !== undefined && { actualKm: body.actualKm as number }),
        ...(body.actualDeparture !== undefined && { actualDeparture: new Date(body.actualDeparture as string) }),
        ...(body.actualArrival !== undefined && { actualArrival: new Date(body.actualArrival as string) }),
        ...(body.capacityUsedPct !== undefined && { capacityUsedPct: body.capacityUsedPct as number }),
        ...(body.cargoWeightKg !== undefined && { cargoWeightKg: body.cargoWeightKg as number }),
        ...(body.cancelReason !== undefined && { cancelReason: body.cancelReason as string }),
        ...(body.notes !== undefined && { notes: body.notes as string }),
        ...(delayMinutes !== undefined && { delayMinutes }),
      })
      .where(eq(fleetUtilizationLogsTable.id, id))
      .returning();

    // Update unit status when trip completes/cancels
    if (newStatus === "completed" || newStatus === "cancelled") {
      await db.update(fleetUnitsTable)
        .set({ status: "available" })
        .where(eq(fleetUnitsTable.id, before.fleetUnitId));
    } else if (newStatus === "on_route" && before.status === "planned") {
      await db.update(fleetUnitsTable)
        .set({ status: "on_route" })
        .where(eq(fleetUnitsTable.id, before.fleetUnitId));
    }

    const actionMap: Record<string, string> = {
      completed: "fleet.utilization.trip_completed",
      cancelled: "fleet.utilization.trip_cancelled",
      on_route: "fleet.utilization.trip_started",
    };
    await audit(req, actionMap[newStatus] ?? "fleet.utilization.trip_updated", id, before, updated);

    // Create ai_task for over-utilized or idle detection
    if (newStatus === "completed" && updated.actualKm && updated.actualKm > 600) {
      await db.insert(aiTasksTable).values({
        companyId,
        source: "fleet_utilization",
        title: `Potensi over-utilisasi: ${updated.actualKm.toFixed(0)}km dalam 1 trip`,
        description: `Trip ID ${id} mencatat ${updated.actualKm.toFixed(0)}km aktual (melebihi threshold 600km). Perlu review kondisi kendaraan.`,
        category: "fleet_utilization",
        priority: "medium",
        status: "new_inquiry",
        adminNotes: `auto_created=true requires_human_review=true source_id=${id}`,
      }).catch(e => logger.warn({ e }, "over-utilization task create failed"));
    }

    return res.json({ success: true, trip: updated });
  } catch (err) {
    logger.error({ err }, "fleet/utilization update error");
    return res.status(500).json({ error: "Gagal update trip" });
  }
});

export default router;
