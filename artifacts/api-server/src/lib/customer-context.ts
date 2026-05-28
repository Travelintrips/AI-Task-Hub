import { eq, and, sql } from "drizzle-orm";
import { db, customerContextsTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Look up (or create) the customer context for a given phone number.
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
      .from(customerContextsTable)
      .where(and(eq(customerContextsTable.phone, phone), eq(customerContextsTable.companyId, companyId)))
      .limit(1);

    if (existing) {
      // Update name if we learned it, and refresh lastSeenAt
      const updates: Partial<typeof customerContextsTable.$inferInsert> = {
        lastSeenAt: new Date(),
      };
      if (name && !existing.name) updates.name = name;
      await db
        .update(customerContextsTable)
        .set(updates)
        .where(eq(customerContextsTable.id, existing.id));
      return existing;
    }

    const [created] = await db
      .insert(customerContextsTable)
      .values({
        phone,
        companyId,
        name: name ?? null,
        totalTasks: 0,
        lastSeenAt: new Date(),
      })
      .returning();
    return created;
  } catch (err) {
    logger.error({ err, phone }, "Failed to get/create customer context");
    return null;
  }
}

/**
 * After a task is created or updated for this customer, update their context.
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
      .from(customerContextsTable)
      .where(and(eq(customerContextsTable.phone, phone), eq(customerContextsTable.companyId, companyId)))
      .limit(1);

    if (!existing) {
      await db.insert(customerContextsTable).values({
        phone,
        companyId,
        name: name ?? null,
        totalTasks: 1,
        lastActiveTaskId: taskId,
        lastSeenAt: new Date(),
        previousIntents: intent ? JSON.stringify([intent]) : null,
      });
      return;
    }

    // Merge intents
    let intents: string[] = [];
    try { intents = JSON.parse(existing.previousIntents ?? "[]"); } catch { intents = []; }
    if (intent && !intents.includes(intent)) {
      intents = [intent, ...intents].slice(0, 10);
    }

    await db
      .update(customerContextsTable)
      .set({
        totalTasks: sql`${customerContextsTable.totalTasks} + 1`,
        lastActiveTaskId: taskId,
        lastSeenAt: new Date(),
        previousIntents: JSON.stringify(intents),
        ...(name && !existing.name ? { name } : {}),
      })
      .where(eq(customerContextsTable.id, existing.id));
  } catch (err) {
    logger.error({ err, phone, taskId }, "Failed to update customer context after task");
  }
}
