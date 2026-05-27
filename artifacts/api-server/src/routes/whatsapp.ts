import { Router, type IRouter } from "express";
import {
  db,
  whatsappMessagesTable,
  aiTasksTable,
  taskAttachmentsTable,
  activityTable,
} from "@workspace/db";
import { detectIntent } from "../lib/openai";
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
    let intent = "general";

    // Only run NLP for text-bearing messages
    if (messageType === "text" || messageType === "document") {
      intent = await detectIntent(bodyText);
    } else if (messageType === "audio") {
      // Placeholder for future voice transcription
      intent = "voice_note";
    } else {
      intent = "attachment_submission";
    }

    const shouldCreateTask = intent !== "general";

    if (shouldCreateTask) {
      const taskNumber = `WA-${Date.now()}`;

      const [task] = await db
        .insert(aiTasksTable)
        .values({
          companyId,
          taskNumber,
          source: "whatsapp",
          customerName: senderName ?? null,
          customerPhone: from,
          title: `[${intent.replace(/_/g, " ")}] ${bodyText.slice(0, 100)}`,
          description: bodyText,
          priority: intent === "complaint" ? "high" : "medium",
          status: "pending",
          aiIntent: intent,
        })
        .returning();

      // Update message: mark AI processed and link to task
      await db
        .insert(whatsappMessagesTable)
        .values({
          companyId,
          from,
          senderPhone: from,
          body: bodyText,
          timestamp: Math.floor(Date.now() / 1000).toString(),
          processed: true,
          aiProcessed: true,
          detectedIntent: intent,
          taskId: task.id,
        })
        .onConflictDoNothing();

      await db.insert(activityTable).values({
        type: "task_created",
        description: `AI task created from WhatsApp (intent: ${intent}) — ${taskNumber}`,
        entityId: task.id,
      });

      logger.info({ taskId: task.id, taskNumber, intent }, "AI task created from WhatsApp message");
    } else {
      logger.info({ msgId: savedMsgId, intent }, "Message classified as general — no task created");
    }
  } catch (err) {
    logger.error({ err, msgId: savedMsgId }, "AI detection failed for message");
  }
}

export default router;
