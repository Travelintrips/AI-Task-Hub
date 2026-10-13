import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  bridgeSources, sessionStates, requiredString, inList,
  safeUuid, isTerminal, matchServiceSecret, validLeaseSeconds,
} from "../lib/job-bridge-validation";

const router = Router();
const schema = "ai_task_bridge";
const uuidParam = (req: Request) => String(req.params.id ?? "");

function serviceAuth(envName: "AI_TASK_BRIDGE_TOKEN" | "AI_TASK_BRIDGE_ACK_TOKEN") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const expected = process.env[envName];
    if (!expected || expected.length < 32 ||
        (envName === "AI_TASK_BRIDGE_ACK_TOKEN" && expected === process.env.AI_TASK_BRIDGE_TOKEN)) {
      res.status(503).json({ error: "Bridge service not configured" });
      return;
    }
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!matchServiceSecret(expected, token)) {
      res.status(401).json({ error: "Bridge authentication required" });
      return;
    }
    next();
  };
}
const requireBridge = serviceAuth("AI_TASK_BRIDGE_TOKEN");
const requireReceipt = serviceAuth("AI_TASK_BRIDGE_ACK_TOKEN");
const adminOnly = [requireAuth, requireRole("super_admin")];

function queryError(res: Response, error: unknown): void {
  // Never disclose database schema, credentials or raw SQL in HTTP responses.
  console.error("AI Task job bridge database operation failed", error instanceof Error ? error.name : "unknown");
  res.status(503).json({ error: "Job registry temporarily unavailable" });
}

// Idempotency is scoped by source. A replay returns the original persisted job.
router.post("/bridge/jobs", requireBridge, async (req: Request, res: Response): Promise<void> => {
  const input = req.body ?? {};
  const source = input.source;
  const externalId = requiredString(input.externalId);
  const key = requiredString(input.idempotencyKey, 180);
  const title = requiredString(input.title, 300);
  const sessionId = input.sessionId === undefined ? null : requiredString(input.sessionId, 180);
  if (!inList(source, bridgeSources) || !externalId || !key || !title ||
      (input.sessionId !== undefined && !sessionId)) {
    res.status(400).json({ error: "Invalid source, externalId, idempotencyKey, title or sessionId" });
    return;
  }
  try {
    const inserted = await pool.query(
      `WITH created AS (
          INSERT INTO ${schema}.jobs (source, external_id, idempotency_key, title, source_session_id)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source, idempotency_key) DO NOTHING
          RETURNING id, source, external_id, status, created_at
        ), recorded AS (
          INSERT INTO ${schema}.job_events (job_id,event_id,kind,sender)
          SELECT id,'created:' || id::text,'JOB_CREATED',source FROM created
          RETURNING id
        ) SELECT * FROM created`,
      [source, externalId, key, title, sessionId],
    );
    const created = inserted.rows.length === 1;
    const job = created ? inserted.rows[0] :
      (await pool.query(
        `SELECT id, source, external_id, status, created_at FROM ${schema}.jobs
          WHERE source=$1 AND idempotency_key=$2`,
        [source, key],
      )).rows[0];
    if (!job) { res.status(409).json({ error: "Concurrent registration; retry with same idempotency key" }); return; }
    if (job.external_id !== externalId) {
      res.status(409).json({ error: "Idempotency key belongs to another external task" });
      return;
    }
    res.status(created ? 201 : 200).json({ accepted: true, created, task: job });
  } catch (error) { queryError(res, error); }
});

// Atomic leasing. A stale worker cannot update a job after another owner takes its lease.
router.post("/bridge/jobs/:id/claim", requireBridge, async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req);
  const owner = requiredString(req.body?.owner, 120);
  const seconds = validLeaseSeconds(req.body?.leaseSeconds);
  if (!safeUuid(id) || !owner || seconds === null) {
    res.status(400).json({ error: "Invalid job ID, owner or leaseSeconds" }); return;
  }
  try {
    const result = await pool.query(
      `WITH claimed AS (
         UPDATE ${schema}.jobs
         SET owner=$2, lease_token=gen_random_uuid(), lease_until=now()+($3 * interval '1 second'),
             status='RUNNING', updated_at=now()
         WHERE id=$1 AND status IN ('QUEUED','WAITING_FOR_WORKER','RUNNING','SUSPECTED_STALL')
           AND (lease_until IS NULL OR lease_until <= now())
         RETURNING id, owner, lease_token, lease_until, status
       ), recorded AS (
         INSERT INTO ${schema}.job_events (job_id,event_id,kind,sender)
         SELECT id,'claimed:' || lease_token::text,'JOB_CLAIMED',owner FROM claimed
         RETURNING id
       ) SELECT * FROM claimed`,
      [id, owner, seconds],
    );
    if (!result.rows[0]) { res.status(409).json({ error: "Job owned by another worker or in terminal stage" }); return; }
    res.json({ accepted: true, task: result.rows[0] });
  } catch (error) { queryError(res, error); }
});

// Refresh a running lease without changing its fencing token.
router.post("/bridge/jobs/:id/renew", requireBridge, async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req);
  const owner = requiredString(req.body?.owner, 120);
  const seconds = validLeaseSeconds(req.body?.leaseSeconds);
  if (!safeUuid(id) || !safeUuid(req.body?.leaseToken) || !owner || seconds === null) {
    res.status(400).json({ error: "Invalid renewal identity" }); return;
  }
  try {
    const result = await pool.query(
      `UPDATE ${schema}.jobs SET lease_until=now()+($4 * interval '1 second'),
       updated_at=now() WHERE id=$1 AND owner=$2 AND lease_token=$3
       AND status='RUNNING' AND lease_until>now() RETURNING id,lease_until`,
      [id,owner,req.body.leaseToken,seconds],
    );
    if (!result.rows[0]) { res.status(409).json({ error: "Lease no longer owned by worker" }); return; }
    res.json({ accepted: true, lease: result.rows[0] });
  } catch (error) { queryError(res, error); }
});

// Worker reports a result, but this MUST NOT mark it complete until an
// independent receiving system submits the matching callback acknowledgement.
router.post("/bridge/jobs/:id/result", requireBridge, async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req);
  const input = req.body ?? {};
  const eventId = requiredString(input.eventId, 180);
  const owner = requiredString(input.owner, 120);
  const callbackId = requiredString(input.callbackId, 180);
  const summary = requiredString(input.resultSummary, 2000);
  if (!safeUuid(id) || !safeUuid(input.leaseToken) || !eventId || !owner || !callbackId || !summary) {
    res.status(400).json({ error: "Invalid event identity, lease, callback or result" }); return;
  }
  const client = await pool.connect().catch(() => null);
  if (!client) { res.status(503).json({ error: "Job registry temporarily unavailable" }); return; }
  try {
    await client.query("BEGIN");
    const previous = await client.query(
      `SELECT id, job_id FROM ${schema}.job_events WHERE event_id=$1`, [eventId],
    );
    if (previous.rows[0]) {
      await client.query("COMMIT");
      if (previous.rows[0].job_id !== id) { res.status(409).json({ error: "Event ID collision" }); return; }
      res.json({ accepted: true, duplicate: true, receiptId: previous.rows[0].id }); return;
    }
    const locked = await client.query(
      `SELECT id, status, owner, lease_token, lease_until FROM ${schema}.jobs WHERE id=$1 FOR UPDATE`, [id],
    );
    const job = locked.rows[0];
    if (!job || isTerminal(job.status) || job.status === "WAITING_FOR_ACK" ||
        job.owner !== owner || job.lease_token !== input.leaseToken ||
        !job.lease_until || new Date(job.lease_until).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Job missing, lease expired or ownership lost" }); return;
    }
    const event = await client.query(
      `INSERT INTO ${schema}.job_events (job_id, event_id, kind, sender, payload)
       VALUES ($1,$2,'RESULT_RECORDED',$3,jsonb_build_object('callbackId',$4::text))
       RETURNING id`, [id, eventId, owner, callbackId],
    );
    await client.query(
      `UPDATE ${schema}.jobs SET status='WAITING_FOR_ACK', callback_id=$2,
       result_summary=$3, updated_at=now() WHERE id=$1`, [id, callbackId, summary],
    );
    await client.query("COMMIT");
    res.status(202).json({ accepted: true, status: "WAITING_FOR_ACK", receiptId: event.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Event ID already used" });
    } else { queryError(res, error); }
  } finally { client.release(); }
});

// Different credential from the worker sender: an ACK must come from the
// authorized receiver, not merely be declared by the producing worker.
router.post("/bridge/jobs/:id/ack", requireReceipt, async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req);
  const eventId = requiredString(req.body?.eventId, 180);
  const callbackId = requiredString(req.body?.callbackId, 180);
  const receiver = requiredString(req.body?.receiver, 120);
  if (!safeUuid(id) || !eventId || !callbackId || !receiver || req.body?.accepted !== true) {
    res.status(400).json({ error: "A verified receiver acknowledgement is required" }); return;
  }
  const client = await pool.connect().catch(() => null);
  if (!client) { res.status(503).json({ error: "Job registry temporarily unavailable" }); return; }
  try {
    await client.query("BEGIN");
    const prior = await client.query(`SELECT id, job_id FROM ${schema}.job_events WHERE event_id=$1`, [eventId]);
    if (prior.rows[0]) {
      await client.query("COMMIT");
      if (prior.rows[0].job_id !== id) { res.status(409).json({ error: "Event ID collision" }); return; }
      res.json({ accepted: true, duplicate: true, receiptId: prior.rows[0].id }); return;
    }
    const current = await client.query(
      `SELECT status, callback_id FROM ${schema}.jobs WHERE id=$1 FOR UPDATE`, [id],
    );
    if (current.rows[0]?.status !== "WAITING_FOR_ACK" || current.rows[0]?.callback_id !== callbackId) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Result/callback not recorded or callback ID mismatch" }); return;
    }
    const receipt = await client.query(
      `INSERT INTO ${schema}.job_events (job_id,event_id,kind,sender,payload)
       VALUES ($1,$2,'CALLBACK_ACK',$3,jsonb_build_object('callbackId',$4::text))
       RETURNING id`, [id, eventId, receiver, callbackId],
    );
    await client.query(
      `UPDATE ${schema}.jobs SET status='COMPLETED', callback_received_at=now(),
       result_verified_at=now(), updated_at=now() WHERE id=$1`, [id],
    );
    await client.query("COMMIT");
    res.json({ accepted: true, status: "COMPLETED", receiptId: receipt.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Event ID already used" });
    } else { queryError(res, error); }
  } finally { client.release(); }
});

router.post("/bridge/jobs/:id/fail", requireBridge, async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req);
  const eventId = requiredString(req.body?.eventId, 180);
  const owner = requiredString(req.body?.owner, 120);
  const reason = requiredString(req.body?.reason, 1000);
  if (!safeUuid(id) || !safeUuid(req.body?.leaseToken) || !eventId || !owner || !reason) {
    res.status(400).json({ error: "Invalid failure event or lease" }); return;
  }
  const client = await pool.connect().catch(() => null);
  if (!client) { res.status(503).json({ error: "Job registry temporarily unavailable" }); return; }
  try {
    await client.query("BEGIN");
    const prior = await client.query(`SELECT id,job_id FROM ${schema}.job_events WHERE event_id=$1`, [eventId]);
    if (prior.rows[0]) {
      await client.query("COMMIT");
      res.status(prior.rows[0].job_id === id ? 200 : 409).json(
        prior.rows[0].job_id === id ? { accepted: true, duplicate: true, receiptId: prior.rows[0].id } :
          { error: "Event ID collision" }); return;
    }
    const current = await client.query(
      `SELECT status,owner,lease_token,lease_until FROM ${schema}.jobs WHERE id=$1 FOR UPDATE`, [id],
    );
    const job = current.rows[0];
    if (!job || isTerminal(job.status) || job.status === "WAITING_FOR_ACK" ||
        job.owner !== owner || job.lease_token !== req.body.leaseToken ||
        !job.lease_until || new Date(job.lease_until).getTime() <= Date.now()) {
      await client.query("ROLLBACK"); res.status(409).json({ error: "Lost job lease" }); return;
    }
    const receipt = await client.query(
      `INSERT INTO ${schema}.job_events (job_id,event_id,kind,sender,payload)
       VALUES ($1,$2,'WORKER_FAILED',$3,jsonb_build_object('reason',$4::text))
       RETURNING id`, [id,eventId,owner,reason],
    );
    await client.query(
      `UPDATE ${schema}.jobs SET status='FAILED',result_summary=$2,updated_at=now() WHERE id=$1`,
      [id,reason],
    );
    await client.query("COMMIT");
    res.json({ accepted: true, status: "FAILED", receiptId: receipt.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Event ID already used" });
    } else { queryError(res, error); }
  } finally { client.release(); }
});

router.post("/bridge/sessions/heartbeat", requireBridge, async (req: Request, res: Response): Promise<void> => {
  const source = req.body?.source;
  const sessionId = requiredString(req.body?.sessionId, 180);
  const owner = req.body?.owner === undefined ? null : requiredString(req.body?.owner, 120);
  const state = req.body?.state;
  const jobId = req.body?.jobId === undefined ? null : req.body.jobId;
  if (!inList(source, bridgeSources) || !sessionId || !inList(state, sessionStates) ||
      (req.body?.owner !== undefined && !owner) || (jobId !== null && !safeUuid(jobId))) {
    res.status(400).json({ error: "Invalid session heartbeat" }); return;
  }
  try {
    const result = await pool.query(
      `INSERT INTO ${schema}.sessions (source, session_id, owner, state, job_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (source,session_id) DO UPDATE SET owner=EXCLUDED.owner,
       state=EXCLUDED.state,job_id=EXCLUDED.job_id,last_seen_at=now()
       RETURNING source,session_id,state,last_seen_at`,
      [source,sessionId,owner,state,jobId],
    );
    res.json({ accepted: true, session: result.rows[0] });
  } catch (error) { queryError(res, error); }
});

// Human visibility is super-admin-only until proper multi-tenant support exists.
router.get("/bridge/admin/jobs", ...adminOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id,source,external_id,source_session_id,title,status,owner,created_at,updated_at,
       callback_received_at,result_verified_at FROM ${schema}.jobs
       ORDER BY created_at DESC LIMIT 100`,
    );
    res.json({ jobs: result.rows });
  } catch (error) { queryError(res, error); }
});
router.get("/bridge/admin/sessions", ...adminOnly, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT source,session_id,state,owner,job_id,last_seen_at,
       (last_seen_at > now()-interval '90 seconds') AS heartbeat_recent
       FROM ${schema}.sessions ORDER BY last_seen_at DESC LIMIT 100`,
    );
    res.json({ sessions: result.rows });
  } catch (error) { queryError(res, error); }
});
router.get("/bridge/admin/jobs/:id/events", ...adminOnly, async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req);
  if (!safeUuid(id)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  try {
    const result = await pool.query(
      `SELECT event_id,kind,sender,payload,received_at FROM ${schema}.job_events
       WHERE job_id=$1 ORDER BY received_at DESC LIMIT 100`, [id],
    );
    res.json({ events: result.rows });
  } catch (error) { queryError(res, error); }
});

export default router;
