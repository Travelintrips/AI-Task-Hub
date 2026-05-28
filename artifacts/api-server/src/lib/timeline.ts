import { db, taskTimelineTable } from "@workspace/db";
import { logger } from "./logger";

export type TimelineEventType =
  | "whatsapp_received"
  | "ai_intent_detected"
  | "task_created"
  | "document_uploaded"
  | "ocr_completed"
  | "audit_completed"
  | "missing_data_requested"
  | "customer_submitted_data"
  | "task_assigned"
  | "progress_updated"
  | "whatsapp_sent"
  | "admin_approved"
  | "task_completed"
  | "status_changed"
  | "quotation_submitted"
  | "trucking_info_added"
  | "token_created";

export type ActorType = "system" | "admin" | "team" | "customer" | "ai" | "vendor";

interface LogTimelineOptions {
  taskId: number;
  eventType: TimelineEventType;
  title: string;
  description?: string;
  actor?: string;
  actorType?: ActorType;
  metadata?: Record<string, unknown>;
}

export async function logTimeline(opts: LogTimelineOptions): Promise<void> {
  try {
    await db.insert(taskTimelineTable).values({
      taskId: opts.taskId,
      eventType: opts.eventType,
      title: opts.title,
      description: opts.description ?? null,
      actor: opts.actor ?? null,
      actorType: opts.actorType ?? "system",
      metadata: opts.metadata ?? null,
    });
  } catch (err) {
    logger.error({ err, taskId: opts.taskId }, "Failed to log timeline event");
  }
}
