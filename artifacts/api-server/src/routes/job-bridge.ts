import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  bridgeSources, sessionStates, requiredString, inList,
  safeUuid, isTerminal, matchServiceSecret, validLeaseSeconds,
} from "../lib/job-bridge-validation";

import {
  parseAiCoreExternalId,
  observeKind,
  verifyAndAckAiCoreSource,
} from "../lib/ai-core-source-verifier";

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

// Source-verified lifecycle observation. AI Core remains the sole dispatcher.
// The receiver checks the persisted AI Core record and cannot be convinced
// that a job is finished by a producer-supplied status alone.
router.post("/bridge/jobs/:id/source-event", requireBridge, async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req);
  const eventId = requiredString(req.body?.eventId, 180);
  const claimedStatus = requiredString(req.body?.status, 40);
  if (!safeUuid(id) || !eventId || !claimedStatus || !eventId.startsWith("ai-core:")) {
    res.status(400).json({ error: "Invalid source lifecycle event" }); return;
  }
  const client = await pool.connect().catch(() => null);
  if (!client) { res.status(503).json({ error: "Job registry temporarily unavailable" }); return; }
  let callbackToVerify: string | null = null;
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT id,source,external_id,status,callback_id FROM ${schema}.jobs WHERE id=$1 FOR UPDATE`, [id],
    );
    const job = locked.rows[0];
    const key = job && job.source === "AI_CORE" ? parseAiCoreExternalId(job.external_id) : null;
    if (!key) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "AI Core source job not found" }); return;
    }
    const previous = await client.query(
      `SELECT job_id,id FROM ${schema}.job_events WHERE event_id=$1`, [eventId],
    );
    if (previous.rows[0]) {
      if (previous.rows[0].job_id !== id) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Event collision" }); return;
      }
      callbackToVerify = job.status === "WAITING_FOR_ACK" &&
        claimedStatus === "COMPLETED" && job.callback_id === "core-source:" + id
          ? job.callback_id : null;
      await client.query("COMMIT");
      res.json({ accepted: true, duplicate: true, status: job.status, receiptId: previous.rows[0].id });
    } else {
      const canonical = await client.query(
        key.kind === "coding-task"
          ? "SELECT status,result_summary FROM ai_platform.ai_coding_tasks WHERE id=$1"
          : "SELECT status,worker_id,error_message FROM ai_platform.ai_coding_workstreams WHERE id=$1",
        [key.id],
      );
      const record = canonical.rows[0];
      if (!record || record.status !== claimedStatus) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "AI Core persisted status did not match lifecycle event" }); return;
      }
      // After a timeout or process restart, the producer may replay with a
      // different eventId. Recheck the canonical source and resume the
      // receiver-owned ACK rather than leaving WAITING_FOR_ACK stranded.
      if (job.status === "WAITING_FOR_ACK" && claimedStatus === "COMPLETED" &&
          job.callback_id === "core-source:" + id) {
        callbackToVerify = job.callback_id;
        await client.query("COMMIT");
        res.status(202).json({ accepted: true, replayed: true, status: "WAITING_FOR_ACK" });
      } else if (isTerminal(job.status) && job.status === claimedStatus) {
        await client.query("COMMIT");
        res.json({ accepted: true, duplicate: true, status: job.status });
      } else if (isTerminal(job.status) || job.status === "WAITING_FOR_ACK") {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Job already closing or terminal" }); return;
      } else {
      const worker = key.kind === "coding-workstream" && typeof record.worker_id === "string"
        ? record.worker_id.slice(0, 120) : null;
      const eventKind = key.kind === "coding-task" && ["CODING","RUNNING"].includes(claimedStatus) ? "SOURCE_PROGRESS" : observeKind(claimedStatus);
      const receipt = await client.query(
        `INSERT INTO ${schema}.job_events(job_id,event_id,kind,sender,payload)
         VALUES($1,$2,$3,'ai-core-source-observer',
         jsonb_build_object('status',$4::text,'worker',$5::text))
         RETURNING id`,
        [id,eventId,eventKind,claimedStatus,worker],
      );
      let finalStatus = job.status;
      if (claimedStatus === "COMPLETED") {
        callbackToVerify = "core-source:" + id;
        const summary = String(record.result_summary ?? "AI Core canonical source marked completed").slice(0,2000);
        await client.query(
          `UPDATE ${schema}.jobs SET status='WAITING_FOR_ACK',callback_id=$2,
           result_summary=$3,updated_at=now() WHERE id=$1`, [id,callbackToVerify,summary],
        );
        finalStatus = "WAITING_FOR_ACK";
      } else if (claimedStatus === "FAILED" || claimedStatus === "CANCELLED") {
        await client.query(
          `UPDATE ${schema}.jobs SET status='FAILED',result_summary=$2,updated_at=now()
           WHERE id=$1`,
          [id,String(record.error_message ?? record.result_summary ?? claimedStatus).slice(0,2000)],
        );
        finalStatus = "FAILED";
      } else {
        const running = ["CLAIMED","RUNNING","ANALYZING","CODING","TESTING","COMMITTING","PR_CREATED"].includes(claimedStatus);
        finalStatus = running ? "RUNNING" : job.status;
        await client.query(
          `UPDATE ${schema}.jobs SET status=$2,owner=COALESCE($3,owner),updated_at=now() WHERE id=$1`,
          [id,finalStatus,worker],
        );
      }
      await client.query("COMMIT");
      res.status(202).json({ accepted: true, status: finalStatus, receiptId: receipt.rows[0].id });
      }
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    queryError(res, error);
  } finally { client.release(); }
  // Independently verify the canonical database after committing result.
  // This verifier cannot be controlled with only a worker-supplied result.
  if (callbackToVerify) {
    void verifyAndAckAiCoreSource(id,callbackToVerify).catch((error: unknown) => {
      console.error("AI Core canonical ACK verification failed", error instanceof Error ? error.name : "unknown");
    });
  }
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
