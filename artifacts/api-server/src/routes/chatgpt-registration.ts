import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { requireAuth } from "../middleware/auth";

// This route requires BOTH an authenticated AI Task user and an independently
// attested conversation binding issued by the trusted relay.
const router = Router();
const MAX_AGE_MS = 5 * 60 * 1000;
const canonical = (x: string) => x.trim();

function verifyRelay(req: Request, sourceId: string, userId: string, companyId: string): boolean {
  const secret = process.env.CHATGPT_RELAY_BINDING_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) return false;
  const timestamp = req.header("x-chat-relay-timestamp") ?? "";
  const signature = req.header("x-chat-relay-signature") ?? "";
  if (!/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_AGE_MS) return false;
  const payload = [timestamp, "chatgpt", sourceId, userId, companyId].join("\n");
  const expected = createHmac("sha256", secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

router.post("/chatgpt/conversations/register", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const sourceId = typeof req.body?.sourceConversationId === "string" ? canonical(req.body.sourceConversationId) : "";
  if (req.body?.command !== "#" || !/^[a-zA-Z0-9_-]{6,160}$/.test(sourceId)) {
    res.status(400).json({ ok: false, code: "INVALID_REGISTRATION_REQUEST" });
    return;
  }
  if (process.env.CHATGPT_HASH_REGISTRATION_ENABLED !== "true" || !process.env.CHATGPT_RELAY_BINDING_SECRET) {
    res.status(503).json({ ok: false, code: "REGISTRATION_DISABLED" });
    return;
  }
  if (!verifyRelay(req, sourceId, String(user.id), user.companyId)) {
    res.status(403).json({ ok: false, code: "RELAY_BINDING_INVALID" });
    return;
  }
  try {
    const result = await pool.query(
      `WITH created AS (
        INSERT INTO ai_task_bridge.chatgpt_conversation_bindings
          (provider, source_conversation_id, user_id, company_id, role)
        VALUES ('chatgpt', $1, $2, $3, $4)
        ON CONFLICT (provider, source_conversation_id, user_id, company_id) DO NOTHING
        RETURNING id, created_at
      )
      SELECT id, created_at, true AS created FROM created
      UNION ALL
      SELECT id, created_at, false AS created
      FROM ai_task_bridge.chatgpt_conversation_bindings
      WHERE provider='chatgpt' AND source_conversation_id=$1
        AND user_id=$2 AND company_id=$3 AND NOT EXISTS(SELECT 1 FROM created)
      LIMIT 1`,
      [sourceId, String(user.id), user.companyId, user.role],
    );
    if (!result.rows[0]) {
      res.status(409).json({ ok: false, code: "REGISTRATION_CONFLICT" });
      return;
    }
    const binding = result.rows[0];
    res.status(binding.created ? 201 : 200).json({
      ok: true, ack: true, code: "REGISTERED",
      registrationId: binding.id, conversationId: binding.id,
      created: binding.created,
    });
  } catch (error) {
    console.error("chatgpt registration failed", error instanceof Error ? error.name : "unknown");
    res.status(503).json({ ok: false, code: "REGISTRY_UNAVAILABLE" });
  }
});

export default router;
