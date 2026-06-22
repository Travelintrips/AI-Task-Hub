import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

// customers.company_id in the legacy DB is an integer FK — we query by whatsapp only
// and use raw SQL inserts to avoid Drizzle type-checking on the integer column.

type CustomerRow = {
  id: number;
  companyId: string | null;
  companyName: string;
  picName: string | null;
  picPhone: string | null;
  whatsapp: string | null;
  email: string | null;
  npwp: string | null;
  address: string | null;
  notes: string | null;
  industry: string | null;
  tier: string | null;
  paymentTerms: string | null;
  totalTasks: number;
  totalDocuments: number;
  aiSummary: string | null;
  lastTaskAt: Date | null;
  riskScore: number | null;
  riskTier: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Look up (or create) the customer record for a given phone number.
 * Queries by whatsapp only — company_id in the legacy DB is an integer FK
 * that cannot accept text values like "default".
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
}): Promise<CustomerRow | null> {
  try {
    const rows = await db.execute<CustomerRow>(
      sql`SELECT * FROM customers WHERE whatsapp = ${phone} LIMIT 1`
    );
    const existing = rows.rows[0] ?? null;

    if (existing) {
      if (name && !existing.picName) {
        await db.execute(
          sql`UPDATE customers SET pic_name = ${name} WHERE id = ${existing.id}`
        );
      }
      return existing;
    }

    const inserted = await db.execute<CustomerRow>(
      sql`INSERT INTO customers (name, company_name, pic_name, whatsapp, total_tasks, total_documents, created_at, updated_at)
          VALUES (${name ?? phone}, ${name ?? phone}, ${name ?? null}, ${phone}, 0, 0, now(), now())
          RETURNING *`
    );
    return inserted.rows[0] ?? null;
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
}): Promise<void> {
  try {
    const rows = await db.execute<CustomerRow>(
      sql`SELECT * FROM customers WHERE whatsapp = ${phone} LIMIT 1`
    );
    const existing = rows.rows[0] ?? null;

    if (!existing) {
      await db.execute(
        sql`INSERT INTO customers (name, company_name, pic_name, whatsapp, total_tasks, total_documents, last_task_at, created_at, updated_at)
            VALUES (${name ?? phone}, ${name ?? phone}, ${name ?? null}, ${phone}, 1, 0, now(), now(), now())`
      );
      return;
    }

    const picUpdate = name && !existing.picName ? sql`, pic_name = ${name}` : sql``;
    await db.execute(
      sql`UPDATE customers
          SET total_tasks = total_tasks + 1,
              last_task_at = now(),
              updated_at = now()
              ${picUpdate}
          WHERE id = ${existing.id}`
    );
  } catch (err) {
    logger.error({ err, phone, taskId }, "Failed to update customer context after task");
  }
}
