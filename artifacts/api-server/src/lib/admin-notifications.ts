import { db, adminNotificationsTable } from "@workspace/db";
import { logger } from "./logger";

export type NotificationType =
  | "new_inquiry"
  | "high_priority_task"
  | "document_uploaded"
  | "audit_missing_data"
  | "missing_data_resolved"
  | "team_progress_update"
  | "vendor_quotation"
  | "waiting_review";

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  taskId?: number | null;
  customerPhone?: string | null;
  customerName?: string | null;
  companyId?: string;
}

/**
 * Create an admin in-app notification. Never throws — errors are logged only.
 */
export async function createAdminNotification(input: CreateNotificationInput): Promise<void> {
  try {
    await db.insert(adminNotificationsTable).values({
      companyId: input.companyId ?? "default",
      type: input.type,
      title: input.title,
      body: input.body,
      taskId: input.taskId ?? null,
      customerPhone: input.customerPhone ?? null,
      // customer_name is NOT NULL in DB — fallback to phone or "Unknown"
      customerName: input.customerName ?? input.customerPhone ?? "Unknown",
      isRead: false,
    });
    logger.info({ type: input.type, taskId: input.taskId }, "Admin notification created");
  } catch (err) {
    logger.error({ err, type: input.type }, "Failed to create admin notification");
  }
}
