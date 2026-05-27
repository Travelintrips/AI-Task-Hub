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
import { logger } from "../lib/logger";

const router: IRouter = Router();

type MessageType = "text" | "image" | "document" | "audio" | "video" | "sticker" | "location" | "unknown";

interface AttachmentInfo {
  url?: string;
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
    return {
      type: "audio",
      text: null,
      attachment: {
        url: audio?.link as string | undefined,
        mimeType: audio?.mime_type as string | undefined,
        filename: `voice_${Date.now()}.ogg`,
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

async function processIncomingMessage({
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

    // 4. Trigger AI detection (non-blocking — errors are caught)
    setImmediate(() => {
      runAiDetection({ savedMsgId: savedMsg.id, from, senderName, bodyText, messageType, companyId }).catch((err) => {
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
}: {
  savedMsgId: number;
  from: string;
  senderName: string | undefined;
  bodyText: string;
  messageType: string;
  companyId: string;
}): Promise<void> {
  try {
    // Voice notes: placeholder — transcription not yet implemented
    if (messageType === "audio") {
      logger.info({ msgId: savedMsgId }, "Voice note received — skipping AI detection (pending transcription)");
      await db
        .update(whatsappMessagesTable)
        .set({ aiProcessed: true, detectedIntent: "voice_note" })
        .where(eq(whatsappMessagesTable.id, savedMsgId));
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
      return;
    }

    // Run full structured AI analysis
    const result = await detectWhatsAppIntent(bodyText, {
      name: senderName ?? null,
      phone: from,
      companyId,
    });

    const taskNumber = `WA-${Date.now()}`;
    const isGeneralInquiry =
      result.category === "General Inquiry" && result.priority === "Low";

    // Always create a task — even general inquiries deserve tracking
    const [task] = await db
      .insert(aiTasksTable)
      .values({
        companyId,
        taskNumber,
        source: "whatsapp",
        customerName: result.customer_name ?? senderName ?? null,
        customerPhone: result.customer_phone ?? from,
        title: `[${result.category}] ${bodyText.slice(0, 100)}`,
        description: bodyText,
        category: result.category,
        division: result.division,
        priority: result.priority.toLowerCase(),
        status: "pending",
        assignedRole: result.suggested_team,
        aiSummary: result.suggested_reply,
        aiIntent: result.intent,
      })
      .returning();

    // Mark the source message as processed and linked
    await db
      .update(whatsappMessagesTable)
      .set({
        processed: true,
        aiProcessed: true,
        detectedIntent: result.intent,
        taskId: task.id,
      })
      .where(eq(whatsappMessagesTable.id, savedMsgId));

    await db.insert(activityTable).values({
      type: "task_created",
      description: `AI task ${taskNumber} created — ${result.category} / ${result.priority} priority (${result.intent})`,
      entityId: task.id,
    });

    logger.info(
      {
        taskId: task.id,
        taskNumber,
        category: result.category,
        priority: result.priority,
        needs_quotation: result.needs_quotation,
        needs_admin_review: result.needs_admin_review,
        suggested_team: result.suggested_team,
        isGeneralInquiry,
      },
      "AI task created from WhatsApp message",
    );
  } catch (err) {
    logger.error({ err, msgId: savedMsgId }, "AI detection failed for message");
  }
}

export default router;
