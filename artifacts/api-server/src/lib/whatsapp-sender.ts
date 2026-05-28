import { eq } from "drizzle-orm";
import { db, whatsappNotificationsTable } from "@workspace/db";
import { logger } from "./logger";

// ─── Gateway config (read from env, never hardcoded) ─────────────────────────

function getGatewayConfig() {
  return {
    apiUrl: process.env.WHATSAPP_API_URL,
    apiToken: process.env.WHATSAPP_API_TOKEN,
    senderId: process.env.WHATSAPP_SENDER_ID,
  };
}

function isConfigured(): boolean {
  const { apiUrl, apiToken, senderId } = getGatewayConfig();
  return !!(apiUrl && apiToken && senderId);
}

// ─── Template names ────────────────────────────────────────────────────────────

export type TemplateName =
  | "missing_document_request"
  | "new_task_notification"
  | "task_assignment"
  | "progress_update"
  | "customer_approval_request"
  | "completed_task_notification";

export const TEMPLATE_NAMES: TemplateName[] = [
  "missing_document_request",
  "new_task_notification",
  "task_assignment",
  "progress_update",
  "customer_approval_request",
  "completed_task_notification",
];

// ─── Template renderers ────────────────────────────────────────────────────────

type TemplateVars = Record<string, unknown>;

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return "pagi";
  if (hour < 15) return "siang";
  if (hour < 18) return "sore";
  return "malam";
}

export function renderTemplate(templateName: TemplateName, vars: TemplateVars): string {
  switch (templateName) {
    case "missing_document_request": {
      const customerName = (vars.customerName as string | undefined) ?? "Bapak/Ibu";
      const taskNumber = vars.taskNumber ? ` (No. ${vars.taskNumber})` : "";
      const rawDocs = vars.missingDocs;
      const missingDocs: string[] = Array.isArray(rawDocs)
        ? (rawDocs as string[])
        : typeof rawDocs === "string"
        ? [rawDocs]
        : [];
      const list = missingDocs.length > 0
        ? missingDocs.map((d, i) => `${i + 1}. ${d}`).join("\n")
        : "1. Dokumen terkait";
      return (
        `Halo ${customerName}, selamat ${timeGreeting()} 🙏\n\n` +
        `Terima kasih telah mempercayakan urusan impor Anda kepada kami${taskNumber}.\n\n` +
        `Mohon maaf, kami masih memerlukan beberapa dokumen/informasi berikut:\n\n` +
        `${list}\n\n` +
        `Mohon dapat segera dikirimkan agar proses dapat segera kami lanjutkan. ` +
        `Jika ada pertanyaan, jangan ragu untuk menghubungi kami. Terima kasih 🙏`
      );
    }

    case "new_task_notification": {
      const title = (vars.title as string | undefined) ?? "Tugas Baru";
      const taskNumber = vars.taskNumber ? `[${vars.taskNumber}] ` : "";
      const customerName = vars.customerName ? `\nCustomer: ${vars.customerName}` : "";
      const category = vars.category ? `\nKategori: ${vars.category}` : "";
      const priority = vars.priority ? `\nPrioritas: ${String(vars.priority).toUpperCase()}` : "";
      return (
        `🔔 *Tugas Baru Masuk*\n\n` +
        `${taskNumber}${title}` +
        `${customerName}${category}${priority}\n\n` +
        `Silakan cek sistem untuk detail lengkap dan tindak lanjut.`
      );
    }

    case "task_assignment": {
      const customerName = (vars.customerName as string | undefined) ?? "-";
      const title = (vars.title as string | undefined) ?? "Tugas";
      const priority = (vars.priority as string | undefined) ?? "-";
      const miniTaskUrl = (vars.miniTaskUrl as string | undefined) ?? "";
      const linkLine = miniTaskUrl ? `\nLink:\n${miniTaskUrl}` : "";
      return (
        `*TASK BARU*\n\n` +
        `Customer:\n${customerName}\n\n` +
        `Pekerjaan:\n${title}\n\n` +
        `Priority:\n${priority.toUpperCase()}` +
        `${linkLine}`
      );
    }

    case "progress_update": {
      const taskNumber = vars.taskNumber ? ` No. ${vars.taskNumber}` : "";
      const title = (vars.title as string | undefined) ?? "Pengiriman Anda";
      const status = (vars.status as string | undefined) ?? "dalam proses";
      const updateNote = vars.updateNote ? `\n\n📝 ${vars.updateNote}` : "";
      const customerName = (vars.customerName as string | undefined) ?? "Bapak/Ibu";
      return (
        `Halo ${customerName}, selamat ${timeGreeting()} 🙏\n\n` +
        `Informasi terkini mengenai proses Anda${taskNumber}:\n\n` +
        `📦 *${title}*\n` +
        `Status: *${status}*${updateNote}\n\n` +
        `Kami akan terus menginformasikan perkembangan selanjutnya. Terima kasih 🙏`
      );
    }

    case "customer_approval_request": {
      const customerName = (vars.customerName as string | undefined) ?? "Bapak/Ibu";
      const taskNumber = vars.taskNumber ? ` (No. ${vars.taskNumber})` : "";
      const title = (vars.title as string | undefined) ?? "proses pengiriman";
      const details = vars.details ? `\n\n${vars.details}` : "";
      return (
        `Halo ${customerName}, selamat ${timeGreeting()} 🙏\n\n` +
        `Mohon konfirmasi persetujuan Anda untuk *${title}*${taskNumber}.${details}\n\n` +
        `Balas pesan ini:\n` +
        `✅ *SETUJU* — jika Anda menyetujui\n` +
        `✏️ *REVISI* — jika ada yang perlu diubah\n\n` +
        `Terima kasih atas perhatian dan kerjasamanya 🙏`
      );
    }

    case "completed_task_notification": {
      const taskNumber = vars.taskNumber ? ` No. ${vars.taskNumber}` : "";
      const title = (vars.title as string | undefined) ?? "Pengiriman";
      const customerName = (vars.customerName as string | undefined) ?? "Bapak/Ibu";
      const completedAt = vars.completedAt ? ` pada ${vars.completedAt}` : "";
      return (
        `Halo ${customerName}, selamat ${timeGreeting()} 🙏\n\n` +
        `Kami dengan senang hati menginformasikan bahwa proses *${title}*${taskNumber} ` +
        `telah selesai${completedAt} ✅\n\n` +
        `Terima kasih telah mempercayakan urusan impor Anda kepada kami. ` +
        `Semoga dapat bekerja sama kembali di masa mendatang 🙏`
      );
    }
  }
}

// ─── Gateway HTTP call ─────────────────────────────────────────────────────────

interface GatewayResult {
  success: boolean;
  externalMessageId?: string;
  error?: string;
}

async function sendViaGateway(to: string, message: string): Promise<GatewayResult> {
  const { apiUrl, apiToken, senderId } = getGatewayConfig();

  if (!apiUrl || !apiToken || !senderId) {
    return { success: false, error: "Gateway not configured" };
  }

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ phone: to, message, sender: senderId }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      logger.error({ status: res.status, errBody, to }, "WhatsApp gateway returned error");
      return { success: false, error: `Gateway error ${res.status}: ${errBody.slice(0, 200)}` };
    }

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const externalMessageId =
      (json.message_id as string | undefined) ??
      (json.id as string | undefined) ??
      (json.uid as string | undefined);

    return { success: true, externalMessageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, to }, "WhatsApp gateway request failed");
    return { success: false, error: msg };
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface SendNotificationOptions {
  to: string;
  recipientType: "customer" | "admin" | "team";
  templateName: TemplateName;
  variables?: TemplateVars;
  taskId?: number | null;
  companyId?: string;
}

export interface SendNotificationResult {
  success: boolean;
  notificationId: number;
  externalMessageId?: string;
  messageText: string;
  error?: string;
  configMissing?: boolean;
}

export async function sendWhatsAppNotification(
  opts: SendNotificationOptions,
): Promise<SendNotificationResult> {
  const { to, recipientType, templateName, variables = {}, taskId, companyId = "default" } = opts;

  const messageText = renderTemplate(templateName, variables);

  // Always persist to DB first (audit trail regardless of gateway status)
  const [notification] = await db
    .insert(whatsappNotificationsTable)
    .values({
      taskId: taskId ?? null,
      companyId,
      recipientPhone: to,
      recipientType,
      templateName,
      messageText,
      status: "pending",
    })
    .returning();

  if (!isConfigured()) {
    await db
      .update(whatsappNotificationsTable)
      .set({ status: "skipped", errorMessage: "Gateway not configured" })
      .where(eq(whatsappNotificationsTable.id, notification.id));

    logger.warn({ notificationId: notification.id, templateName, to }, "WhatsApp gateway not configured — notification saved but not sent");

    return {
      success: false,
      notificationId: notification.id,
      messageText,
      error: "Gateway not configured (set WHATSAPP_API_URL, WHATSAPP_API_TOKEN, WHATSAPP_SENDER_ID)",
      configMissing: true,
    };
  }

  const gatewayResult = await sendViaGateway(to, messageText);

  await db
    .update(whatsappNotificationsTable)
    .set({
      status: gatewayResult.success ? "sent" : "failed",
      sentAt: gatewayResult.success ? new Date() : null,
      externalMessageId: gatewayResult.externalMessageId ?? null,
      errorMessage: gatewayResult.error ?? null,
    })
    .where(eq(whatsappNotificationsTable.id, notification.id));

  logger.info(
    { notificationId: notification.id, templateName, to, recipientType, success: gatewayResult.success },
    gatewayResult.success ? "WhatsApp notification sent" : "WhatsApp notification failed",
  );

  return {
    success: gatewayResult.success,
    notificationId: notification.id,
    externalMessageId: gatewayResult.externalMessageId,
    messageText,
    error: gatewayResult.error,
  };
}
