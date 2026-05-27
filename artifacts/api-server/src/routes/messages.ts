import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, whatsappMessagesTable, tasksTable, activityTable } from "@workspace/db";
import {
  ListMessagesQueryParams,
  ProcessMessageParams,
  SendWhatsAppMessageBody,
  ReceiveWhatsAppWebhookBody,
  VerifyWhatsAppWebhookQueryParams,
} from "@workspace/api-zod";
import { detectIntent } from "../lib/openai";
import { sendWhatsAppMessage } from "../lib/whatsapp";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/messages", async (req, res): Promise<void> => {
  const parsed = ListMessagesQueryParams.safeParse(req.query);
  const filters = parsed.success ? parsed.data : {};

  const messages = await db
    .select()
    .from(whatsappMessagesTable)
    .orderBy(desc(whatsappMessagesTable.createdAt));

  const filtered = messages.filter((m) => {
    if (filters.processed !== undefined && m.processed !== filters.processed) return false;
    return true;
  });

  res.json(
    filtered.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    }))
  );
});

router.post("/messages/:id/process", async (req, res): Promise<void> => {
  const params = ProcessMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [message] = await db
    .select()
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.id, params.data.id));

  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const intent = await detectIntent(message.body);

  const shouldCreateTask = intent !== "general";
  let createdTask = null;

  if (shouldCreateTask) {
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: `[${intent.replace(/_/g, " ")}] ${message.body.slice(0, 80)}`,
        description: message.body,
        status: "pending",
        priority: intent === "complaint" ? "high" : "medium",
        sourceMessageId: message.id,
        tags: [intent],
      })
      .returning();

    await db
      .update(whatsappMessagesTable)
      .set({ processed: true, detectedIntent: intent, taskId: task.id })
      .where(eq(whatsappMessagesTable.id, message.id));

    await db.insert(activityTable).values({
      type: "task_created",
      description: `Task created from WhatsApp message with intent: ${intent}`,
      entityId: task.id,
    });

    createdTask = {
      ...task,
      assigneeName: null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      dueDate: task.dueDate ?? null,
      tags: task.tags ?? [],
    };
  } else {
    await db
      .update(whatsappMessagesTable)
      .set({ processed: true, detectedIntent: intent })
      .where(eq(whatsappMessagesTable.id, message.id));
  }

  res.json({
    intent,
    taskCreated: shouldCreateTask && createdTask !== null,
    task: createdTask,
  });
});

router.post("/messages/send", async (req, res): Promise<void> => {
  const parsed = SendWhatsAppMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await sendWhatsAppMessage(parsed.data.to, parsed.data.message);
  res.json(result);
});

// WhatsApp webhook verification
router.get("/webhook/whatsapp", (req, res): void => {
  const params = VerifyWhatsAppWebhookQueryParams.safeParse(req.query);
  const query = params.success ? params.data : req.query;

  const mode = query["hub.mode"] as string | undefined;
  const token = query["hub.verify_token"] as string | undefined;
  const challenge = query["hub.challenge"] as string | undefined;

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    req.log.info("WhatsApp webhook verified");
    res.status(200).send(challenge);
  } else {
    req.log.warn({ mode, token }, "WhatsApp webhook verification failed");
    res.sendStatus(403);
  }
});

// WhatsApp webhook receiver
router.post("/webhook/whatsapp", async (req, res): Promise<void> => {
  const parsed = ReceiveWhatsAppWebhookBody.safeParse(req.body);
  const body = parsed.success ? parsed.data : req.body;

  try {
    if (body?.object === "whatsapp_business_account") {
      const entries = body?.entry ?? [];
      for (const entry of entries) {
        const changes = (entry as Record<string, unknown>)?.changes as unknown[] | undefined;
        for (const change of changes ?? []) {
          const value = (change as Record<string, unknown>)?.value as Record<string, unknown> | undefined;
          const messages = value?.messages as Array<Record<string, unknown>> | undefined;

          for (const msg of messages ?? []) {
            const from = msg.from as string;
            const timestamp = msg.timestamp as string;
            const textBody = (msg.text as Record<string, unknown> | undefined)?.body as string | undefined;
            const contactName = ((value?.contacts as Array<Record<string, unknown>> | undefined)?.[0]?.profile as Record<string, unknown> | undefined)?.name as string | undefined;

            if (textBody) {
              const intent = await detectIntent(textBody);
              const shouldCreateTask = intent !== "general";

              const [savedMsg] = await db
                .insert(whatsappMessagesTable)
                .values({
                  from,
                  senderName: contactName ?? null,
                  body: textBody,
                  timestamp,
                  processed: shouldCreateTask,
                  detectedIntent: intent,
                })
                .returning();

              await db.insert(activityTable).values({
                type: "message_received",
                description: `WhatsApp message received from ${contactName ?? from}`,
                entityId: savedMsg.id,
              });

              if (shouldCreateTask) {
                const [task] = await db
                  .insert(tasksTable)
                  .values({
                    title: `[${intent.replace(/_/g, " ")}] ${textBody.slice(0, 80)}`,
                    description: textBody,
                    status: "pending",
                    priority: intent === "complaint" ? "high" : "medium",
                    sourceMessageId: savedMsg.id,
                    tags: [intent],
                  })
                  .returning();

                await db
                  .update(whatsappMessagesTable)
                  .set({ taskId: task.id })
                  .where(eq(whatsappMessagesTable.id, savedMsg.id));

                await db.insert(activityTable).values({
                  type: "task_created",
                  description: `Auto-task created from WhatsApp message: ${intent}`,
                  entityId: task.id,
                });
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Error processing WhatsApp webhook");
  }

  res.sendStatus(200);
});

export default router;
