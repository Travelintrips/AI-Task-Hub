import { Router, type IRouter } from "express";
import { eq, and, inArray, or } from "drizzle-orm";
import {
  db,
  whatsappMessagesTable,
  aiTasksTable,
  taskAttachmentsTable,
  auditLogsTable,
  whatsappNotificationsTable,
  intakeSessionsTable,
  notificationReceiversTable,
} from "@workspace/db";
import { detectWhatsAppIntent } from "../lib/whatsapp-ai";
import { createTaskFromWhatsAppMessage } from "../lib/task-service";
import { transcribeAudio } from "../lib/openai";
import { sendWhatsAppNotification, TEMPLATE_NAMES } from "../lib/whatsapp-sender";
import type { TemplateName } from "../lib/whatsapp-sender";
import { logger } from "../lib/logger";
import { getOrCreateCustomerContext, updateCustomerContextAfterTask } from "../lib/customer-context";
import { createAdminNotification } from "../lib/admin-notifications";
import { emitSseEvent } from "../lib/sse";
import { sendFonnte, getOwnDeviceNumbers, normalizePhone } from "../lib/fonnte";
import { requireAuth } from "../middleware/auth";
import { validateDocument } from "../lib/document-validation-engine";
import {
  findActiveIntakeSession,
  processIntakeMessage,
  startIntakeSession,
  markIntakeSubmitted,
  isGreeting,
  isClosingPhrase,
  isCancellation,
  isPriceInquiry,
  isGeneralInquiry,
  isSportCenterPriceInquiry,
  isTenantPriceInquiry,
  buildSportCenterPriceListMessage,
  buildTenantPriceMessage,
  isCreativeServiceRequest,
  buildSalesAiMessage,
} from "../lib/intake-engine";
import {
  routeIntentToFlow,
  findFormSentSession,
  findRecentAnySession,
  FORM_MENU_BUTTONS,
  sendFormMenu,
} from "../lib/mini-form-router";
import { sendWhatsAppInteractiveButtons } from "../lib/whatsapp";
import { getFormConfig } from "../lib/mini-form-config";
import { generateSecureToken } from "../lib/tokens";
import { isSportCenterBookingIntent } from "../lib/sport-center-availability";

const router: IRouter = Router();

function getFormMenuCategory(intentCode: string, sessionCategory?: string | null): {
  label: string;
  aliases: string[];
} {
  const raw = `${intentCode} ${sessionCategory ?? ""}`.toLowerCase().replace(/-/g, "_");
  if (/(ppjk|custom|bea_cukai|import|ekspor|freight)/.test(raw)) {
    return { label: "PPJK / Customs", aliases: ["Customs", "PPJK", "Bea Cukai", "PPJK/Customs", "Logistik", "Freight"] };
  }
  if (/(sport|lapangan|booking|futsal|badminton|basket|tenis|voli)/.test(raw)) {
    return { label: "Sport Center", aliases: ["Sport Center", "Lapangan", "Olahraga", "Booking Lapangan"] };
  }
  if (/(kasbon|cash_advance|finance|keuangan|pembayaran)/.test(raw)) {
    return { label: "Finance / Kasbon", aliases: ["Finance", "Kasbon", "Keuangan", "Pembayaran"] };
  }
  if (/(fleet|armada|kendaraan|driver|repair)/.test(raw)) {
    return { label: "Fleet / Armada", aliases: ["Fleet", "Armada", "Kendaraan", "Fleet Management"] };
  }
  if (/(tenant|properti|sewa_properti)/.test(raw)) {
    return { label: "Tenant / Properti", aliases: ["Tenant", "Properti", "Sewa Properti"] };
  }
  return { label: "Trucking / Logistik", aliases: ["Logistik", "Trucking", "Pengiriman", "Sea Freight", "Air Freight"] };
}

async function getFormAgentTargets(
  companyId: string,
  intentCode: string,
  sessionCategory?: string | null,
): Promise<{ label: string; targets: string[] }> {
  const category = getFormMenuCategory(intentCode, sessionCategory);
  try {
    const receivers = await db
      .select({ phone: notificationReceiversTable.phone })
      .from(notificationReceiversTable)
      .where(
        and(
          or(
            eq(notificationReceiversTable.companyId, companyId),
            eq(notificationReceiversTable.companyId, "default"),
          ),
          eq(notificationReceiversTable.isActive, true),
          inArray(notificationReceiversTable.category, category.aliases),
        ),
      );
    const targets = [...new Set(receivers.map((receiver) => receiver.phone).filter(Boolean))];
    if (targets.length > 0) return { label: category.label, targets };
  } catch (err) {
    logger.warn({ err, companyId, intentCode }, "form-menu: gagal mencari penerima berdasarkan kategori");
  }

  const key = category.label.startsWith("PPJK") ? "CUSTOMS" : "LOGISTIK";
  const divisionPhones = (process.env[`STAFF_NOTIFY_PHONES_${key}`] ?? "")
    .split(",")
    .map((phone) => phone.trim())
    .filter(Boolean);
  const divisionGroups = (process.env[`STAFF_NOTIFY_GROUPS_${key}`] ?? "")
    .split(",")
    .map((group) => group.trim())
    .filter((group) => /^\d+@g\.us$/.test(group));
  return { label: category.label, targets: [...divisionPhones, ...divisionGroups] };
}

// ─── Per-phone processing queue ─────────────────────────────────────────────────
// Guards against race conditions when two messages from the same customer arrive
// in quick succession: without this, both messages can run runAiDetection
// concurrently, each seeing "no active intake session" (since the first hasn't
// finished creating/saving its session yet), causing duplicate/conflicting
// sessions and confusing or missing replies (e.g. sport center booking flow).
const phoneQueues = new Map<string, Promise<void>>();

// ─── General inquiry clarification pending ────────────────────────────────────
// Tracks which phone numbers are awaiting clarification after replying
// "pertanyaan lainnya". The NEXT message from that phone bypasses all
// early-return gates and goes straight to the AI pipeline so the actual
// question can be classified and routed to the right notification recipient.
const generalInquiryPending = new Set<string>();

// ─── Incoming-message dedup cache ────────────────────────────────────────────
// Fonnte has multiple configured devices. When a message arrives it can be
// forwarded by several devices to our webhook concurrently, producing multiple
// identical webhook calls for the exact same customer message. Without dedup
// these would each create a new intake session and send e.g. "Jadwal Tersedia!"
// three times. We prevent this by tracking (phone, body) pairs for 60 seconds.
const recentMessages = new Map<string, number>(); // key → epoch ms
const DEDUP_WINDOW_MS = 60_000;
function isDuplicateMessage(from: string, body: string): boolean {
  const key = `${from}:${body}`;
  const now = Date.now();
  // Prune stale entries to avoid unbounded growth
  for (const [k, ts] of recentMessages) {
    if (now - ts > DEDUP_WINDOW_MS) recentMessages.delete(k);
  }
  if (recentMessages.has(key)) return true;
  recentMessages.set(key, now);
  return false;
}

function enqueueForPhone(phone: string, task: () => Promise<void>): void {
  const prev = phoneQueues.get(phone) ?? Promise.resolve();
  const next = prev
    .catch(() => {}) // isolate failures between queued tasks
    .then(() => task())
    .catch((err) => {
      logger.error({ err, phone }, "runAiDetection queued task failed");
    })
    .finally(() => {
      // Clean up the map entry once this was the last queued task for the phone
      if (phoneQueues.get(phone) === next) phoneQueues.delete(phone);
    });
  phoneQueues.set(phone, next);
}

// ─── POST /whatsapp/send ───────────────────────────────────────────────────────

router.post("/whatsapp/send", async (req, res): Promise<void> => {
  const {
    to,
    recipientType,
    templateName,
    variables,
    taskId,
    companyId,
  } = req.body as {
    to?: string;
    recipientType?: string;
    templateName?: string;
    variables?: Record<string, unknown>;
    taskId?: number;
    companyId?: string;
  };

  if (!to || typeof to !== "string" || !to.trim()) {
    res.status(400).json({ error: "Field 'to' (phone number) is required" });
    return;
  }

  const validRecipientTypes = ["customer", "admin", "team", "group"] as const;
  if (!recipientType || !validRecipientTypes.includes(recipientType as typeof validRecipientTypes[number])) {
    res.status(400).json({ error: "Field 'recipientType' must be one of: customer, admin, team, group" });
    return;
  }

  if (!templateName || !(TEMPLATE_NAMES as string[]).includes(templateName)) {
    res.status(400).json({
      error: `Field 'templateName' must be one of: ${TEMPLATE_NAMES.join(", ")}`,
    });
    return;
  }

  const result = await sendWhatsAppNotification({
    to: to.trim(),
    recipientType: recipientType as "customer" | "admin" | "team" | "group",
    templateName: templateName as TemplateName,
    variables: variables ?? {},
    taskId: taskId ?? null,
    companyId: companyId ?? "default",
  });

  const httpStatus = result.success ? 200 : result.configMissing ? 202 : 500;
  res.status(httpStatus).json(result);
});

// ─── POST /whatsapp/send-group ─────────────────────────────────────────────────
// Kirim pesan teks bebas ke grup WhatsApp via group JID (@g.us).
// Sistem akan mencoba semua Fonnte device yang terdaftar secara otomatis.

router.post("/whatsapp/send-group", requireAuth, async (req, res): Promise<void> => {
  const { groupJid, message, taskId, companyId } = req.body as {
    groupJid?: string;
    message?: string;
    taskId?: number;
    companyId?: string;
  };

  if (!groupJid || typeof groupJid !== "string" || !groupJid.trim()) {
    res.status(400).json({ error: "Field 'groupJid' (group WhatsApp JID, format: 628xxx@g.us) diperlukan" });
    return;
  }

  const jid = groupJid.trim();
  if (!jid.endsWith("@g.us")) {
    res.status(400).json({ error: "groupJid harus berformat grup WhatsApp: <nomor>@g.us" });
    return;
  }

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Field 'message' tidak boleh kosong" });
    return;
  }

  const effectiveCompanyId = companyId ?? "default";
  const messageText = message.trim();

  // Simpan ke DB sebagai audit trail
  let notifId: number | null = null;
  try {
    const [inserted] = await db.insert(whatsappNotificationsTable).values({
      taskId: taskId ?? null,
      companyId: effectiveCompanyId,
      recipientPhone: jid,
      recipientType: "group",
      templateName: "group_broadcast",
      messageText,
      status: "pending",
    }).returning({ id: whatsappNotificationsTable.id });
    notifId = inserted?.id ?? null;
  } catch (err) {
    logger.warn({ err }, "send-group: gagal simpan notif ke DB (lanjut kirim)");
  }

  const result = await sendFonnte(jid, messageText);

  // Update status di DB (non-critical — jangan blokir response)
  if (notifId !== null) {
    db.update(whatsappNotificationsTable)
      .set({
        status: result.success ? "sent" : "failed",
        sentAt: result.success ? new Date() : null,
        externalMessageId: result.messageId ?? null,
        errorMessage: result.error ?? null,
      })
      .where(eq(whatsappNotificationsTable.id, notifId))
      .catch(() => { /* non-critical */ });
  }

  logger.info({ groupJid: jid, success: result.success, taskId }, "WhatsApp group send result");

  res.status(result.success ? 200 : 500).json({
    success: result.success,
    groupJid: jid,
    messageId: result.messageId,
    error: result.error,
  });
});

type MessageType = "text" | "image" | "document" | "audio" | "video" | "sticker" | "location" | "unknown";

interface AttachmentInfo {
  url?: string;
  mediaId?: string;
  mimeType?: string;
  filename?: string;
}

function extractMessageContent(msg: Record<string, unknown>): {
  type: MessageType;
  text: string | null;
  attachment: AttachmentInfo | null;
} {
  const type = (msg.type as string | undefined) ?? "unknown";

  // Fonnte incoming format: no "type" field, text is in "message" key
  if (type === "unknown" && typeof msg.message === "string" && msg.message) {
    return { type: "text", text: msg.message, attachment: null };
  }

  if (type === "text") {
    // Meta format: text.body
    const textBody =
      (msg.text as Record<string, unknown> | undefined)?.body as string | undefined ??
      (typeof msg.message === "string" ? msg.message : undefined);
    return { type: "text", text: textBody ?? null, attachment: null };
  }

  if (type === "interactive") {
    const interactive = msg.interactive as Record<string, unknown> | undefined;
    const buttonReply = interactive?.button_reply as Record<string, unknown> | undefined;
    const listReply = interactive?.list_reply as Record<string, unknown> | undefined;
    const reply = buttonReply ?? listReply;
    return {
      type: "text",
      text:
        (reply?.title as string | undefined) ??
        (reply?.id as string | undefined) ??
        null,
      attachment: null,
    };
  }

  if (type === "image") {
    const image = msg.image as Record<string, unknown> | undefined;
    return {
      type: "image",
      text: (image?.caption as string | undefined) ?? null,
      attachment: {
        url: image?.link as string | undefined,
        mimeType: image?.mime_type as string | undefined,
        filename: `image_${Date.now()}.jpg`,
      },
    };
  }

  if (type === "document") {
    const doc = msg.document as Record<string, unknown> | undefined;
    return {
      type: "document",
      text: (doc?.caption as string | undefined) ?? null,
      attachment: {
        url: doc?.link as string | undefined,
        mimeType: doc?.mime_type as string | undefined,
        filename: (doc?.filename as string | undefined) ?? `document_${Date.now()}`,
      },
    };
  }

  if (type === "audio") {
    const audio = msg.audio as Record<string, unknown> | undefined;
    const mimeType = audio?.mime_type as string | undefined;
    const ext = mimeType?.split("/")[1]?.split(";")[0] ?? "ogg";
    return {
      type: "audio",
      text: null,
      attachment: {
        url: audio?.link as string | undefined,
        mediaId: audio?.id as string | undefined,
        mimeType,
        filename: `voice_${Date.now()}.${ext}`,
      },
    };
  }

  if (type === "video") {
    const video = msg.video as Record<string, unknown> | undefined;
    return {
      type: "video",
      text: (video?.caption as string | undefined) ?? null,
      attachment: {
        url: video?.link as string | undefined,
        mimeType: video?.mime_type as string | undefined,
        filename: `video_${Date.now()}.mp4`,
      },
    };
  }

  if (type === "sticker") {
    const sticker = msg.sticker as Record<string, unknown> | undefined;
    return {
      type: "sticker",
      text: null,
      attachment: {
        url: sticker?.link as string | undefined,
        mimeType: sticker?.mime_type as string | undefined,
        filename: `sticker_${Date.now()}.webp`,
      },
    };
  }

  return { type: "unknown", text: null, attachment: null };
}

function resolveDocumentType(mimeType: string | undefined, filename: string | undefined): string {
  if (!mimeType && !filename) return "attachment";
  const mime = mimeType?.toLowerCase() ?? "";
  const name = (filename ?? "").toLowerCase();
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (mime.includes("spreadsheet") || mime.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv"))
    return "spreadsheet";
  if (mime.includes("word") || name.endsWith(".docx") || name.endsWith(".doc")) return "word";
  if (mime.includes("image")) return "image";
  if (mime.includes("audio") || mime.includes("ogg")) return "voice";
  if (mime.includes("video")) return "video";
  return "document";
}

/**
 * Infer PPJK document type from caption text + filename keywords.
 * Returns a known document_validation_rules type if matched, otherwise
 * falls back to the generic mime-based type from resolveDocumentType.
 */
function inferPpjkDocumentType(
  caption: string,
  filename: string | undefined,
  mimeType: string | undefined,
): string {
  const text = `${caption} ${filename ?? ""}`.toLowerCase();
  if (/\bci\b|commercial.?invoice|\binvoice\b/.test(text)) return "commercial_invoice";
  if (/\bpl\b|packing.?list|pack.*list/.test(text)) return "packing_list";
  if (/\bbl\b|\bawb\b|bill.?of.?lading|airway.?bill|b\/l/.test(text)) return "bl_awb";
  if (/\bhs.?code\b/.test(text)) return "hs_code";
  if (/\bcoa\b|certificate.?of.?analysis/.test(text)) return "coa";
  if (/\bmsds\b|safety.?data/.test(text)) return "msds";
  if (/damage|rusak|kerusakan/.test(text)) return "damage_photo";
  if (/\bstnk\b|\bkir\b|asuransi.?kendaraan/.test(text)) return "stnk_kir_insurance";
  if (/\bbbm\b|\bfuel\b|bensin|solar|struk.*pompa/.test(text)) return "fuel_receipt";
  if (/bengkel|invoice.*servis|servis.*kendaraan/.test(text)) return "maintenance_invoice";
  if (/kasbon|cash.?advance/.test(text)) return "cash_advance_receipt";
  // Fallback: use mime-based generic type so AI still analyzes the doc
  return resolveDocumentType(mimeType, filename);
}

/**
 * Download a WhatsApp media file using the Media API.
 * Handles the two-step flow: get URL, then download with auth.
 */
async function downloadWhatsAppMedia(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    logger.warn("WHATSAPP_TOKEN not set — cannot download WhatsApp media");
    return null;
  }
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      logger.error({ status: metaRes.status, mediaId }, "Failed to get WhatsApp media URL");
      return null;
    }
    const meta = (await metaRes.json()) as { url: string; mime_type?: string };
    const dlRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dlRes.ok) {
      logger.error({ status: dlRes.status, mediaId }, "Failed to download WhatsApp media");
      return null;
    }
    const mimeType = meta.mime_type ?? "audio/ogg";
    const ext = mimeType.split("/")[1]?.split(";")[0] ?? "ogg";
    const filename = `voice_${Date.now()}.${ext}`;
    const buffer = Buffer.from(await dlRes.arrayBuffer());
    return { buffer, mimeType, filename };
  } catch (err) {
    logger.error({ err, mediaId }, "Exception downloading WhatsApp media");
    return null;
  }
}

/**
 * POST /api/whatsapp/webhook
 *
 * Receives incoming WhatsApp messages from the gateway.
 * - Saves raw message to whatsapp_messages
 * - Saves any attachments to task_attachments
 * - Triggers AI intent detection async (does not block response)
 * - Returns 200 immediately
 */
router.post("/whatsapp/webhook", async (req, res): Promise<void> => {
  // Respond immediately — webhook gateways require fast acknowledgement
  res.sendStatus(200);

  const rawPayload = req.body as Record<string, unknown>;
  const companyId = (req.headers["x-company-id"] as string | undefined) ?? "default";

  try {
    const object = rawPayload?.object as string | undefined;

    // Handle Meta/WhatsApp Business API format
    if (object === "whatsapp_business_account") {
      const entries = (rawPayload?.entry as Array<Record<string, unknown>>) ?? [];

      for (const entry of entries) {
        const changes = (entry?.changes as Array<Record<string, unknown>>) ?? [];

        for (const change of changes) {
          const value = change?.value as Record<string, unknown> | undefined;
          if (!value) continue;

          const messages = (value?.messages as Array<Record<string, unknown>>) ?? [];
          const contacts = (value?.contacts as Array<Record<string, unknown>>) ?? [];
          const senderName = (contacts[0]?.profile as Record<string, unknown> | undefined)?.name as string | undefined;

          for (const msg of messages) {
            await processIncomingMessage({ msg, senderName, companyId, rawPayload });
          }
        }
      }
      return;
    }

    // Handle generic/3rd-party gateway format (including Fonnte)
    // Fonnte sends: sender, message, name, device, quick
    //
    // Anti-echo-loop: Fonnte marks outgoing message echoes with quick=true.
    // Real incoming messages from customers have quick=false or quick absent.
    // Use truthy comparison — Fonnte may send boolean true, integer 1, or string "true".
    const quickVal = rawPayload?.quick;
    const isQuickEcho =
      quickVal === true || quickVal === 1 ||
      (typeof quickVal === "string" && (quickVal === "true" || quickVal === "1"));
    if (isQuickEcho) {
      logger.debug({ quick: quickVal }, "Fonnte echo detected — skipping outgoing message");
      return;
    }

    // Secondary content filter: belt-and-suspenders for echoes where quick is absent
    const rawMessage =
      (rawPayload?.message as string | undefined) ??
      (rawPayload?.pesan as string | undefined) ??
      "";
    const isBotReplyEcho =
      rawMessage.includes("/mini-form/") ||
      rawMessage.includes("Silakan ceritakan kebutuhan Anda") ||
      rawMessage.includes("Tim kami siap membantu! 🙏") ||
      rawMessage.includes("_AI Task Center_");
    if (isBotReplyEcho) {
      logger.debug({ snippet: rawMessage.slice(0, 80) }, "Bot-reply echo detected — skipping");
      return;
    }

    const from =
      (rawPayload?.from as string | undefined) ??
      (rawPayload?.sender as string | undefined) ??
      (rawPayload?.sender_phone as string | undefined) ??
      (rawPayload?.phone as string | undefined);

    // NOTE: Tertiary device-number filter was REMOVED.
    // It incorrectly blocked real messages from users/admins whose WhatsApp
    // number happens to be registered as a Fonnte device (e.g. the owner testing
    // from their own number). The quick=true filter above is the correct and
    // sufficient mechanism to prevent echo loops.

    // Device yang menerima pesan — dipakai untuk memilih token Fonnte yang tepat saat balas
    const fonnteDevice = (rawPayload?.device as string | undefined) ?? null;

    if (from) {
      await processIncomingMessage({
        msg: rawPayload,
        senderName:
          (rawPayload?.name as string | undefined) ??
          (rawPayload?.pushname as string | undefined) ??
          (rawPayload?.sender_name as string | undefined),
        companyId,
        rawPayload,
        fonnteDevice,
      });
    }
  } catch (err) {
    logger.error({ err, companyId }, "Unhandled error processing WhatsApp webhook");
  }
});

export async function processIncomingMessage({
  msg,
  senderName,
  companyId,
  rawPayload,
  fonnteDevice,
}: {
  msg: Record<string, unknown>;
  senderName: string | undefined;
  companyId: string;
  rawPayload: Record<string, unknown>;
  fonnteDevice?: string | null;
}): Promise<void> {
  // Normalize phone number: Fonnte can send numbers with @s.whatsapp.net or @c.us suffix
  // which would break session lookup (stored phone never has the suffix).
  const rawFrom =
    (msg?.from as string | undefined) ??
    (msg?.sender as string | undefined) ??
    (msg?.sender_phone as string | undefined) ??
    (msg?.phone as string | undefined) ??
    "unknown";
  // For group JIDs (ends @g.us) keep as-is; for individual phones, strip WA suffixes and normalize.
  const from = rawFrom === "unknown"
    ? "unknown"
    : (normalizePhone(rawFrom) ?? rawFrom);

  // When message comes from a WA group, reply to the group JID (not the member's private number)
  const replyTo = (msg?.group_jid as string | undefined) ?? from;

  const timestamp =
    (msg?.timestamp as string | undefined) ??
    Math.floor(Date.now() / 1000).toString();

  const { type: messageType, text: messageText, attachment } = extractMessageContent(msg);

  const bodyText = messageText ?? `[${messageType} message]`;

  // 1. Save message to database (non-blocking — AI pipeline ALWAYS continues even on save failure)
  let savedMsg: { id: number } = { id: 0 };
  try {
    const [inserted] = await db
      .insert(whatsappMessagesTable)
      .values({
        companyId,
        from,
        senderPhone: from,
        senderName: senderName ?? null,
        body: bodyText,
        messageText: messageText ?? null,
        messageType,
        direction: "inbound",
        attachmentUrl: attachment?.url ?? null,
        rawPayload,
        timestamp,
        processed: false,
        aiProcessed: false,
      })
      .returning();
    savedMsg = inserted;
    logger.info({ msgId: savedMsg.id, from, type: messageType }, "WhatsApp message saved");
  } catch (saveErr) {
    logger.warn({ saveErr, from, companyId }, "Failed to save WhatsApp message — AI pipeline will continue");
  }

  try {

    // Emit SSE so messages page updates instantly
    emitSseEvent(
      "new_message",
      { msgId: savedMsg.id, from, senderName: senderName ?? null, type: messageType },
      companyId,
    );

    // 2. Route as WA command first — if handled, skip AI pipeline
    if (messageType === "text" && messageText) {
      const { routeWaCommand } = await import("../lib/wa-command-router");
      const handled = await routeWaCommand(from, messageText, companyId).catch((err) => {
        logger.error({ err, from }, "wa-command-router: uncaught error");
        return false;
      });
      if (handled) {
        // Mark message as processed so it doesn't re-appear in unprocessed queue
        await db
          .update(whatsappMessagesTable)
          .set({ processed: true, aiProcessed: true })
          .where(eq(whatsappMessagesTable.id, savedMsg.id))
          .catch(() => {});
        return;
      }
    }

    // 2b. Fast-path gates: greeting / cancellation — intercept BEFORE the async AI queue.
    // This is a safety net that ensures these always fire even if runAiDetection has DB issues.
    // Only applies to plain text messages.
    if (messageType === "text" && messageText) {
      const trimmed = messageText.trim();
      const answeringClarification = generalInquiryPending.has(from);

      // Greeting gate (also matches short messages starting with greeting word e.g. "hallo ai task")
      if (!answeringClarification && isGreeting(trimmed)) {
        logger.info({ from, msg: trimmed }, "processIncomingMessage: greeting pre-gate — sending menu");
        // Cancel any stale intake sessions (fire-and-forget)
        db.update(intakeSessionsTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(and(
            eq(intakeSessionsTable.phone, from),
            eq(intakeSessionsTable.companyId, companyId),
            inArray(intakeSessionsTable.status, ["collecting", "ready_for_task"]),
          ))
          .catch((e) => logger.warn({ e }, "greeting pre-gate: failed to cancel sessions"));

        const greetingReply =
          `Halo! 👋 Selamat datang, ada yang bisa kami bantu?\n\n` +
          `Silakan ceritakan kebutuhan Anda, misalnya:\n` +
          `1.🚚 Pengiriman / Trucking / Sea & Air Freight\n` +
          `2.📋 Layanan PPJK / Bea Cukai / Customs\n` +
          `3.🏟️ Booking Lapangan Olahraga\n` +
          `4.💰 Kasbon / Pembayaran\n` +
          `5.❓ Pertanyaan lainnya\n` +
          `6.🎨 Layanan Kreatif / Desain AI\n\n` +
          `Tim kami siap membantu! 🙏\n` +
          `atau ketik angka.`;
        await sendFonnte(replyTo, greetingReply, fonnteDevice ?? null).catch((e) =>
          logger.warn({ e }, "greeting pre-gate: failed to send reply"),
        );
        await db.update(whatsappMessagesTable)
          .set({ processed: true, aiProcessed: true })
          .where(eq(whatsappMessagesTable.id, savedMsg.id))
          .catch(() => {});
        return;
      }

      // Cancellation gate (fires even mid-session — always intercept)
      if (isCancellation(trimmed)) {
        logger.info({ from, msg: trimmed }, "processIncomingMessage: cancellation pre-gate — sending ack");
        db.update(intakeSessionsTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(and(
            eq(intakeSessionsTable.phone, from),
            eq(intakeSessionsTable.companyId, companyId),
            inArray(intakeSessionsTable.status, ["collecting", "ready_for_task"]),
          ))
          .catch((e) => logger.warn({ e }, "cancellation pre-gate: failed to cancel sessions"));

        const cancelReply = `Baik, permintaan Anda telah dibatalkan. 🙏 Jika ada kebutuhan lain, silakan hubungi kami kembali ya.`;
        await sendFonnte(replyTo, cancelReply, fonnteDevice ?? null).catch((e) =>
          logger.warn({ e }, "cancellation pre-gate: failed to send reply"),
        );
        await db.update(whatsappMessagesTable)
          .set({ processed: true, aiProcessed: true })
          .where(eq(whatsappMessagesTable.id, savedMsg.id))
          .catch(() => {});
        return;
      }

      // Closing phrase gate (only when not answering clarification)
      if (!answeringClarification && isClosingPhrase(trimmed)) {
        logger.info({ from, msg: trimmed }, "processIncomingMessage: closing-phrase pre-gate — sending ack");
        const closingReply = `Sama-sama! 😊 Jika ada kebutuhan lain, jangan ragu untuk menghubungi kami ya.`;
        await sendFonnte(replyTo, closingReply, fonnteDevice ?? null).catch((e) =>
          logger.warn({ e }, "closing pre-gate: failed to send reply"),
        );
        await db.update(whatsappMessagesTable)
          .set({ processed: true, aiProcessed: true })
          .where(eq(whatsappMessagesTable.id, savedMsg.id))
          .catch(() => {});
        return;
      }
    }

    // 3. Save attachment reference if present
    if (attachment?.url && savedMsg.id) {
      try {
        await db.insert(taskAttachmentsTable).values({
          taskId: 0,
          fileName: attachment.filename ?? `attachment_${Date.now()}`,
          fileUrl: attachment.url,
          fileType: attachment.mimeType ?? messageType,
          documentType: resolveDocumentType(attachment.mimeType, attachment.filename),
        });
        logger.info({ msgId: savedMsg.id, fileUrl: attachment.url }, "Attachment reference saved");
      } catch (attachErr) {
        logger.error({ attachErr, msgId: savedMsg.id }, "Failed to save attachment reference");
      }

      // 3b. Auto-validate via Document Validation Engine (fire-and-forget)
      // — saves result to document_intake_audits → appears in Doc Validation queue
      // — sends notification to PPJK WA group (if PPJK_WHATSAPP_GROUP_ID is set)
      const _autoValidate = (async () => {
        try {
          const docType = inferPpjkDocumentType(bodyText, attachment.filename, attachment.mimeType);
          const fileName = attachment.filename ?? `attachment_${Date.now()}`;

          // Skip voice/video — not meaningful to validate with Vision
          if (docType === "voice" || docType === "video") return;

          logger.info({ from, docType, fileName }, "auto-validate: triggering document validation");

          const result = await validateDocument({
            companyId,
            documentType: docType,
            fileName,
            fileUrl: attachment.url,
          });

          logger.info(
            { from, docType, status: result.validationStatus, auditId: result.auditId },
            "auto-validate: validation complete",
          );

          // Notify PPJK group
          const groupId = process.env.PPJK_WHATSAPP_GROUP_ID;
          if (groupId) {
            const docTypeLabel = docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            const senderLabel = senderName ? `${senderName} (${from})` : from;
            let notifMsg: string;
            if (result.validationStatus === "valid") {
              notifMsg =
                `✅ *Dokumen Diterima*\n` +
                `📄 *${fileName}*\n` +
                `Tipe: ${docTypeLabel}\n` +
                `Dari: ${senderLabel}\n` +
                `Status: Valid & siap diproses.`;
            } else {
              const reason = result.issueSummary ?? "Dokumen tidak sesuai tipe yang diminta";
              notifMsg =
                `❌ *Validasi Dokumen Gagal*\n` +
                `📄 *${fileName}*\n` +
                `Tipe: ${docTypeLabel}\n` +
                `Dari: ${senderLabel}\n\n` +
                `${reason}\n` +
                `Mohon dicek kembali.`;
            }
            await sendFonnte(groupId, notifMsg).catch((e) =>
              logger.warn({ e, groupId }, "auto-validate: gagal kirim notif PPJK grup (non-fatal)"),
            );
          }
        } catch (autoErr) {
          logger.warn({ autoErr, from }, "auto-validate: validateDocument gagal (non-fatal)");
        }
      })();
      void _autoValidate;
    }

    // 3. Log activity
    try {
      await db.insert(auditLogsTable).values({
        action: "message_received",
        module: "messages",
        before: `WhatsApp message received from ${senderName ?? from} (${messageType})`,
        entityId: savedMsg.id,
      });
    } catch (actErr) {
      logger.error({ actErr }, "Failed to log activity for incoming message");
    }

    // 4. Look up customer context (non-blocking — errors must not block AI)
    let customerCtx: Awaited<ReturnType<typeof getOrCreateCustomerContext>> = null;
    try {
      customerCtx = await getOrCreateCustomerContext({ phone: from, companyId, name: senderName });
    } catch (ctxErr) {
      logger.warn({ ctxErr, from }, "getOrCreateCustomerContext failed — continuing without context");
    }

    // 5. Create admin notification for new WhatsApp inquiry (non-blocking)
    createAdminNotification({
      type: "new_inquiry",
      title: "Pesan WhatsApp Baru",
      body: `Pesan dari ${senderName ?? from}: "${bodyText.slice(0, 100)}${bodyText.length > 100 ? "…" : ""}"`,
      customerPhone: from,
      customerName: senderName ?? customerCtx?.picName ?? null,
      companyId,
    }).catch((notifErr) => {
      logger.warn({ notifErr, from }, "createAdminNotification failed — AI pipeline continues");
    });

    // 6. Trigger AI detection (non-blocking, but serialized per phone number to
    // avoid race conditions between quick successive messages — see phoneQueues).
    // Dedup guard: Fonnte may forward the same customer message from multiple
    // devices, producing duplicate webhook calls. If we've already queued this
    // (from, body) pair within DEDUP_WINDOW_MS, skip to avoid triple-sends.
    if (isDuplicateMessage(from, bodyText)) {
      logger.info({ from, bodyText: bodyText.slice(0, 80) }, "Duplicate webhook call detected — skipping (already queued for this phone+body)");
      return;
    }
    enqueueForPhone(from, () =>
      runAiDetection({
        savedMsgId: savedMsg.id,
        from,
        replyTo,
        senderName,
        bodyText,
        messageType,
        companyId,
        attachmentUrl: attachment?.url ?? null,
        mediaId: attachment?.mediaId ?? null,
        customerCtxName: customerCtx?.picName ?? senderName ?? null,
        previousIntents: null,
        fonnteDevice: fonnteDevice ?? null,
      }),
    );
  } catch (err) {
    logger.error({ err, from, companyId }, "AI pipeline error in processIncomingMessage");
    // Always reply to customer even when the pipeline setup fails
    sendFonnte(
      replyTo,
      "Terima kasih atas pesan Anda! Tim kami sedang memproses dan akan segera menghubungi Anda. 🙏",
      fonnteDevice ?? null,
    ).catch(() => {});
  }
}

async function runAiDetection({
  savedMsgId,
  from,
  replyTo,
  senderName,
  bodyText,
  messageType,
  companyId,
  attachmentUrl,
  mediaId,
  customerCtxName,
  previousIntents,
  fonnteDevice,
}: {
  savedMsgId: number;
  from: string;
  /** Target untuk sendFonnte — group JID jika pesan dari grup, else sama dengan from */
  replyTo: string;
  senderName: string | undefined;
  bodyText: string;
  messageType: string;
  companyId: string;
  attachmentUrl?: string | null;
  mediaId?: string | null;
  customerCtxName?: string | null;
  previousIntents?: string | null;
  fonnteDevice?: string | null;
}): Promise<void> {
  const effectiveName = senderName ?? customerCtxName ?? null;
  let parsedPrevIntents: string[] = [];
  try { parsedPrevIntents = JSON.parse(previousIntents ?? "[]"); } catch (_) { parsedPrevIntents = []; }

  try {
    // ── Step 0: Check for active intake session ────────────────────────────────
    // If customer is mid-conversation collecting data, continue that session
    // instead of detecting a new intent.
    const activeSession = await findActiveIntakeSession(from, companyId);

    // ── Step 0a-clarify: "Pertanyaan lainnya" pending check ───────────────────
    // If this phone was previously asked "Boleh saya tau apa yang ingin ditanyakan?",
    // this message IS the actual question. Clear the pending flag and bypass all
    // early-return gates so the AI pipeline can classify the question and route
    // notifications to the correct recipient (PPJK, Trucking, Lapangan, etc.).
    const isAnsweringClarification = generalInquiryPending.has(from);
    if (isAnsweringClarification) {
      generalInquiryPending.delete(from);
      logger.info({ from, msg: bodyText }, "General inquiry clarification answer received — routing to AI pipeline");
    }

    // ── Step 0a-form-menu: Form menu reply gate ─────────────────────────────────
    // Deteksi ketika pelanggan membalas dengan salah satu pilihan menu form:
    //   8 / Kembali Menu Awal  → tampilkan menu utama + cancel semua sesi
    //   9 / Akhiri Percakapan  → cancel sesi + kirim pesan penutup
    //   10 / Hubungi Agent     → notif ke staff + wa.me link personal divisi ke pelanggan
    {
      // Hapus bracket luar [] dan emoji prefix agar teks manual tetap cocok
      const normalizedMsg = bodyText
        .trim()
        .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, "") // strip leading emoji
        .replace(/^\[+|\]+$/g, "") // strip outer brackets
        .trim()
        .toLowerCase();
      // Cocokkan angka shortcut (1/8/9/10), ID tombol (btn_*), DAN keyword teks
      const isOption0 = /^(1|btn_isi_form|isi form|isi formulir)$/i.test(normalizedMsg);
      const isOption1 = /^(8|btn_menu_awal|form_menu_home|kembali menu awal|kembali)$/i.test(normalizedMsg);
      const isOption2 = /^(9|btn_akhiri|form_menu_end|akhiri percakapan|akhiri|selesai)$/i.test(normalizedMsg);
      const isOption3 = /^(10|btn_hubungi_agent|form_menu_agent|hubungi agent|hubungi agen|agent|agen)$/i.test(normalizedMsg);

      // Guard: hanya proses jika ada sesi form aktif (form_sent) ATAU sesi apapun
      // yang dibuat dalam 2 jam terakhir (user sudah submit form lalu klik menu).
      // EXCEPTION: Klik tombol interaktif (btn_*) selalu diproses — tombol hanya bisa
      // diklik jika kita yang mengirimnya, jadi sesi pasti sudah ada sebelumnya.
      const isButtonIdClick = /^(btn_menu_awal|btn_akhiri|btn_hubungi_agent)$/.test(bodyText.trim());
      const isFormMenuReply = isOption0 || isOption1 || isOption2 || isOption3;
      let formSentSession: Awaited<ReturnType<typeof findFormSentSession>> = null;
      let recentSession: { intentCode: string; category: string | null } | null = null;

      if (isFormMenuReply && !isButtonIdClick) {
        formSentSession = await findFormSentSession(from, companyId);
        if (!formSentSession) {
          // Fallback: cek apakah ada sesi apapun dalam 2 jam terakhir
          recentSession = await findRecentAnySession(from, companyId);
        }
      }

      // isOption0 (Isi Form) hanya valid jika ada sesi yang bisa dijadikan konteks
      const shouldHandleFormMenu =
        isFormMenuReply &&
        (isButtonIdClick || formSentSession !== null || recentSession !== null) &&
        // "1" terlalu ambigu tanpa konteks sesi — hanya aktifkan jika ada sesi
        (!isOption0 || formSentSession !== null || recentSession !== null);
      // Sumber intentCode/category terbaik untuk routing Hubungi Agent
      const sessionForAgent = formSentSession ?? recentSession;

      if (shouldHandleFormMenu) {
        const choice =
          isOption0 ? 0
          : isOption1 ? 1
          : isOption2 ? 2
          : isOption3 ? 3
          : -1;

        if (choice >= 0) {
          logger.info({ from, bodyText, normalizedMsg, choice }, "form-menu: pilihan menu form terdeteksi");

          if (choice === 0) {
            // ── Isi Form — generate/resend link form sesuai intent sesi ──────────
            const intentCode = sessionForAgent?.intentCode ?? "";
            const category = sessionForAgent?.category ?? null;
            logger.info({ from, intentCode, category }, "form-menu: Isi Form dipilih — kirim/resend link form");

            const route = await routeIntentToFlow({
              phone: from,
              companyId,
              intentCode,
              intentName: intentCode,
              category,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              resolution: {} as any,
              collectedFields: {},
              missingFields: [],
              requiredDocuments: [],
              fonnteDevice,
            });

            if (!route.waSent) {
              const fallbackMsg =
                `Baik, tim kami akan membantu Anda melanjutkan proses. 🙏\n` +
                `Silakan ceritakan kebutuhan Anda lebih lanjut atau ketik *10* untuk langsung dihubungi agent.`;
              await sendFonnte(replyTo, fallbackMsg, fonnteDevice).catch((e) =>
                logger.warn({ e }, "form-menu isi-form: gagal kirim fallback"),
              );
            }

            await db
              .update(whatsappMessagesTable)
              .set({ aiProcessed: true, detectedIntent: "form_menu_isi_form" })
              .where(eq(whatsappMessagesTable.id, savedMsgId))
              .catch((e) => logger.warn({ e }, "form-menu isi-form: gagal update aiProcessed"));
            return;
          }

          // Cancel semua sesi aktif (form_sent, collecting, ready_for_task) untuk opsi 1/2/3
          try {
            await db
              .update(intakeSessionsTable)
              .set({ status: "cancelled", updatedAt: new Date() })
              .where(
                and(
                  eq(intakeSessionsTable.phone, from),
                  eq(intakeSessionsTable.companyId, companyId),
                  inArray(intakeSessionsTable.status, ["form_sent", "collecting", "ready_for_task"]),
                ),
              );
          } catch (cancelErr) {
            logger.warn({ cancelErr }, "form-menu: gagal cancel sesi");
          }

          if (choice === 1) {
            // Kembali Menu Awal — tampilkan menu utama
            const menuReply =
              `Halo! 👋 Selamat datang, ada yang bisa kami bantu?\n\n` +
              `Silakan ceritakan kebutuhan Anda, misalnya:\n` +
              `1.🚚 Pengiriman / Trucking / Sea & Air Freight\n` +
              `2.📋 Layanan PPJK / Bea Cukai / Customs\n` +
              `3.🏟️ Booking Lapangan Olahraga\n` +
              `4.💰 Kasbon / Pembayaran\n` +
              `5.❓ Pertanyaan lainnya\n` +
              `6.🎨 Layanan Kreatif / Desain AI\n\n` +
              `Tim kami siap membantu! 🙏\n` +
              `atau ketik angka.`;
            await sendFonnte(replyTo, menuReply, fonnteDevice).catch((e) =>
              logger.warn({ e }, "form-menu: gagal kirim menu utama"),
            );
          } else if (choice === 2) {
            // Akhiri Percakapan
            const endReply =
              `Baik, percakapan telah diakhiri. 🙏\n\n` +
              `Jika suatu saat membutuhkan bantuan lagi, jangan ragu menghubungi kami ya. Terima kasih!`;
            await sendFonnte(replyTo, endReply, fonnteDevice).catch((e) =>
              logger.warn({ e }, "form-menu: gagal kirim pesan penutup"),
            );
          } else if (choice === 3) {
            // Hubungi Agent — cari nomor personal divisi dari Penerima Notifikasi,
            // kirim wa.me link ke pelanggan + notif ke staff
            const agentTargets = await getFormAgentTargets(
              companyId,
              sessionForAgent?.intentCode ?? "",
              sessionForAgent?.category,
            );

            // Nomor pertama dari Penerima Notifikasi dijadikan wa.me link untuk pelanggan
            const personalPhone = agentTargets.targets.length > 0
              ? (normalizePhone(agentTargets.targets[0]!) ?? agentTargets.targets[0]!)
              : null;

            let agentAck =
              `Baik, kami akan segera menghubungkan Anda dengan agent *${agentTargets.label}*. 🙏`;
            if (personalPhone && !personalPhone.includes("@g.us")) {
              agentAck +=
                `\n\nSilakan hubungi langsung melalui link berikut:\n` +
                `👉 https://wa.me/${personalPhone}`;
            } else {
              agentAck += `\n\nMohon tunggu sebentar, tim kami akan segera membantu!`;
            }
            await sendFonnte(replyTo, agentAck, fonnteDevice).catch((e) =>
              logger.warn({ e }, "form-menu: gagal kirim ack agent"),
            );

            // Notifikasi ke semua penerima divisi (termasuk grup)
            const staffMsg =
              `🔔 *Permintaan Bantuan Agent*\n\n` +
              `Pelanggan *${from}*${effectiveName ? ` (${effectiveName})` : ""}` +
              ` meminta dihubungi oleh agent *${agentTargets.label}*.\n\n` +
              `Silakan segera hubungi pelanggan via WhatsApp.`;

            await Promise.allSettled(
              agentTargets.targets.map((target) =>
                sendFonnte(target, staffMsg).catch((e) =>
                  logger.warn({ e, target }, "form-menu: gagal notif staff"),
                ),
              ),
            );

            logger.info(
              { from, agentLabel: agentTargets.label, personalPhone, targetCount: agentTargets.targets.length },
              agentTargets.targets.length > 0
                ? "form-menu: notifikasi agent terkirim"
                : "form-menu: tidak ada penerima agent ditemukan — periksa Notification Receivers",
            );
          }

          await db
            .update(whatsappMessagesTable)
            .set({ aiProcessed: true, detectedIntent: `form_menu_${choice}` })
            .where(eq(whatsappMessagesTable.id, savedMsgId))
            .catch((e) => logger.warn({ e }, "form-menu: gagal update aiProcessed"));

          return;
        }
      }
    }

    // ── Step 0a-pre-affirm: "Ya" confirmation gate ─────────────────────────────
    // Ketika user menjawab "ya"/"iya" setelah AI mendeteksi intent dan mengirim balasan
    // konfirmasi ("Ada yang bisa kami bantu terkait X?"), tawarkan pilihan:
    //   1. Isi Form    → resend link form sesuai intent terdeteksi sebelumnya
    //   10. Hubungi Agent → hubungkan ke nomor personal divisi
    // Gate hanya aktif jika ada sesi form_sent ATAU sesi apapun dalam 2 jam terakhir.
    {
      const isAffirmativeOnly = /^(ya|iya|yes|yap|oke|ok|siap|boleh)\s*[!.?]*$/i.test(bodyText.trim());
      if (!isAnsweringClarification && isAffirmativeOnly && !activeSession) {
        const affirmFormSent = await findFormSentSession(from, companyId);
        const affirmRecent = affirmFormSent ?? await findRecentAnySession(from, companyId);
        if (affirmRecent) {
          logger.info(
            { from, bodyText, hasFormSent: !!affirmFormSent, intentCode: affirmRecent.intentCode },
            "ya-confirmation: sesi ditemukan — tampilkan pilihan form/agent",
          );
          const choiceMsg =
            `Baik! Bagaimana Anda ingin melanjutkan? 😊\n\n` +
            `*1. Isi Form* — Kami kirimkan link form untuk diisi\n` +
            `*10. Hubungi Agent* — Hubungkan Anda dengan tim kami langsung\n\n` +
            `Balas *1* untuk form atau *10* untuk agent.`;
          await sendFonnte(replyTo, choiceMsg, fonnteDevice).catch((e) =>
            logger.warn({ e }, "ya-confirmation: gagal kirim choice menu"),
          );
          await db
            .update(whatsappMessagesTable)
            .set({ aiProcessed: true, detectedIntent: "ya_confirmation" })
            .where(eq(whatsappMessagesTable.id, savedMsgId))
            .catch((e) => logger.warn({ e }, "ya-confirmation: gagal mark aiProcessed"));
          return;
        }
      }
    }

    // ── Step 0a-pre: Closing phrase gate — "terima kasih", "ok", "siap", etc.
    // These are conversation-enders, not new requests. Respond with a simple
    // acknowledgment and return. Do NOT cancel sessions or show the full menu.
    // IMPORTANT: Skip this gate when there is an active intake session — phrases
    // like "ya", "oke", "iya" are intake confirmations (e.g. sport center availability),
    // not conversation-enders. Also skip when customer is answering a clarification
    // question so their actual question is not silently swallowed.
    if (!isAnsweringClarification && isClosingPhrase(bodyText) && !activeSession) {
      logger.info({ from, msg: bodyText }, "Closing phrase detected — sending simple ack, skipping AI");
      const closingReply = `Sama-sama! 😊 Jika ada kebutuhan lain, jangan ragu untuk menghubungi kami ya.`;
      await sendFonnte(replyTo, closingReply, fonnteDevice).catch((e) =>
        logger.warn({ e }, "closing: failed to send ack reply"),
      );
      await db
        .update(whatsappMessagesTable)
        .set({ aiProcessed: true, detectedIntent: "general_inquiry" })
        .where(eq(whatsappMessagesTable.id, savedMsgId))
        .catch((e) => logger.warn({ e }, "closing: failed to mark aiProcessed"));
      return;
    }

    // ── Step 0a-pre2: Cancellation gate — "batal", "tidak jadi", "cancel", dll.
    // Harus dicek SEBELUM AI detection agar tidak jatuh ke fallback generic.
    // Jika ada active session: cancel session lalu balas. Jika tidak ada: balas langsung.
    if (isCancellation(bodyText)) {
      logger.info({ from, msg: bodyText }, "Cancellation phrase detected — cancelling session & sending ack");
      try {
        await db
          .update(intakeSessionsTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(
            and(
              eq(intakeSessionsTable.phone, from),
              eq(intakeSessionsTable.companyId, companyId),
              inArray(intakeSessionsTable.status, ["collecting", "ready_for_task"]),
            ),
          );
      } catch (e) {
        logger.warn({ e }, "cancellation: failed to cancel active sessions");
      }
      const cancelReply = `Baik, permintaan Anda telah dibatalkan. 🙏 Jika ada kebutuhan lain, silakan hubungi kami kembali ya.`;
      await sendFonnte(replyTo, cancelReply, fonnteDevice).catch((e) =>
        logger.warn({ e }, "cancellation: failed to send ack reply"),
      );
      await db
        .update(whatsappMessagesTable)
        .set({ aiProcessed: true, detectedIntent: "cancellation" })
        .where(eq(whatsappMessagesTable.id, savedMsgId))
        .catch((e) => logger.warn({ e }, "cancellation: failed to mark aiProcessed"));
      return;
    }

    // ── Step 0a: Greeting gate — intercept BEFORE any session or AI detection.
    // When user sends a simple greeting, cancel all active sessions and respond
    // directly with a canned message. Do NOT fall through to AI detection,
    // which could re-detect the old intent and create a new stuck session.
    // Greeting always fires — even mid-clarification — so customer can start fresh.
    if (!isAnsweringClarification && isGreeting(bodyText)) {
      logger.info({ from, msg: bodyText }, "Greeting detected — cancelling sessions, sending canned reply, skipping AI");
      try {
        await db
          .update(intakeSessionsTable)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(
            and(
              eq(intakeSessionsTable.phone, from),
              eq(intakeSessionsTable.companyId, companyId),
              inArray(intakeSessionsTable.status, ["collecting", "ready_for_task"]),
            ),
          );
      } catch (resetErr) {
        logger.warn({ resetErr }, "greeting: failed to cancel active sessions");
      }
      const greetingReply =
        `Halo! 👋 Selamat datang, ada yang bisa kami bantu?\n\n` +
        `Silakan ceritakan kebutuhan Anda, misalnya:\n` +
        `1.🚚 Pengiriman / Trucking / Sea & Air Freight\n` +
        `2.📋 Layanan PPJK / Bea Cukai / Customs\n` +
        `3.🏟️ Booking Lapangan Olahraga\n` +
        `4.💰 Kasbon / Pembayaran\n` +
        `5.❓ Pertanyaan lainnya\n` +
        `6.🎨 Layanan Kreatif / Desain AI\n\n` +
        `Tim kami siap membantu! 🙏\n` +
        `atau ketik angka.`;
      await sendFonnte(replyTo, greetingReply, fonnteDevice).catch((e) =>
        logger.warn({ e }, "greeting: failed to send canned reply"),
      );
      await db
        .update(whatsappMessagesTable)
        .set({ aiProcessed: true, detectedIntent: "general_inquiry" })
        .where(eq(whatsappMessagesTable.id, savedMsgId))
        .catch((e) => logger.warn({ e }, "greeting: failed to mark aiProcessed"));
      return;
    }

    // ── Step 0a-price: Price inquiry gate ─────────────────────────────────────
    // "mau tanya harga", "berapa biaya", "info tarif" dll tanpa konteks layanan
    // spesifik → balas menu klarifikasi daripada menjalankan AI pipeline yang
    // akan salah classify ke freight/trucking dan mengirim form yang tidak tepat.
    if (!isAnsweringClarification && !activeSession && isPriceInquiry(bodyText)) {
      logger.info({ from, msg: bodyText }, "Price inquiry (vague) detected — sending clarification menu");
      const priceReply =
        `Halo! Kami siap bantu informasikan harga. 😊\n\n` +
        `Untuk layanan apa yang ingin Anda ketahui harganya?\n\n` +
        `1.🚚 Pengiriman / Trucking / Freight\n` +
        `2.📋 Bea Cukai / Customs / PPJK\n` +
        `3.🏟️ Sewa Lapangan Olahraga\n` +
        `4.🏪 Sewa Kios / Tenant\n` +
        `5.❓ Lainnya — ceritakan kebutuhan Anda\n\n` +
        `Silakan balas dengan nomor atau langsung ceritakan kebutuhan Anda. 🙏`;
      await sendFonnte(replyTo, priceReply, fonnteDevice).catch((e) =>
        logger.warn({ e }, "price-inquiry: failed to send clarification menu"),
      );
      await db
        .update(whatsappMessagesTable)
        .set({ aiProcessed: true, detectedIntent: "price_inquiry_vague" })
        .where(eq(whatsappMessagesTable.id, savedMsgId))
        .catch(() => {});
      return;
    }

    // ── Step 0a-sc-price: Sport Center price inquiry gate ─────────────────────
    // "harga lapangan badminton", "tarif futsal", "berapa harga voli" dll →
    // langsung balas daftar harga tanpa masuk ke booking flow.
    // Gate ini juga aktif saat isAnsweringClarification (user menjawab setelah
    // "pertanyaan lainnya" menu) agar tidak salah masuk ke booking flow.
    if (!activeSession) {
      const scPrice = isSportCenterPriceInquiry(bodyText);
      if (scPrice.match) {
        logger.info({ from, msg: bodyText, fieldType: scPrice.fieldType }, "Sport Center price inquiry detected — sending price list");
        const priceListReply = buildSportCenterPriceListMessage(scPrice.fieldType);
        await sendFonnte(replyTo, priceListReply, fonnteDevice).catch((e) =>
          logger.warn({ e }, "sc-price: failed to send price list"),
        );
        await db
          .update(whatsappMessagesTable)
          .set({ aiProcessed: true, detectedIntent: "sc_price_inquiry" })
          .where(eq(whatsappMessagesTable.id, savedMsgId))
          .catch(() => {});
        return;
      }

      if (isTenantPriceInquiry(bodyText)) {
        logger.info({ from, msg: bodyText }, "Tenant price inquiry detected — sending tenant price info");
        const tenantReply = buildTenantPriceMessage();
        await sendFonnte(replyTo, tenantReply, fonnteDevice).catch((e) =>
          logger.warn({ e }, "tenant-price: failed to send price info"),
        );
        await db
          .update(whatsappMessagesTable)
          .set({ aiProcessed: true, detectedIntent: "tenant_price_inquiry" })
          .where(eq(whatsappMessagesTable.id, savedMsgId))
          .catch(() => {});
        // Simpan sesi minimal agar "Hubungi Agent" (opsi 10) diarahkan ke divisi Tenant,
        // bukan ke divisi terakhir yang aktif (misal PPJK).
        await db
          .insert(intakeSessionsTable)
          .values({
            phone: from,
            companyId,
            intentCode: "info_sewa_tenant",
            intentName: "Informasi Harga Sewa Tenant",
            category: "Tenant",
            status: "form_sent",
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 jam
          })
          .catch((e) => logger.warn({ e }, "tenant-price: gagal simpan sesi routing"));
        return;
      }

    }

    // ── Step 0a-general: General inquiry gate ("pertanyaan lainnya" / digit 5) ──
    // Intercept BEFORE the AI pipeline. Instead of creating a task immediately,
    // ask a clarification question so the customer can specify their topic.
    // The NEXT message will then be routed to the correct notification recipient
    // (PPJK, Trucking, Lapangan Olahraga, Tenant, Bea Cukai, Pengiriman, dll.)
    // by the normal AI intent classification pipeline.
    //
    // NOTE: `!activeSession` intentionally removed — we also need to intercept when
    // a stale "ready_for_task" session exists from the same phone (e.g. the previous
    // "pertanyaan lainnya" that slipped through to the AI pipeline and left a session).
    const _isDigit5 = bodyText.trim() === "5";
    const _isGenInquiry = isGeneralInquiry(bodyText);
    logger.info(
      { from, bodyText, bodyLen: bodyText.length, isAnsweringClarification, _isDigit5, _isGenInquiry },
      "general-inquiry-gate: evaluating",
    );
    if (!isAnsweringClarification && (_isDigit5 || _isGenInquiry)) {
      logger.info({ from, msg: bodyText }, "General inquiry detected — cancelling any stale session, asking clarification question");
      // Cancel any lingering session so it doesn't interfere with the clarification flow
      await db
        .update(intakeSessionsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(intakeSessionsTable.phone, from),
            eq(intakeSessionsTable.companyId, companyId),
            inArray(intakeSessionsTable.status, ["collecting", "ready_for_task"]),
          ),
        )
        .catch((e) => logger.warn({ e }, "general-inquiry: failed to cancel stale sessions"));

      const clarificationReply =
        `Boleh saya tau apa yang ingin ditanyakan? 😊\n\n` +
        `Kami siap bantu untuk pertanyaan seputar:\n` +
        `• 🚚 Pengiriman / Trucking / Freight\n` +
        `• 📋 PPJK / Bea Cukai / Customs\n` +
        `• 🏟️ Harga Lapangan (Badminton, Futsal, Voli, Basketball, Tenis)\n` +
        `• 🏋️ GYM / Fitness\n` +
        `• 🎱 Billiard (Self-Service)\n` +
        `• 🏪 Tenant / Sewa Kios\n` +
        `• 📦 Layanan lainnya\n\n` +
        `Silakan ceritakan kebutuhan Anda. 🙏`;
      await sendFonnte(replyTo, clarificationReply, fonnteDevice).catch((e) =>
        logger.warn({ e }, "general-inquiry: failed to send clarification question"),
      );
      generalInquiryPending.add(from);
      await db
        .update(whatsappMessagesTable)
        .set({ aiProcessed: true, detectedIntent: "general_inquiry_pending" })
        .where(eq(whatsappMessagesTable.id, savedMsgId))
        .catch(() => {});
      return;
    }

    // ── Step 0a-menu: Menu digit selection gate ─────────────────────────────────
    // When user replies with a single digit referencing the greeting menu
    // (and there is no active intake session), translate the digit to a full
    // intent phrase so the AI pipeline detects the correct intent and creates
    // an intake session. Also applies when answering the "pertanyaan lainnya"
    // clarification so digits 1-4 are correctly routed to their services.
    // NOTE: Digit "5" is intercepted by the general inquiry gate above.
    // NOTE: Digit "6" is intercepted here and redirected directly to Sales AI.
    if (messageType === "text") {
      const menuKey = bodyText.trim();
      const isMenuEligible = !activeSession || isAnsweringClarification;

      // ── Digit "6" → Sales AI redirect (no task, no intake session) ────────
      if (isMenuEligible && menuKey === "6") {
        logger.info({ from }, "Menu digit 6 — redirecting to Sales AI");
        const salesAiReply = buildSalesAiMessage();
        await sendFonnte(replyTo, salesAiReply, fonnteDevice).catch((e) =>
          logger.warn({ e }, "creative-gate: failed to send Sales AI redirect reply"),
        );
        await db
          .update(whatsappMessagesTable)
          .set({ aiProcessed: true, detectedIntent: "sales_ai_redirect" })
          .where(eq(whatsappMessagesTable.id, savedMsgId))
          .catch(() => {});
        return;
      }

      const menuExpand: Record<string, string> = {
        "1": "saya butuh layanan pengiriman trucking sea air freight logistik",
        "2": "saya butuh layanan PPJK bea cukai customs kepabeanan",
        "3": "saya mau booking lapangan olahraga futsal badminton",
        "4": "saya butuh kasbon pembayaran uang muka",
      };
      const expanded = isMenuEligible ? menuExpand[menuKey] : undefined;
      if (expanded) {
        logger.info({ from, digit: menuKey }, "Menu digit detected — expanding to full intent text for AI pipeline");
        // eslint-disable-next-line no-param-reassign
        bodyText = expanded;
      }
    }

    // ── Step 0a-creative: Creative / Sales AI gate (free-text) ─────────────────
    // Catches free-text creative requests ("mau buat logo", "minta desain brand",
    // "bikin company profile", dll) BEFORE the AI pipeline runs a full intent
    // detection and creates a task. AI Task Center tidak mengerjakan kreatif
    // sendiri — redirect ke Sales AI.
    if (!isAnsweringClarification && !activeSession && isCreativeServiceRequest(bodyText)) {
      logger.info({ from, msg: bodyText }, "Creative service request detected — redirecting to Sales AI");
      const salesAiReply = buildSalesAiMessage();
      await sendFonnte(replyTo, salesAiReply, fonnteDevice).catch((e) =>
        logger.warn({ e }, "creative-gate: failed to send Sales AI redirect reply"),
      );
      await db
        .update(whatsappMessagesTable)
        .set({ aiProcessed: true, detectedIntent: "sales_ai_redirect" })
        .where(eq(whatsappMessagesTable.id, savedMsgId))
        .catch(() => {});
      return;
    }

    // ── Step 0b: Check for active intake session ───────────────────────────────
    // If customer is mid-conversation collecting data, continue that session
    // instead of detecting a new intent.
    if (activeSession) {
      logger.info(
        { msgId: savedMsgId, sessionId: activeSession.id, intent: activeSession.intentCode, status: activeSession.status },
        "Active intake session found — continuing data collection",
      );

      // ── Wrap entire active-session processing so errors NEVER fall through ──
      // to the "no active session" new-intent flow, which would cause looping.
      try {
        // Handle image attachment upload within intake session
        const effectiveAttachmentUrl = attachmentUrl ?? null;

        // For image/sticker in intake session → treat as document upload
        let effectiveText = bodyText;
        if ((messageType === "image" || messageType === "document") && effectiveAttachmentUrl) {
          effectiveText = bodyText.startsWith("[") ? `[Dokumen dikirim]` : bodyText;

          // Sprint 9C: validate document in background, send WA reply for validation status
          const fileNameFromUrl = effectiveAttachmentUrl.split("/").pop()?.split("?")[0] ?? `doc_${Date.now()}`;
          const docType = resolveDocumentType(
            messageType === "image" ? "image" : undefined,
            fileNameFromUrl,
          );
          validateDocument({
            companyId,
            documentType: docType,
            fileName: fileNameFromUrl,
            fileUrl: effectiveAttachmentUrl,
            intakeSessionId: activeSession.id,
          }).then((valResult) => {
            sendFonnte(replyTo, valResult.waReply, fonnteDevice).catch((e) =>
              logger.warn({ e }, "intake: failed to send document validation WA reply"),
            );
            logger.info(
              { sessionId: activeSession.id, docType, status: valResult.validationStatus },
              "Sprint 9C: document validated in intake session",
            );
          }).catch((err) => logger.warn({ err }, "Sprint 9C: document validation failed (intake)"));
        }

        // ── Price inquiry escape hatch ─────────────────────────────────────
        // If customer is in a booking session but EXPLICITLY asks about price
        // (e.g. "maksud saya harga lapangan tenis", "kalau lapangan tenis?"),
        // cancel the booking session and show the price list instead.
        // This prevents the "Pilih lapangan" loop when user just wants pricing.
        if (isSportCenterBookingIntent(activeSession.intentCode)) {
          const scPrice = isSportCenterPriceInquiry(effectiveText);
          if (scPrice.match) {
            logger.info(
              { from, sessionId: activeSession.id, msg: effectiveText, fieldType: scPrice.fieldType },
              "Price inquiry detected inside active booking session — cancelling session, sending price list",
            );
            // Cancel the booking session
            await db
              .update(intakeSessionsTable)
              .set({ status: "cancelled", updatedAt: new Date() })
              .where(eq(intakeSessionsTable.id, activeSession.id))
              .catch((e) => logger.warn({ e }, "price-escape: failed to cancel session"));

            const priceListReply = buildSportCenterPriceListMessage(scPrice.fieldType);
            await sendFonnte(replyTo, priceListReply, fonnteDevice).catch((e) =>
              logger.warn({ e }, "price-escape: failed to send price list"),
            );
            await db
              .update(whatsappMessagesTable)
              .set({ aiProcessed: true, detectedIntent: "sc_price_inquiry_escape" })
              .where(eq(whatsappMessagesTable.id, savedMsgId))
              .catch(() => {});
            return;
          }
        }

        const intakeResult = await processIntakeMessage({
          session: activeSession,
          message: effectiveText,
          attachmentUrl: effectiveAttachmentUrl,
          companyId,
          fonnteDevice,
        });

        logger.info(
          { sessionId: activeSession.id, action: intakeResult.action, collected: Object.keys(intakeResult.collectedFields), missing: intakeResult.missingFields },
          "IntakeEngine processIntakeMessage result",
        );

        // Always send reply to customer.
        // If preReply is set (e.g. "please wait while we check availability"),
        // send it first, then send the main reply.
        if (intakeResult.preReply) {
          await sendFonnte(replyTo, intakeResult.preReply, fonnteDevice).catch((e) =>
            logger.warn({ e }, "intake: failed to send preReply via Fonnte"),
          );
        }
        if (intakeResult.replyToUser) {
          await sendFonnte(replyTo, intakeResult.replyToUser, fonnteDevice).catch((e) =>
            logger.warn({ e }, "intake: failed to send reply via Fonnte"),
          );
        }

        await db
          .update(whatsappMessagesTable)
          .set({ aiProcessed: true, detectedIntent: `intake:${activeSession.intentCode}` })
          .where(eq(whatsappMessagesTable.id, savedMsgId))
          .catch((e) => logger.warn({ e }, "intake: failed to mark message aiProcessed"));

        if (intakeResult.action === "send_form") {
          // Hybrid mode: conversation complete, now send the form
          const formType = intakeResult.formType!;
          const token = generateSecureToken();
          const domains = process.env.REPLIT_DOMAINS ?? "";
          const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "";
          const baseUrl = domains ? `https://${domains.split(",")[0]?.trim()}` : devDomain ? `https://${devDomain}` : "http://localhost:5000";
          const formUrl = `${baseUrl}/mini-form/${formType}/${token}`;

          // Store form token on session
          await db.update(intakeSessionsTable)
            .set({ formToken: token, formSentAt: new Date(), updatedAt: new Date() })
            .where(eq(intakeSessionsTable.id, intakeResult.session.id))
            .catch(e => logger.warn({ e }, "hybrid: failed to store formToken on session"));

          // Build and send WA message with form link
          const formCfg = getFormConfig(formType);
          const waTemplate = formCfg?.waMessageTemplate ??
            "Terima kasih! Data Anda sudah lengkap. Silakan konfirmasi melalui form berikut:\n\n{mini_form_url}\n\nTim kami akan segera menindaklanjuti. 🙏";
          const waMsg =
            waTemplate.replace("{mini_form_url}", formUrl) +
            `\nSilakan pilih tindakan berikutnya dari menu di bawah.`;

          await sendFormMenu(replyTo, waMsg, companyId, fonnteDevice).catch(e =>
            logger.warn({ e, from }, "hybrid: failed to send form link via Fonnte"),
          );

          await createAdminNotification({
            type: "new_inquiry",
            title: `📋 Hybrid Form Dikirim: ${activeSession.intentCode}`,
            body: `${effectiveName ?? from} selesai tanya-jawab. Form ${formType} telah dikirim untuk konfirmasi.`,
            customerPhone: from,
            customerName: effectiveName,
            companyId,
          });

          logger.info({ sessionId: activeSession.id, formType, formUrl }, "Hybrid: form link sent after conversation");

        } else if (intakeResult.action === "ready_for_task") {
          // All data collected — create the task now
          logger.info({ sessionId: activeSession.id, fields: intakeResult.collectedFields }, "Intake complete — creating task");

          try {
            const result = await detectWhatsAppIntent(
              `${activeSession.intentCode} - ${Object.entries(intakeResult.collectedFields).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
              { name: effectiveName, phone: from, companyId, previousIntents: parsedPrevIntents },
              savedMsgId,
            );

            // Inject collected fields into the result context
            const taskOutput = await createTaskFromWhatsAppMessage({
              savedMsgId,
              from,
              senderName,
              bodyText: `[Intake Complete] ${JSON.stringify(intakeResult.collectedFields)}`,
              companyId,
              result,
              resolution: result._resolution,
              collectedFields: intakeResult.collectedFields,
            });

            if (taskOutput) {
              await markIntakeSubmitted(activeSession.id, taskOutput.taskId);
              await updateCustomerContextAfterTask({ phone: from, companyId, taskId: taskOutput.taskId, intent: result.intent, name: effectiveName });
              await createAdminNotification({
                type: "new_inquiry",
                title: `✅ Task Baru dari Intake: ${result.intent}`,
                body: `Data lengkap dari ${effectiveName ?? from}. Task #${taskOutput.taskNumber ?? taskOutput.taskId} telah dibuat.`,
                customerPhone: from,
                customerName: effectiveName,
                companyId,
              });
              logger.info({ taskId: taskOutput.taskId, sessionId: activeSession.id }, "Task created from completed intake");
            } else {
              // Task creation returned null — mark session submitted anyway to prevent re-processing
              await markIntakeSubmitted(activeSession.id, 0).catch(() => {});
              logger.warn({ sessionId: activeSession.id }, "Intake: createTask returned null — session marked submitted to prevent loop");
            }
          } catch (taskErr) {
            // Task creation failed (e.g. ai_tasks table missing) — mark session submitted to prevent loop
            logger.error({ taskErr, sessionId: activeSession.id }, "Intake: task creation failed — marking session submitted to prevent re-processing loop");
            await markIntakeSubmitted(activeSession.id, 0).catch(() => {});
            await createAdminNotification({
              type: "waiting_review",
              title: "Error Membuat Task dari Intake",
              body: `Data intake dari ${effectiveName ?? from} sudah lengkap tetapi task gagal dibuat. Perlu review manual.`,
              customerPhone: from,
              customerName: effectiveName,
              companyId,
            }).catch(() => {});
          }
        } else if (intakeResult.action === "cancelled") {
          logger.info({ sessionId: activeSession.id }, "Intake session cancelled by user");
        }
      } catch (sessionErr) {
        // processIntakeMessage or other session processing failed
        // Send a recovery message to the user — do NOT fall through to new-intent flow
        logger.error(
          { sessionErr, sessionId: activeSession.id, from },
          "Active intake session processing error — sending recovery reply",
        );
        await sendFonnte(
          replyTo,
          "Maaf, ada gangguan sementara. Mohon ulangi pesan terakhir Anda. Tim kami siap membantu! 🙏",
          fonnteDevice,
        ).catch(() => {});
      }

      return;
    }

    // ── No active session: normal flow ────────────────────────────────────────

    // Voice notes: transcribe with OpenAI Whisper, then run full AI detection
    if (messageType === "audio") {
      logger.info({ msgId: savedMsgId, hasMediaId: !!mediaId, hasUrl: !!attachmentUrl }, "Voice note received — attempting Whisper transcription");

      let transcript: string | null = null;

      if (mediaId) {
        const media = await downloadWhatsAppMedia(mediaId);
        if (media) {
          transcript = await transcribeAudio(media.buffer, media.filename, media.mimeType);
        }
      } else if (attachmentUrl) {
        try {
          const res = await fetch(attachmentUrl);
          if (res.ok) {
            const buffer = Buffer.from(await res.arrayBuffer());
            transcript = await transcribeAudio(buffer, `voice_${Date.now()}.ogg`, "audio/ogg");
          }
        } catch (dlErr) {
          logger.error({ dlErr, attachmentUrl }, "Failed to download audio from direct URL");
        }
      }

      if (transcript) {
        logger.info({ msgId: savedMsgId, chars: transcript.length }, "Voice note transcribed — running intent detection");

        await db
          .update(whatsappMessagesTable)
          .set({ body: `[Voice Note] ${transcript}`, messageText: transcript })
          .where(eq(whatsappMessagesTable.id, savedMsgId));

        const result = await detectWhatsAppIntent(transcript, {
          name: effectiveName,
          phone: from,
          companyId,
          previousIntents: parsedPrevIntents,
        }, savedMsgId);

        // Start intake session if fields are missing
        const hasMissingFields = (result.missing_data?.length ?? 0) > 0;
        if (hasMissingFields && result._resolution) {
          const intakeResult = await startIntakeSession({
            phone: from,
            companyId,
            message: transcript,
            resolution: result._resolution,
          });

          if (intakeResult.replyToUser) {
            await sendFonnte(replyTo, intakeResult.replyToUser, fonnteDevice).catch((e) =>
              logger.warn({ e }, "Failed to send intake reply via Fonnte"),
            );
          }

          await db
            .update(whatsappMessagesTable)
            .set({ aiProcessed: true, detectedIntent: `intake_started:${result.intent}` })
            .where(eq(whatsappMessagesTable.id, savedMsgId));

          if (intakeResult.action === "ready_for_task") {
            const taskOutput = await createTaskFromWhatsAppMessage({ savedMsgId, from, senderName, bodyText: transcript, companyId, result, resolution: result._resolution });
            if (taskOutput) {
              await markIntakeSubmitted(intakeResult.session.id, taskOutput.taskId);
              await updateCustomerContextAfterTask({ phone: from, companyId, taskId: taskOutput.taskId, intent: result.intent, name: effectiveName });
              await _notifyForTask({ taskOutput, result, from, replyTo, effectiveName, companyId, suggestedReply: null, fonnteDevice });
            }
          } else {
            await createAdminNotification({
              type: "new_inquiry",
              title: `📋 Intake Dimulai: ${result.intent}`,
              body: `${effectiveName ?? from} mulai mengisi data untuk ${result.category}. Menunggu ${result.missing_data?.length ?? 0} field lagi.`,
              customerPhone: from,
              customerName: effectiveName,
              companyId,
            });
          }
        } else {
          const taskOutput = await createTaskFromWhatsAppMessage({ savedMsgId, from, senderName, bodyText: transcript, companyId, result, resolution: result._resolution });
          if (taskOutput) {
            await updateCustomerContextAfterTask({ phone: from, companyId, taskId: taskOutput.taskId, intent: result.intent, name: effectiveName });
            await _notifyForTask({ taskOutput, result, from, replyTo, effectiveName, companyId, suggestedReply: result._resolution?.suggestedReply ?? null, fonnteDevice });
          }

          await db
            .update(whatsappMessagesTable)
            .set({ aiProcessed: true, detectedIntent: result.intent })
            .where(eq(whatsappMessagesTable.id, savedMsgId));
        }
      } else {
        logger.warn({ msgId: savedMsgId }, "Voice note transcription failed — marking as voice_note");
        await db
          .update(whatsappMessagesTable)
          .set({ aiProcessed: true, detectedIntent: "voice_note" })
          .where(eq(whatsappMessagesTable.id, savedMsgId));
        await createAdminNotification({
          type: "waiting_review",
          title: "Voice Note Perlu Review Manual",
          body: `Voice note dari ${effectiveName ?? from} tidak bisa ditranskrip. Perlu review manual.`,
          customerPhone: from,
          customerName: effectiveName,
          companyId,
        });
      }
      return;
    }

    // Non-text attachments without caption: validate document then flag
    if ((messageType === "image" || messageType === "sticker" || messageType === "document") && bodyText.startsWith("[")) {
      logger.info({ msgId: savedMsgId }, "Image/document without text — validating and flagging as attachment_submission");
      await db
        .update(whatsappMessagesTable)
        .set({ aiProcessed: true, detectedIntent: "attachment_submission" })
        .where(eq(whatsappMessagesTable.id, savedMsgId));

      // Sprint 9C: validate the document and reply
      if (attachmentUrl) {
        const fileNameFromUrl2 = attachmentUrl.split("/").pop()?.split("?")[0] ?? `doc_${Date.now()}`;
        const docType = resolveDocumentType(
          messageType === "image" || messageType === "sticker" ? "image" : undefined,
          fileNameFromUrl2,
        );
        validateDocument({
          companyId,
          documentType: docType,
          fileName: fileNameFromUrl2,
          fileUrl: attachmentUrl,
        }).then((valResult) => {
          sendFonnte(replyTo, valResult.waReply, fonnteDevice).catch((e) =>
            logger.warn({ e }, "WA: failed to send document validation reply"),
          );
          logger.info(
            { docType, status: valResult.validationStatus, from },
            "Sprint 9C: standalone document validated",
          );
        }).catch((err) => logger.warn({ err }, "Sprint 9C: document validation failed (standalone)"));
      }

      await createAdminNotification({
        type: "document_uploaded",
        title: "Dokumen Diterima",
        body: `${effectiveName ?? from} mengirimkan gambar/dokumen via WhatsApp.`,
        customerPhone: from,
        customerName: effectiveName,
        companyId,
      });
      return;
    }

    // Run full structured AI analysis
    const result = await detectWhatsAppIntent(bodyText, {
      name: effectiveName,
      phone: from,
      companyId,
      previousIntents: parsedPrevIntents,
    }, savedMsgId);

    // ── Sport Center booking: ALWAYS conversation-first (never send form immediately) ──
    // Even if hasMissingFields=false or intake_mode="mini_form" in DB, we must:
    //   1. Ask: lapangan apa, tanggal berapa, jam berapa?
    //   2. Check availability via sport-center-availability gate
    //   3. Show slot result + ask user to confirm with "ya"
    //   4. Ask booker name + phone
    //   5. THEN send the mini-form link
    const isGenInquiryIntent = result.intent === "general_inquiry";
    if (!isGenInquiryIntent && result._resolution && isSportCenterBookingIntent(result.intent)) {
      logger.info({ from, intent: result.intent }, "Sport Center booking detected — forcing conversation-first flow");

      // Safety guard: re-check for an active session here. The initial check at
      // Step 0 (line ~559) might have returned null due to a race condition or
      // transient DB error. If a session now exists, route the message through
      // it instead of creating a new one (which would cancel the old session).
      const existingSessionGuard = await findActiveIntakeSession(from, companyId).catch(() => null);
      if (existingSessionGuard) {
        logger.info(
          { from, sessionId: existingSessionGuard.id },
          "Sport Center path: active session found on re-check — routing to processIntakeMessage instead",
        );
        const guardResult = await processIntakeMessage({
          session: existingSessionGuard,
          message: bodyText,
          attachmentUrl: attachmentUrl ?? undefined,
          companyId,
          fonnteDevice,
        }).catch((err) => {
          logger.error({ err, from }, "Sport Center guard: processIntakeMessage failed");
          return null;
        });
        if (guardResult?.preReply) {
          await sendFonnte(replyTo, guardResult.preReply, fonnteDevice).catch(() => {});
        }
        if (guardResult?.replyToUser) {
          await sendFonnte(replyTo, guardResult.replyToUser, fonnteDevice).catch(() => {});
        }
        await db
          .update(whatsappMessagesTable)
          .set({ aiProcessed: true, detectedIntent: `intake:${existingSessionGuard.intentCode}` })
          .where(eq(whatsappMessagesTable.id, savedMsgId))
          .catch(() => {});
        return;
      }

      let scIntakeResult;
      try {
        scIntakeResult = await startIntakeSession({
          phone: from,
          companyId,
          message: bodyText,
          attachmentUrl: attachmentUrl ?? undefined,
          resolution: result._resolution,
          miniFormType: "field-booking",
        });
      } catch (scErr) {
        logger.error({ scErr, from }, "Sport Center: startIntakeSession failed — sending fallback question");
        await sendFonnte(
          replyTo,
          `🏟️ Mau booking lapangan olahraga ya!\n\nLapangan apa yang ingin Anda booking, dan tanggal serta jam berapa? 😊\n\n_(Contoh: "Badminton, 5 Juli jam 10:00")_`,
          fonnteDevice,
        ).catch(() => {});
        return;
      }

      const scReply = scIntakeResult.replyToUser ||
        `🏟️ Mau booking lapangan olahraga ya!\n\nLapangan apa yang ingin Anda booking, dan tanggal serta jam berapa? 😊\n\n_(Contoh: "Badminton, 5 Juli jam 10:00")_`;

      await sendFonnte(replyTo, scReply, fonnteDevice).catch((e) =>
        logger.warn({ e }, "sport-center intake: failed to send opening question"),
      );

      await db
        .update(whatsappMessagesTable)
        .set({ aiProcessed: true, detectedIntent: `intake_started:${result.intent}` })
        .where(eq(whatsappMessagesTable.id, savedMsgId))
        .catch(() => {});

      await createAdminNotification({
        type: "new_inquiry",
        title: `🏟️ Sport Center Intake: ${result.intent}`,
        body: `${effectiveName ?? from} mulai booking lapangan. Menunggu detail lapangan, tanggal, dan jam.`,
        customerPhone: from,
        customerName: effectiveName,
        companyId,
      }).catch(() => {});

      return;
    }

    // ── Intake gate: start session if required fields are missing ──────────────
    const hasMissingFields = (result.missing_data?.length ?? 0) > 0;

    if (hasMissingFields && !isGenInquiryIntent && result._resolution) {
      logger.info(
        { intent: result.intent, missing: result.missing_data?.length },
        "Missing fields detected — checking intake flow mode",
      );

      // ── Sprint 9B: Route to correct flow (conversation / hybrid / mini_form) ─
      // deferFormSend=true: hybrid mode will NOT send form immediately.
      // Instead we start conversation first and send form when fields are complete.
      const route = await routeIntentToFlow({
        phone: from,
        companyId,
        intentCode: result.intent,
        intentName: result._resolution?.intentName ?? result.intent,
        category: result.category ?? null,
        resolution: result._resolution,
        collectedFields: {},
        missingFields: result.missing_data ?? [],
        requiredDocuments: [],
        fonnteDevice,
        deferFormSend: true,
      });

      if (route.flow === "mini_form") {
        // mini_form: form link already sent immediately by routeIntentToFlow
        if (!route.waSent) {
          const fallbackReply =
            result._resolution?.suggestedReply ??
            `Halo! Kami menerima permintaan Anda untuk ${result.category ?? result.intent}. ` +
            `Tim kami sedang memproses dan akan segera menghubungi Anda. Ada yang bisa kami bantu lagi?`;
          await sendFonnte(replyTo, fallbackReply, fonnteDevice).catch((e) =>
            logger.warn({ e, from }, "fallback reply failed after mini-form send error"),
          );
        }
        await db
          .update(whatsappMessagesTable)
          .set({ aiProcessed: true, detectedIntent: `mini_form_sent:${result.intent}` })
          .where(eq(whatsappMessagesTable.id, savedMsgId));
        await createAdminNotification({
          type: "new_inquiry",
          title: `📋 Mini Form Dikirim: ${result.intent}`,
          body: `${effectiveName ?? from} diminta mengisi form untuk ${result.category ?? result.intent}.`,
          customerPhone: from,
          customerName: effectiveName,
          companyId,
        });
        return;
      }

      // ── "hybrid" or "conversation": start intake (ask questions first) ────────
      // For hybrid: miniFormType is passed so engine sends form when fields complete
      const hybridFormType = route.flow === "hybrid" ? (route.formType ?? null) : null;
      if (hybridFormType) {
        logger.info({ from, intentCode: result.intent, hybridFormType }, "Hybrid mode: starting conversation first, form deferred");
      }

      let intakeResult;
      try {
        intakeResult = await startIntakeSession({
          phone: from,
          companyId,
          message: bodyText,
          attachmentUrl: attachmentUrl ?? undefined,
          resolution: result._resolution,
          miniFormType: hybridFormType,
        });
      } catch (intakeErr) {
        logger.error({ intakeErr, from, intent: result.intent }, "startIntakeSession failed — sending fallback reply");
        const fallbackReply =
          result._resolution?.suggestedReply ??
          `Halo! Kami menerima permintaan Anda mengenai ${result.category ?? result.intent}. ` +
          `Tim kami akan segera menindaklanjuti. Ada yang bisa kami bantu lebih lanjut?`;
        await sendFonnte(replyTo, fallbackReply, fonnteDevice).catch(() => {});
        return;
      }

      // Send question to customer
      if (intakeResult.replyToUser) {
        await sendFonnte(replyTo, intakeResult.replyToUser, fonnteDevice).catch((e) =>
          logger.warn({ e }, "Failed to send intake question via Fonnte"),
        );
      } else {
        // replyToUser is null/empty — send fallback so customer is not left hanging
        const fallbackReply =
          result._resolution?.suggestedReply ??
          `Halo! Kami menerima permintaan Anda mengenai ${result.category ?? result.intent}. ` +
          `Tim kami akan segera menindaklanjuti. Ada yang bisa kami bantu lebih lanjut?`;
        await sendFonnte(replyTo, fallbackReply, fonnteDevice).catch(() => {});
      }

      await db
        .update(whatsappMessagesTable)
        .set({ aiProcessed: true, detectedIntent: `intake_started:${result.intent}` })
        .where(eq(whatsappMessagesTable.id, savedMsgId));

      // If intake immediately ready (no template fields), create task
      if (intakeResult.action === "ready_for_task") {
        const taskOutput = await createTaskFromWhatsAppMessage({
          savedMsgId, from, senderName, bodyText, companyId, result, resolution: result._resolution,
        });
        if (taskOutput) {
          await markIntakeSubmitted(intakeResult.session.id, taskOutput.taskId);
          await updateCustomerContextAfterTask({ phone: from, companyId, taskId: taskOutput.taskId, intent: result.intent, name: effectiveName });
          await _notifyForTask({ taskOutput, result, from, replyTo, effectiveName, companyId, suggestedReply: null, fonnteDevice });
        }
      } else {
        // Notify admin: intake started, no task yet
        await createAdminNotification({
          type: "new_inquiry",
          title: `📋 Intake Dimulai: ${result.intent}`,
          body: `${effectiveName ?? from} mulai mengisi data untuk ${result.category}. Menunggu ${result.missing_data?.length ?? 0} field lagi.`,
          customerPhone: from,
          customerName: effectiveName,
          companyId,
        });
      }

      return;
    }

    // ── No missing fields OR general inquiry: create task immediately ─────────
    const taskOutput = await createTaskFromWhatsAppMessage({
      savedMsgId,
      from,
      senderName,
      bodyText,
      companyId,
      result,
      resolution: result._resolution,
    });

    if (taskOutput) {
      logger.info(
        {
          action: taskOutput.action,
          taskId: taskOutput.taskId,
          taskNumber: taskOutput.taskNumber,
          title: taskOutput.title,
          status: taskOutput.status,
          category: result.category,
          priority: result.priority,
        },
        taskOutput.action === "created"
          ? "New AI task created from WhatsApp message"
          : "WhatsApp message appended to existing task",
      );

      await updateCustomerContextAfterTask({ phone: from, companyId, taskId: taskOutput.taskId, intent: result.intent, name: effectiveName });

      // Admin notification based on priority / task action
      // Use _resolution.suggestedReply (enriched by intent-engine) first, fallback to raw AI reply
      const bestSuggestedReply = result._resolution?.suggestedReply ?? result.suggested_reply ?? null;
      await _notifyForTask({ taskOutput, result, from, replyTo, effectiveName, companyId, suggestedReply: bestSuggestedReply, fonnteDevice });

    } else {
      await createAdminNotification({
        type: "waiting_review",
        title: "Pesan Perlu Review Manual",
        body: `AI tidak bisa membuat task untuk pesan dari ${effectiveName ?? from}. Perlu review manual.`,
        customerPhone: from,
        customerName: effectiveName,
        companyId,
      });
    }
  } catch (err) {
    logger.error({ err, msgId: savedMsgId }, "AI detection failed for message");
    // Always reply to customer — never leave them hanging
    await sendFonnte(
      replyTo,
      "Terima kasih atas pesan Anda! Tim kami sedang memproses dan akan segera menghubungi Anda. 🙏",
      fonnteDevice,
    ).catch(() => {});
    try {
      await createAdminNotification({
        type: "waiting_review",
        title: "Error Pemrosesan AI",
        body: `Terjadi error saat memproses pesan dari ${effectiveName ?? from}. Pesan tetap tersimpan, perlu review manual.`,
        customerPhone: from,
        customerName: effectiveName,
        companyId,
      });
    } catch (_) { /* ignore secondary failure */ }
  }
}

/** Create the right admin notification depending on the task outcome. */
async function _notifyForTask({
  taskOutput,
  result,
  from,
  replyTo,
  effectiveName,
  companyId,
  suggestedReply,
  fonnteDevice,
}: {
  taskOutput: { action: string; taskId: number; title: string; taskNumber: string | null };
  result: { priority: string; category: string };
  from: string;
  /** Target untuk sendFonnte — group JID jika pesan dari grup, else sama dengan from */
  replyTo: string;
  effectiveName: string | null;
  companyId: string;
  suggestedReply?: string | null;
  fonnteDevice?: string | null;
}) {
  const customerLabel = effectiveName ?? from;
  const taskLabel = taskOutput.taskNumber ? `[${taskOutput.taskNumber}]` : "";

  if (result.priority === "High" && taskOutput.action === "created") {
    // WA reply to customer already sent by notifyTaskCreated (includes suggestedReply via templateTaskCreated)
    await createAdminNotification({
      type: "high_priority_task",
      title: `Task Prioritas Tinggi ${taskLabel}`,
      body: `Task baru prioritas TINGGI dari ${customerLabel}: "${taskOutput.title}". Segera ditangani.`,
      taskId: taskOutput.taskId,
      customerPhone: from,
      customerName: effectiveName,
      companyId,
    });
  } else if (taskOutput.action === "created") {
    // WA reply to customer already sent by notifyTaskCreated (includes suggestedReply via templateTaskCreated)
    await createAdminNotification({
      type: "new_inquiry",
      title: `Task Baru ${taskLabel}`,
      body: `Task "${taskOutput.title}" dibuat untuk ${customerLabel} (${result.category}).`,
      taskId: taskOutput.taskId,
      customerPhone: from,
      customerName: effectiveName,
      companyId,
    });
  } else if (taskOutput.action === "appended") {
    // Pesan lanjutan — gunakan AI suggestedReply jika ada, kalau tidak pakai ACK singkat
    const replyMsg = suggestedReply?.trim()
      || `Pesan Anda sudah kami catat pada tiket ${taskLabel}. Tim kami akan segera merespons.`;
    try {
      const sent = await sendFonnte(replyTo, replyMsg, fonnteDevice);
      await db.insert(whatsappNotificationsTable).values({
        taskId:            taskOutput.taskId,
        companyId,
        recipientPhone:    from,
        recipientType:     "customer",
        templateName:      "followup_ack",
        messageText:       replyMsg,
        status:            sent.success ? "sent" : "failed",
        externalMessageId: sent.messageId,
        errorMessage:      sent.error,
        sentAt:            sent.success ? new Date() : null,
      }).catch(() => { /* log only */ });
    } catch (err) {
      logger.error({ err, from }, "Gagal kirim balasan pesan lanjutan");
    }
    await createAdminNotification({
      type: "new_inquiry",
      title: `Pesan Lanjutan ${taskLabel}`,
      body: `${customerLabel} mengirim pesan lanjutan untuk task "${taskOutput.title}".`,
      taskId: taskOutput.taskId,
      customerPhone: from,
      customerName: effectiveName,
      companyId,
    });
  }
}

export default router;
