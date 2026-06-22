/**
 * Sprint 10A-1 — WhatsApp Role Resolver
 *
 * Resolves the role of an incoming WhatsApp sender by looking up their phone
 * number across team_members, fleet_drivers, and customers tables.
 *
 * Priority (highest first):
 *   super_admin > owner > company_admin > supervisor > staff > driver > customer > unknown
 */

import { eq, or, ilike } from "drizzle-orm";
import { db, teamMembersTable, fleetDriversTable, customersTable } from "@workspace/db";
import { logger } from "./logger";

export type WaRole =
  | "super_admin"
  | "owner"
  | "company_admin"
  | "supervisor"
  | "staff"
  | "driver"
  | "customer"
  | "unknown";

export interface ResolvedUser {
  role: WaRole;
  name: string | null;
  entityId: number | null;
  companyId: string;
}

const ROLE_PRIORITY: Record<string, number> = {
  super_admin: 8,
  owner: 7,
  company_admin: 6,
  supervisor: 5,
  staff: 4,
  driver: 3,
  customer: 2,
  unknown: 0,
};

/** Normalize phone: strip non-digits, ensure starts with 62 */
function normPhone(raw: string): string {
  let n = raw.replace(/\D/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  if (n.startsWith("8") && n.length >= 9) n = "62" + n;
  return n;
}

/** Build multiple phone variants to match against stored data */
function phoneVariants(phone: string): string[] {
  const n = normPhone(phone);
  const variants = [n];
  if (n.startsWith("62")) {
    variants.push("0" + n.slice(2));  // 081xxx
    variants.push(n.slice(2));         // 81xxx
    variants.push("+" + n);            // +62xxx
  }
  return [...new Set(variants)];
}

export async function resolveWaRole(
  phone: string,
  companyId = "default",
): Promise<ResolvedUser> {
  const variants = phoneVariants(phone);
  const norm = normPhone(phone);

  try {
    // 1. Check team_members (staff/admin/supervisor roles)
    const staffRows = await db
      .select({
        id: teamMembersTable.id,
        name: teamMembersTable.name,
        role: teamMembersTable.role,
        companyId: teamMembersTable.companyId,
        phone: teamMembersTable.phone,
      })
      .from(teamMembersTable)
      .where(eq(teamMembersTable.companyId, companyId))
      .limit(50);

    for (const row of staffRows) {
      if (!row.phone) continue;
      const rowVariants = phoneVariants(row.phone);
      const matched = variants.some((v) => rowVariants.includes(v));
      if (matched) {
        const role = (row.role as WaRole) ?? "staff";
        return {
          role: ROLE_PRIORITY[role] !== undefined ? role : "staff",
          name: row.name,
          entityId: row.id,
          companyId: row.companyId ?? companyId,
        };
      }
    }

    // 2. Check fleet_drivers
    const driverRows = await db
      .select({
        id: fleetDriversTable.id,
        fullName: fleetDriversTable.fullName,
        phone: fleetDriversTable.phone,
        companyId: fleetDriversTable.companyId,
      })
      .from(fleetDriversTable)
      .where(eq(fleetDriversTable.companyId, companyId))
      .limit(200);

    for (const row of driverRows) {
      if (!row.phone) continue;
      const rowVariants = phoneVariants(row.phone);
      const matched = variants.some((v) => rowVariants.includes(v));
      if (matched) {
        return {
          role: "driver",
          name: row.fullName,
          entityId: row.id,
          companyId: row.companyId ?? companyId,
        };
      }
    }

    // 3. Check customers
    const custRows = await db
      .select({
        id: customersTable.id,
        companyName: customersTable.companyName,
        picName: customersTable.picName,
        whatsapp: customersTable.whatsapp,
        companyId: customersTable.companyId,
      })
      .from(customersTable)
      .where(eq(customersTable.companyId, companyId))
      .limit(500);

    for (const row of custRows) {
      const waPhone = row.whatsapp ?? "";
      if (!waPhone) continue;
      const rowVariants = phoneVariants(waPhone);
      const matched = variants.some((v) => rowVariants.includes(v));
      if (matched) {
        return {
          role: "customer",
          name: row.picName ?? row.companyName ?? null,
          entityId: row.id,
          companyId: row.companyId ?? companyId,
        };
      }
    }

    return { role: "unknown", name: null, entityId: null, companyId };
  } catch (err) {
    logger.error({ err, phone }, "wa-role-resolver: DB error");
    return { role: "unknown", name: null, entityId: null, companyId };
  }
}

/** Check if a role has at least supervisor-level access */
export function isSupervisorOrAbove(role: WaRole): boolean {
  return ROLE_PRIORITY[role] >= ROLE_PRIORITY["supervisor"];
}

/** Check if a role is admin or above */
export function isAdminOrAbove(role: WaRole): boolean {
  return ROLE_PRIORITY[role] >= ROLE_PRIORITY["company_admin"];
}
