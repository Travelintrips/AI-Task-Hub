/**
 * Sprint 5B — Vendor Memory Center API
 *
 * All endpoints are under /api/vendors/:id/...
 * Primary entity: suppliers table in Supabase (vendor_id = suppliers.id)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  vendorPreferencesTable,
  vendorRiskAssessmentsTable,
  vendorPerformanceSnapshotsTable,
  vendorCapabilitiesTable,
  vendorDocumentRegistryTable,
  vendorMemorySnapshotsTable,
  vendorMemoryEventsTable,
  auditLogsTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole, getCompanyId } from "../middleware/auth";
import {
  invalidateVendorMemoryCache,
  computeReadinessScore,
  computeMissingDocs,
  computeDocumentScore,
  readinessGrade,
  getRequiredDocs,
  type VendorKpis,
} from "../lib/vendor-memory";
import { logger } from "../lib/logger";
import { sql, eq, and, desc, asc, isNotNull, lte } from "drizzle-orm";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function cid(req: Request): string {
  return getCompanyId(req) ?? req.user?.companyId ?? "default";
}

async function logVendorEvent(
  companyId: string,
  vendorId: number,
  eventType: string,
  actorId: string | undefined,
  actorType: "user" | "ai" | "system",
  entityType: string | null,
  entityId: number | null,
  payload: Record<string, unknown> | null,
  notes?: string,
) {
  try {
    await db.insert(vendorMemoryEventsTable).values({
      companyId,
      vendorId,
      eventType,
      actorId,
      actorType,
      entityType: entityType ?? undefined,
      entityId: entityId ?? undefined,
      payload: payload as any,
      notes,
    });
  } catch (e) {
    logger.warn({ e }, "logVendorEvent failed (non-fatal)");
  }
}

async function findVendorFromSupabase(vendorId: number) {
  const rows = await db.execute(
    sql`SELECT id, name, service_type, supported_modes, is_active, company_id,
               eta_days_min, eta_days_max, has_internal_truck, fee, markup,
               contact_email, phone, contact_person, country
        FROM suppliers WHERE id = ${vendorId} LIMIT 1`
  );
  return (rows.rows?.[0] ?? null) as Record<string, unknown> | null;
}

async function getVendorPerformanceFromSupabase(vendorId: number) {
  const rows = await db.execute(
    sql`SELECT * FROM vendor_performance WHERE vendor_id = ${vendorId} LIMIT 1`
  );
  return (rows.rows?.[0] ?? null) as Record<string, unknown> | null;
}

// ── GET /api/vendors — List vendors ──────────────────────────────────────────

router.get("/vendors", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const serviceType = req.query.service_type as string | undefined;
    const grade = req.query.grade as string | undefined;
    const riskTier = req.query.risk_tier as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);

    const vendorRows = await db.execute(
      serviceType
        ? sql`SELECT s.id, s.name, s.service_type, s.supported_modes, s.is_active, s.company_id, s.contact_email, s.phone, s.country, s.contact_person FROM suppliers s WHERE s.is_active = true AND s.service_type = ${serviceType} ORDER BY s.name LIMIT ${limit} OFFSET ${offset}`
        : sql`SELECT s.id, s.name, s.service_type, s.supported_modes, s.is_active, s.company_id, s.contact_email, s.phone, s.country, s.contact_person FROM suppliers s WHERE s.is_active = true ORDER BY s.name LIMIT ${limit} OFFSET ${offset}`
    );
    const vendors = vendorRows.rows as Record<string, unknown>[];

    // Attach risk and snapshot data
    const vendorIds = vendors.map((v) => Number(v["id"]));
    let enriched = vendors;

    if (vendorIds.length > 0) {
      const risks = await db
        .select({ vendorId: vendorRiskAssessmentsTable.vendorId, tier: vendorRiskAssessmentsTable.tier, riskScore: vendorRiskAssessmentsTable.riskScore })
        .from(vendorRiskAssessmentsTable)
        .where(and(eq(vendorRiskAssessmentsTable.companyId, companyId), eq(vendorRiskAssessmentsTable.isActive, true)));

      const snaps = await db
        .select({ vendorId: vendorMemorySnapshotsTable.vendorId, performanceGrade: vendorMemorySnapshotsTable.performanceGrade, readinessScore: vendorMemorySnapshotsTable.readinessScore, riskTier: vendorMemorySnapshotsTable.riskTier })
        .from(vendorMemorySnapshotsTable)
        .where(and(eq(vendorMemorySnapshotsTable.companyId, companyId), eq(vendorMemorySnapshotsTable.isStale, false)));

      const riskMap = new Map(risks.map((r) => [r.vendorId, r]));
      const snapMap = new Map(snaps.map((s) => [s.vendorId, s]));

      enriched = vendors.map((v) => {
        const vid = Number(v["id"]);
        return {
          ...v,
          activeRisk: riskMap.get(vid) ?? null,
          latestSnapshot: snapMap.get(vid) ?? null,
        };
      });

      if (grade) {
        enriched = enriched.filter((v) => (v as any).latestSnapshot?.performanceGrade === grade);
      }
      if (riskTier) {
        enriched = enriched.filter((v) => (v as any).activeRisk?.tier === riskTier);
      }
    }

    res.json({ vendors: enriched, total: enriched.length, limit, offset });
  } catch (err) {
    logger.error({ err }, "GET /vendors failed");
    res.status(500).json({ error: "Failed to list vendors" });
  }
});

// ── GET /api/vendors/:id/memory ───────────────────────────────────────────────

router.get("/vendors/:id/memory", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [vendor, supabasePerf, activeRisk, latestSnapRows, activePrefs, docs] = await Promise.all([
      findVendorFromSupabase(id),
      getVendorPerformanceFromSupabase(id),
      db.select().from(vendorRiskAssessmentsTable)
        .where(and(eq(vendorRiskAssessmentsTable.companyId, companyId), eq(vendorRiskAssessmentsTable.vendorId, id), eq(vendorRiskAssessmentsTable.isActive, true)))
        .orderBy(desc(vendorRiskAssessmentsTable.assessedAt)).limit(1),
      db.select({
        id: vendorMemorySnapshotsTable.id, version: vendorMemorySnapshotsTable.version,
        aiContextBlock: vendorMemorySnapshotsTable.aiContextBlock, freshnessScore: vendorMemorySnapshotsTable.freshnessScore,
        isStale: vendorMemorySnapshotsTable.isStale, activeJobsCount: vendorMemorySnapshotsTable.activeJobsCount,
        topServiceTypes: vendorMemorySnapshotsTable.topServiceTypes, missingDocsList: vendorMemorySnapshotsTable.missingDocsList,
        riskTier: vendorMemorySnapshotsTable.riskTier, performanceGrade: vendorMemorySnapshotsTable.performanceGrade,
        readinessScore: vendorMemorySnapshotsTable.readinessScore, priceTrend: vendorMemorySnapshotsTable.priceTrend,
        avgPrice: vendorMemorySnapshotsTable.avgPrice, recentIssues: vendorMemorySnapshotsTable.recentIssues,
        createdAt: vendorMemorySnapshotsTable.createdAt,
      })
        .from(vendorMemorySnapshotsTable)
        .where(and(eq(vendorMemorySnapshotsTable.companyId, companyId), eq(vendorMemorySnapshotsTable.vendorId, id)))
        .orderBy(desc(vendorMemorySnapshotsTable.createdAt)).limit(1),
      db.select().from(vendorPreferencesTable)
        .where(and(eq(vendorPreferencesTable.companyId, companyId), eq(vendorPreferencesTable.vendorId, id), eq(vendorPreferencesTable.status, "active")))
        .orderBy(asc(vendorPreferencesTable.category), asc(vendorPreferencesTable.key)),
      db.select().from(vendorDocumentRegistryTable)
        .where(and(eq(vendorDocumentRegistryTable.companyId, companyId), eq(vendorDocumentRegistryTable.vendorId, id), eq(vendorDocumentRegistryTable.isCurrent, true)))
        .orderBy(desc(vendorDocumentRegistryTable.uploadedAt)).limit(50),
    ]);

    if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }

    const kpis: VendorKpis = supabasePerf ? {
      onTimeRate: Number(supabasePerf["on_time_rate"] ?? supabasePerf["ontime_percentage"] ?? 0) / 100,
      podCompletenessScore: Number(supabasePerf["pod_completeness_score"] ?? 0) / 100,
      rfqSelected: Number(supabasePerf["total_selected"] ?? 0),
      rfqSubmitted: Number(supabasePerf["total_submitted"] ?? 0),
      avgResponseHours: Number(supabasePerf["avg_response_hours"] ?? 24),
      etaAccuracyScore: Number(supabasePerf["eta_accuracy_score"] ?? 0) / 100,
      cancelRate: Number(supabasePerf["cancel_rate"] ?? 0),
      documentScore: computeDocumentScore(String(vendor["service_type"] ?? "default"), docs.map((d) => ({ documentType: d.documentType, isCurrent: d.isCurrent, isVerified: d.isVerified, expiryDate: d.expiryDate }))),
      riskTier: activeRisk[0]?.tier ?? "low",
    } : {};

    const readinessScore = computeReadinessScore(kpis);
    const missingDocs    = computeMissingDocs(String(vendor["service_type"] ?? "default"), docs.map((d) => ({ documentType: d.documentType, isCurrent: d.isCurrent, isVerified: d.isVerified, expiryDate: d.expiryDate })));

    res.json({
      vendor,
      supabasePerformance: supabasePerf,
      activeRisk: activeRisk[0] ?? null,
      latestSnapshot: latestSnapRows[0] ?? null,
      preferences: activePrefs,
      documents: docs,
      readinessScore,
      grade: readinessGrade(readinessScore),
      missingDocs,
    });
  } catch (err) {
    logger.error({ err }, "GET /vendors/:id/memory failed");
    res.status(500).json({ error: "Failed to load vendor memory" });
  }
});

// ── GET /api/vendors/:id/performance ─────────────────────────────────────────

router.get("/vendors/:id/performance", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [supabasePerf, snapshots, activeRisk, docs] = await Promise.all([
      getVendorPerformanceFromSupabase(id),
      db.select().from(vendorPerformanceSnapshotsTable)
        .where(and(eq(vendorPerformanceSnapshotsTable.companyId, companyId), eq(vendorPerformanceSnapshotsTable.vendorId, id)))
        .orderBy(desc(vendorPerformanceSnapshotsTable.snapshotDate)).limit(30),
      db.select().from(vendorRiskAssessmentsTable)
        .where(and(eq(vendorRiskAssessmentsTable.companyId, companyId), eq(vendorRiskAssessmentsTable.vendorId, id), eq(vendorRiskAssessmentsTable.isActive, true)))
        .limit(1),
      db.select().from(vendorDocumentRegistryTable)
        .where(and(eq(vendorDocumentRegistryTable.companyId, companyId), eq(vendorDocumentRegistryTable.vendorId, id), eq(vendorDocumentRegistryTable.isCurrent, true))),
    ]);

    const vendor = await findVendorFromSupabase(id);
    const docItems = docs.map((d) => ({ documentType: d.documentType, isCurrent: d.isCurrent, isVerified: d.isVerified, expiryDate: d.expiryDate }));
    const kpis: VendorKpis = supabasePerf ? {
      onTimeRate: Number(supabasePerf["on_time_rate"] ?? supabasePerf["ontime_percentage"] ?? 0) / 100,
      podCompletenessScore: Number(supabasePerf["pod_completeness_score"] ?? 0) / 100,
      rfqSelected: Number(supabasePerf["total_selected"] ?? 0),
      rfqSubmitted: Number(supabasePerf["total_submitted"] ?? 0),
      avgResponseHours: Number(supabasePerf["avg_response_hours"] ?? 24),
      etaAccuracyScore: Number(supabasePerf["eta_accuracy_score"] ?? 0) / 100,
      cancelRate: Number(supabasePerf["cancel_rate"] ?? 0),
      documentScore: computeDocumentScore(String(vendor?.["service_type"] ?? "default"), docItems),
      riskTier: activeRisk[0]?.tier ?? "low",
    } : {};

    const readinessScore = computeReadinessScore(kpis);
    const grade          = readinessGrade(readinessScore);

    res.json({
      supabasePerformance: supabasePerf,
      snapshots,
      readinessScore,
      grade,
      riskTier: activeRisk[0]?.tier ?? null,
      kpis,
    });
  } catch (err) {
    logger.error({ err }, "GET /vendors/:id/performance failed");
    res.status(500).json({ error: "Failed to load vendor performance" });
  }
});

// ── GET /api/vendors/:id/pricing ──────────────────────────────────────────────

router.get("/vendors/:id/pricing", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const days   = Math.min(Number(req.query.days ?? 90), 365);
    const since  = new Date(Date.now() - days * 86400_000).toISOString().split("T")[0];

    const [rateCard, rfqHistory, miniFormHistory, catalogPrices] = await Promise.all([
      db.execute(sql`SELECT * FROM vendor_rates WHERE vendor_id = ${id} AND is_active = true ORDER BY transport_mode, created_at DESC`),
      db.execute(sql`
        SELECT rvl.vendor_id, rvl.offered_price, rvl.currency, rvl.eta, rvl.submitted_at,
               rvl.status, rvl.rfq_type, f.rfq_id
        FROM rfq_vendor_links rvl
        LEFT JOIN freight_rfqs f ON f.id = rvl.rfq_id
        WHERE rvl.vendor_id = ${id}
          AND rvl.submitted_at >= ${since}::date
        ORDER BY rvl.submitted_at DESC LIMIT 50
      `),
      db.execute(sql`
        SELECT vendor_price, currency, eta, valid_until, selected_by_admin,
               submitted_at, service_type, vendor_name
        FROM vendor_mini_form_submissions
        WHERE supplier_id = ${id}
          AND submitted_at >= ${since}
        ORDER BY submitted_at DESC LIMIT 30
      `),
      db.execute(sql`
        SELECT id, name, price_base, price_sell, currency, validity_date,
               service_type, kategori, stock_status, lead_time
        FROM vendor_catalog_items
        WHERE vendor_id = ${id} AND is_published = true
        ORDER BY updated_at DESC LIMIT 20
      `),
    ]);

    const allPrices = [
      ...(rfqHistory.rows as any[]).map((r) => ({ source: "rfq", price: Number(r.offered_price), currency: r.currency, date: r.submitted_at, selected: r.status === "selected" })),
      ...(miniFormHistory.rows as any[]).map((r) => ({ source: "mini_form", price: Number(r.vendor_price), currency: r.currency, date: r.submitted_at, selected: r.selected_by_admin })),
    ].filter((p) => p.price > 0);

    const avgOffered = allPrices.length > 0
      ? allPrices.reduce((s, p) => s + p.price, 0) / allPrices.length
      : null;

    const wonPrices  = allPrices.filter((p) => p.selected);
    const avgFinal   = wonPrices.length > 0
      ? wonPrices.reduce((s, p) => s + p.price, 0) / wonPrices.length
      : null;

    res.json({
      rateCard: rateCard.rows,
      rfqHistory: rfqHistory.rows,
      miniFormHistory: miniFormHistory.rows,
      catalogPrices: catalogPrices.rows,
      stats: {
        avgOffered,
        avgFinal,
        totalQuotations: allPrices.length,
        wonQuotations: wonPrices.length,
        winRate: allPrices.length > 0 ? wonPrices.length / allPrices.length : null,
        days,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /vendors/:id/pricing failed");
    res.status(500).json({ error: "Failed to load vendor pricing" });
  }
});

// ── GET /api/vendors/:id/capabilities ────────────────────────────────────────

router.get("/vendors/:id/capabilities", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [capabilities, vendor, drivers, catalog] = await Promise.all([
      db.select().from(vendorCapabilitiesTable)
        .where(and(eq(vendorCapabilitiesTable.companyId, companyId), eq(vendorCapabilitiesTable.vendorId, id), eq(vendorCapabilitiesTable.isActive, true)))
        .orderBy(asc(vendorCapabilitiesTable.serviceType)),
      findVendorFromSupabase(id),
      db.execute(sql`SELECT * FROM vendor_drivers WHERE supplier_id = ${id} AND is_active = true ORDER BY name`),
      db.execute(sql`SELECT id, name, type, service_type, kategori, price_base, price_sell, currency, stock_status, lead_time, origin_cities, is_published FROM vendor_catalog_items WHERE vendor_id = ${id} AND is_published = true ORDER BY name LIMIT 30`),
    ]);

    res.json({
      capabilities,
      vendor: {
        serviceType: vendor?.["service_type"],
        supportedModes: vendor?.["supported_modes"],
        hasInternalTruck: vendor?.["has_internal_truck"],
        etaDaysMin: vendor?.["eta_days_min"],
        etaDaysMax: vendor?.["eta_days_max"],
      },
      drivers: drivers.rows,
      driverCount: drivers.rows.length,
      catalog: catalog.rows,
    });
  } catch (err) {
    logger.error({ err }, "GET /vendors/:id/capabilities failed");
    res.status(500).json({ error: "Failed to load vendor capabilities" });
  }
});

// ── POST /api/vendors/:id/capabilities ───────────────────────────────────────

router.post("/vendors/:id/capabilities",
  requireAuth, requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

      const { serviceType, cargoType, dangerousGoods, coldChain, maxWeightKg, maxVolumeM3, originCities, destinationCities, vehicleTypes, driverCount, certifications, notes } = req.body as Record<string, unknown>;
      if (!serviceType) { res.status(400).json({ error: "serviceType is required" }); return; }

      const [cap] = await db.insert(vendorCapabilitiesTable).values({
        companyId,
        vendorId: id,
        serviceType: String(serviceType),
        cargoType: cargoType ? String(cargoType) : undefined,
        dangerousGoods: Boolean(dangerousGoods),
        coldChain: Boolean(coldChain),
        maxWeightKg: maxWeightKg ? Number(maxWeightKg) : undefined,
        maxVolumeM3: maxVolumeM3 ? Number(maxVolumeM3) : undefined,
        originCities: Array.isArray(originCities) ? (originCities as string[]) : undefined,
        destinationCities: Array.isArray(destinationCities) ? (destinationCities as string[]) : undefined,
        vehicleTypes: Array.isArray(vehicleTypes) ? (vehicleTypes as string[]) : undefined,
        driverCount: driverCount ? Number(driverCount) : undefined,
        certifications: Array.isArray(certifications) ? (certifications as string[]) : undefined,
        notes: notes ? String(notes) : undefined,
        source: "manual",
        createdBy: String(req.user?.email ?? req.user?.id ?? "unknown"),
      }).returning();

      await logVendorEvent(companyId, id, "capability_updated", req.user?.id ? String(req.user.id) : undefined, "user", "vendor_capability", cap!.id, { serviceType, action: "created" });
      res.status(201).json(cap);
    } catch (err) {
      logger.error({ err }, "POST /vendors/:id/capabilities failed");
      res.status(500).json({ error: "Failed to create capability" });
    }
  }
);

// ── DELETE /api/vendors/:id/capabilities/:capId ───────────────────────────────

router.delete("/vendors/:id/capabilities/:capId",
  requireAuth, requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      const capId = Number(req.params.capId);
      if (Number.isNaN(id) || Number.isNaN(capId)) { res.status(400).json({ error: "Invalid id" }); return; }

      await db.update(vendorCapabilitiesTable)
        .set({ isActive: false })
        .where(and(eq(vendorCapabilitiesTable.id, capId), eq(vendorCapabilitiesTable.companyId, companyId), eq(vendorCapabilitiesTable.vendorId, id)));

      await logVendorEvent(companyId, id, "capability_updated", req.user?.id ? String(req.user.id) : undefined, "user", "vendor_capability", capId, { action: "deactivated" });
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "DELETE /vendors/:id/capabilities/:capId failed");
      res.status(500).json({ error: "Failed to deactivate capability" });
    }
  }
);

// ── GET /api/vendors/:id/documents ───────────────────────────────────────────

router.get("/vendors/:id/documents", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const vendor = await findVendorFromSupabase(id);
    const serviceType = String(vendor?.["service_type"] ?? "default");
    const requiredDocs = getRequiredDocs(serviceType);

    const currentFilter = req.query.current === "false" ? undefined : true;
    const docs = await db.select().from(vendorDocumentRegistryTable)
      .where(and(
        eq(vendorDocumentRegistryTable.companyId, companyId),
        eq(vendorDocumentRegistryTable.vendorId, id),
        ...(currentFilter !== undefined ? [eq(vendorDocumentRegistryTable.isCurrent, currentFilter)] : []),
      ))
      .orderBy(desc(vendorDocumentRegistryTable.uploadedAt))
      .limit(100);

    const docItems = docs.map((d) => ({ documentType: d.documentType, isCurrent: d.isCurrent, isVerified: d.isVerified, expiryDate: d.expiryDate }));
    const missingDocs = computeMissingDocs(serviceType, docItems);
    const documentScore = computeDocumentScore(serviceType, docItems);

    const now = new Date();
    const in30days = new Date(now.getTime() + 30 * 86400_000);
    const expiringSoon = docs.filter((d) => d.expiryDate && new Date(d.expiryDate) > now && new Date(d.expiryDate) <= in30days);

    res.json({
      documents: docs,
      requiredDocs,
      missingDocs,
      documentScore: Math.round(documentScore * 100),
      complianceStatus: documentScore >= 0.9 ? "compliant" : documentScore >= 0.7 ? "partial" : documentScore >= 0.5 ? "incomplete" : "non_compliant",
      expiringSoon: expiringSoon.map((d) => ({
        doc: d,
        expiryDate: d.expiryDate,
        daysLeft: Math.ceil((new Date(d.expiryDate!).getTime() - now.getTime()) / 86400_000),
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /vendors/:id/documents failed");
    res.status(500).json({ error: "Failed to load vendor documents" });
  }
});

// ── POST /api/vendors/:id/documents ──────────────────────────────────────────

router.post("/vendors/:id/documents", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { documentType, fileName, fileUrl, objectPath, mimeType, fileSizeBytes, expiryDate, notes, tags, sourceType, sourceId } = req.body as Record<string, unknown>;
    if (!documentType || !fileName) { res.status(400).json({ error: "documentType and fileName are required" }); return; }

    await db.update(vendorDocumentRegistryTable)
      .set({ isCurrent: false })
      .where(and(eq(vendorDocumentRegistryTable.companyId, companyId), eq(vendorDocumentRegistryTable.vendorId, id), eq(vendorDocumentRegistryTable.documentType, String(documentType)), eq(vendorDocumentRegistryTable.isCurrent, true)));

    const [doc] = await db.insert(vendorDocumentRegistryTable).values({
      companyId,
      vendorId: id,
      documentType: String(documentType),
      fileName: String(fileName),
      fileUrl: fileUrl ? String(fileUrl) : undefined,
      objectPath: objectPath ? String(objectPath) : undefined,
      mimeType: mimeType ? String(mimeType) : undefined,
      fileSizeBytes: fileSizeBytes ? Number(fileSizeBytes) : undefined,
      expiryDate: expiryDate ? String(expiryDate) : undefined,
      notes: notes ? String(notes) : undefined,
      tags: Array.isArray(tags) ? (tags as string[]) : undefined,
      sourceType: sourceType ? String(sourceType) : "upload",
      sourceId: sourceId ? Number(sourceId) : undefined,
      isCurrent: true,
      uploadedBy: String(req.user?.email ?? req.user?.id ?? "unknown"),
    }).returning();

    await logVendorEvent(companyId, id, "document_registered", req.user?.id ? String(req.user.id) : undefined, "user", "vendor_document", doc!.id, { documentType, fileName });
    res.status(201).json(doc);
  } catch (err) {
    logger.error({ err }, "POST /vendors/:id/documents failed");
    res.status(500).json({ error: "Failed to register document" });
  }
});

// ── PATCH /api/vendors/:id/documents/:docId ──────────────────────────────────

router.patch("/vendors/:id/documents/:docId",
  requireAuth, requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      const docId = Number(req.params.docId);
      if (Number.isNaN(id) || Number.isNaN(docId)) { res.status(400).json({ error: "Invalid id" }); return; }

      const { isVerified, expiryDate, notes, isCurrent, verificationNotes } = req.body as Record<string, unknown>;
      const updates: Record<string, unknown> = {};
      if (isVerified !== undefined) {
        updates["isVerified"] = Boolean(isVerified);
        if (Boolean(isVerified)) { updates["verifiedBy"] = req.user?.email ?? "unknown"; updates["verifiedAt"] = new Date(); }
      }
      if (expiryDate !== undefined) updates["expiryDate"] = String(expiryDate);
      if (notes !== undefined) updates["notes"] = String(notes);
      if (isCurrent !== undefined) updates["isCurrent"] = Boolean(isCurrent);
      if (verificationNotes !== undefined) updates["verificationNotes"] = String(verificationNotes);

      const [updated] = await db.update(vendorDocumentRegistryTable)
        .set(updates as any)
        .where(and(eq(vendorDocumentRegistryTable.id, docId), eq(vendorDocumentRegistryTable.companyId, companyId), eq(vendorDocumentRegistryTable.vendorId, id)))
        .returning();

      if (!updated) { res.status(404).json({ error: "Document not found" }); return; }
      await logVendorEvent(companyId, id, "document_verified", req.user?.id ? String(req.user.id) : undefined, "user", "vendor_document", docId, { isVerified, updates: Object.keys(updates) });
      res.json(updated);
    } catch (err) {
      logger.error({ err }, "PATCH /vendors/:id/documents/:docId failed");
      res.status(500).json({ error: "Failed to update document" });
    }
  }
);

// ── DELETE /api/vendors/:id/documents/:docId ─────────────────────────────────

router.delete("/vendors/:id/documents/:docId",
  requireAuth, requireRole("company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      const docId = Number(req.params.docId);
      if (Number.isNaN(id) || Number.isNaN(docId)) { res.status(400).json({ error: "Invalid id" }); return; }

      const [deleted] = await db.delete(vendorDocumentRegistryTable)
        .where(and(eq(vendorDocumentRegistryTable.id, docId), eq(vendorDocumentRegistryTable.companyId, companyId), eq(vendorDocumentRegistryTable.vendorId, id)))
        .returning();

      if (!deleted) { res.status(404).json({ error: "Document not found" }); return; }
      await logVendorEvent(companyId, id, "document_registered", req.user?.id ? String(req.user.id) : undefined, "user", "vendor_document", docId, { action: "deleted", fileName: deleted.fileName });
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "DELETE /vendors/:id/documents/:docId failed");
      res.status(500).json({ error: "Failed to delete document" });
    }
  }
);

// ── GET /api/vendors/:id/risk ─────────────────────────────────────────────────

router.get("/vendors/:id/risk", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const canSeeFactors = ["supervisor", "company_admin", "super_admin"].includes(req.user?.role ?? "");
    const assessments = await db.select().from(vendorRiskAssessmentsTable)
      .where(and(eq(vendorRiskAssessmentsTable.companyId, companyId), eq(vendorRiskAssessmentsTable.vendorId, id)))
      .orderBy(desc(vendorRiskAssessmentsTable.assessedAt)).limit(20);

    const result = assessments.map((a) => ({
      ...a,
      factors: canSeeFactors ? a.factors : undefined,
      recommendations: canSeeFactors ? a.recommendations : undefined,
    }));

    res.json({
      active: result.find((a) => a.isActive) ?? null,
      history: result.filter((a) => !a.isActive),
    });
  } catch (err) {
    logger.error({ err }, "GET /vendors/:id/risk failed");
    res.status(500).json({ error: "Failed to load risk assessments" });
  }
});

// ── POST /api/vendors/:id/risk ────────────────────────────────────────────────

router.post("/vendors/:id/risk",
  requireAuth, requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

      const { riskScore, tier, creditLimit, paymentTermsDays, factors, recommendations, notes, expiresAt } = req.body as Record<string, unknown>;
      if (riskScore == null || !tier) { res.status(400).json({ error: "riskScore and tier are required" }); return; }

      const vendor = await findVendorFromSupabase(id);
      if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }

      const [currentActive] = await db
        .select({ id: vendorRiskAssessmentsTable.id, tier: vendorRiskAssessmentsTable.tier })
        .from(vendorRiskAssessmentsTable)
        .where(and(eq(vendorRiskAssessmentsTable.companyId, companyId), eq(vendorRiskAssessmentsTable.vendorId, id), eq(vendorRiskAssessmentsTable.isActive, true)))
        .orderBy(desc(vendorRiskAssessmentsTable.assessedAt)).limit(1);

      const [newAssessment] = await db.insert(vendorRiskAssessmentsTable).values({
        companyId,
        vendorId: id,
        assessedBy: String(req.user?.email ?? req.user?.id ?? "unknown"),
        assessType: "manual",
        riskScore: Number(riskScore),
        tier: String(tier),
        previousTier: currentActive?.tier ?? null,
        creditLimit: creditLimit ? String(creditLimit) : undefined,
        paymentTermsDays: paymentTermsDays ? Number(paymentTermsDays) : undefined,
        factors: factors as any ?? undefined,
        recommendations: recommendations ? String(recommendations) : undefined,
        notes: notes ? String(notes) : undefined,
        expiresAt: expiresAt ? String(expiresAt) : undefined,
        isActive: true,
      }).returning();

      if (currentActive) {
        await db.update(vendorRiskAssessmentsTable)
          .set({ isActive: false, archivedAt: new Date(), archivedByAssessmentId: newAssessment!.id })
          .where(eq(vendorRiskAssessmentsTable.id, currentActive.id));
      }

      await logVendorEvent(companyId, id, "risk_assessed", req.user?.id ? String(req.user.id) : undefined, "user", "vendor_risk", newAssessment!.id, { riskScore, tier, previousTier: currentActive?.tier ?? null });

      await db.insert(auditLogsTable).values({
        action: "vendor_risk_assessment_created",
        module: "vendor_risk",
        before: currentActive ? `tier=${currentActive.tier}` : "none",
        after: `tier=${tier}, score=${riskScore}`,
        entityId: id,
      });

      invalidateVendorMemoryCache(companyId, id);
      res.status(201).json(newAssessment);
    } catch (err) {
      logger.error({ err }, "POST /vendors/:id/risk failed");
      res.status(500).json({ error: "Failed to create risk assessment" });
    }
  }
);

// ── GET /api/vendors/:id/preferences ─────────────────────────────────────────

router.get("/vendors/:id/preferences", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const statusFilter = (req.query.status as string | undefined) ?? "active";
    const rows = await db.select().from(vendorPreferencesTable)
      .where(and(eq(vendorPreferencesTable.companyId, companyId), eq(vendorPreferencesTable.vendorId, id), eq(vendorPreferencesTable.status, statusFilter)))
      .orderBy(asc(vendorPreferencesTable.category), asc(vendorPreferencesTable.key));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /vendors/:id/preferences failed");
    res.status(500).json({ error: "Failed to load preferences" });
  }
});

// ── PUT /api/vendors/:id/preferences/:category/:key ──────────────────────────

router.put("/vendors/:id/preferences/:category/:key",
  requireAuth, requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      const category = String(req.params.category);
      const key = String(req.params.key);
      const { value, valueJson, source = "manual", confidence, notes } = req.body as Record<string, unknown>;
      if (Number.isNaN(id) || !value) { res.status(400).json({ error: "id and value are required" }); return; }

      const [existing] = await db.select().from(vendorPreferencesTable)
        .where(and(eq(vendorPreferencesTable.companyId, companyId), eq(vendorPreferencesTable.vendorId, id), eq(vendorPreferencesTable.category, category), eq(vendorPreferencesTable.key, key), eq(vendorPreferencesTable.status, "active")))
        .limit(1);

      if (existing) {
        await db.update(vendorPreferencesTable).set({ status: "superseded", supersededAt: new Date() }).where(eq(vendorPreferencesTable.id, existing.id));
      }

      const [created] = await db.insert(vendorPreferencesTable).values({
        companyId,
        vendorId: id,
        category,
        key,
        value: String(value),
        valueJson: valueJson as any ?? undefined,
        status: "active",
        source: String(source),
        confidence: confidence ? String(confidence) : undefined,
        createdBy: String(req.user?.email ?? req.user?.id ?? "unknown"),
        supersededBy: existing ? existing.id : undefined,
      }).returning();

      if (existing) {
        await db.update(vendorPreferencesTable).set({ supersededBy: created!.id }).where(eq(vendorPreferencesTable.id, existing.id));
      }

      await logVendorEvent(companyId, id, "preference_created", req.user?.id ? String(req.user.id) : undefined, "user", "vendor_preference", created!.id, { category, key, oldValue: existing?.value ?? null, newValue: value }, notes as string | undefined);
      res.json(created);
    } catch (err) {
      logger.error({ err }, "PUT /vendors/:id/preferences failed");
      res.status(500).json({ error: "Failed to upsert preference" });
    }
  }
);

// ── DELETE /api/vendors/:id/preferences/:category/:key ───────────────────────

router.delete("/vendors/:id/preferences/:category/:key",
  requireAuth, requireRole("company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      const category = String(req.params.category);
      const key = String(req.params.key);
      if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

      await db.update(vendorPreferencesTable)
        .set({ status: "inactive", supersededAt: new Date() })
        .where(and(eq(vendorPreferencesTable.companyId, companyId), eq(vendorPreferencesTable.vendorId, id), eq(vendorPreferencesTable.category, category), eq(vendorPreferencesTable.key, key), eq(vendorPreferencesTable.status, "active")));

      await logVendorEvent(companyId, id, "preference_deactivated", req.user?.id ? String(req.user.id) : undefined, "user", "vendor_preference", null, { category, key, action: "deactivated" });
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "DELETE /vendors/:id/preferences failed");
      res.status(500).json({ error: "Failed to delete preference" });
    }
  }
);

// ── GET /api/vendors/:id/ai-context ──────────────────────────────────────────

router.get("/vendors/:id/ai-context", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [snapshot] = await db.select().from(vendorMemorySnapshotsTable)
      .where(and(eq(vendorMemorySnapshotsTable.companyId, companyId), eq(vendorMemorySnapshotsTable.vendorId, id)))
      .orderBy(desc(vendorMemorySnapshotsTable.createdAt)).limit(1);

    res.json(snapshot ?? null);
  } catch (err) {
    logger.error({ err }, "GET /vendors/:id/ai-context failed");
    res.status(500).json({ error: "Failed to load AI context" });
  }
});

// ── POST /api/vendors/:id/ai-context/refresh ─────────────────────────────────

router.post("/vendors/:id/ai-context/refresh",
  requireAuth, requireRole("supervisor", "company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = cid(req);
      const id = Number(req.params.id);
      if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

      const vendor = await findVendorFromSupabase(id);
      if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }

      const { openai } = await import("../lib/openai");

      const [supabasePerf, activeRisk, activePrefs, docs, rfqStats, jobStats] = await Promise.all([
        getVendorPerformanceFromSupabase(id),
        db.select().from(vendorRiskAssessmentsTable).where(and(eq(vendorRiskAssessmentsTable.companyId, companyId), eq(vendorRiskAssessmentsTable.vendorId, id), eq(vendorRiskAssessmentsTable.isActive, true))).limit(1),
        db.select().from(vendorPreferencesTable).where(and(eq(vendorPreferencesTable.companyId, companyId), eq(vendorPreferencesTable.vendorId, id), eq(vendorPreferencesTable.status, "active"))),
        db.select().from(vendorDocumentRegistryTable).where(and(eq(vendorDocumentRegistryTable.companyId, companyId), eq(vendorDocumentRegistryTable.vendorId, id), eq(vendorDocumentRegistryTable.isCurrent, true))),
        db.execute(sql`SELECT COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled','rejected')) AS active_jobs, COUNT(*) FILTER (WHERE status = 'completed') AS completed_jobs FROM vendor_job_orders WHERE vendor_id = ${id}`),
        db.execute(sql`SELECT transport_mode, COUNT(*) as cnt FROM vendor_rates WHERE vendor_id = ${id} AND is_active = true GROUP BY transport_mode ORDER BY cnt DESC LIMIT 5`),
      ]);

      const serviceType = String(vendor["service_type"] ?? "default");
      const docItems = docs.map((d) => ({ documentType: d.documentType, isCurrent: d.isCurrent, isVerified: d.isVerified, expiryDate: d.expiryDate }));
      const missingDocs = computeMissingDocs(serviceType, docItems);
      const docScore = computeDocumentScore(serviceType, docItems);
      const risk = activeRisk[0] ?? null;

      const kpis: VendorKpis = supabasePerf ? {
        onTimeRate: Number(supabasePerf["on_time_rate"] ?? 0) / 100,
        podCompletenessScore: Number(supabasePerf["pod_completeness_score"] ?? 0) / 100,
        rfqSelected: Number(supabasePerf["total_selected"] ?? 0),
        rfqSubmitted: Number(supabasePerf["total_submitted"] ?? 0),
        avgResponseHours: Number(supabasePerf["avg_response_hours"] ?? 24),
        etaAccuracyScore: Number(supabasePerf["eta_accuracy_score"] ?? 0) / 100,
        cancelRate: Number(supabasePerf["cancel_rate"] ?? 0),
        documentScore: docScore,
        riskTier: risk?.tier ?? "low",
      } : {};

      const readinessScore = computeReadinessScore(kpis);
      const grade = readinessGrade(readinessScore);
      const activeJobs = Number((jobStats.rows[0] as any)?.active_jobs ?? 0);
      const topModes = (jobStats.rows as any[]).map((r) => String(r.transport_mode));

      const responseTimeTier = kpis.avgResponseHours != null
        ? kpis.avgResponseHours < 2 ? "fast" : kpis.avgResponseHours < 24 ? "medium" : "slow"
        : "unknown";

      const contextPayload = {
        vendor: { id, name: vendor["name"], serviceType: vendor["service_type"], supportedModes: vendor["supported_modes"], country: vendor["country"] },
        performance: supabasePerf ? {
          grade: supabasePerf["vendor_grade"],
          onTimeRate: supabasePerf["on_time_rate"],
          cancelRate: supabasePerf["cancel_rate"],
          avgResponseHours: supabasePerf["avg_response_hours"],
          totalRfqInvites: supabasePerf["total_rfq_invites"],
          totalSelected: supabasePerf["total_selected"],
          recommendationScore: supabasePerf["recommendation_score"],
        } : null,
        risk: risk ? { score: risk.riskScore, tier: risk.tier, creditLimit: risk.creditLimit, expiresAt: risk.expiresAt } : null,
        readinessScore,
        grade,
        activeJobsCount: activeJobs,
        missingDocuments: missingDocs,
        preferences: activePrefs.map((p) => `${p.category}/${p.key}=${p.value}`),
        topServiceModes: topModes,
      };

      const systemPrompt = `Kamu adalah sistem AI yang menghasilkan "vendor memory snapshot" untuk platform manajemen logistik.
Berdasarkan data vendor, buat ringkasan singkat (max 350 kata) dalam format natural language yang akan diinjeksikan ke AI saat merekomendasikan atau menugaskan vendor ke order logistik.

Fokus pada:
- Kapabilitas layanan utama dan rute dominan
- Performa terkini (grade, on-time rate, win rate RFQ, kecepatan respons)
- Status risiko dan limit kredit
- Job aktif saat ini
- Dokumen yang kurang atau akan expire
- Preferensi operasional vendor

PENTING: Output harus ringkas dan informatif. Output HANYA teks naratif Bahasa Indonesia — TIDAK ada JSON, TIDAK ada header markdown.`;

      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Data vendor:\n${JSON.stringify(contextPayload, null, 2)}` },
        ],
        max_tokens: 450,
        temperature: 0.3,
      });

      const aiContextBlock = resp.choices[0]?.message?.content?.trim() ?? "Tidak ada data memori vendor yang tersedia.";
      const tokenCount = resp.usage?.total_tokens ?? null;

      const [latestSnap] = await db.select({ version: vendorMemorySnapshotsTable.version })
        .from(vendorMemorySnapshotsTable)
        .where(and(eq(vendorMemorySnapshotsTable.companyId, companyId), eq(vendorMemorySnapshotsTable.vendorId, id)))
        .orderBy(desc(vendorMemorySnapshotsTable.version)).limit(1);

      const newVersion = (latestSnap?.version ?? 0) + 1;

      await db.update(vendorMemorySnapshotsTable)
        .set({ isStale: true, staleReason: "Replaced by newer snapshot", freshnessScore: 0 })
        .where(and(eq(vendorMemorySnapshotsTable.companyId, companyId), eq(vendorMemorySnapshotsTable.vendorId, id), eq(vendorMemorySnapshotsTable.isStale, false)));

      const [snapshot] = await db.insert(vendorMemorySnapshotsTable).values({
        companyId,
        vendorId: id,
        version: newVersion,
        snapshotType: "full",
        generatedBy: "ai",
        model: "gpt-4o-mini",
        topServiceTypes: topModes.length > 0 ? topModes : (vendor["supported_modes"] as string[] | null) ?? [String(vendor["service_type"])],
        activeJobsCount: activeJobs,
        missingDocsList: missingDocs,
        riskTier: risk?.tier ?? "low",
        performanceGrade: grade,
        readinessScore,
        responseTimeTier,
        complianceStatus: docScore >= 0.9 ? "compliant" : docScore >= 0.7 ? "partial" : docScore >= 0.5 ? "incomplete" : "non_compliant",
        frequentServices: topModes,
        aiContextBlock,
        tokenCount,
        sourceFulfillmentCount: Number((jobStats.rows[0] as any)?.completed_jobs ?? 0),
        freshnessScore: 100,
        isStale: false,
        validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }).returning();

      await logVendorEvent(companyId, id, "snapshot_generated", req.user?.id ? String(req.user.id) : "ai", "ai", "vendor_memory_snapshot", snapshot!.id, { version: newVersion, tokenCount, readinessScore, grade });

      invalidateVendorMemoryCache(companyId, id);
      res.status(201).json(snapshot);
    } catch (err) {
      logger.error({ err }, "POST /vendors/:id/ai-context/refresh failed");
      res.status(500).json({ error: "Failed to generate AI context snapshot" });
    }
  }
);

// ── GET /api/vendors/:id/ai-context/history ──────────────────────────────────

router.get("/vendors/:id/ai-context/history", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const snapshots = await db.select({
      id: vendorMemorySnapshotsTable.id, version: vendorMemorySnapshotsTable.version,
      snapshotType: vendorMemorySnapshotsTable.snapshotType, generatedBy: vendorMemorySnapshotsTable.generatedBy,
      freshnessScore: vendorMemorySnapshotsTable.freshnessScore, isStale: vendorMemorySnapshotsTable.isStale,
      staleReason: vendorMemorySnapshotsTable.staleReason, tokenCount: vendorMemorySnapshotsTable.tokenCount,
      readinessScore: vendorMemorySnapshotsTable.readinessScore, performanceGrade: vendorMemorySnapshotsTable.performanceGrade,
      riskTier: vendorMemorySnapshotsTable.riskTier, createdAt: vendorMemorySnapshotsTable.createdAt,
    })
      .from(vendorMemorySnapshotsTable)
      .where(and(eq(vendorMemorySnapshotsTable.companyId, companyId), eq(vendorMemorySnapshotsTable.vendorId, id)))
      .orderBy(desc(vendorMemorySnapshotsTable.createdAt)).limit(20);

    res.json(snapshots);
  } catch (err) {
    logger.error({ err }, "GET /vendors/:id/ai-context/history failed");
    res.status(500).json({ error: "Failed to load AI context history" });
  }
});

// ── GET /api/vendors/:id/memory/events ───────────────────────────────────────

router.get("/vendors/:id/memory/events", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const events = await db.select().from(vendorMemoryEventsTable)
      .where(and(eq(vendorMemoryEventsTable.companyId, companyId), eq(vendorMemoryEventsTable.vendorId, id)))
      .orderBy(desc(vendorMemoryEventsTable.createdAt)).limit(100);

    res.json(events);
  } catch (err) {
    logger.error({ err }, "GET /vendors/:id/memory/events failed");
    res.status(500).json({ error: "Failed to load memory events" });
  }
});

// ── GET /api/vendors/recommend ────────────────────────────────────────────────

router.get("/vendors/recommend", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = cid(req);
    const serviceType = req.query.service_type as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 5), 20);

    const vendorRows = await db.execute(sql`
      SELECT s.id, s.name, s.service_type, s.supported_modes, s.eta_days_min, s.eta_days_max,
             s.has_internal_truck, s.contact_email, s.phone
      FROM suppliers s
      WHERE s.is_active = true
        ${serviceType ? sql`AND (s.service_type = ${serviceType} OR ${serviceType} = ANY(s.supported_modes))` : sql``}
      ORDER BY s.name LIMIT 50
    `);

    const vendors = vendorRows.rows as Record<string, unknown>[];
    const vendorIds = vendors.map((v) => Number(v["id"]));

    if (vendorIds.length === 0) { res.json([]); return; }

    const [snaps, risks] = await Promise.all([
      db.select({
        vendorId: vendorMemorySnapshotsTable.vendorId,
        readinessScore: vendorMemorySnapshotsTable.readinessScore,
        performanceGrade: vendorMemorySnapshotsTable.performanceGrade,
        riskTier: vendorMemorySnapshotsTable.riskTier,
        avgPrice: vendorMemorySnapshotsTable.avgPrice,
        responseTimeTier: vendorMemorySnapshotsTable.responseTimeTier,
        activeJobsCount: vendorMemorySnapshotsTable.activeJobsCount,
        topServiceTypes: vendorMemorySnapshotsTable.topServiceTypes,
        missingDocsList: vendorMemorySnapshotsTable.missingDocsList,
      })
        .from(vendorMemorySnapshotsTable)
        .where(and(eq(vendorMemorySnapshotsTable.companyId, companyId), eq(vendorMemorySnapshotsTable.isStale, false))),
      db.select({ vendorId: vendorRiskAssessmentsTable.vendorId, tier: vendorRiskAssessmentsTable.tier, riskScore: vendorRiskAssessmentsTable.riskScore })
        .from(vendorRiskAssessmentsTable)
        .where(and(eq(vendorRiskAssessmentsTable.companyId, companyId), eq(vendorRiskAssessmentsTable.isActive, true))),
    ]);

    const snapMap = new Map(snaps.map((s) => [s.vendorId, s]));
    const riskMap = new Map(risks.map((r) => [r.vendorId, r]));

    const ranked = vendors.map((v) => {
      const vid = Number(v["id"]);
      const snap = snapMap.get(vid);
      const risk = riskMap.get(vid);
      const readiness = snap?.readinessScore ?? 50;
      const riskTier  = risk?.tier ?? snap?.riskTier ?? "medium";
      const riskPenalty = riskTier === "blacklisted" ? 0 : riskTier === "high" ? 0.7 : riskTier === "medium" ? 0.9 : 1.0;
      const rankScore = readiness * riskPenalty;

      return {
        vendorId: vid,
        vendorName: v["name"],
        serviceType: v["service_type"],
        performanceGrade: snap?.performanceGrade ?? "?",
        readinessScore: readiness,
        riskTier,
        avgPrice: snap?.avgPrice,
        responseTimeTier: snap?.responseTimeTier ?? "unknown",
        activeJobsCount: snap?.activeJobsCount ?? 0,
        missingDocsList: snap?.missingDocsList ?? [],
        rankScore,
      };
    })
      .filter((v) => v.riskTier !== "blacklisted")
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, limit);

    res.json(ranked);
  } catch (err) {
    logger.error({ err }, "GET /vendors/recommend failed");
    res.status(500).json({ error: "Failed to get vendor recommendations" });
  }
});

export default router;
