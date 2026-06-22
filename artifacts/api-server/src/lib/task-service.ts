import { eq, and, ne, gte, desc, or } from "drizzle-orm";
import {
  db,
  aiTasksTable,
  taskCommentsTable,
  whatsappMessagesTable,
  auditLogsTable,
  adminNotificationsTable,
  type AiTask,
} from "@workspace/db";
import { type WhatsAppIntentResult, IMPORT_REQUIRED_FIELDS } from "./whatsapp-ai";
import type { IntentResolution } from "./intent-engine";
import { logger } from "./logger";
import { emitSseEvent } from "./sse";
import { notifyTaskCreated } from "./notifications";

// ─── Status vocabulary ────────────────────────────────────────────────────────

export type AiTaskStatus =
  | "New Inquiry"
  | "Waiting Documents"
  | "Ready for Review"
  | "Assigned"
  | "In Progress"
  | "Waiting Customer"
  | "Completed";

const ACTIVE_STATUSES: AiTaskStatus[] = [
  "New Inquiry",
  "Waiting Documents",
  "Ready for Review",
  "Assigned",
  "In Progress",
  "Waiting Customer",
];
export { ACTIVE_STATUSES };

// ─── Missing data helpers ─────────────────────────────────────────────────────

/** Serialise a string array to a JSON text column value. */
function encodeMissingData(keys: string[]): string {
  return JSON.stringify(keys);
}

/** Parse the text column back to a string array (safe, never throws). */
function decodeMissingData(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

// ─── Title generation ─────────────────────────────────────────────────────────

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
        : result.commodity ? ` ${result.commodity}` : " Shipment";
      return `Complaint${subject}${suffix}`;
    }
    case "Freight": {
      const origin = result.origin ?? result.pickup_location;
      const dest = result.destination ?? result.delivery_location;
      const route = origin && dest ? ` ${origin} to ${dest}` : "";
      return `Freight${route}${suffix}`;
    }
    case "Warehouse":    return `Warehouse Request${suffix}`;
    case "Finance":      return `Finance Inquiry${suffix}`;
    case "Product Sales": {
      const commodity = result.commodity ? ` ${result.commodity}` : "";
      return `Product Sales${commodity}${suffix}`;
    }
    default:             return `General Inquiry${suffix}`;
  }
}

// ─── Status determination ─────────────────────────────────────────────────────

export function determineInitialStatus(result: WhatsAppIntentResult): AiTaskStatus {
  const hasMissingData = result.missing_data.length > 0;
  if (hasMissingData && result.needs_document_audit) return "Waiting Documents";
  if (result.needs_admin_review && !hasMissingData)  return "Ready for Review";
  return "New Inquiry";
}

// ─── AI summary builder ───────────────────────────────────────────────────────

export function buildAiSummary(result: WhatsAppIntentResult): string {
  const lines: string[] = [];
  if (result.commodity)         lines.push(`Komoditi: ${result.commodity}`);
  if (result.shipment_type)     lines.push(`Jenis Shipment: ${result.shipment_type}`);
  if (result.origin)            lines.push(`Asal: ${result.origin}`);
  if (result.destination)       lines.push(`Tujuan: ${result.destination}`);
  if (result.pickup_location)   lines.push(`Pickup: ${result.pickup_location}`);
  if (result.delivery_location) lines.push(`Delivery: ${result.delivery_location}`);
  if (result.requested_date)    lines.push(`Tanggal: ${result.requested_date}`);
  if (result.required_documents.length > 0)
    lines.push(`Dokumen diperlukan: ${result.required_documents.join(", ")}`);
  if (result.missing_data.length > 0)
    lines.push(`Data kurang: ${result.missing_data.join(", ")}`);
  const flags: string[] = [];
  if (result.needs_quotation)      flags.push("Butuh Quotation");
  if (result.needs_document_audit) flags.push("Butuh Audit Dokumen");
  if (result.needs_admin_review)   flags.push("Butuh Review Admin");
  if (flags.length > 0) lines.push(`Flag: ${flags.join(" | ")}`);
  return lines.join("\n");
}

// ─── Topic-change detection ───────────────────────────────────────────────────

/**
 * Determine whether the new AI result represents a clear topic change vs
 * a continuation of the existing task.
 *
 * Rules (in priority order):
 * 1. Complaint always starts a new task — complaints are standalone.
 * 2. If both categories are the same → continuation.
 * 3. If new category is "General Inquiry" → ambiguous; treat as continuation.
 * 4. Otherwise (clear different business category) → topic change.
 */
export function isTopicChange(existingCategory: string, newResult: WhatsAppIntentResult): boolean {
  const newCat = newResult.category;

  // Complaints always spin up a dedicated task
  if (newCat === "Complaint") return true;

  // Same category → definitely a continuation
  if (newCat === existingCategory) return false;

  // General Inquiry is too vague to force a new task; treat as continuation
  if (newCat === "General Inquiry") return false;

  // A real different category with medium+ priority → topic change
  if (newResult.priority === "Low") return false; // probably just a casual follow-up
  return true;
}

// ─── Find any active task for this customer ───────────────────────────────────

/**
 * Find the most recent active task for a customer (any category).
 * Used as the first lookup step — topic-change detection runs after.
 */
export async function findAnyActiveTaskForCustomer({
  companyId,
  customerPhone,
}: {
  companyId: string;
  customerPhone: string;
}): Promise<AiTask | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(aiTasksTable)
    .where(
      and(
        eq(aiTasksTable.companyId, companyId),
        eq(aiTasksTable.customerPhone, customerPhone),
        ne(aiTasksTable.status, "Completed"),
        gte(aiTasksTable.createdAt, thirtyDaysAgo),
      ),
    )
    .orderBy(desc(aiTasksTable.updatedAt))   // most recently active first
    .limit(1);

  return rows[0] ?? null;
}

// ─── Missing data resolution ──────────────────────────────────────────────────

/**
 * Determine how many of the task's outstanding missing-data fields have been
 * satisfied by the new message, and compute the updated remaining list.
 *
 * For Import tasks, the AI returns field *keys* (e.g. "hs_code") in missing_data.
 * For other categories it returns human-readable descriptions — we just check
 * whether missing_data shrank.
 *
 * Returns:
 *  - resolvedKeys: the keys/descriptions that were resolved
 *  - remainingKeys: what is still missing
 *  - allResolved: true when the task has no more missing data
 */
export function computeMissingDataResolution(
  existingMissingData: string[],
  newResult: WhatsAppIntentResult,
  category: string,
): {
  resolvedKeys: string[];
  remainingKeys: string[];
  allResolved: boolean;
} {
  if (existingMissingData.length === 0) {
    return { resolvedKeys: [], remainingKeys: [], allResolved: true };
  }

  if (category === "Import") {
    // The AI returns the fields still missing from the *new* message.
    // Fields that were missing before but are no longer in new missing_data are resolved.
    const newMissingSet = new Set(newResult.missing_data);
    const resolvedKeys = existingMissingData.filter((k) => !newMissingSet.has(k));
    const remainingKeys = existingMissingData.filter((k) =>  newMissingSet.has(k));
    return { resolvedKeys, remainingKeys, allResolved: remainingKeys.length === 0 };
  }

  // Non-import: if new message has zero missing_data entries, treat all as resolved
  if (newResult.missing_data.length === 0) {
    return { resolvedKeys: existingMissingData, remainingKeys: [], allResolved: true };
  }

  // Partial: keep existing list, just swap in the new (shorter) list if it shrank
  if (newResult.missing_data.length < existingMissingData.length) {
    const remaining = newResult.missing_data;
    const resolved = existingMissingData.filter((k) => !remaining.includes(k));
    return { resolvedKeys: resolved, remainingKeys: remaining, allResolved: remaining.length === 0 };
  }

  // Nothing changed
  return { resolvedKeys: [], remainingKeys: existingMissingData, allResolved: false };
}

/**
 * Build a human-readable summary of what the customer just provided and what's
 * still outstanding, for the task comment log.
 */
function buildResolutionNote(
  resolvedKeys: string[],
  remainingKeys: string[],
  category: string,
): string {
  const fieldLabel = (key: string) => {
    if (category === "Import") {
      return IMPORT_REQUIRED_FIELDS.find((f) => f.key === key)?.label ?? key;
    }
    return key;
  };

  const lines: string[] = ["[AI] Analisis pesan lanjutan:"];

  if (resolvedKeys.length > 0) {
    lines.push(`✅ Data diterima: ${resolvedKeys.map(fieldLabel).join(", ")}`);
  }
  if (remainingKeys.length > 0) {
    lines.push(`⏳ Masih diperlukan: ${remainingKeys.map(fieldLabel).join(", ")}`);
  } else {
    lines.push("✅ Semua data lengkap — siap untuk review admin.");
  }

  return lines.join("\n");
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
  /** Optional: richer knowledge-base resolution from IntentEngine (Sprint 2A+) */
  resolution?: IntentResolution;
}

export interface CreateTaskOutput {
  action: "created" | "appended" | "new_topic";
  taskId: number;
  taskNumber: string;
  status: AiTaskStatus;
  title: string;
  resolvedFields?: string[];
  remainingFields?: string[];
}

/**
 * Core conversation-continuity entry point.
 *
 * Flow:
 * 1. Look up any active task from this customer (last 30 days, not Completed).
 * 2. If none → create a brand-new task.
 * 3. If one exists:
 *    a. Check for a topic change (different category, not General Inquiry, Medium+ priority).
 *       → Topic change: create a new task (action = "new_topic").
 *    b. Same topic:
 *       - Append the message as a customer comment.
 *       - Compute which missing-data fields are now resolved.
 *       - Update missingData column and aiSummary on the task.
 *       - If all missing data resolved → escalate to "Ready for Review".
 *       - If customer replied while status was "Waiting Customer" → "In Progress".
 *
 * Sprint 2A: accepts optional `resolution` from IntentEngine for DB-driven
 * missing data, SLA, and document requirements.
 */
export async function createTaskFromWhatsAppMessage(
  input: CreateTaskInput,
): Promise<CreateTaskOutput | null> {
  const { savedMsgId, from, senderName, bodyText, attachmentUrl, companyId, result, resolution } = input;

  const customerName = result.customer_name ?? senderName ?? null;
  const customerPhone = result.customer_phone ?? from;

  try {
    // ── 1. Find any active task for this customer ──────────────────────────────
    const existingTask = await findAnyActiveTaskForCustomer({ companyId, customerPhone });

    if (existingTask) {
      const existingCategory = existingTask.category ?? "General Inquiry";
      const topicChanged = isTopicChange(existingCategory, result);

      if (topicChanged) {
        // ── 2a. New topic → create a separate task ───────────────────────────
        logger.info(
          {
            existingTaskId: existingTask.id,
            existingCategory,
            newCategory: result.category,
          },
          "Topic change detected — creating a new task",
        );
        return createNewTask({ customerName, customerPhone, companyId, bodyText, attachmentUrl, savedMsgId, result, resolution, action: "new_topic" });
      }

      // ── 2b. Same topic → append and resolve missing data ──────────────────
      const existingMissing = decodeMissingData(existingTask.missingData);
      const { resolvedKeys, remainingKeys, allResolved } = computeMissingDataResolution(
        existingMissing,
        result,
        existingCategory,
      );

      // Determine new status
      let newStatus = existingTask.status as AiTaskStatus;
      if (existingTask.status === "Waiting Customer") {
        newStatus = "In Progress";
      }
      if (allResolved && ["Waiting Documents", "New Inquiry", "In Progress"].includes(existingTask.status)) {
        newStatus = "Ready for Review";
      }

      // Build the resolution note for the comment thread
      const hasResolution = resolvedKeys.length > 0 || allResolved;
      const resolutionNote = hasResolution
        ? buildResolutionNote(resolvedKeys, remainingKeys, existingCategory)
        : null;

      // Persist everything in one logical batch
      await db.insert(taskCommentsTable).values({
        taskId: existingTask.id,
        senderType: "customer",
        senderName: customerName ?? from,
        comment: bodyText,
        attachmentUrl: attachmentUrl ?? null,
      });

      if (resolutionNote) {
        await db.insert(taskCommentsTable).values({
          taskId: existingTask.id,
          senderType: "ai",
          senderName: "AI Assistant",
          comment: resolutionNote,
        });
      }

      // Update task — missing data and status
      const taskUpdates: Record<string, unknown> = {
        missingData: encodeMissingData(remainingKeys),
      };
      if (newStatus !== existingTask.status) {
        taskUpdates.status = newStatus;
      }
      // Merge AI summary with any newly extracted fields
      if (hasResolution) {
        taskUpdates.aiSummary = buildUpdatedSummary(existingTask.aiSummary, result, remainingKeys);
      }

      await db
        .update(aiTasksTable)
        .set(taskUpdates)
        .where(eq(aiTasksTable.id, existingTask.id));

      // Link the WhatsApp message
      await db
        .update(whatsappMessagesTable)
        .set({ processed: true, aiProcessed: true, detectedIntent: result.intent, taskId: existingTask.id })
        .where(eq(whatsappMessagesTable.id, savedMsgId));

      await db.insert(auditLogsTable).values({
        action: "message_received",
        module: "messages",
        before: resolvedKeys.length > 0
          ? `Customer provided data: ${resolvedKeys.join(", ")} — task ${existingTask.taskNumber ?? existingTask.id} updated`
          : `Follow-up message from ${customerName ?? from} on task ${existingTask.taskNumber ?? existingTask.id}`,
        entityId: existingTask.id,
      });

      logger.info(
        {
          taskId: existingTask.id,
          action: "appended",
          resolvedCount: resolvedKeys.length,
          remainingCount: remainingKeys.length,
          statusChange: newStatus !== existingTask.status ? `${existingTask.status} → ${newStatus}` : "none",
        },
        "Message appended to existing task with missing-data resolution",
      );

      return {
        action: "appended",
        taskId: existingTask.id,
        taskNumber: existingTask.taskNumber ?? String(existingTask.id),
        status: newStatus,
        title: existingTask.title,
        resolvedFields: resolvedKeys,
        remainingFields: remainingKeys,
      };
    }

    // ── 3. No active task → create new ────────────────────────────────────────
    return createNewTask({ customerName, customerPhone, companyId, bodyText, attachmentUrl, savedMsgId, result, resolution, action: "created" });
  } catch (err) {
    logger.error({ err, from, companyId }, "createTaskFromWhatsAppMessage failed");
    return null;
  }
}

// ─── Internal: create a brand-new task record ─────────────────────────────────

async function createNewTask({
  customerName,
  customerPhone,
  companyId,
  bodyText,
  attachmentUrl,
  savedMsgId,
  result,
  resolution,
  action,
}: {
  customerName: string | null;
  customerPhone: string;
  companyId: string;
  bodyText: string;
  attachmentUrl?: string | null;
  savedMsgId: number;
  result: WhatsAppIntentResult;
  resolution?: IntentResolution;
  action: "created" | "new_topic";
}): Promise<CreateTaskOutput> {
  const taskNumber = `WA-${Date.now()}`;
  const title     = generateTaskTitle(result, customerName);
  const status    = determineInitialStatus(result);
  const aiSummary = buildAiSummary(result);

  // Sprint 2A: use KB-driven fields when IntentResolution is available
  const effectiveMissingData = resolution?.missingDataKeys ?? result.missing_data;
  const effectiveIntent      = resolution?.intentCode ?? result.intent;
  const slaHours             = resolution?.slaHours ?? null;
  const overdueAt            = slaHours ? new Date(Date.now() + slaHours * 3_600_000) : null;

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
      category:    result.category,
      division:    result.division,
      priority:    result.priority.toLowerCase(),
      status,
      assignedRole:       result.suggested_team,
      aiSummary,
      aiIntent:           effectiveIntent,
      missingData:        encodeMissingData(effectiveMissingData),
      aiConfidenceScore:  result.confidence_score ?? null,
      customerSentiment:  result.customer_sentiment ?? null,
      ...(slaHours !== null && { slaHours }),
      ...(overdueAt !== null && { overdueAt }),
    })
    .returning();

  // First customer message as comment
  await db.insert(taskCommentsTable).values({
    taskId: task.id,
    senderType: "customer",
    senderName: customerName ?? customerPhone,
    comment: bodyText,
    attachmentUrl: attachmentUrl ?? null,
  });

  // AI suggested reply as a comment
  if (result.suggested_reply) {
    await db.insert(taskCommentsTable).values({
      taskId: task.id,
      senderType: "ai",
      senderName: "AI Assistant",
      comment: result.suggested_reply,
    });
  }

  // Link WhatsApp message
  await db
    .update(whatsappMessagesTable)
    .set({ processed: true, aiProcessed: true, detectedIntent: result.intent, taskId: task.id })
    .where(eq(whatsappMessagesTable.id, savedMsgId));

  await db.insert(auditLogsTable).values({
    action: "task_created",
    module: "tasks",
    before: `Task ${taskNumber} created (${action}) — ${result.category} / ${result.priority} (${status}) — ${title}`,
    entityId: task.id,
  });

  // ── Write in-app notification + push SSE ────────────────────────────────────
  const notifType = result.priority.toLowerCase() === "high" ? "high_priority_task" : "new_inquiry";
  const [notif] = await db.insert(adminNotificationsTable).values({
    companyId,
    type: notifType,
    title: result.priority.toLowerCase() === "high"
      ? `🔴 Task prioritas tinggi: ${title}`
      : `💬 Task baru dari WhatsApp: ${title}`,
    body: `${result.category} · ${result.division} · Status: ${status}${customerName ? ` · ${customerName}` : ""}`,
    taskId: task.id,
    customerPhone: customerPhone ?? null,
    customerName: customerName ?? customerPhone ?? "Unknown",
  }).returning();

  emitSseEvent(
    "new_task",
    {
      taskId:    task.id,
      taskNumber,
      title,
      category:  result.category,
      priority:  result.priority,
      status,
      customerName:  customerName ?? null,
      customerPhone: customerPhone ?? null,
      notifId:   notif.id,
      notifType,
    },
    companyId,
  );

  logger.info(
    { taskId: task.id, taskNumber, title, status, category: result.category, action },
    "New AI task created",
  );

  // ── WhatsApp notification (fire-and-forget) ──────────────────────────────────
  notifyTaskCreated({
    taskId:       task.id,
    taskNumber,
    title,
    customerName:  customerName,
    customerPhone: customerPhone,
    status,
    priority:     result.priority.toLowerCase(),
    companyId,
  }).catch((err) => logger.error({ err }, "notifyTaskCreated gagal"));

  return {
    action,
    taskId: task.id,
    taskNumber,
    status,
    title,
    resolvedFields: [],
    remainingFields: effectiveMissingData,
  };
}

// ─── Summary merge helper ─────────────────────────────────────────────────────

/**
 * Merge new AI-extracted data into the existing aiSummary, replacing the
 * "Data kurang" line with the updated remaining list.
 */
function buildUpdatedSummary(
  existingSummary: string | null,
  newResult: WhatsAppIntentResult,
  remainingKeys: string[],
): string {
  const base = existingSummary ?? "";

  // Update the "Data kurang" line
  const updated = base.replace(/Data kurang: .*/g, "").trim();
  const newLines: string[] = [updated];

  // Inject any newly extracted fields that aren't already in the summary
  if (newResult.commodity && !base.includes("Komoditi:"))
    newLines.push(`Komoditi: ${newResult.commodity}`);
  if (newResult.origin && !base.includes("Asal:"))
    newLines.push(`Asal: ${newResult.origin}`);
  if (newResult.destination && !base.includes("Tujuan:"))
    newLines.push(`Tujuan: ${newResult.destination}`);

  if (remainingKeys.length > 0) {
    newLines.push(`Data kurang: ${remainingKeys.join(", ")}`);
  } else {
    newLines.push("Data kurang: — (lengkap)");
  }

  return newLines.filter(Boolean).join("\n");
}
