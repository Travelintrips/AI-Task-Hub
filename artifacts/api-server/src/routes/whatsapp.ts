import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  whatsappMessagesTable,
  aiTasksTable,
  taskAttachmentsTable,
  activityTable,
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

const router: IRouter = Router();

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

  const validRecipientTypes = ["customer", "admin", "team"] as const;
  if (!recipientType || !validRecipientTypes.includes(recipientType as typeof validRecipientTypes[number])) {
    res.status(400).json({ error: "Field 'recipientType' must be one of: customer, admin, team" });
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
    recipientType: recipientType as "customer" | "admin" | "team",
    templateName: templateName as TemplateName,
    variables: variables ?? {},
    taskId: taskId ?? null,
    companyId: companyId ?? "default",
  });

  const httpStatus = result.success ? 200 : result.configMissing ? 202 : 500;
  res.status(httpStatus).json(result);
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

  if (type === "text") {
    const textBody = (msg.text as Record<string, unknown> | undefined)?.body as string | undefined;
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

    // Handle generic/3rd-party gateway format
    const from =
      (rawPayload?.from as string | undefined) ??
      (rawPayload?.sender_phone as string | undefined) ??
      (rawPayload?.phone as string | undefined);

    if (from) {
      await processIncomingMessage({
        msg: rawPayload,
        senderName: rawPayload?.sender_name as string | undefined,
        companyId,
        rawPayload,
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
}: {
  msg: Record<string, unknown>;
  senderName: string | undefined;
  companyId: string;
  rawPayload: Record<string, unknown>;
}): Promise<void> {
  const from =
    (msg?.from as string | undefined) ??
    (msg?.sender_phone as string | undefined) ??
    (msg?.phone as string | undefined) ??
    "unknown";

  const timestamp =
    (msg?.timestamp as string | undefined) ??
    Math.floor(Date.now() / 1000).toString();

  const { type: messageType, text: messageText, attachment } = extractMessageContent(msg);

  const bodyText = messageText ?? `[${messageType} message]`;

  try {
    // 1. Save message to database
    const [savedMsg] = await db
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

    logger.info({ msgId: savedMsg.id, from, type: messageType }, "WhatsApp message saved");

    // Emit SSE so messages page updates instantly
    emitSseEvent(
      "new_message",
      { msgId: savedMsg.id, from, senderName: senderName ?? null, type: messageType },
      companyId,
    );

    // 2. Save attachment reference if present
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
      await db.insert(activityTable).values({
        type: "message_received",
        description: `WhatsApp message received from ${senderName ?? from} (${messageType})`,
        entityId: savedMsg.id,
      });
    } catch (actErr) {
      logger.error({ actErr }, "Failed to log activity for incoming message");
    }

    // 4. Look up customer context (non-blocking)
    const customerCtx = await getOrCreateCustomerContext({ phone: from, companyId, name: senderName });

    // 5. Create admin notification for new WhatsApp inquiry
    await createAdminNotification({
      type: "new_inquiry",
      title: "Pesan WhatsApp Baru",
      body: `Pesan dari ${senderName ?? from}: "${bodyText.slice(0, 100)}${bodyText.length > 100 ? "…" : ""}"`,
      customerPhone: from,
      customerName: senderName ?? customerCtx?.name ?? null,
      companyId,
    });

    // 6. Trigger AI detection (non-blocking — errors are caught)
    setImmediate(() => {
      runAiDetection({
        savedMsgId: savedMsg.id,
        from,
        senderName,
        bodyText,
        messageType,
        companyId,
        attachmentUrl: attachment?.url ?? null,
        mediaId: attachment?.mediaId ?? null,
        customerCtxName: customerCtx?.name ?? senderName ?? null,
        previousIntents: customerCtx?.previousIntents ?? null,
      }).catch((err) => {
        logger.error({ err, msgId: savedMsg.id }, "AI detection background task failed");
      });
    });
  } catch (err) {
    logger.error({ err, from, companyId }, "Failed to save WhatsApp message");
  }
}

async function runAiDetection({
  savedMsgId,
  from,
  senderName,
  bodyText,
  messageType,
  companyId,
  attachmentUrl,
  mediaId,
  customerCtxName,
  previousIntents,
}: {
  savedMsgId: number;
  from: string;
  senderName: string | undefined;
  bodyText: string;
  messageType: string;
  companyId: string;
  attachmentUrl?: string | null;
  mediaId?: string | null;
  customerCtxName?: string | null;
  previousIntents?: string | null;
}): Promise<void> {
  const effectiveName = senderName ?? customerCtxName ?? null;
  let parsedPrevIntents: string[] = [];
  try { parsedPrevIntents = JSON.parse(previousIntents ?? "[]"); } catch { parsedPrevIntents = []; }

  try {
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
        });

        const taskOutput = await createTaskFromWhatsAppMessage({ savedMsgId, from, senderName, bodyText: transcript, companyId, result });

        if (taskOutput) {
          await updateCustomerContextAfterTask({ phone: from, companyId, taskId: taskOutput.taskId, intent: result.intent, name: effectiveName });
          await _notifyForTask({ taskOutput, result, from, effectiveName, companyId });
        }

        await db
          .update(whatsappMessagesTable)
          .set({ aiProcessed: true, detectedIntent: result.intent })
          .where(eq(whatsappMessagesTable.id, savedMsgId));
      } else {
        logger.warn({ msgId: savedMsgId }, "Voice note transcription failed — marking as voice_note");
        await db
          .update(whatsappMessagesTable)
          .set({ aiProcessed: true, detectedIntent: "voice_note" })
          .where(eq(whatsappMessagesTable.id, savedMsgId));
        // Error handling: save failed transcription as manual review notification
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

    // Non-text attachments without caption: flag as attachment_submission
    if ((messageType === "image" || messageType === "sticker") && !bodyText.startsWith("[")) {
      // has caption — fall through to AI
    } else if (messageType === "image" || messageType === "sticker") {
      logger.info({ msgId: savedMsgId }, "Image/sticker without text — flagged as attachment_submission");
      await db
        .update(whatsappMessagesTable)
        .set({ aiProcessed: true, detectedIntent: "attachment_submission" })
        .where(eq(whatsappMessagesTable.id, savedMsgId));
      // Notify admin: customer uploaded document
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
    });

    // Create task or append to existing active task (duplicate guard built-in)
    const taskOutput = await createTaskFromWhatsAppMessage({
      savedMsgId,
      from,
      senderName,
      bodyText,
      companyId,
      result,
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

      // Update customer context
      await updateCustomerContextAfterTask({ phone: from, companyId, taskId: taskOutput.taskId, intent: result.intent, name: effectiveName });

      // Admin notification based on priority / task action
      await _notifyForTask({ taskOutput, result, from, effectiveName, companyId });
    } else {
      // AI failed to produce task — create manual review notification
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
    // Safe error handling: create manual review notification even if AI crashes
    try {
      await createAdminNotification({
        type: "waiting_review",
        title: "Error Pemrosesan AI",
        body: `Terjadi error saat memproses pesan dari ${effectiveName ?? from}. Pesan tetap tersimpan, perlu review manual.`,
        customerPhone: from,
        customerName: effectiveName,
        companyId,
      });
    } catch { /* ignore secondary failure */ }
  }
}

/** Create the right admin notification depending on the task outcome. */
async function _notifyForTask({
  taskOutput,
  result,
  from,
  effectiveName,
  companyId,
}: {
  taskOutput: { action: string; taskId: number; title: string; taskNumber: string | null };
  result: { priority: string; category: string };
  from: string;
  effectiveName: string | null;
  companyId: string;
}) {
  const customerLabel = effectiveName ?? from;
  const taskLabel = taskOutput.taskNumber ? `[${taskOutput.taskNumber}]` : "";

  if (result.priority === "High" && taskOutput.action === "created") {
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
    await createAdminNotification({
      type: "new_inquiry",
      title: `Task Baru ${taskLabel}`,
      body: `Task "${taskOutput.title}" dibuat untuk ${customerLabel} (${result.category}).`,
      taskId: taskOutput.taskId,
      customerPhone: from,
      customerName: effectiveName,
      companyId,
    });
  }
}

export default router;
