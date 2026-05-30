import { db, aiTasksTable } from "@workspace/db";
import { eq, and, isNull, lte, ne } from "drizzle-orm";
import { logger } from "./logger";

export const SLA_HOURS_BY_CATEGORY: Record<string, number> = {
  Import: 72,
  "Import FCL": 72,
  "Import LCL": 48,
  Export: 48,
  Trucking: 24,
  "Customs Clearance": 48,
  Customs: 48,
  default: 48,
};

export function getSlaHours(category: string | null | undefined): number {
  if (!category) return SLA_HOURS_BY_CATEGORY.default;
  return SLA_HOURS_BY_CATEGORY[category] ?? SLA_HOURS_BY_CATEGORY.default;
}

export function calcOverdueAt(createdAt: Date, slaHours: number): Date {
  const d = new Date(createdAt);
  d.setHours(d.getHours() + slaHours);
  return d;
}

export function calcSlaStatus(overdueAt: Date | null | undefined, completedAt: Date | null | undefined): string {
  if (completedAt) return "completed";
  if (!overdueAt) return "on_track";
  const now = new Date();
  const diffMs = overdueAt.getTime() - now.getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffMs < 0) return "overdue";
  if (diffH <= 6) return "due_soon";
  return "on_track";
}

export async function refreshSlaStatuses(companyId = "default"): Promise<void> {
  try {
    const tasks = await db
      .select({ id: aiTasksTable.id, overdueAt: aiTasksTable.overdueAt, completedAt: aiTasksTable.completedAt, slaStatus: aiTasksTable.slaStatus })
      .from(aiTasksTable)
      .where(and(eq(aiTasksTable.companyId, companyId), ne(aiTasksTable.status, "completed"), ne(aiTasksTable.status, "cancelled")));

    for (const t of tasks) {
      const newStatus = calcSlaStatus(t.overdueAt, t.completedAt);
      if (newStatus !== t.slaStatus) {
        await db.update(aiTasksTable).set({ slaStatus: newStatus }).where(eq(aiTasksTable.id, t.id));
      }
    }
  } catch (err) {
    logger.error({ err }, "refreshSlaStatuses failed");
  }
}
