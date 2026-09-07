/**
 * Sprint 5B — Vendor Memory Service
 *
 * loadVendorMemory()         — load latest non-stale AI context block (10-min cache)
 * invalidateVendorMemoryCache() — flush cache after snapshot refresh
 * computeReadinessScore()    — 0–100 score from KPI data
 * getVendorRecommendations() — rank vendors for a given service context
 */

import { eq, and, desc } from "drizzle-orm";
import { db, vendorMemorySnapshotsTable } from "@workspace/db";
import { logger } from "./logger";

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number }
const VENDOR_MEMORY_TTL_MS = 10 * 60 * 1_000; // 10 minutes

const vendorMemoryCache = new Map<string, CacheEntry<string | null>>();

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return !!entry && Date.now() < entry.expiresAt;
}

/**
 * Load the latest non-stale AI context block for a vendor.
 * Returns null if no valid snapshot exists or validUntil has passed.
 * Results cached for 10 min per companyId:vendorId.
 */
export async function loadVendorMemory(
  companyId: string,
  vendorId: number,
): Promise<string | null> {
  const key = `${companyId}:${vendorId}`;
  const cached = vendorMemoryCache.get(key);
  if (isFresh(cached)) return cached.data;

  try {
    const [snapshot] = await db
      .select({
        aiContextBlock: vendorMemorySnapshotsTable.aiContextBlock,
        isStale: vendorMemorySnapshotsTable.isStale,
        validUntil: vendorMemorySnapshotsTable.validUntil,
      })
      .from(vendorMemorySnapshotsTable)
      .where(
        and(
          eq(vendorMemorySnapshotsTable.companyId, companyId),
          eq(vendorMemorySnapshotsTable.vendorId, vendorId),
          eq(vendorMemorySnapshotsTable.isStale, false),
        ),
      )
      .orderBy(desc(vendorMemorySnapshotsTable.createdAt))
      .limit(1);

    const isExpired = snapshot?.validUntil
      ? new Date(snapshot.validUntil) < new Date()
      : false;

    const value =
      snapshot && !isExpired ? snapshot.aiContextBlock : null;

    vendorMemoryCache.set(key, { data: value, expiresAt: Date.now() + VENDOR_MEMORY_TTL_MS });
    return value;
  } catch (err) {
    logger.warn({ err }, "loadVendorMemory failed (non-fatal)");
    return null;
  }
}

/** Invalidate cached vendor memory (call after new snapshot is generated). */
export function invalidateVendorMemoryCache(
  companyId: string,
  vendorId: number,
): void {
  vendorMemoryCache.delete(`${companyId}:${vendorId}`);
}

// ─── Readiness Score ──────────────────────────────────────────────────────────

export interface VendorKpis {
  onTimeRate?: number | null;
  podCompletenessScore?: number | null;
  rfqSelected?: number | null;
  rfqSubmitted?: number | null;
  avgResponseHours?: number | null;
  etaAccuracyScore?: number | null;
  cancelRate?: number | null;
  documentScore?: number | null;       // 0.0–1.0
  riskTier?: string | null;
}

export function computeReadinessScore(kpis: VendorKpis): number {
  const onTimeRate      = kpis.onTimeRate ?? 0;
  const podScore        = kpis.podCompletenessScore ?? 0;
  const winRate         = kpis.rfqSubmitted && kpis.rfqSubmitted > 0
    ? (kpis.rfqSelected ?? 0) / kpis.rfqSubmitted
    : 0;
  const responseScore   = responseTimeScore(kpis.avgResponseHours ?? 48);
  const etaScore        = kpis.etaAccuracyScore ?? 0;
  const cancelScore     = 1 - (kpis.cancelRate ?? 0);
  const docScore        = kpis.documentScore ?? 0;

  const raw =
    onTimeRate      * 0.25 +
    podScore        * 0.15 +
    winRate         * 0.15 +
    responseScore   * 0.15 +
    etaScore        * 0.10 +
    cancelScore     * 0.10 +
    docScore        * 0.10;

  const multiplier = riskMultiplier(kpis.riskTier ?? "low");
  return Math.round(Math.min(100, Math.max(0, raw * 100 * multiplier)));
}

function responseTimeScore(avgHours: number): number {
  if (avgHours < 2)  return 1.0;
  if (avgHours < 6)  return 0.8;
  if (avgHours < 24) return 0.6;
  return 0.3;
}

function riskMultiplier(tier: string): number {
  switch (tier) {
    case "low":         return 1.0;
    case "medium":      return 0.9;
    case "high":        return 0.7;
    case "blacklisted": return 0.0;
    default:            return 1.0;
  }
}

export function readinessGrade(score: number): string {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

// ─── Required Documents ───────────────────────────────────────────────────────

const REQUIRED_DOCS_BY_SERVICE: Record<string, string[]> = {
  trucking:    ["npwp", "nib", "td_angkutan", "kir", "sio", "bpkb"],
  air_freight: ["npwp", "nib", "siup", "pkp", "sertifikat_k3"],
  sea_freight: ["npwp", "nib", "siup", "pkp", "sertifikat_k3"],
  customs:     ["npwp", "nib", "siup", "pkp", "nppbkc"],
  warehouse:   ["npwp", "nib", "siup"],
  default:     ["npwp", "nib"],
};

export interface DocRegistryItem {
  documentType: string;
  isCurrent: boolean;
  isVerified: boolean;
  expiryDate?: string | null;
}

export function computeMissingDocs(
  serviceType: string,
  registeredDocs: DocRegistryItem[],
): string[] {
  const required =
    REQUIRED_DOCS_BY_SERVICE[serviceType] ??
    REQUIRED_DOCS_BY_SERVICE["default"]!;

  const presentAndValid = new Set(
    registeredDocs
      .filter((d) => {
        if (!d.isCurrent) return false;
        if (d.expiryDate && new Date(d.expiryDate) < new Date()) return false;
        return true;
      })
      .map((d) => d.documentType),
  );

  return required.filter((r) => !presentAndValid.has(r));
}

export function computeDocumentScore(
  serviceType: string,
  registeredDocs: DocRegistryItem[],
): number {
  const required =
    REQUIRED_DOCS_BY_SERVICE[serviceType] ??
    REQUIRED_DOCS_BY_SERVICE["default"]!;

  if (required.length === 0) return 1.0;

  const presentDocs = registeredDocs.filter((d) => {
    if (!d.isCurrent) return false;
    if (d.expiryDate && new Date(d.expiryDate) < new Date()) return false;
    return true;
  });

  const presentCount  = presentDocs.filter((d) => required.includes(d.documentType)).length;
  const verifiedCount = presentDocs.filter((d) => required.includes(d.documentType) && d.isVerified).length;

  if (presentCount === 0) return 0;

  const presentRatio   = presentCount / required.length;
  const verifiedRatio  = verifiedCount / presentCount;

  return Math.min(1.0, presentRatio * (0.7 + 0.3 * verifiedRatio));
}

export function getRequiredDocs(serviceType: string): string[] {
  return REQUIRED_DOCS_BY_SERVICE[serviceType] ?? REQUIRED_DOCS_BY_SERVICE["default"]!;
}
