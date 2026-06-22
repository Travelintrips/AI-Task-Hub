/**
 * Sprint 7C — Fleet Tire Lifecycle API
 *
 * POST  /api/fleet/tires              — daftarkan ban baru ke unit
 * GET   /api/fleet/tires              — list ban
 * PATCH /api/fleet/tires/:id         — update status / data ban
 * POST  /api/fleet/tires/rotation    — catat rotasi ban
 * GET   /api/fleet/tires/lifecycle   — analitik lifecycle + worn alerts
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  fleetTiresTable,
  fleetTireRotationsTable,
  fleetUnitsTable,
  aiTasksTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, desc, sql } from "drizzle-orm";

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
    entityType: "fleet_tire",
    before: before ? JSON.stringify(before) : null,
    after: after ? JSON.stringify(after) : null,
    ipAddress: req.ip,
  }).catch(e => logger.warn({ e }, "audit log failed"));
}

function computeLifecycle(tire: typeof fleetTiresTable.$inferSelect, currentOdometer?: number) {
  const currentOdo = currentOdometer ?? tire.currentOdometerKm ?? tire.installOdometerKm ?? 0;
  const usedKm = tire.installOdometerKm !== null && tire.installOdometerKm !== undefined
    ? Math.max(0, currentOdo - (tire.installOdometerKm ?? 0))
    : (tire.usedKm ?? 0);
  const expectedLife = tire.expectedLifeKm ?? 80000;
  const remainingKm = Math.max(0, expectedLife - usedKm);
  const wearPct = Math.min(100, Math.round((usedKm / expectedLife) * 100));
  const isWorn = wearPct >= 80;
  const isCritical = wearPct >= 95;
  return { usedKm, remainingKm, wearPct, isWorn, isCritical };
}

// ── GET /api/fleet/tires/lifecycle ────────────────────────────────────────────
// Must be before /:id

router.get("/fleet/tires/lifecycle", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);

    const tires = await db
      .select({
        tire: fleetTiresTable,
        plateNumber: fleetUnitsTable.plateNumber,
        unitNumber: fleetUnitsTable.unitNumber,
        currentOdometer: fleetUnitsTable.currentOdometerKm,
      })
      .from(fleetTiresTable)
      .leftJoin(fleetUnitsTable, eq(fleetTiresTable.fleetUnitId, fleetUnitsTable.id))
      .where(and(
        eq(fleetTiresTable.companyId, companyId),
        eq(fleetTiresTable.isActive, true),
      ))
      .orderBy(fleetTiresTable.fleetUnitId, fleetTiresTable.position);

    const enriched = tires.map(r => {
      const lc = computeLifecycle(r.tire, r.currentOdometer ?? undefined);
      return {
        ...r.tire,
        plateNumber: r.plateNumber,
        unitNumber: r.unitNumber,
        ...lc,
      };
    });

    const wornCount = enriched.filter(t => t.isWorn).length;
    const criticalCount = enriched.filter(t => t.isCritical).length;

    res.json({
      tires: enriched,
      total: enriched.length,
      wornCount,
      criticalCount,
    });
  } catch (err) {
    logger.error({ err }, "fleet/tires/lifecycle error");
    res.status(500).json({ error: "Gagal mengambil lifecycle ban" });
  }
});

// ── POST /api/fleet/tires/rotation ────────────────────────────────────────────

router.post("/fleet/tires/rotation", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const body = req.body as Record<string, unknown>;

    if (!body.fleetUnitId || !body.rotationDate) {
      return res.status(400).json({ error: "fleetUnitId dan rotationDate wajib diisi" });
    }

    const [rotation] = await db.insert(fleetTireRotationsTable).values({
      companyId,
      fleetUnitId: body.fleetUnitId as number,
      rotationDate: body.rotationDate as string,
      odometerAtRotation: body.odometerAtRotation as number | undefined,
      positionsChanged: body.positionsChanged as unknown[] | undefined,
      performedBy: body.performedBy as string | undefined,
      workshopName: body.workshopName as string | undefined,
      notes: body.notes as string | undefined,
      createdBy: null,
    }).returning();

    await audit(req, "fleet.tire.rotated", rotation.id, null, rotation);
    return res.status(201).json({ success: true, rotation });
  } catch (err) {
    logger.error({ err }, "fleet/tires/rotation create error");
    return res.status(500).json({ error: "Gagal mencatat rotasi ban" });
  }
});

// ── POST /api/fleet/tires ─────────────────────────────────────────────────────

router.post("/fleet/tires", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const body = req.body as Record<string, unknown>;

    if (!body.fleetUnitId || !body.position) {
      return res.status(400).json({ error: "fleetUnitId dan position wajib diisi" });
    }

    const unit = await db.select().from(fleetUnitsTable)
      .where(and(eq(fleetUnitsTable.id, body.fleetUnitId as number), eq(fleetUnitsTable.companyId, companyId)))
      .limit(1);
    if (!unit[0]) return res.status(404).json({ error: "Unit tidak ditemukan" });

    const installOdometerKm = (body.installOdometerKm as number | undefined) ?? unit[0].currentOdometerKm ?? undefined;
    const expectedLifeKm = (body.expectedLifeKm as number | undefined) ?? 80000;

    const [tire] = await db.insert(fleetTiresTable).values({
      companyId,
      fleetUnitId: body.fleetUnitId as number,
      serialNumber: body.serialNumber as string | undefined,
      brand: body.brand as string | undefined,
      model: body.model as string | undefined,
      sizeName: body.sizeName as string | undefined,
      position: body.position as string,
      installDate: body.installDate as string | undefined,
      installOdometerKm,
      expectedLifeKm,
      currentOdometerKm: unit[0].currentOdometerKm ?? undefined,
      status: "good",
      notes: body.notes as string | undefined,
      createdBy: null,
    }).returning();

    await audit(req, "fleet.tire.installed", tire.id, null, tire);

    const lc = computeLifecycle(tire, unit[0].currentOdometerKm ?? undefined);
    return res.status(201).json({ success: true, tire: { ...tire, ...lc } });
  } catch (err) {
    logger.error({ err }, "fleet/tires create error");
    return res.status(500).json({ error: "Gagal mendaftarkan ban" });
  }
});

// ── GET /api/fleet/tires ──────────────────────────────────────────────────────

router.get("/fleet/tires", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { unitId, status, wornOnly, limit = "100", offset = "0" } = req.query as Record<string, string>;

    const conditions = [
      eq(fleetTiresTable.companyId, companyId),
      eq(fleetTiresTable.isActive, true),
    ];
    if (unitId) conditions.push(eq(fleetTiresTable.fleetUnitId, parseInt(unitId)));
    if (status) conditions.push(eq(fleetTiresTable.status, status));

    const rows = await db
      .select({
        tire: fleetTiresTable,
        plateNumber: fleetUnitsTable.plateNumber,
        unitNumber: fleetUnitsTable.unitNumber,
        currentOdometer: fleetUnitsTable.currentOdometerKm,
      })
      .from(fleetTiresTable)
      .leftJoin(fleetUnitsTable, eq(fleetTiresTable.fleetUnitId, fleetUnitsTable.id))
      .where(and(...conditions))
      .orderBy(fleetTiresTable.fleetUnitId, fleetTiresTable.position)
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    let enriched = rows.map(r => {
      const lc = computeLifecycle(r.tire, r.currentOdometer ?? undefined);
      return { ...r.tire, plateNumber: r.plateNumber, unitNumber: r.unitNumber, ...lc };
    });

    if (wornOnly === "true") enriched = enriched.filter(t => t.isWorn);

    const total = await db.select({ count: sql<number>`count(*)::int` })
      .from(fleetTiresTable).where(and(...conditions));

    res.json({ tires: enriched, total: total[0]?.count ?? 0 });
  } catch (err) {
    logger.error({ err }, "fleet/tires list error");
    res.status(500).json({ error: "Gagal mengambil data ban" });
  }
});

// ── PATCH /api/fleet/tires/:id ────────────────────────────────────────────────

router.patch("/fleet/tires/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);
    const body = req.body as Record<string, unknown>;

    const existing = await db.select().from(fleetTiresTable)
      .where(and(eq(fleetTiresTable.id, id), eq(fleetTiresTable.companyId, companyId)))
      .limit(1);
    if (!existing[0]) return res.status(404).json({ error: "Ban tidak ditemukan" });

    const before = existing[0];
    const isReplaced = body.status === "replaced" || body.status === "scrapped";

    const [updated] = await db.update(fleetTiresTable)
      .set({
        ...(body.serialNumber !== undefined && { serialNumber: body.serialNumber as string }),
        ...(body.brand !== undefined && { brand: body.brand as string }),
        ...(body.expectedLifeKm !== undefined && { expectedLifeKm: body.expectedLifeKm as number }),
        ...(body.status !== undefined && { status: body.status as string }),
        ...(body.notes !== undefined && { notes: body.notes as string }),
        ...(isReplaced && { isActive: false, replacedAt: new Date(), replacedReason: body.replacedReason as string | undefined }),
      })
      .where(eq(fleetTiresTable.id, id))
      .returning();

    const action = isReplaced ? "fleet.tire.replaced" : "fleet.tire.updated";
    await audit(req, action, id, before, updated);

    // Create ai_task if tire worn threshold exceeded
    const unit = await db.select().from(fleetUnitsTable)
      .where(eq(fleetUnitsTable.id, updated.fleetUnitId)).limit(1);
    const lc = computeLifecycle(updated, unit[0]?.currentOdometerKm ?? undefined);
    if (lc.isCritical && !isReplaced) {
      await db.insert(aiTasksTable).values({
        companyId,
        source: "fleet_tires",
        title: `Ban kritis: ${unit[0]?.plateNumber ?? "—"} posisi ${updated.position}`,
        description: `Ban (${updated.brand ?? "—"} SN:${updated.serialNumber ?? "—"}) sudah aus ${lc.wearPct}% dari expected life. Sisa ${lc.remainingKm.toFixed(0)}km.`,
        category: "fleet_tires",
        priority: "high",
        status: "new_inquiry",
        adminNotes: `auto_created=true requires_human_review=true source_id=${id}`,
      }).catch(e => logger.warn({ e }, "tire worn task create failed"));
    }

    return res.json({ success: true, tire: { ...updated, ...lc } });
  } catch (err) {
    logger.error({ err }, "fleet/tires update error");
    return res.status(500).json({ error: "Gagal update ban" });
  }
});

export default router;
