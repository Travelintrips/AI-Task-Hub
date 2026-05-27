import { eq, and, ne, gte, desc } from "drizzle-orm";
import {
  db,
  aiTasksTable,
  taskCommentsTable,
  whatsappMessagesTable,
  activityTable,
  type AiTask,
} from "@workspace/db";
import { type WhatsAppIntentResult } from "./whatsapp-ai";
import { logger } from "./logger";

// ─── Status vocabulary ────────────────────────────────────────────────────────

export type AiTaskStatus =
  | "New Inquiry"
  | "Waiting Documents"
  | "Ready for Review"
  | "Assigned"
  | "In Progress"
  | "Waiting Customer"
  | "Completed";

/** Active statuses — a task in any of these can receive new messages. */
const ACTIVE_STATUSES: AiTaskStatus[] = [
  "New Inquiry",
  "Waiting Documents",
  "Ready for Review",
  "Assigned",
  "In Progress",
  "Waiting Customer",
];

// ─── Title generation ─────────────────────────────────────────────────────────

/**
 * Generate a human-readable task title from the AI intent result.
 *
 * Patterns:
 *   Import Mesin CNC dari China  - Budi Santoso
 *   Trucking Jakarta to Surabaya - CV Maju Jaya
 *   Complaint Shipment Delay     - Ahmad
 *   Export Batubara to Singapore - PT Energi
 *   Customs Clearance Inquiry    - (unknown)
 */
export function generateTaskTitle(
  result: WhatsAppIntentResult,
  customerName: string | null,
): string {
  const name = customerName?.trim() || null;
  const suffix = name ? ` - ${name}` : "";
  const cat = result.category;

  switch (cat) {
    case "Import": {
      const commodity = result.commodity ? ` ${result.commodity}` : "";
      const origin = result.origin ? ` dari ${result.origin}` : " dari Luar Negeri";
      return `Import${commodity}${origin}${suffix}`;
    }

    case "Export": {
      const commodity = result.commodity ? ` ${result.commodity}` : "";
      const dest = result.destination ? ` to ${result.destination}` : "";
      return `Export${commodity}${dest}${suffix}`;
    }

    case "Trucking": {
      const pickup = result.pickup_location ?? result.origin ?? "Origin";
      const delivery = result.delivery_location ?? result.destination ?? "Destination";
      return `Trucking ${pickup} to ${delivery}${suffix}`;
    }

    case "Customs": {
      const commodity = result.commodity ? ` ${result.commodity}` : "";
      return `Customs Clearance${commodity}${suffix}`;
    }

    case "Complaint": {
      const subject = result.shipment_type
        ? ` ${result.shipment_type}`
        : result.commodity
        ? ` ${result.commodity}`
        : " Shipment";
      return `Complaint${subject}${suffix}`;
    }

    case "Freight": {
      const origin = result.origin ?? result.pickup_location;
      const dest = result.destination ?? result.delivery_location;
      const route = origin && dest ? ` ${origin} to ${dest}` : "";
      return `Freight${route}${suffix}`;
    }

    case "Warehouse": {
      return `Warehouse Request${suffix}`;
    }

    case "Finance": {
      return `Finance Inquiry${suffix}`;
    }

    case "Product Sales": {
      const commodity = result.commodity ? ` ${result.commodity}` : "";
      return `Product Sales${commodity}${suffix}`;
    }

    default: {
      return `General Inquiry${suffix}`;
    }
  }
}

// ─── Status determination ─────────────────────────────────────────────────────

/**
 * Determine the initial task status from the AI result.
 *
 * Rules:
 * - missing_data present AND needs_document_audit → "Waiting Documents"
 * - needs_admin_review AND no missing_data        → "Ready for Review"
 * - everything else                               → "New Inquiry"
 */
export function determineInitialStatus(result: WhatsAppIntentResult): AiTaskStatus {
  const hasMissingData = result.missing_data.length > 0;

  if (hasMissingData && result.needs_document_audit) {
    return "Waiting Documents";
  }
  if (result.needs_admin_review && !hasMissingData) {
    return "Ready for Review";
  }
  return "New Inquiry";
}

// ─── AI summary builder ───────────────────────────────────────────────────────

/**
 * Build a structured AI summary string combining extracted entities +
 * the AI's suggested reply context.
 */
export function buildAiSummary(result: WhatsAppIntentResult): string {
  const lines: string[] = [];

  if (result.commodity)        lines.push(`Komoditi: ${result.commodity}`);
  if (result.shipment_type)    lines.push(`Jenis Shipment: ${result.shipment_type}`);
  if (result.origin)           lines.push(`Asal: ${result.origin}`);
  if (result.destination)      lines.push(`Tujuan: ${result.destination}`);
  if (result.pickup_location)  lines.push(`Pickup: ${result.pickup_location}`);
  if (result.delivery_location)lines.push(`Delivery: ${result.delivery_location}`);
  if (result.requested_date)   lines.push(`Tanggal: ${result.requested_date}`);

  if (result.required_documents.length > 0) {
    lines.push(`Dokumen diperlukan: ${result.required_documents.join(", ")}`);
  }
  if (result.missing_data.length > 0) {
    lines.push(`Data kurang: ${result.missing_data.join(", ")}`);
  }

  const flags: string[] = [];
  if (result.needs_quotation)      flags.push("Butuh Quotation");
  if (result.needs_document_audit) flags.push("Butuh Audit Dokumen");
  if (result.needs_admin_review)   flags.push("Butuh Review Admin");
  if (flags.length > 0) lines.push(`Flag: ${flags.join(" | ")}`);

  return lines.join("\n");
}

// ─── Duplicate guard ──────────────────────────────────────────────────────────

/**
 * Find an existing active task for the same customer + category + company.
 * Only looks at tasks created within the last 30 days to avoid linking
 * conversations that are truly unrelated.
 */
export async function findActiveTaskForCustomer({
  companyId,
  customerPhone,
  category,
}: {
  companyId: string;
  customerPhone: string;
  category: string;
}): Promise<AiTask | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(aiTasksTable)
    .where(
      and(
        eq(aiTasksTable.companyId, companyId),
        eq(aiTasksTable.customerPhone, customerPhone),
        eq(aiTasksTable.category, category),
        ne(aiTasksTable.status, "Completed"),
        gte(aiTasksTable.createdAt, thirtyDaysAgo),
      ),
    )
    .orderBy(desc(aiTasksTable.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

// ─── Main function ────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  savedMsgId: number;
  from: string;
  senderName: string | undefined;
  bodyText: string;
  attachmentUrl?: string | null;
  companyId: string;
  result: WhatsAppIntentResult;
}

export interface CreateTaskOutput {
  action: "created" | "appended";
  taskId: number;
  taskNumber: string;
  status: AiTaskStatus;
  title: string;
}

/**
 * Create a new ai_task from a WhatsApp message, or append the message to an
 * existing active task if the same customer is continuing the same conversation.
 *
 * Never throws — errors are logged and the function returns null on failure.
 */
export async function createTaskFromWhatsAppMessage(
  input: CreateTaskInput,
): Promise<CreateTaskOutput | null> {
  const { savedMsgId, from, senderName, bodyText, attachmentUrl, companyId, result } = input;

  const customerName = result.customer_name ?? senderName ?? null;
  const customerPhone = result.customer_phone ?? from;

  try {
    // ── 1. Duplicate guard ────────────────────────────────────────────────────
    const existingTask = await findActiveTaskForCustomer({
      companyId,
      customerPhone,
      category: result.category,
    });

    if (existingTask) {
      // Append the new message as a comment on the existing task
      await db.insert(taskCommentsTable).values({
        taskId: existingTask.id,
        senderType: "customer",
        senderName: customerName ?? from,
        comment: bodyText,
        attachmentUrl: attachmentUrl ?? null,
      });

      // Link the WhatsApp message to the existing task
      await db
        .update(whatsappMessagesTable)
        .set({
          processed: true,
          aiProcessed: true,
          detectedIntent: result.intent,
          taskId: existingTask.id,
        })
        .where(eq(whatsappMessagesTable.id, savedMsgId));

      // If new message has missing data resolved, consider bumping status
      const newStatus = maybeEscalateStatus(existingTask.status as AiTaskStatus, result);
      if (newStatus !== existingTask.status) {
        await db
          .update(aiTasksTable)
          .set({ status: newStatus })
          .where(eq(aiTasksTable.id, existingTask.id));
      }

      await db.insert(activityTable).values({
        type: "message_received",
        description: `New message from ${customerName ?? from} appended to task ${existingTask.taskNumber ?? existingTask.id}`,
        entityId: existingTask.id,
      });

      logger.info(
        { taskId: existingTask.id, taskNumber: existingTask.taskNumber, action: "appended" },
        "Message appended to existing active task",
      );

      return {
        action: "appended",
        taskId: existingTask.id,
        taskNumber: existingTask.taskNumber ?? String(existingTask.id),
        status: (existingTask.status as AiTaskStatus) ?? "New Inquiry",
        title: existingTask.title,
      };
    }

    // ── 2. Create new task ────────────────────────────────────────────────────
    const taskNumber = `WA-${Date.now()}`;
    const title = generateTaskTitle(result, customerName);
    const status = determineInitialStatus(result);
    const aiSummary = buildAiSummary(result);

    const [task] = await db
      .insert(aiTasksTable)
      .values({
        companyId,
        taskNumber,
        source: "whatsapp",
        customerName,
        customerPhone,
        title,
        description: bodyText,
        category: result.category,
        division: result.division,
        priority: result.priority.toLowerCase(),
        status,
        assignedRole: result.suggested_team,
        aiSummary,
        aiIntent: result.intent,
      })
      .returning();

    // ── 3. Add the original message as the first comment ──────────────────────
    await db.insert(taskCommentsTable).values({
      taskId: task.id,
      senderType: "customer",
      senderName: customerName ?? from,
      comment: bodyText,
      attachmentUrl: attachmentUrl ?? null,
    });

    // ── 4. Add AI suggested reply as a system comment ─────────────────────────
    if (result.suggested_reply) {
      await db.insert(taskCommentsTable).values({
        taskId: task.id,
        senderType: "ai",
        senderName: "AI Assistant",
        comment: result.suggested_reply,
        attachmentUrl: null,
      });
    }

    // ── 5. Link WhatsApp message to the new task ──────────────────────────────
    await db
      .update(whatsappMessagesTable)
      .set({
        processed: true,
        aiProcessed: true,
        detectedIntent: result.intent,
        taskId: task.id,
      })
      .where(eq(whatsappMessagesTable.id, savedMsgId));

    // ── 6. Log activity ───────────────────────────────────────────────────────
    await db.insert(activityTable).values({
      type: "task_created",
      description: `Task ${taskNumber} created — ${result.category} / ${result.priority} (${status}) — ${title}`,
      entityId: task.id,
    });

    logger.info(
      {
        taskId: task.id,
        taskNumber,
        title,
        status,
        category: result.category,
        priority: result.priority,
        needs_quotation: result.needs_quotation,
        needs_admin_review: result.needs_admin_review,
        action: "created",
      },
      "New AI task created from WhatsApp message",
    );

    return { action: "created", taskId: task.id, taskNumber, status, title };
  } catch (err) {
    logger.error({ err, from, companyId }, "createTaskFromWhatsAppMessage failed");
    return null;
  }
}

// ─── Status escalation helper ─────────────────────────────────────────────────

/**
 * When a customer sends a follow-up message, check whether the task status
 * should be escalated based on the new message's AI result.
 *
 * Rules:
 * - "Waiting Documents" + new message has no missing_data → "Ready for Review"
 * - "Waiting Customer"  + new customer reply              → "In Progress"
 * - All other cases: keep existing status
 */
function maybeEscalateStatus(
  current: AiTaskStatus,
  result: WhatsAppIntentResult,
): AiTaskStatus {
  if (current === "Waiting Documents" && result.missing_data.length === 0) {
    return "Ready for Review";
  }
  if (current === "Waiting Customer") {
    return "In Progress";
  }
  return current;
}

// Re-export status list for use in routes/other services
export { ACTIVE_STATUSES };
