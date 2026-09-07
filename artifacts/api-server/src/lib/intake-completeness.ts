/**
 * intake-completeness.ts — Sprint 9A Phase 4
 *
 * Calculates completion percentage and per-intent readiness thresholds.
 *
 * Thresholds:
 *   complaint     → 60%   (fast-track — any basic detail is enough)
 *   import        → 90%   (strict — regulatory & commercial data required)
 *   fleet_repair  → 80%   (operational urgency)
 *   cash_advance  → 100%  (financial approval — all fields mandatory)
 *   default       → 80%
 */

export interface CompletenessResult {
  completionPct: number;
  totalRequired: number;
  totalCollected: number;
  missingFieldNames: string[];
  isReady: boolean;
  threshold: number;
}

const INTENT_THRESHOLDS: Record<string, number> = {
  complaint:        60,
  keluhan:          60,
  cash_advance:     100,
  kasbon:           100,
  fleet_repair:     80,
  fleet_maintenance: 80,
  import:           90,
  customs_import:   90,
  export:           85,
  trucking:         80,
  freight:          80,
  warehouse:        75,
  general_inquiry:  60,
  // Sport Center
  booking_lapangan:        67,
  daftar_membership:       80,
  perpanjang_membership:   80,
  konfirmasi_pembayaran_sport: 100,
  // Tenant
  daftar_tenant:           80,
  info_sewa_tenant:        60,
};

export function getCompletionThreshold(intentCode: string): number {
  const lower = intentCode.toLowerCase().replace(/[-\s]/g, "_");
  if (INTENT_THRESHOLDS[lower] !== undefined) return INTENT_THRESHOLDS[lower]!;

  for (const [key, val] of Object.entries(INTENT_THRESHOLDS)) {
    if (lower.includes(key)) return val;
  }

  return 80;
}

export function calculateCompleteness(
  requiredFields: string[],
  collectedFields: Record<string, unknown>,
  intentCode: string,
): CompletenessResult {
  const totalRequired = requiredFields.length;

  if (totalRequired === 0) {
    return {
      completionPct: 100,
      totalRequired: 0,
      totalCollected: 0,
      missingFieldNames: [],
      isReady: true,
      threshold: getCompletionThreshold(intentCode),
    };
  }

  // "phone" is always known from the WA sender — never report it as missing.
  const missingFieldNames = requiredFields.filter(
    (fname) => {
      if (fname === "phone") return false;
      const val = collectedFields[fname];
      return val === null || val === undefined || val === "";
    },
  );

  const totalCollected = totalRequired - missingFieldNames.length;
  const completionPct = Math.round((totalCollected / totalRequired) * 100);
  const threshold = getCompletionThreshold(intentCode);
  const isReady = completionPct >= threshold;

  return {
    completionPct,
    totalRequired,
    totalCollected,
    missingFieldNames,
    isReady,
    threshold,
  };
}

export function readinessLabel(pct: number): "not_ready" | "collecting" | "eligible" {
  if (pct < 50) return "not_ready";
  if (pct < 80) return "collecting";
  return "eligible";
}
