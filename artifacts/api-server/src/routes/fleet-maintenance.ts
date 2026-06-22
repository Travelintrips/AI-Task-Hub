/**
 * Sprint 7B — Fleet Maintenance API
 *
 * GET    /api/fleet/maintenance/due          — jadwal yang jatuh tempo
 * GET    /api/fleet/maintenance              — list maintenance records
 * POST   /api/fleet/maintenance              — buat record baru (status=pending)
 * GET    /api/fleet/maintenance/:id          — detail
 * POST   /api/fleet/maintenance/:id/approve  — approve + opsional purchase request
 * POST   /api/fleet/maintenance/:id/reject   — reject + alasan
 * POST   /api/fleet/maintenance/:id/complete — tandai selesai
 * GET    /api/fleet/maintenance/schedules    — list jadwal service
 * POST   /api/fleet/maintenance/schedules    — buat jadwal service
 * PATCH  /api/fleet/maintenance/schedules/:id — update jadwal
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  fleetMaintenanceRecordsTable,
  fleetMaintenanceSchedulesTable,
  fleetUnitsTable,
  logisticPurchaseRequestsTable,
  aiTasksTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, desc, lte, sql, or } from "drizzle-orm";

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
    entityType: "fleet_maintenance",
    before: before ? JSON.stringify(before) : null,
    after: after ? JSON.stringify(after) : null,
    ipAddress: req.ip,
  }).catch(e => logger.warn({ e }, "audit log failed"));
}

function generatePRNumber(): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `FLT-${ymd}-${seq}`;
}

// ── GET /api/fleet/maintenance/due ────────────────────────────────────────────
// Must be before /:id

router.get("/fleet/maintenance/due", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const days = parseInt((req.query.days as string) || "7");
    const today = new Date().toISOString().split("T")[0];
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + days);
    const thresholdStr = threshold.toISOString().split("T")[0];

    const schedules = await db
      .select({
        schedule: fleetMaintenanceSchedulesTable,
        plateNumber: fleetUnitsTable.plateNumber,
        unitNumber: fleetUnitsTable.unitNumber,
        currentOdometer: fleetUnitsTable.currentOdometerKm,
      })
      .from(fleetMaintenanceSchedulesTable)
      .leftJoin(fleetUnitsTable, eq(fleetMaintenanceSchedulesTable.fleetUnitId, fleetUnitsTable.id))
      .where(and(
        eq(fleetMaintenanceSchedulesTable.companyId, companyId),
        eq(fleetMaintenanceSchedulesTable.status, "active"),
        lte(fleetMaintenanceSchedulesTable.nextDueDate, thresholdStr!),
      ))
      .orderBy(fleetMaintenanceSchedulesTable.nextDueDate);

    res.json({ data: schedules, total: schedules.length });
  } catch (err) {
    logger.error({ err }, "fleet/maintenance due error");
    res.status(500).json({ error: "Gagal mengambil jadwal service" });
  }
});

// ── GET /api/fleet/maintenance/schedules ──────────────────────────────────────

router.get("/fleet/maintenance/schedules", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { unitId } = req.query as Record<string, string>;

    const conditions = [eq(fleetMaintenanceSchedulesTable.companyId, companyId)];
    if (unitId) conditions.push(eq(fleetMaintenanceSchedulesTable.fleetUnitId, parseInt(unitId)));

    const schedules = await db
      .select({
        schedule: fleetMaintenanceSchedulesTable,
        plateNumber: fleetUnitsTable.plateNumber,
        unitNumber: fleetUnitsTable.unitNumber,
      })
      .from(fleetMaintenanceSchedulesTable)
      .leftJoin(fleetUnitsTable, eq(fleetMaintenanceSchedulesTable.fleetUnitId, fleetUnitsTable.id))
      .where(and(...conditions))
      .orderBy(fleetMaintenanceSchedulesTable.nextDueDate);

    res.json({
      data: schedules.map(r => ({
        ...r.schedule,
        plateNumber: r.plateNumber,
        unitNumber: r.unitNumber,
      })),
      total: schedules.length,
    });
  } catch (err) {
    logger.error({ err }, "fleet/maintenance schedules list error");
    res.status(500).json({ error: "Gagal mengambil jadwal" });
  }
});

// ── POST /api/fleet/maintenance/schedules ─────────────────────────────────────

router.post("/fleet/maintenance/schedules", requireAuth, requireRole("supervisor", "company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const body = req.body as Record<string, unknown>;

    if (!body.fleetUnitId || !body.scheduleName || !body.triggerType) {
      return res.status(400).json({ error: "fleetUnitId, scheduleName, triggerType wajib diisi" });
    }

    const [sched] = await db.insert(fleetMaintenanceSchedulesTable).values({
      companyId,
      fleetUnitId: body.fleetUnitId as number,
      scheduleName: body.scheduleName as string,
      triggerType: (body.triggerType as string) || "km_interval",
      kmInterval: body.kmInterval as number | undefined,
      dateIntervalDays: body.dateIntervalDays as number | undefined,
      lastDoneKm: body.lastDoneKm as number | undefined,
      lastDoneDate: body.lastDoneDate as string | undefined,
      nextDueKm: body.nextDueKm as number | undefined,
      nextDueDate: body.nextDueDate as string | undefined,
      autoCreateTask: (body.autoCreateTask as boolean) || false,
      notifyRoles: body.notifyRoles as unknown[] | undefined,
      createdBy: null,
    }).returning();

    return res.status(201).json(sched);
  } catch (err) {
    logger.error({ err }, "fleet/maintenance schedules create error");
    return res.status(500).json({ error: "Gagal membuat jadwal service" });
  }
});

// ── PATCH /api/fleet/maintenance/schedules/:id ────────────────────────────────

router.patch("/fleet/maintenance/schedules/:id", requireAuth, requireRole("supervisor", "company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);
    const body = req.body as Record<string, unknown>;

    const [existing] = await db
      .select()
      .from(fleetMaintenanceSchedulesTable)
      .where(and(eq(fleetMaintenanceSchedulesTable.id, id), eq(fleetMaintenanceSchedulesTable.companyId, companyId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Jadwal tidak ditemukan" });

    const allowed = ["scheduleName", "triggerType", "kmInterval", "dateIntervalDays", "lastDoneKm", "lastDoneDate", "nextDueKm", "nextDueDate", "status", "autoCreateTask", "notifyRoles"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }

    const [updated] = await db
      .update(fleetMaintenanceSchedulesTable)
      .set(updates)
      .where(and(eq(fleetMaintenanceSchedulesTable.id, id), eq(fleetMaintenanceSchedulesTable.companyId, companyId)))
      .returning();

    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "fleet/maintenance schedules update error");
    return res.status(500).json({ error: "Gagal update jadwal" });
  }
});

// ── GET /api/fleet/maintenance ────────────────────────────────────────────────

router.get("/fleet/maintenance", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const { status, unitId, limit = "50", offset = "0" } = req.query as Record<string, string>;

    const conditions = [eq(fleetMaintenanceRecordsTable.companyId, companyId)];
    if (status) conditions.push(eq(fleetMaintenanceRecordsTable.status, status));
    if (unitId) conditions.push(eq(fleetMaintenanceRecordsTable.fleetUnitId, parseInt(unitId)));

    const records = await db
      .select({
        record: fleetMaintenanceRecordsTable,
        plateNumber: fleetUnitsTable.plateNumber,
        unitNumber: fleetUnitsTable.unitNumber,
      })
      .from(fleetMaintenanceRecordsTable)
      .leftJoin(fleetUnitsTable, eq(fleetMaintenanceRecordsTable.fleetUnitId, fleetUnitsTable.id))
      .where(and(...conditions))
      .orderBy(desc(fleetMaintenanceRecordsTable.createdAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(fleetMaintenanceRecordsTable)
      .where(and(...conditions));

    res.json({
      data: records.map(r => ({ ...r.record, plateNumber: r.plateNumber, unitNumber: r.unitNumber })),
      total: Number(total[0]?.count ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "fleet/maintenance list error");
    res.status(500).json({ error: "Gagal mengambil data maintenance" });
  }
});

// ── POST /api/fleet/maintenance ───────────────────────────────────────────────

router.post("/fleet/maintenance", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const body = req.body as Record<string, unknown>;

    if (!body.fleetUnitId || !body.description || !body.serviceDate) {
      return res.status(400).json({ error: "fleetUnitId, description, serviceDate wajib diisi" });
    }

    const [unit] = await db
      .select({ id: fleetUnitsTable.id, plateNumber: fleetUnitsTable.plateNumber })
      .from(fleetUnitsTable)
      .where(and(eq(fleetUnitsTable.id, body.fleetUnitId as number), eq(fleetUnitsTable.companyId, companyId)))
      .limit(1);

    if (!unit) return res.status(404).json({ error: "Kendaraan tidak ditemukan" });

    const [record] = await db.insert(fleetMaintenanceRecordsTable).values({
      companyId,
      fleetUnitId: body.fleetUnitId as number,
      maintenanceType: (body.maintenanceType as string) || "routine",
      category: (body.category as string) || "other",
      description: body.description as string,
      odometerAtService: body.odometerAtService as number | undefined,
      serviceDate: body.serviceDate as string,
      workshopName: body.workshopName as string | undefined,
      costEstimate: body.costEstimate as number | undefined,
      nextServiceKm: body.nextServiceKm as number | undefined,
      nextServiceDate: body.nextServiceDate as string | undefined,
      notes: body.notes as string | undefined,
      status: "pending",
      createdBy: null,
    }).returning();

    await audit(req, "fleet.maintenance.created", record.id, null, record);

    // Auto-create AI task untuk approval
    await db.insert(aiTasksTable).values({
      companyId,
      source: "fleet_maintenance",
      title: `Approval Maintenance: ${unit.plateNumber} — ${body.maintenanceType ?? "routine"}`,
      description: `Permintaan maintenance untuk kendaraan ${unit.plateNumber}.\nDeskripsi: ${body.description}\nEstimasi biaya: ${body.costEstimate ? `Rp ${Number(body.costEstimate).toLocaleString("id-ID")}` : "-"}`,
      category: "fleet_maintenance",
      priority: (body.maintenanceType === "emergency") ? "high" : "medium",
      status: "new_inquiry",
      adminNotes: `auto_created=true requires_human_review=true fleet_unit_id=${body.fleetUnitId} maintenance_id=${record.id}`,
    }).catch(e => logger.warn({ e }, "ai_task creation failed"));

    return res.status(201).json(record);
  } catch (err) {
    logger.error({ err }, "fleet/maintenance create error");
    return res.status(500).json({ error: "Gagal membuat record maintenance" });
  }
});

// ── GET /api/fleet/maintenance/:id ────────────────────────────────────────────

router.get("/fleet/maintenance/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);

    const [row] = await db
      .select({
        record: fleetMaintenanceRecordsTable,
        plateNumber: fleetUnitsTable.plateNumber,
        unitNumber: fleetUnitsTable.unitNumber,
      })
      .from(fleetMaintenanceRecordsTable)
      .leftJoin(fleetUnitsTable, eq(fleetMaintenanceRecordsTable.fleetUnitId, fleetUnitsTable.id))
      .where(and(eq(fleetMaintenanceRecordsTable.id, id), eq(fleetMaintenanceRecordsTable.companyId, companyId)))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Record tidak ditemukan" });

    return res.json({ ...row.record, plateNumber: row.plateNumber, unitNumber: row.unitNumber });
  } catch (err) {
    logger.error({ err }, "fleet/maintenance detail error");
    return res.status(500).json({ error: "Gagal mengambil detail maintenance" });
  }
});

// ── POST /api/fleet/maintenance/:id/approve ───────────────────────────────────

router.post("/fleet/maintenance/:id/approve", requireAuth, requireRole("supervisor", "company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);
    const { costActual, workshopName, generatePurchaseRequest, notes } = req.body as {
      costActual?: number;
      workshopName?: string;
      generatePurchaseRequest?: boolean;
      notes?: string;
    };

    const [existing] = await db
      .select()
      .from(fleetMaintenanceRecordsTable)
      .where(and(eq(fleetMaintenanceRecordsTable.id, id), eq(fleetMaintenanceRecordsTable.companyId, companyId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record tidak ditemukan" });
    if (existing.status !== "pending") {
      return res.status(400).json({ error: `Hanya record dengan status 'pending' yang dapat di-approve. Status saat ini: ${existing.status}` });
    }

    const updates: Record<string, unknown> = {
      status: "in_progress",
      approvedBy: req.user?.id ?? null,
      approvedAt: new Date(),
    };
    if (costActual != null) updates.costActual = costActual;
    if (workshopName) updates.workshopName = workshopName;
    if (notes) updates.notes = notes;

    let purchaseRequest = null;

    // Generate purchase request jika diminta (tanpa auto-expense)
    if (generatePurchaseRequest) {
      const [unit] = await db
        .select({ plateNumber: fleetUnitsTable.plateNumber })
        .from(fleetUnitsTable)
        .where(eq(fleetUnitsTable.id, existing.fleetUnitId))
        .limit(1);

      const [pr] = await db.insert(logisticPurchaseRequestsTable).values({
        companyId,
        requestNumber: generatePRNumber(),
        requestedBy: req.user?.name ?? "Fleet System",
        description: `[FLEET] ${existing.description} — Kendaraan: ${unit?.plateNumber ?? existing.fleetUnitId}`,
        estimatedAmount: Number(costActual ?? existing.costEstimate ?? 0),
        status: "draft",
        notes: `Auto-generated dari approval maintenance #${id}. Perlu review finance sebelum pembayaran.`,
      }).returning();

      purchaseRequest = pr;
      updates.purchaseRequestId = pr.id;
    }

    const [updated] = await db
      .update(fleetMaintenanceRecordsTable)
      .set(updates)
      .where(and(eq(fleetMaintenanceRecordsTable.id, id), eq(fleetMaintenanceRecordsTable.companyId, companyId)))
      .returning();

    await audit(req, "fleet.maintenance.approved", id, existing, updated);
    return res.json({ record: updated, purchaseRequest });
  } catch (err) {
    logger.error({ err }, "fleet/maintenance approve error");
    return res.status(500).json({ error: "Gagal approve maintenance" });
  }
});

// ── POST /api/fleet/maintenance/:id/reject ────────────────────────────────────

router.post("/fleet/maintenance/:id/reject", requireAuth, requireRole("supervisor", "company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);
    const { reason } = req.body as { reason?: string };

    const [existing] = await db
      .select()
      .from(fleetMaintenanceRecordsTable)
      .where(and(eq(fleetMaintenanceRecordsTable.id, id), eq(fleetMaintenanceRecordsTable.companyId, companyId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record tidak ditemukan" });
    if (existing.status !== "pending") {
      return res.status(400).json({ error: `Hanya record dengan status 'pending' yang dapat ditolak. Status saat ini: ${existing.status}` });
    }

    const [updated] = await db
      .update(fleetMaintenanceRecordsTable)
      .set({
        status: "rejected",
        rejectedBy: null,
        rejectedAt: new Date(),
        rejectionReason: reason ?? "Ditolak oleh supervisor",
      })
      .where(and(eq(fleetMaintenanceRecordsTable.id, id), eq(fleetMaintenanceRecordsTable.companyId, companyId)))
      .returning();

    await audit(req, "fleet.maintenance.rejected", id, existing, updated);
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "fleet/maintenance reject error");
    return res.status(500).json({ error: "Gagal menolak maintenance" });
  }
});

// ── POST /api/fleet/maintenance/:id/complete ──────────────────────────────────

router.post("/fleet/maintenance/:id/complete", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);
    const { completionDate, costActual, invoiceUrl, nextServiceKm, nextServiceDate, notes } = req.body as Record<string, unknown>;

    const [existing] = await db
      .select()
      .from(fleetMaintenanceRecordsTable)
      .where(and(eq(fleetMaintenanceRecordsTable.id, id), eq(fleetMaintenanceRecordsTable.companyId, companyId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Record tidak ditemukan" });
    if (existing.status !== "in_progress") {
      return res.status(400).json({ error: `Hanya record 'in_progress' yang dapat diselesaikan. Status: ${existing.status}` });
    }

    const today = new Date().toISOString().split("T")[0];
    const updates: Record<string, unknown> = {
      status: "completed",
      completionDate: (completionDate as string) || today,
    };
    if (costActual != null) updates.costActual = costActual;
    if (invoiceUrl) updates.invoiceUrl = invoiceUrl;
    if (nextServiceKm) updates.nextServiceKm = nextServiceKm;
    if (nextServiceDate) updates.nextServiceDate = nextServiceDate;
    if (notes) updates.notes = notes;

    const [updated] = await db
      .update(fleetMaintenanceRecordsTable)
      .set(updates)
      .where(and(eq(fleetMaintenanceRecordsTable.id, id), eq(fleetMaintenanceRecordsTable.companyId, companyId)))
      .returning();

    await audit(req, "fleet.maintenance.completed", id, existing, updated);
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "fleet/maintenance complete error");
    return res.status(500).json({ error: "Gagal menyelesaikan maintenance" });
  }
});

export default router;
