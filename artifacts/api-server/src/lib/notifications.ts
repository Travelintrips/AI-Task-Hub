import { db, whatsappNotificationsTable } from "@workspace/db";
import { sendFonnte } from "./fonnte";
import { logger } from "./logger";

export interface TaskNotifContext {
  taskId: number;
  taskNumber: string;
  title: string;
  customerName?: string | null;
  customerPhone?: string | null;
  assignedTo?: string | null;
  status: string;
  priority: string;
  companyId: string;
  /** AI-generated reply — if present, sent as the main message to customer */
  suggestedReply?: string | null;
  /** Nomor device Fonnte yang menerima pesan asli — pastikan balasan keluar lewat device yang sama */
  fonnteDevice?: string | null;
  /**
   * Divisi/kategori task — digunakan untuk category-based routing notifikasi.
   * Jika di-set, notifikasi dikirim hanya ke staff/group yang relevan.
   * Contoh: "Logistik", "Customs", "Sport Center", "Finance"
   */
  division?: string | null;
  category?: string | null;
}

// ─── Staff phones dari env ─────────────────────────────────────────────────────

function getStaffPhones(): string[] {
  // STAFF_NOTIFY_PHONES = nomor pribadi admin/staff yang menerima notifikasi WA baru
  // WHATSAPP_PHONE_NUMBER_ID = nomor device Fonnte (pengirim), BUKAN target notifikasi
  // Selalu set STAFF_NOTIFY_PHONES di env untuk menghindari notifikasi ke device sendiri
  const raw =
    process.env.STAFF_NOTIFY_PHONES ??
    process.env.WHATSAPP_PHONE_NUMBER_ID ??
    "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

// ─── WA Group targets dari env ─────────────────────────────────────────────────
// STAFF_NOTIFY_GROUPS = daftar group JID Fonnte (@g.us), pisahkan dengan koma
// Contoh: 120363427607305800@g.us,120363500000000000@g.us

function getGroupTargets(): string[] {
  const raw = process.env.STAFF_NOTIFY_GROUPS ?? "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((g) => g.trim())
    .filter((g) => /^\d+@g\.us$/.test(g));
}

// ─── Category-based routing ────────────────────────────────────────────────────
// Mapping divisi/kategori ke env var key suffix.
// Env vars format:
//   STAFF_NOTIFY_PHONES_LOGISTIK      → nomor tim logistik (trucking/freight/import/export)
//   STAFF_NOTIFY_PHONES_CUSTOMS       → nomor tim customs/PPJK/finance
//   STAFF_NOTIFY_PHONES_SPORT_CENTER  → nomor admin sport center
//   STAFF_NOTIFY_GROUPS_LOGISTIK      → group WA tim logistik
//   STAFF_NOTIFY_GROUPS_CUSTOMS       → group WA tim customs
//   STAFF_NOTIFY_GROUPS_SPORT_CENTER  → group WA admin sport center
//
// Jika env var divisi tidak di-set → fallback ke STAFF_NOTIFY_PHONES/GROUPS (broadcast ke semua).

function getDivisionEnvKey(division?: string | null, category?: string | null): string | null {
  const raw = (division ?? category ?? "").toLowerCase();
  if (!raw) return null;
  if (raw.includes("logistik") || raw.includes("trucking") || raw.includes("freight")
      || raw.includes("import") || raw.includes("export") || raw.includes("warehouse")) {
    return "LOGISTIK";
  }
  if (raw.includes("custom") || raw.includes("ppjk") || raw.includes("finance")
      || raw.includes("bea cukai") || raw.includes("customs")) {
    return "CUSTOMS";
  }
  if (raw.includes("sport") || raw.includes("olahraga") || raw.includes("lapangan")
      || raw.includes("sport center")) {
    return "SPORT_CENTER";
  }
  return null;
}

/**
 * Kembalikan nomor staff untuk divisi tertentu.
 * Jika env STAFF_NOTIFY_PHONES_{KEY} tidak di-set → fallback ke semua staff.
 */
function getStaffPhonesByDivision(division?: string | null, category?: string | null): string[] {
  const key = getDivisionEnvKey(division, category);
  if (key) {
    const divRaw = process.env[`STAFF_NOTIFY_PHONES_${key}`] ?? "";
    if (divRaw.trim()) {
      return divRaw.split(",").map((p) => p.trim()).filter(Boolean);
    }
  }
  return getStaffPhones(); // fallback: broadcast ke semua staff
}

/**
 * Kembalikan group WA untuk divisi tertentu.
 * Jika env STAFF_NOTIFY_GROUPS_{KEY} tidak di-set → fallback ke semua group.
 */
function getGroupTargetsByDivision(division?: string | null, category?: string | null): string[] {
  const key = getDivisionEnvKey(division, category);
  if (key) {
    const divRaw = process.env[`STAFF_NOTIFY_GROUPS_${key}`] ?? "";
    if (divRaw.trim()) {
      return divRaw.split(",").map((g) => g.trim()).filter((g) => /^\d+@g\.us$/.test(g));
    }
  }
  return getGroupTargets(); // fallback: broadcast ke semua group
}

// ─── Template pesan ────────────────────────────────────────────────────────────

function templateTaskCreated(ctx: TaskNotifContext): string {
  // If AI generated a contextual reply (e.g. "Kasbon berapa?"), use it as the
  // main body so the customer gets a relevant answer, not a robotic template.
  if (ctx.suggestedReply?.trim()) {
    return [
      ctx.suggestedReply.trim(),
      ``,
      `📋 No. Tiket: *${ctx.taskNumber}* _(simpan untuk referensi)_`,
      `_AI Task Center_`,
    ].join("\n");
  }
  // Fallback to structured template when no AI reply available
  const lines = [
    `✅ *Permintaan Anda Sudah Kami Terima*`,
    ``,
    `📋 No: *${ctx.taskNumber}*`,
    `📝 ${ctx.title}`,
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

function templateStaffNewTask(ctx: TaskNotifContext): string {
  const lines = [
    `🆕 *[STAFF] Task Baru Masuk*`,
    ``,
    `📋 No: *${ctx.taskNumber}*`,
    `📝 ${ctx.title}`,
  ];
  if (ctx.customerName) lines.push(`👤 Customer: ${ctx.customerName}`);
  if (ctx.customerPhone) lines.push(`📱 HP: ${ctx.customerPhone}`);
  lines.push(`⚡ Prioritas: ${priorityLabel(ctx.priority)}`);
  lines.push(`🚦 Status: ${ctx.status}`);
  lines.push(``);
  lines.push(`_AI Task Center_`);
  return lines.join("\n");
}

function templateStaffStatusChanged(ctx: TaskNotifContext, oldStatus: string): string {
  return [
    `🔔 *[STAFF] Status Task Berubah*`,
    ``,
    `📋 No: *${ctx.taskNumber}*`,
    `📝 ${ctx.title}`,
    ``,
    `${statusEmoji(oldStatus)} ${oldStatus}  →  ${statusEmoji(ctx.status)} *${ctx.status}*`,
    ``,
    `_AI Task Center_`,
  ].join("\n");
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function priorityLabel(p: string): string {
  const map: Record<string, string> = {
    urgent: "🔴 Urgent",
    high:   "🟠 Tinggi",
    medium: "🟡 Sedang",
    low:    "🟢 Rendah",
  };
  return map[p] ?? p;
}

export function statusEmoji(s: string): string {
  const map: Record<string, string> = {
    "new_inquiry":        "🆕",
    "New Inquiry":        "🆕",
    "waiting_documents":  "📄",
    "Waiting Documents":  "📄",
    "ready_for_review":   "🔍",
    "Ready for Review":   "🔍",
    "assigned":           "📌",
    "Assigned":           "📌",
    "in_progress":        "⚙️",
    "In Progress":        "⚙️",
    "waiting_customer":   "⏳",
    "Waiting Customer":   "⏳",
    "completed":          "✅",
    "Completed":          "✅",
    "pending":            "🕐",
    "cancelled":          "❌",
  };
  return map[s] ?? "📋";
}

// ─── Core send + log ───────────────────────────────────────────────────────────

async function sendAndLog(opts: {
  phone: string;
  message: string;
  taskId: number;
  companyId: string;
  recipientType: "customer" | "staff";
  templateName: string;
  fonnteDevice?: string | null;
}): Promise<void> {
  const result = await sendFonnte(opts.phone, opts.message, opts.fonnteDevice);

  await db
    .insert(whatsappNotificationsTable)
    .values({
      taskId:            opts.taskId,
      companyId:         opts.companyId,
      recipientPhone:    opts.phone,
      recipientType:     opts.recipientType,
      templateName:      opts.templateName,
      messageText:       opts.message,
      status:            result.success ? "sent" : "failed",
      externalMessageId: result.messageId,
      errorMessage:      result.error,
      sentAt:            result.success ? new Date() : null,
    })
    .catch((err) => logger.error({ err }, "Gagal menyimpan log notifikasi WA"));
}

// ─── Notifikasi task dibuat (ke customer + staff) ──────────────────────────────

export async function notifyTaskCreated(ctx: TaskNotifContext): Promise<void> {
  const customerMsg = templateTaskCreated(ctx);
  const staffMsg    = templateStaffNewTask(ctx);

  const sends: Promise<void>[] = [];

  if (ctx.customerPhone) {
    sends.push(
      sendAndLog({
        phone:        ctx.customerPhone,
        message:      customerMsg,
        taskId:       ctx.taskId,
        companyId:    ctx.companyId,
        recipientType: "customer",
        templateName: "task_created_customer",
        fonnteDevice: ctx.fonnteDevice,
      }),
    );
  }

  // ── Category-based routing: kirim ke staff/group divisi yang relevan ──────────
  // Jika env STAFF_NOTIFY_PHONES_{DIVISI} di-set → hanya kirim ke tim tersebut.
  // Jika tidak di-set → fallback ke semua staff (broadcast seperti sebelumnya).
  const staffPhones = getStaffPhonesByDivision(ctx.division, ctx.category);
  for (const phone of staffPhones) {
    sends.push(
      sendAndLog({
        phone,
        message:      staffMsg,
        taskId:       ctx.taskId,
        companyId:    ctx.companyId,
        recipientType: "staff",
        templateName: "task_created_staff",
      }),
    );
  }

  // Kirim ke WA group — juga dengan category-based routing
  const groupTargets = getGroupTargetsByDivision(ctx.division, ctx.category);
  for (const group of groupTargets) {
    sends.push(
      sendAndLog({
        phone:        group,
        message:      staffMsg,
        taskId:       ctx.taskId,
        companyId:    ctx.companyId,
        recipientType: "staff",
        templateName: "task_created_group",
      }),
    );
  }

  await Promise.allSettled(sends);
}

// ─── Template selesai (completed) ─────────────────────────────────────────────

function templateTaskCompleted(ctx: TaskNotifContext & { adminNotes?: string | null; quotationAmount?: string | null; driverName?: string | null; plateNumber?: string | null }): string {
  const lines = [
    `✅ *Pekerjaan Selesai!*`,
    ``,
    `📋 No: *${ctx.taskNumber}*`,
    `📝 ${ctx.title}`,
  ];
  if (ctx.customerName) lines.push(`👤 Customer: ${ctx.customerName}`);
  if (ctx.assignedTo) lines.push(`👷 Dikerjakan oleh: ${ctx.assignedTo}`);
  if (ctx.adminNotes) lines.push(``, `📎 Catatan: ${ctx.adminNotes}`);
  if (ctx.quotationAmount) lines.push(`💰 Biaya: Rp ${Number(ctx.quotationAmount).toLocaleString("id-ID")}`);
  if (ctx.driverName)     lines.push(`🚗 Driver: ${ctx.driverName}`);
  if (ctx.plateNumber)    lines.push(`🔢 Plat: ${ctx.plateNumber}`);
  lines.push(``, `Terima kasih telah mempercayakan pekerjaan kepada kami. 🙏`);
  lines.push(`_AI Task Center_`);
  return lines.join("\n");
}

function templateStaffTaskCompleted(ctx: TaskNotifContext): string {
  return [
    `🏁 *[STAFF] Task Selesai*`,
    ``,
    `📋 No: *${ctx.taskNumber}*`,
    `📝 ${ctx.title}`,
    ...(ctx.customerName ? [`👤 Customer: ${ctx.customerName}`] : []),
    ...(ctx.assignedTo   ? [`👷 Petugas: ${ctx.assignedTo}`]   : []),
    ``,
    `_AI Task Center_`,
  ].join("\n");
}

// ─── Notifikasi task selesai (ke customer + staff) ────────────────────────────

export async function notifyTaskCompleted(
  ctx: TaskNotifContext & {
    adminNotes?: string | null;
    quotationAmount?: string | null;
    driverName?: string | null;
    plateNumber?: string | null;
  },
): Promise<void> {
  const customerMsg = templateTaskCompleted(ctx);
  const staffMsg    = templateStaffTaskCompleted(ctx);

  const sends: Promise<void>[] = [];

  if (ctx.customerPhone) {
    sends.push(
      sendAndLog({
        phone:         ctx.customerPhone,
        message:       customerMsg,
        taskId:        ctx.taskId,
        companyId:     ctx.companyId,
        recipientType: "customer",
        templateName:  "task_completed_customer",
      }),
    );
  }

  for (const phone of getStaffPhones()) {
    sends.push(
      sendAndLog({
        phone,
        message:       staffMsg,
        taskId:        ctx.taskId,
        companyId:     ctx.companyId,
        recipientType: "staff",
        templateName:  "task_completed_staff",
      }),
    );
  }

  // Kirim ke WA group
  for (const group of getGroupTargets()) {
    sends.push(
      sendAndLog({
        phone:        group,
        message:      staffMsg,
        taskId:       ctx.taskId,
        companyId:    ctx.companyId,
        recipientType: "staff",
        templateName: "task_completed_group",
      }),
    );
  }

  await Promise.allSettled(sends);
}

// ─── Notifikasi status berubah (ke customer + staff) ──────────────────────────

export async function notifyStatusChanged(ctx: TaskNotifContext, oldStatus: string): Promise<void> {
  if (oldStatus === ctx.status) return;

  const customerMsg = templateStatusChanged(ctx, oldStatus);
  const staffMsg    = templateStaffStatusChanged(ctx, oldStatus);

  const sends: Promise<void>[] = [];

  if (ctx.customerPhone) {
    sends.push(
      sendAndLog({
        phone:        ctx.customerPhone,
        message:      customerMsg,
        taskId:       ctx.taskId,
        companyId:    ctx.companyId,
        recipientType: "customer",
        templateName: "status_changed_customer",
      }),
    );
  }

  for (const phone of getStaffPhones()) {
    sends.push(
      sendAndLog({
        phone,
        message:      staffMsg,
        taskId:       ctx.taskId,
        companyId:    ctx.companyId,
        recipientType: "staff",
        templateName: "status_changed_staff",
      }),
    );
  }

  // Kirim ke WA group
  for (const group of getGroupTargets()) {
    sends.push(
      sendAndLog({
        phone:        group,
        message:      staffMsg,
        taskId:       ctx.taskId,
        companyId:    ctx.companyId,
        recipientType: "staff",
        templateName: "status_changed_group",
      }),
    );
  }

  await Promise.allSettled(sends);
}

// ─── Notifikasi task di-assign (ke staff + customer) ──────────────────────────

export async function notifyTaskAssigned(
  ctx: TaskNotifContext,
  staffPhone: string | null,
): Promise<void> {
  if (!ctx.assignedTo) return;

  const message = templateAssigned(ctx);
  const sends: Promise<void>[] = [];

  if (staffPhone) {
    sends.push(
      sendAndLog({
        phone:        staffPhone,
        message,
        taskId:       ctx.taskId,
        companyId:    ctx.companyId,
        recipientType: "staff",
        templateName: "task_assigned_staff",
      }),
    );
  }

  if (ctx.customerPhone) {
    sends.push(
      sendAndLog({
        phone:        ctx.customerPhone,
        message,
        taskId:       ctx.taskId,
        companyId:    ctx.companyId,
        recipientType: "customer",
        templateName: "task_assigned_customer",
      }),
    );
  }

  // Kirim ke WA group
  for (const group of getGroupTargets()) {
    sends.push(
      sendAndLog({
        phone:        group,
        message,
        taskId:       ctx.taskId,
        companyId:    ctx.companyId,
        recipientType: "staff",
        templateName: "task_assigned_group",
      }),
    );
  }

  await Promise.allSettled(sends);
}

// ─── Kirim manual (dari admin UI) ─────────────────────────────────────────────

export async function sendManualNotification(opts: {
  phone: string;
  message: string;
  taskId?: number | null;
  companyId: string;
}): Promise<{ success: boolean; error?: string }> {
  const result = await sendFonnte(opts.phone, opts.message);

  await db
    .insert(whatsappNotificationsTable)
    .values({
      taskId:            opts.taskId ?? null,
      companyId:         opts.companyId,
      recipientPhone:    opts.phone,
      recipientType:     "staff",
      templateName:      "manual",
      messageText:       opts.message,
      status:            result.success ? "sent" : "failed",
      externalMessageId: result.messageId,
      errorMessage:      result.error,
      sentAt:            result.success ? new Date() : null,
    })
    .catch((err) => logger.error({ err }, "Gagal menyimpan log notifikasi manual"));

  return { success: result.success, error: result.error };
}
