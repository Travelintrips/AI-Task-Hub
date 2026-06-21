import {
  db, aiTasksTable, escalationRulesTable, escalationLogsTable,
  taskCommentsTable, auditLogsTable, teamMembersTable,
  approvalRequestsTable,
} from "@workspace/db";
import { eq, and, gte, inArray } from "drizzle-orm";
import { sendFonnte } from "./fonnte";
import { logger } from "./logger";

// Active task statuses that could trigger escalation
const ACTIVE_STATUSES = [
  "new_inquiry", "waiting_documents", "documents_received",
  "audit_in_progress", "missing_data", "ready_for_review",
  "assigned", "in_progress", "waiting_customer", "waiting_vendor",
];

function buildEscalationMessage(
  template: string | null,
  task: { taskNumber: string | null; title: string; customerName: string | null; priority: string },
): string {
  const base = template ?? "⚠️ Task *{taskNumber}* telah melampaui batas waktu eskalasi. Mohon segera ditangani.";
  return base
    .replace("{taskNumber}", task.taskNumber ?? task.title)
    .replace("{title}", task.title)
    .replace("{customerName}", task.customerName ?? "—")
    .replace("{priority}", task.priority);
}

async function runEscalations(): Promise<void> {
  const now = new Date();

  // Load all active escalation rules
  const rules = await db
    .select()
    .from(escalationRulesTable)
    .where(eq(escalationRulesTable.isActive, true));

  if (rules.length === 0) return;

  // Load active tasks
  const tasks = await db
    .select()
    .from(aiTasksTable)
    .where(inArray(aiTasksTable.status, ACTIVE_STATUSES))
    .limit(500);

  for (const task of tasks) {
    const taskAgeHours = (now.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60);

    for (const rule of rules) {
      // Match rule to task using specificity cascade
      if (rule.intentCode && rule.intentCode !== task.aiIntent) continue;
      if (rule.category && rule.category !== task.category) continue;
      if (rule.priority && rule.priority !== task.priority) continue;
      if (rule.companyId !== task.companyId) continue;

      // Check if trigger threshold has been reached
      if (taskAgeHours < rule.triggerHours) continue;

      // Dedupe: don't fire the same rule for the same task within 24 hours
      const recentLog = await db
        .select({ id: escalationLogsTable.id })
        .from(escalationLogsTable)
        .where(
          and(
            eq(escalationLogsTable.taskId, task.id),
            eq(escalationLogsTable.ruleId, rule.id),
            gte(escalationLogsTable.firedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
          ),
        )
        .limit(1);

      if (recentLog.length > 0) continue;

      // Resolve who to notify
      const message = buildEscalationMessage(rule.messageTemplate, task);

      let notifyPhone: string | null = null;
      if (rule.notifyChannel === "whatsapp") {
        const [member] = await db
          .select()
          .from(teamMembersTable)
          .where(eq(teamMembersTable.role, rule.escalateTo as Parameters<typeof eq>[1]))
          .limit(1);
        notifyPhone = member?.phone ?? null;
      }

      let isSuccess = true;
      let errorMessage: string | null = null;

      if (notifyPhone && rule.notifyChannel === "whatsapp") {
        const result = await sendFonnte(notifyPhone, message);
        isSuccess = result.success;
        errorMessage = result.error ?? null;
      }

      await db.insert(escalationLogsTable).values({
        companyId: task.companyId,
        taskId: task.id,
        ruleId: rule.id,
        escalatedTo: rule.escalateTo,
        channel: rule.notifyChannel,
        message,
        isSuccess,
        errorMessage,
      });

      await db.insert(taskCommentsTable).values({
        taskId: task.id,
        senderName: "AI System",
        comment: `🚨 Eskalasi otomatis: diteruskan ke ${rule.escalateTo} setelah ${rule.triggerHours} jam${isSuccess ? " ✅" : " ❌ gagal kirim notifikasi"}`,
        senderType: "system",
      });

      await db.insert(auditLogsTable).values({
        action: "task_escalated",
        module: "governance",
        before: `Task ${task.taskNumber ?? task.id} dieskalasi ke ${rule.escalateTo} (rule #${rule.id})`,
        entityId: task.id,
      }).catch(() => {});

      logger.info({ taskId: task.id, ruleId: rule.id, escalateTo: rule.escalateTo, isSuccess }, "Escalation fired");
    }
  }
}

// ─── Approval timeout scanner ─────────────────────────────────────────────────

async function runApprovalTimeouts(): Promise<void> {
  const now = new Date();

  const pending = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.status, "pending"))
    .limit(200);

  for (const req of pending) {
    const ruleTimeoutHours = 24;
    const ageHours = (now.getTime() - req.requestedAt.getTime()) / (1000 * 60 * 60);
    if (ageHours < ruleTimeoutHours) continue;

    await db
      .update(approvalRequestsTable)
      .set({ status: "timeout", decidedAt: now, updatedAt: now })
      .where(eq(approvalRequestsTable.id, req.id));

    logger.info({ approvalRequestId: req.id, taskId: req.taskId }, "Approval request timed out");
  }
}

let escalationSchedulerRunning = false;

export function startEscalationScheduler(): void {
  if (escalationSchedulerRunning) return;
  escalationSchedulerRunning = true;

  // Escalation check every 30 minutes
  setInterval(async () => {
    try {
      await runEscalations();
    } catch (err) {
      logger.error({ err }, "Escalation scheduler error");
    }
  }, 30 * 60 * 1000);

  // Approval timeout check every hour
  setInterval(async () => {
    try {
      await runApprovalTimeouts();
    } catch (err) {
      logger.error({ err }, "Approval timeout scanner error");
    }
  }, 60 * 60 * 1000);

  logger.info("Escalation scheduler started (interval: 30m escalations, 1h approval timeouts)");
}
