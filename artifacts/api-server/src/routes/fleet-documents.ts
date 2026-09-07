/**
 * Sprint 7B — Fleet Documents API
 *
 * GET    /api/fleet/documents/expiring        — dokumen yang akan/sudah expired
 * GET    /api/fleet/units/:unitId/documents   — list dokumen per kendaraan
 * POST   /api/fleet/units/:unitId/documents   — upload dokumen
 * PATCH  /api/fleet/documents/:id             — update dokumen
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  fleetDocumentsTable,
  fleetUnitsTable,
  aiTasksTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";
import { eq, and, desc, lte, sql } from "drizzle-orm";

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
    entityType: "fleet_document",
    before: before ? JSON.stringify(before) : null,
    after: after ? JSON.stringify(after) : null,
    ipAddress: req.ip,
  }).catch(e => logger.warn({ e }, "audit log failed"));
}

function computeDocStatus(expiredDate: string | null): "active" | "expiring_soon" | "expired" {
  if (!expiredDate) return "active";
  const now = new Date();
  const exp = new Date(expiredDate);
  const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 30) return "expiring_soon";
  return "active";
}

const DOC_TYPE_LABELS: Record<string, string> = {
  stnk: "STNK",
  kir: "KIR",
  insurance: "Asuransi",
  tax: "Pajak",
  mutation: "Mutasi",
  other: "Lainnya",
};

// ── GET /api/fleet/documents/expiring ─────────────────────────────────────────

router.get("/fleet/documents/expiring", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const days = parseInt((req.query.days as string) || "30");
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + days);
    const thresholdStr = threshold.toISOString().split("T")[0];

    const docs = await db
      .select({
        doc: fleetDocumentsTable,
        plateNumber: fleetUnitsTable.plateNumber,
        unitNumber: fleetUnitsTable.unitNumber,
      })
      .from(fleetDocumentsTable)
      .leftJoin(fleetUnitsTable, eq(fleetDocumentsTable.fleetUnitId, fleetUnitsTable.id))
      .where(and(
        eq(fleetDocumentsTable.companyId, companyId),
        lte(fleetDocumentsTable.expiredDate, thresholdStr!),
      ))
      .orderBy(fleetDocumentsTable.expiredDate);

    const now = new Date();
    const enriched = docs.map(r => {
      const daysLeft = r.doc.expiredDate
        ? Math.ceil((new Date(r.doc.expiredDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      return {
        ...r.doc,
        plateNumber: r.plateNumber,
        unitNumber: r.unitNumber,
        daysLeft,
        docTypeLabel: DOC_TYPE_LABELS[r.doc.docType] ?? r.doc.docType,
        status: computeDocStatus(r.doc.expiredDate),
      };
    });

    res.json({ data: enriched, total: enriched.length });
  } catch (err) {
    logger.error({ err }, "fleet/documents expiring error");
    res.status(500).json({ error: "Gagal mengambil data dokumen" });
  }
});

// ── GET /api/fleet/units/:unitId/documents ────────────────────────────────────

router.get("/fleet/units/:unitId/documents", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const unitId = parseInt(req.params.unitId as string);

    const docs = await db
      .select()
      .from(fleetDocumentsTable)
      .where(and(
        eq(fleetDocumentsTable.fleetUnitId, unitId),
        eq(fleetDocumentsTable.companyId, companyId),
      ))
      .orderBy(desc(fleetDocumentsTable.createdAt));

    const enriched = docs.map(d => ({
      ...d,
      docTypeLabel: DOC_TYPE_LABELS[d.docType] ?? d.docType,
      status: computeDocStatus(d.expiredDate),
    }));

    res.json({ data: enriched, total: enriched.length });
  } catch (err) {
    logger.error({ err }, "fleet/units documents error");
    res.status(500).json({ error: "Gagal mengambil dokumen kendaraan" });
  }
});

// ── POST /api/fleet/units/:unitId/documents ───────────────────────────────────

router.post("/fleet/units/:unitId/documents", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const unitId = parseInt(req.params.unitId as string);
    const body = req.body as Record<string, unknown>;

    if (!body.docType) {
      return res.status(400).json({ error: "docType wajib diisi" });
    }

    const [unit] = await db
      .select({ id: fleetUnitsTable.id, plateNumber: fleetUnitsTable.plateNumber })
      .from(fleetUnitsTable)
      .where(and(eq(fleetUnitsTable.id, unitId), eq(fleetUnitsTable.companyId, companyId)))
      .limit(1);

    if (!unit) return res.status(404).json({ error: "Kendaraan tidak ditemukan" });

    const docStatus = computeDocStatus(body.expiredDate as string | null);

    const [doc] = await db.insert(fleetDocumentsTable).values({
      companyId,
      fleetUnitId: unitId,
      docType: body.docType as string,
      docNumber: body.docNumber as string | undefined,
      issuedDate: body.issuedDate as string | undefined,
      expiredDate: body.expiredDate as string | undefined,
      issuingAuthority: body.issuingAuthority as string | undefined,
      fileUrl: body.fileUrl as string | undefined,
      status: docStatus,
      reminderDays: (body.reminderDays as number) || 30,
      notes: body.notes as string | undefined,
      createdBy: null,
    }).returning();

    await audit(req, "fleet.document.uploaded", doc.id, null, doc);

    // Auto-create AI task jika dokumen langsung expired atau expiring_soon
    if (docStatus === "expired" || docStatus === "expiring_soon") {
      const daysLeft = doc.expiredDate
        ? Math.ceil((new Date(doc.expiredDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const label = DOC_TYPE_LABELS[doc.docType] ?? doc.docType;
      const isExpired = docStatus === "expired";

      await db.insert(aiTasksTable).values({
        companyId,
        source: "fleet_scheduler",
        title: `${isExpired ? "DOKUMEN EXPIRED" : "Dokumen Akan Expired"}: ${label} kendaraan ${unit.plateNumber}`,
        description: isExpired
          ? `${label} untuk kendaraan ${unit.plateNumber} telah expired. Segera perpanjang.`
          : `${label} untuk kendaraan ${unit.plateNumber} akan expired dalam ${daysLeft} hari. Segera perpanjang.`,
        category: "fleet_document",
        priority: isExpired ? "high" : "medium",
        status: "new_inquiry",
        adminNotes: `auto_created=true requires_human_review=true fleet_unit_id=${unitId} doc_id=${doc.id}`,
      }).catch(e => logger.warn({ e }, "ai_task creation failed"));
    }

    return res.status(201).json({ ...doc, status: docStatus });
  } catch (err) {
    logger.error({ err }, "fleet/documents upload error");
    return res.status(500).json({ error: "Gagal upload dokumen" });
  }
});

// ── PATCH /api/fleet/documents/:id ────────────────────────────────────────────

router.patch("/fleet/documents/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = cid(req);
    const id = parseInt(req.params.id as string);
    const body = req.body as Record<string, unknown>;

    const [existing] = await db
      .select()
      .from(fleetDocumentsTable)
      .where(and(eq(fleetDocumentsTable.id, id), eq(fleetDocumentsTable.companyId, companyId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Dokumen tidak ditemukan" });

    const allowed = ["docNumber", "issuedDate", "expiredDate", "issuingAuthority", "fileUrl", "reminderDays", "notes"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }
    if ("expiredDate" in body) {
      updates.status = computeDocStatus(body.expiredDate as string | null);
    }

    const [updated] = await db
      .update(fleetDocumentsTable)
      .set(updates)
      .where(and(eq(fleetDocumentsTable.id, id), eq(fleetDocumentsTable.companyId, companyId)))
      .returning();

    await audit(req, "fleet.document.updated", id, existing, updated);
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "fleet/documents update error");
    return res.status(500).json({ error: "Gagal update dokumen" });
  }
});

export default router;
