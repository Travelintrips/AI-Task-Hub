import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, whatsappMessagesTable } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function mapMessage(r: typeof whatsappMessagesTable.$inferSelect) {
  return {
    id:             r.id,
    from:           r.from,
    senderName:     r.senderName,
    body:           r.body,
    processed:      r.processed,
    detectedIntent: r.detectedIntent,
    taskId:         r.taskId,
    wamid:          r.wamid,
    timestamp:      r.timestamp,
    createdAt:      r.createdAt.toISOString(),
    repliedAt:      null as string | null,
    replyMessage:   null as string | null,
  };
}

// ─── GET /messages ────────────────────────────────────────────────────────────

router.get("/messages", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(whatsappMessagesTable)
      .orderBy(desc(whatsappMessagesTable.createdAt))
      .limit(300);

    const { processed } = req.query as Record<string, string | undefined>;
    let filtered = rows;
    if (processed === "true") filtered = rows.filter((r) => r.processed);
    if (processed === "false") filtered = rows.filter((r) => !r.processed);

    res.json(filtered.map(mapMessage));
  } catch (err) {
    logger.error({ err }, "GET /messages failed");
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// ─── POST /messages/:id/process ───────────────────────────────────────────────

router.post("/messages/:id/process", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [updated] = await db
      .update(whatsappMessagesTable)
      .set({ processed: true })
      .where(eq(whatsappMessagesTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Message not found" }); return; }

    res.json(mapMessage(updated));
  } catch (err) {
    logger.error({ err }, "POST /messages/:id/process failed");
    res.status(500).json({ error: "Failed to process message" });
  }
});

// ─── POST /messages/send ──────────────────────────────────────────────────────

router.post("/messages/send", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  res.status(501).json({ error: "Send WhatsApp requires WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID" });
});

// ─── WhatsApp webhook verification ────────────────────────────────────────────

router.get("/webhook/whatsapp", (req: Request, res: Response): void => {
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

router.post("/webhook/whatsapp", (_req: Request, res: Response): void => {
  res.sendStatus(200);
});

export default router;
