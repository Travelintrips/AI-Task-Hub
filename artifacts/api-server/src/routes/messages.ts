import { Router, type IRouter } from "express";
import { supabaseQuery } from "../lib/supabase-db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface WaRow {
  id: number;
  sender: string | null;
  sender_name: string | null;
  message: string | null;
  is_read: boolean | null;
  message_type: string | null;
  received_at: Date | null;
  created_at: Date | null;
  replied_at: Date | null;
  reply_message: string | null;
}

function mapMessage(r: WaRow) {
  const created = r.received_at ?? r.created_at ?? new Date();
  return {
    id: r.id,
    from: r.sender ?? "",
    senderName: r.sender_name ?? null,
    body: r.message ?? "",
    processed: r.is_read ?? false,
    detectedIntent: r.message_type ?? null,
    taskId: null as number | null,
    wamid: null as string | null,
    timestamp: String(Math.floor(created.getTime() / 1000)),
    createdAt: created.toISOString(),
    repliedAt: r.replied_at ? r.replied_at.toISOString() : null,
    replyMessage: r.reply_message ?? null,
  };
}

router.get("/messages", async (req, res): Promise<void> => {
  try {
    const processed = req.query.processed;
    const where =
      processed === "true"
        ? "WHERE is_read = true"
        : processed === "false"
          ? "WHERE (is_read IS NULL OR is_read = false)"
          : "";
    const rows = await supabaseQuery<WaRow>(
      `SELECT id, sender, sender_name, message, is_read, message_type,
              received_at, created_at, replied_at, reply_message
       FROM wa_incoming_messages
       ${where}
       ORDER BY COALESCE(received_at, created_at) DESC NULLS LAST
       LIMIT 300`,
    );
    res.json(rows.map(mapMessage));
  } catch (err) {
    logger.error({ err }, "GET /messages failed");
    res.status(500).json({ error: "Failed to load messages" });
  }
});

router.post("/messages/:id/process", async (_req, res): Promise<void> => {
  res
    .status(501)
    .json({ error: "Read-only mode: messages are sourced from Supabase" });
});

router.post("/messages/send", async (_req, res): Promise<void> => {
  res.status(501).json({ error: "Send WhatsApp not available in read-only mode" });
});

// Keep WhatsApp webhook verification (Meta still pings it)
router.get("/webhook/whatsapp", (req, res): void => {
  const mode = req.query["hub.mode"] as string | undefined;
  const token = req.query["hub.verify_token"] as string | undefined;
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
