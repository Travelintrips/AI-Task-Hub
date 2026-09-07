/**
 * Sprint 10A-1.1 — Plate Number Canonicalization
 *
 * Normalizes vehicle plate numbers to a consistent canonical form
 * so that "B7777ZZZ", "B 7777 ZZZ", "b-7777-zzz", "B.7777.ZZZ"
 * all compare equal.
 *
 * Canonical form: UPPERCASE, no spaces, no dashes, no punctuation.
 * Examples:
 *   "B 7777 ZZZ"   → "B7777ZZZ"
 *   "b-7777-zzz"   → "B7777ZZZ"
 *   "B.7777.ZZZ"   → "B7777ZZZ"
 *   "B7777ZZZ"     → "B7777ZZZ"
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * Convert any plate format to canonical uppercase no-separator form.
 */
export function normalizePlate(raw: string): string {
  return raw.replace(/[\s\-\.]+/g, "").toUpperCase();
}

/**
 * Build a Drizzle SQL expression that compares a plate_number column
 * against a user-supplied plate string, ignoring spaces/dashes/case.
 *
 * Usage:
 *   .where(and(eq(fleetUnitsTable.companyId, cid), plateWhere(fleetUnitsTable.plateNumber, userInput)))
 */
export function plateWhere(col: unknown, plateInput: string): SQL {
  const norm = normalizePlate(plateInput);
  return sql`REPLACE(LOWER(${col as Parameters<typeof sql>[0]}), ' ', '') = ${norm.toLowerCase()}`;
}
