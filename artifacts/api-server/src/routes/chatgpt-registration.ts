import { Router, type Request, type Response } from "express";
import { verifyRelayBinding, readRelayBinding } from "./chatgpt-relay-verifier";
import { pool } from "@workspace/db";
import { requireAuth } from "../middleware/auth";

const router = Router();
const canonical = (x: string) => x.trim();

router.post("/chatgpt/conversations/register", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const sourceId = typeof req.body?.sourceConversationId === "string" ? canonical(req.body.sourceConversationId) : "";
  if (req.body?.command !== "#" || !/^[a-zA-Z0-9_-]{6,160}$/.test(sourceId)) {
    res.status(400).json({ ok: false, code: "INVALID_REGISTRATION_REQUEST" });
    return;
  }
  const secret = process.env.CHATGPT_RELAY_BINDING_SECRET;
  if (process.env.CHATGPT_HASH_REGISTRATION_ENABLED !== "true" || !secret) {
    res.status(503).json({ ok: false, code: "REGISTRATION_DISABLED" });
    return;
  }
  const verified = verifyRelayBinding(
    readRelayBinding(req, sourceId, String(user.id), String(user.companyId)),
    secret,
  );
  if (!verified.ok) {
    res.status(403).json({ ok: false, code: verified.code });
    return;
  }

  const client = await pool.connect().catch((error: unknown) => {
    console.error("chatgpt registration connection failed", error instanceof Error ? error.name : "unknown");
    res.status(503).json({ ok: false, code: "REGISTRY_UNAVAILABLE" });
    return null;
  });
  if (!client) return;
  try {
    await client.query("BEGIN");
    // Unique nonce insert is the atomic replay gate. A duplicate nonce is rejected,
    // even when two identical requests arrive concurrently.
    const nonce = await client.query(
      `INSERT INTO ai_task_bridge.chatgpt_relay_nonces (nonce_hash, expires_at)
       VALUES ($1, NOW() + INTERVAL '10 minutes')
       ON CONFLICT (nonce_hash) DO NOTHING
       RETURNING nonce_hash`,
      [verified.nonceHash],
    );
    if (nonce.rowCount !== 1) {
      await client.query("ROLLBACK");
      res.status(409).json({ ok: false, code: "RELAY_REPLAY_REJECTED" });
      return;
    }

    const result = await client.query(
      `INSERT INTO ai_task_bridge.chatgpt_conversation_bindings
        (provider, source_conversation_id, user_id, company_id, role)
       VALUES ('chatgpt', $1, $2, $3, $4)
       ON CONFLICT (provider, source_conversation_id, user_id, company_id) DO NOTHING
       RETURNING id, created_at`,
      [sourceId, String(user.id), String(user.companyId), String(user.role)],
    );
    let binding = result.rows[0];
    const created = Boolean(binding);
    if (!binding) {
      const existing = await client.query(
        `SELECT id, created_at FROM ai_task_bridge.chatgpt_conversation_bindings
         WHERE provider='chatgpt' AND source_conversation_id=$1 AND user_id=$2 AND company_id=$3
         LIMIT 1`,
        [sourceId, String(user.id), String(user.companyId)],
      );
      binding = existing.rows[0];
    }
    if (!binding) {
      await client.query("ROLLBACK");
      res.status(409).json({ ok: false, code: "REGISTRATION_CONFLICT" });
      return;
    }
    await client.query("COMMIT");
    res.status(created ? 201 : 200).json({
      ok: true, ack: true, code: "REGISTERED",
      registrationId: binding.id, conversationId: binding.id, created,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("chatgpt registration failed", error instanceof Error ? error.name : "unknown");
    res.status(503).json({ ok: false, code: "REGISTRY_UNAVAILABLE" });
  } finally {
    client.release();
  }
});

export default router;
