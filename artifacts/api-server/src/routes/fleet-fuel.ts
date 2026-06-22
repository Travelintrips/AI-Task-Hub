/**
 * Sprint 7C — Fleet Fuel Intelligence API
 *
 * POST /api/fleet/fuel/benchmarks    — set benchmark km/L per vehicle type
 * GET  /api/fleet/fuel/benchmarks   — list benchmarks
 * POST /api/fleet/fuel              — log pengisian BBM + auto-detect anomali
 * GET  /api/fleet/fuel              — list fuel logs
 * GET  /api/fleet/fuel/analytics    — analitik konsumsi BBM
 * GET  /api/fleet/fuel/anomalies    — daftar log anomali
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  fleetFuelLogsTable,
  fleetFuelBenchmarksTable,
  fleetUnitsTable,
  fleetDriversTable,
  aiTasksTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, desc, gte, lte, isNotNull, sql, or } from "drizzle-orm";

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
    entityType: "fleet_fuel",
    before: before ? JSON.stringify(before) : null,
    after: after ? JSON.stringify(after) : null,
    ipAddress: req.ip,
  }).catch(e => logger.warn({ e }, "audit log failed"));
}

// ── POST /api/fleet/fuel/benchmarks ───────────────────────────────────────────

router.post("/fleet/fuel/benchmarks", requireAuth, requireRole("supervisor", "company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const body = req.body as Record<string, unknown>;

    if (!body.vehicleType || !body.benchmarkKmPerLiter) {
      return res.status(400).json({ error: "vehicleType dan benchmarkKmPerLiter wajib diisi" });
    }

    const [bench] = await db.insert(fleetFuelBenchmarksTable).values({
      companyId,
      vehicleType: body.vehicleType as string,
      fuelType: (body.fuelType as string) || "solar",
      benchmarkKmPerLiter: body.benchmarkKmPerLiter as number,
      tolerancePct: (body.tolerancePct as number) || 20,
      minLitersAlert: body.minLitersAlert as number | undefined,
      maxLitersAlert: body.maxLitersAlert as number | undefined,
      notes: body.notes as string | undefined,
      createdBy: req.user?.id,
    }).returning();

    await audit(req, "fleet.fuel.benchmark_set", bench.id, null, bench);
    res.status(201).json({ success: true, benchmark: bench });
  } catch (err) {
    logger.error({ err }, "fleet/fuel/benchmarks create error");
    res.status(500).json({ error: "Gagal menyimpan benchmark" });
  }
});

// ── GET /api/fleet/fuel/benchmarks ────────────────────────────────────────────

router.get("/fleet/fuel/benchmarks", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const rows = await db.select().from(fleetFuelBenchmarksTable)
      .where(eq(fleetFuelBenchmarksTable.companyId, companyId))
      .orderBy(fleetFuelBenchmarksTable.vehicleType);
    res.json({ benchmarks: rows, total: rows.length });
  } catch (err) {
    logger.error({ err }, "fleet/fuel/benchmarks list error");
    res.status(500).json({ error: "Gagal mengambil benchmark" });
  }
});

// ── GET /api/fleet/fuel/anomalies ─────────────────────────────────────────────
// Must be before /:id style routes

router.get("/fleet/fuel/anomalies", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { limit = "50", offset = "0" } = req.query as Record<string, string>;

    const rows = await db
      .select({
        log: fleetFuelLogsTable,
        plateNumber: fleetUnitsTable.plateNumber,
        unitNumber: fleetUnitsTable.unitNumber,
        driverName: fleetDriversTable.fullName,
      })
      .from(fleetFuelLogsTable)
      .leftJoin(fleetUnitsTable, eq(fleetFuelLogsTable.fleetUnitId, fleetUnitsTable.id))
      .leftJoin(fleetDriversTable, eq(fleetFuelLogsTable.driverId, fleetDriversTable.id))
      .where(and(
        eq(fleetFuelLogsTable.companyId, companyId),
        eq(fleetFuelLogsTable.isAnomaly, true),
      ))
      .orderBy(desc(fleetFuelLogsTable.loggedAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    const total = await db.select({ count: sql<number>`count(*)::int` })
      .from(fleetFuelLogsTable)
      .where(and(
        eq(fleetFuelLogsTable.companyId, companyId),
        eq(fleetFuelLogsTable.isAnomaly, true),
      ));

    res.json({
      anomalies: rows.map(r => ({ ...r.log, plateNumber: r.plateNumber, unitNumber: r.unitNumber, driverName: r.driverName })),
      total: total[0]?.count ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "fleet/fuel/anomalies list error");
    res.status(500).json({ error: "Gagal mengambil anomali BBM" });
  }
});

// ── GET /api/fleet/fuel/analytics ─────────────────────────────────────────────

router.get("/fleet/fuel/analytics", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { unitId, fromDate, toDate } = req.query as Record<string, string>;

    const conditions = [eq(fleetFuelLogsTable.companyId, companyId)];
    if (unitId) conditions.push(eq(fleetFuelLogsTable.fleetUnitId, parseInt(unitId)));
    if (fromDate) conditions.push(gte(fleetFuelLogsTable.loggedAt, new Date(fromDate)));
    if (toDate) conditions.push(lte(fleetFuelLogsTable.loggedAt, new Date(toDate)));

    const rows = await db.select().from(fleetFuelLogsTable)
      .where(and(...conditions))
      .orderBy(desc(fleetFuelLogsTable.loggedAt));

    const totalLiters = rows.reduce((s, r) => s + (r.litersFilled ?? 0), 0);
    const totalCost = rows.reduce((s, r) => s + (r.totalCost ?? 0), 0);
    const totalKm = rows.reduce((s, r) => s + (r.kmSinceLastFill ?? 0), 0);
    const avgKmPerLiter = totalKm > 0 && totalLiters > 0 ? totalKm / totalLiters : null;
    const anomalyCount = rows.filter(r => r.isAnomaly).length;

    // Per-unit breakdown
    const byUnit: Record<number, { unitId: number; totalLiters: number; totalCost: number; totalKm: number; fillCount: number }> = {};
    for (const r of rows) {
      const uid = r.fleetUnitId;
      if (!byUnit[uid]) byUnit[uid] = { unitId: uid, totalLiters: 0, totalCost: 0, totalKm: 0, fillCount: 0 };
      byUnit[uid].totalLiters += r.litersFilled ?? 0;
      byUnit[uid].totalCost += r.totalCost ?? 0;
      byUnit[uid].totalKm += r.kmSinceLastFill ?? 0;
      byUnit[uid].fillCount++;
    }

    res.json({
      totalFillCount: rows.length,
      totalLiters: Math.round(totalLiters * 100) / 100,
      totalCost: Math.round(totalCost),
      totalKm: Math.round(totalKm),
      avgKmPerLiter: avgKmPerLiter ? Math.round(avgKmPerLiter * 100) / 100 : null,
      anomalyCount,
      anomalyRate: rows.length > 0 ? Math.round((anomalyCount / rows.length) * 100) : 0,
      byUnit: Object.values(byUnit),
    });
  } catch (err) {
    logger.error({ err }, "fleet/fuel/analytics error");
    res.status(500).json({ error: "Gagal mengambil analitik BBM" });
  }
});

// ── POST /api/fleet/fuel ──────────────────────────────────────────────────────

router.post("/fleet/fuel", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const body = req.body as Record<string, unknown>;

    if (!body.fleetUnitId || !body.odometerKm || !body.litersFilled) {
      return res.status(400).json({ error: "fleetUnitId, odometerKm, litersFilled wajib diisi" });
    }

    const fleetUnitId = body.fleetUnitId as number;
    const odometerKm = body.odometerKm as number;
    const litersFilled = body.litersFilled as number;

    // Get unit info + last fill
    const unit = await db.select().from(fleetUnitsTable)
      .where(and(eq(fleetUnitsTable.id, fleetUnitId), eq(fleetUnitsTable.companyId, companyId)))
      .limit(1);
    if (!unit[0]) return res.status(404).json({ error: "Unit tidak ditemukan" });

    const lastFill = await db.select().from(fleetFuelLogsTable)
      .where(and(eq(fleetFuelLogsTable.fleetUnitId, fleetUnitId), eq(fleetFuelLogsTable.companyId, companyId)))
      .orderBy(desc(fleetFuelLogsTable.loggedAt))
      .limit(1);

    const kmSinceLastFill = lastFill[0] ? Math.max(0, odometerKm - (lastFill[0].odometerKm ?? 0)) : null;
    const kmPerLiter = kmSinceLastFill && kmSinceLastFill > 0 && litersFilled > 0
      ? kmSinceLastFill / litersFilled : null;

    // Anomaly detection
    const anomalies: string[] = [];
    let anomalyScore = 0;

    // 1. Odometer regression
    if (lastFill[0] && odometerKm < (lastFill[0].odometerKm ?? 0)) {
      anomalies.push("Odometer turun dari isi sebelumnya (kemungkinan salah input)");
      anomalyScore += 40;
    }

    // 2. Duplicate same day / unit / liters
    const today = new Date().toISOString().split("T")[0];
    const todayStart = new Date(today + "T00:00:00Z");
    const todayEnd = new Date(today + "T23:59:59Z");
    const dup = await db.select().from(fleetFuelLogsTable)
      .where(and(
        eq(fleetFuelLogsTable.companyId, companyId),
        eq(fleetFuelLogsTable.fleetUnitId, fleetUnitId),
        gte(fleetFuelLogsTable.loggedAt, todayStart),
        lte(fleetFuelLogsTable.loggedAt, todayEnd),
      )).limit(1);
    if (dup[0]) {
      anomalies.push("Sudah ada pengisian BBM hari ini untuk unit ini");
      anomalyScore += 20;
    }

    // 3. KM/L below benchmark tolerance
    if (kmPerLiter !== null) {
      const bench = await db.select().from(fleetFuelBenchmarksTable)
        .where(and(
          eq(fleetFuelBenchmarksTable.companyId, companyId),
          eq(fleetFuelBenchmarksTable.vehicleType, unit[0].vehicleType),
        )).limit(1);

      if (bench[0]) {
        const minAcceptable = bench[0].benchmarkKmPerLiter * (1 - bench[0].tolerancePct / 100);
        if (kmPerLiter < minAcceptable) {
          anomalies.push(`KM/L (${kmPerLiter.toFixed(2)}) di bawah batas toleransi (${minAcceptable.toFixed(2)} km/L)`);
          anomalyScore += 30;
        }
        // 4. Unusually high liters
        if (bench[0].maxLitersAlert && litersFilled > bench[0].maxLitersAlert) {
          anomalies.push(`Liter sangat tinggi (${litersFilled}L > batas ${bench[0].maxLitersAlert}L)`);
          anomalyScore += 25;
        }
      }
    }

    const isAnomaly = anomalies.length > 0;

    // Calculate totalCost
    const pricePerLiter = body.pricePerLiter as number | undefined;
    const totalCost = pricePerLiter ? litersFilled * pricePerLiter : (body.totalCost as number | undefined);

    const [log] = await db.insert(fleetFuelLogsTable).values({
      companyId,
      fleetUnitId,
      driverId: body.driverId as number | undefined,
      loggedAt: body.loggedAt ? new Date(body.loggedAt as string) : new Date(),
      odometerKm,
      litersFilled,
      fuelType: (body.fuelType as string) || unit[0].fuelType || "solar",
      pricePerLiter,
      totalCost,
      stationName: body.stationName as string | undefined,
      kmSinceLastFill: kmSinceLastFill ?? undefined,
      kmPerLiter: kmPerLiter ?? undefined,
      isAnomaly,
      anomalyReason: anomalies.length > 0 ? anomalies.join("; ") : undefined,
      anomalyScore: anomalyScore > 0 ? anomalyScore : undefined,
      notes: body.notes as string | undefined,
      createdBy: req.user?.id,
    }).returning();

    // Update unit odometer
    await db.update(fleetUnitsTable)
      .set({ currentOdometerKm: odometerKm })
      .where(eq(fleetUnitsTable.id, fleetUnitId));

    await audit(req, "fleet.fuel.logged", log.id, null, log);

    // Create ai_task for critical fuel anomaly
    if (isAnomaly && anomalyScore >= 40) {
      await audit(req, "fleet.fuel.anomaly_flagged", log.id, null, { anomalies, anomalyScore });
      await db.insert(aiTasksTable).values({
        companyId,
        taskNumber: `FUEL-ANOM-${Date.now()}`,
        title: `Anomali BBM kritis: ${unit[0].plateNumber} (${unit[0].unitNumber})`,
        description: `Pengisian BBM terdeteksi anomali:\n${anomalies.map(a => `• ${a}`).join("\n")}\n\nLiter: ${litersFilled}L, Odometer: ${odometerKm}km, KM/L: ${kmPerLiter?.toFixed(2) ?? "—"}`,
        status: "open",
        priority: "high",
        sourceModule: "fleet_fuel",
        sourceId: log.id,
        autoCreated: true,
        requiresHumanReview: true,
        detectedAt: new Date(),
      }).catch(e => logger.warn({ e }, "fuel anomaly task create failed"));
    }

    res.status(201).json({
      success: true,
      fuelLog: log,
      isAnomaly,
      anomalies,
      anomalyScore,
      kmPerLiter,
      kmSinceLastFill,
    });
  } catch (err) {
    logger.error({ err }, "fleet/fuel create error");
    res.status(500).json({ error: "Gagal menyimpan log BBM" });
  }
});

// ── GET /api/fleet/fuel ───────────────────────────────────────────────────────

router.get("/fleet/fuel", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { unitId, fromDate, toDate, anomalyOnly, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const conditions = [eq(fleetFuelLogsTable.companyId, companyId)];
    if (unitId) conditions.push(eq(fleetFuelLogsTable.fleetUnitId, parseInt(unitId)));
    if (fromDate) conditions.push(gte(fleetFuelLogsTable.loggedAt, new Date(fromDate)));
    if (toDate) conditions.push(lte(fleetFuelLogsTable.loggedAt, new Date(toDate)));
    if (anomalyOnly === "true") conditions.push(eq(fleetFuelLogsTable.isAnomaly, true));

    const rows = await db
      .select({
        log: fleetFuelLogsTable,
        plateNumber: fleetUnitsTable.plateNumber,
        unitNumber: fleetUnitsTable.unitNumber,
        driverName: fleetDriversTable.fullName,
      })
      .from(fleetFuelLogsTable)
      .leftJoin(fleetUnitsTable, eq(fleetFuelLogsTable.fleetUnitId, fleetUnitsTable.id))
      .leftJoin(fleetDriversTable, eq(fleetFuelLogsTable.driverId, fleetDriversTable.id))
      .where(and(...conditions))
      .orderBy(desc(fleetFuelLogsTable.loggedAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    const totalQ = await db.select({ count: sql<number>`count(*)::int` })
      .from(fleetFuelLogsTable).where(and(...conditions));

    res.json({
      fuelLogs: rows.map(r => ({ ...r.log, plateNumber: r.plateNumber, unitNumber: r.unitNumber, driverName: r.driverName })),
      total: totalQ[0]?.count ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "fleet/fuel list error");
    res.status(500).json({ error: "Gagal mengambil log BBM" });
  }
});

export default router;
