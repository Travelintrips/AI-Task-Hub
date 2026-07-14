import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  whatsappMessagesTable,
  aiTasksTable,
  taskAttachmentsTable,
  auditLogsTable,
  whatsappNotificationsTable,
  intakeSessionsTable,
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
} from "../lib/intake-engine";
import { routeIntentToFlow } from "../lib/mini-form-router";
import { getFormConfig } from "../lib/mini-form-config";
import { generateSecureToken } from "../lib/tokens";
import { isSportCenterBookingIntent } from "../lib/sport-center-availability";

const router: IRouter = Router();

// ─── Per-phone processing queue ─────────────────────────────────────────────────
// Guards against race conditions when two messages from the same customer arrive
// in quick succession: without this, both messages can run runAiDetection
// concurrently, each seeing "no active intake session" (since the first hasn't
// finished creating/saving its session yet), causing duplicate/conflicting
// sessions and confusing or missing replies (e.g. sport center booking flow).
const phoneQueues = new Map<string, Promise<void>>();

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
    // Skip quick=true payloads to prevent infinite response loops.
    const isQuickEcho = rawPayload?.quick === true;
    if (isQuickEcho) {
      logger.debug("Fonnte quick=true echo detected — skipping outgoing message");
      return;
    }

    // Secondary content filter: belt-and-suspenders for any missed echoes
    const rawMessage =
      (rawPayload?.message as string | undefined) ??
      (rawPayload?.pesan as string | undefined) ??
      "";
    if (rawMessage.includes("/mini-form/")) {
      logger.debug({ rawMessage: rawMessage.slice(0, 80) }, "mini-form URL echo detected — skipping");
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

    // ── Step 0a-pre: Closing phrase gate — "terima kasih", "ok", "siap", etc.
    // These are conversation-enders, not new requests. Respond with a simple
    // acknowledgment and return. Do NOT cancel sessions or show the full menu.
    // IMPORTANT: Skip this gate when there is an active intake session — phrases
    // like "ya", "oke", "iya" are intake confirmations (e.g. sport center availability),
    // not conversation-enders.
    if (isClosingPhrase(bodyText) && !activeSession) {
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
    if (isGreeting(bodyText)) {
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
        `5.❓ Pertanyaan lainnya\n\n` +
        `Tim kami siap membantu! 🙏`;
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

    // ── Step 0a-menu: Menu digit selection gate ─────────────────────────────────
    // When user replies with a single digit 1-5 referencing the greeting menu
    // (and there is no active intake session), translate the digit to a full
    // intent phrase so the AI pipeline detects the correct intent and creates
    // an intake session. Do NOT return early here — let the full AI pipeline
    // run so an intake session is started correctly.
    if (!activeSession && messageType === "text") {
      const menuExpand: Record<string, string> = {
        "1": "saya butuh layanan pengiriman trucking sea air freight logistik",
        "2": "saya butuh layanan PPJK bea cukai customs kepabeanan",
        "3": "saya mau booking lapangan olahraga futsal badminton",
        "4": "saya butuh kasbon pembayaran uang muka",
        "5": "saya punya pertanyaan umum informasi lainnya",
      };
      const menuKey = bodyText.trim();
      const expanded = menuExpand[menuKey];
      if (expanded) {
        logger.info({ from, digit: menuKey }, "Menu digit detected — expanding to full intent text for AI pipeline");
        // eslint-disable-next-line no-param-reassign
        bodyText = expanded;
      }
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
          const waMsg = waTemplate.replace("{mini_form_url}", formUrl);

          await sendFonnte(replyTo, waMsg, fonnteDevice).catch(e =>
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
    const isGeneralInquiry = result.intent === "general_inquiry";
    if (!isGeneralInquiry && result._resolution && isSportCenterBookingIntent(result.intent)) {
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

    if (hasMissingFields && !isGeneralInquiry && result._resolution) {
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
