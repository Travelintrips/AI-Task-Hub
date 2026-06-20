import { eq, and, sql } from "drizzle-orm";
import { db, customersTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Look up (or create) the customer record for a given phone number.
 * Uses customersTable (whatsapp field) as the primary lookup key.
 * Never throws.
 */
export async function getOrCreateCustomerContext({
  phone,
  companyId = "default",
  name,
}: {
  phone: string;
  companyId?: string;
  name?: string | null;
}) {
  try {
    const [existing] = await db
      .select()
      .from(customersTable)
      .where(and(eq(customersTable.whatsapp, phone), eq(customersTable.companyId, companyId)))
      .limit(1);

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (name && !existing.picName) updates.picName = name;
      if (Object.keys(updates).length > 0) {
        await db
          .update(customersTable)
          .set(updates)
          .where(eq(customersTable.id, existing.id));
      }
      return existing;
    }

    const [created] = await db
      .insert(customersTable)
      .values({
        companyId,
        companyName: name ?? phone,
        picName: name ?? null,
        whatsapp: phone,
        totalTasks: 0,
      })
      .returning();
    return created;
  } catch (err) {
    logger.error({ err, phone }, "Failed to get/create customer context");
    return null;
  }
}

/**
 * After a task is created or updated for this customer, update their record.
 */
export async function updateCustomerContextAfterTask({
  phone,
  companyId = "default",
  taskId,
  intent,
  name,
}: {
  phone: string;
  companyId?: string;
  taskId: number;
  intent?: string | null;
  name?: string | null;
}) {
  try {
    const [existing] = await db
      .select()
      .from(customersTable)
      .where(and(eq(customersTable.whatsapp, phone), eq(customersTable.companyId, companyId)))
      .limit(1);

    if (!existing) {
      await db.insert(customersTable).values({
        companyId,
        companyName: name ?? phone,
        picName: name ?? null,
        whatsapp: phone,
        totalTasks: 1,
        lastTaskAt: new Date(),
      });
      return;
    }

    await db
      .update(customersTable)
      .set({
        totalTasks: sql`${customersTable.totalTasks} + 1`,
        lastTaskAt: new Date(),
        ...(name && !existing.picName ? { picName: name } : {}),
      })
      .where(eq(customersTable.id, existing.id));
  } catch (err) {
    logger.error({ err, phone, taskId }, "Failed to update customer context after task");
  }
}
