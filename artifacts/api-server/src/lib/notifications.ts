import { db, whatsappNotificationsTable } from "@workspace/db";
import { sendFonnte } from "./fonnte";
import { logger } from "./logger";

interface TaskNotifContext {
  taskId: number;
  taskNumber: string;
  title: string;
  customerName?: string | null;
  customerPhone?: string | null;
  assignedTo?: string | null;
  status: string;
  priority: string;
  companyId: string;
}

// ─── Template pesan ───────────────────────────────────────────────────────────

function templateTaskCreated(ctx: TaskNotifContext): string {
  const lines = [
    `✅ *Task Baru Dibuat*`,
    ``,
    `📋 No: *${ctx.taskNumber}*`,
    `📝 Judul: ${ctx.title}`,
  ];
  if (ctx.customerName) lines.push(`👤 Customer: ${ctx.customerName}`);
  lines.push(`🚦 Status: ${ctx.status}`);
  lines.push(`⚡ Prioritas: ${priorityLabel(ctx.priority)}`);
  lines.push(``);
  lines.push(`_AI Task Center_`);
  return lines.join("\n");
}

function templateStatusChanged(ctx: TaskNotifContext, oldStatus: string): string {
  const lines = [
    `🔄 *Status Task Diperbarui*`,
    ``,
    `📋 No: *${ctx.taskNumber}*`,
    `📝 ${ctx.title}`,
    ``,
    `${statusEmoji(oldStatus)} ${oldStatus}  →  ${statusEmoji(ctx.status)} *${ctx.status}*`,
  ];
  if (ctx.assignedTo) lines.push(`👷 Petugas: ${ctx.assignedTo}`);
  lines.push(``);
  lines.push(`_AI Task Center_`);
  return lines.join("\n");
}

function templateAssigned(ctx: TaskNotifContext): string {
  return [
    `📌 *Task Ditugaskan*`,
    ``,
    `📋 No: *${ctx.taskNumber}*`,
    `📝 ${ctx.title}`,
    `👷 Petugas: *${ctx.assignedTo}*`,
    `🚦 Status: ${ctx.status}`,
    ``,
    `_AI Task Center_`,
  ].join("\n");
}

// ─── Helper ────────────────────────────────────────────────────────────────────

function priorityLabel(p: string): string {
  const map: Record<string, string> = { urgent: "🔴 Urgent", high: "🟠 Tinggi", medium: "🟡 Sedang", low: "🟢 Rendah" };
  return map[p] ?? p;
}

function statusEmoji(s: string): string {
  const map: Record<string, string> = {
    "New Inquiry": "🆕", "Waiting Documents": "📄", "Ready for Review": "🔍",
    "Assigned": "📌", "In Progress": "⚙️", "Waiting Customer": "⏳", "Completed": "✅",
  };
  return map[s] ?? "📋";
}

// ─── Fungsi utama kirim notifikasi ────────────────────────────────────────────

async function sendAndLog(opts: {
  phone: string;
  message: string;
  taskId: number;
  companyId: string;
  recipientType: "customer" | "staff";
  templateName: string;
}): Promise<void> {
  const result = await sendFonnte(opts.phone, opts.message);

  await db.insert(whatsappNotificationsTable).values({
    taskId: opts.taskId,
    companyId: opts.companyId,
    recipientPhone: opts.phone,
    recipientType: opts.recipientType,
    templateName: opts.templateName,
    messageText: opts.message,
    status: result.success ? "sent" : "failed",
    externalMessageId: result.messageId,
    errorMessage: result.error,
    sentAt: result.success ? new Date() : null,
  }).catch((err) => logger.error({ err }, "Gagal menyimpan log notifikasi WA"));
}

// ─── Notifikasi task dibuat ───────────────────────────────────────────────────

export async function notifyTaskCreated(ctx: TaskNotifContext): Promise<void> {
  const message = templateTaskCreated(ctx);

  if (ctx.customerPhone) {
    await sendAndLog({
      phone: ctx.customerPhone,
      message,
      taskId: ctx.taskId,
      companyId: ctx.companyId,
      recipientType: "customer",
      templateName: "task_created_customer",
    });
  } else {
    logger.info({ taskId: ctx.taskId }, "Tidak ada nomor customer — notifikasi task_created dilewati");
  }
}

// ─── Notifikasi status berubah ────────────────────────────────────────────────

export async function notifyStatusChanged(ctx: TaskNotifContext, oldStatus: string): Promise<void> {
  if (oldStatus === ctx.status) return;

  const message = templateStatusChanged(ctx, oldStatus);

  if (ctx.customerPhone) {
    await sendAndLog({
      phone: ctx.customerPhone,
      message,
      taskId: ctx.taskId,
      companyId: ctx.companyId,
      recipientType: "customer",
      templateName: "status_changed_customer",
    });
  }
}

// ─── Notifikasi task di-assign ────────────────────────────────────────────────

export async function notifyTaskAssigned(ctx: TaskNotifContext, staffPhone: string | null): Promise<void> {
  if (!ctx.assignedTo) return;

  const message = templateAssigned(ctx);

  if (staffPhone) {
    await sendAndLog({
      phone: staffPhone,
      message,
      taskId: ctx.taskId,
      companyId: ctx.companyId,
      recipientType: "staff",
      templateName: "task_assigned_staff",
    });
  }

  if (ctx.customerPhone) {
    await sendAndLog({
      phone: ctx.customerPhone,
      message,
      taskId: ctx.taskId,
      companyId: ctx.companyId,
      recipientType: "customer",
      templateName: "task_assigned_customer",
    });
  }
}
