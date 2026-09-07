import { Router, type IRouter } from "express";
import { db, whatsappMessagesTable } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";
import { emitSseEvent } from "../lib/sse";

const router: IRouter = Router();

// ─── GET /messages ─────────────────────────────────────────────────────────────

router.get("/messages", requireAuth, async (req, res): Promise<void> => {
  try {
    // super_admin: getCompanyId returns null → no company filter (sees ALL messages)
    // other roles: returns their own companyId
    const companyId = getCompanyId(req);
    const processedFilter = req.query.processed as string | undefined;

    let rows = await db
      .select()
      .from(whatsappMessagesTable)
      .where(
        companyId === null
          // super_admin: only filter by processed status if requested, no company scope
          ? processedFilter === "true"
            ? eq(whatsappMessagesTable.processed, true)
            : processedFilter === "false"
              ? eq(whatsappMessagesTable.processed, false)
              : undefined
          // regular user: always scope by companyId
          : processedFilter === "true"
            ? and(
                eq(whatsappMessagesTable.companyId, companyId),
                eq(whatsappMessagesTable.processed, true),
              )
            : processedFilter === "false"
              ? and(
                  eq(whatsappMessagesTable.companyId, companyId),
                  eq(whatsappMessagesTable.processed, false),
                )
              : eq(whatsappMessagesTable.companyId, companyId),
      )
      .orderBy(desc(whatsappMessagesTable.createdAt))
      .limit(300);

    const mapped = rows.map((r) => ({
      id:             r.id,
      from:           r.from,
      senderPhone:    r.senderPhone ?? null,
      senderName:     r.senderName ?? null,
      body:           r.body,
      messageText:    r.messageText ?? null,
      messageType:    r.messageType ?? null,
      direction:      r.direction ?? null,
      processed:      r.processed,
      aiProcessed:    r.aiProcessed ?? false,
      detectedIntent: r.detectedIntent ?? null,
      taskId:         r.taskId ?? null,
      wamid:          r.wamid ?? null,
      timestamp:      r.timestamp,
      createdAt:      r.createdAt.toISOString(),
      attachmentUrl:  r.attachmentUrl ?? null,
      repliedAt:      null as string | null,
      replyMessage:   null as string | null,
    }));

    res.json(mapped);
  } catch (err) {
    logger.error({ err }, "GET /messages failed");
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// ─── POST /messages/:id/process ────────────────────────────────────────────────

router.post("/messages/:id/process", requireAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db
      .update(whatsappMessagesTable)
      .set({ processed: true })
      .where(eq(whatsappMessagesTable.id, id))
      .returning();
    const companyId = row?.companyId ?? "default";
    emitSseEvent("message_updated", { messageId: id }, companyId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "POST /messages/:id/process failed");
    res.status(500).json({ error: "Failed to process message" });
  }
});

// ─── POST /messages/send ───────────────────────────────────────────────────────

router.post("/messages/send", requireAuth, async (_req, res): Promise<void> => {
  res.status(501).json({ error: "Use /api/ai-tasks/reply-wa to send WhatsApp replies" });
});

// ─── WhatsApp webhook verification (Meta pings this) ──────────────────────────

router.get("/webhook/whatsapp", (req, res): void => {
  const mode      = req.query["hub.mode"] as string | undefined;
  const token     = req.query["hub.verify_token"] as string | undefined;
  const challenge = req.query["hub.challenge"] as string | undefined;
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && token === verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

router.post("/webhook/whatsapp", (_req, res): void => {
  res.sendStatus(200);
});

export default router;
