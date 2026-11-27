import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  bridgeSources, sessionStates, requiredString, inList,
  safeUuid, isTerminal, matchServiceSecret, validLeaseSeconds,
  projectAiCoreObservedStatus,
} from "../lib/job-bridge-validation";

import { attachBridgeCleanupRoutes } from "./job-bridge-admin-cleanup";
import { attachBridgeDashboardVisibilityRoutes } from "./job-bridge-dashboard-visibility";
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
          : key.kind === "coding-workstream"
            ? "SELECT status,worker_id,error_message FROM ai_platform.ai_coding_workstreams WHERE id=$1"
            : "SELECT status FROM ai_platform.ai_coding_bridge_commands WHERE id=$1",
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
        finalStatus = projectAiCoreObservedStatus(claimedStatus, job.status);
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
router.get("/bridge/admin/jobs", ...adminOnly, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id,source,external_id,source_session_id,title,status,owner,created_at,updated_at,
       callback_received_at,result_verified_at FROM ${schema}.jobs j
       WHERE ($1::boolean OR NOT EXISTS (
         SELECT 1 FROM ${schema}.job_events e
         WHERE e.job_id=j.id AND e.kind='DASHBOARD_ARCHIVED'
       ))
       ORDER BY created_at DESC LIMIT 100`,
      [req.query.includeArchived === "true"],
    );
    const hidden = await pool.query(
      "SELECT DISTINCT entity_id FROM public.audit_logs " +
      "WHERE action='dashboard_hidden' AND entity_type='ai_task' " +
      "AND entity_id ~ '^[0-9]+$' LIMIT 5000",
    );
    // DEV-only display enrichment. Never rewrite the canonical registry status,
    // claim a job, replay a command, or acknowledge a failed notification.
    let passiveEventClassification: "AVAILABLE" | "UNAVAILABLE" | undefined;
    const passiveIds = new Set<string>();
    if (process.env.NODE_ENV === "development" &&
        (process.env.APP_ENV === undefined || process.env.APP_ENV === "development") &&
        process.env.PUBLIC_APP_BASE_URL === "https://dev-ai-task.cstlogistic.co.id" &&
        process.env.SUPABASE_URL_DEV === "https://xssrfshdrtdfupgqwfdw.supabase.co") {
      try {
        const candidates = result.rows.filter(row => row.source === "AI_CORE" &&
          row.status === "QUEUED" && row.owner === null &&
          parseAiCoreExternalId(row.external_id)?.kind === "bridge-command");
        if (candidates.length) {
          const passive = await pool.query(
            `SELECT j.id FROM ai_task_bridge.jobs j
             JOIN ai_platform.ai_coding_bridge_commands c ON c.id=CASE
               WHEN j.external_id ~ '^bridge-command:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
               THEN split_part(j.external_id,':',2)::uuid ELSE NULL END
             WHERE j.id=ANY($1::uuid[]) AND j.source='AI_CORE' AND j.status='QUEUED'
               AND j.owner IS NULL AND j.lease_token IS NULL
               AND c.command_type='EVENT_BINDING' AND c.status='RECEIVED'
               AND coalesce(c.metadata_json->>'assignedClientId','')=''`,
            [candidates.map(row => row.id)],
          );
          for (const row of passive.rows) passiveIds.add(row.id);
        }
        passiveEventClassification = "AVAILABLE";
      } catch (error) {
        passiveIds.clear();
        passiveEventClassification = "UNAVAILABLE";
        console.warn("DEV passive event classification unavailable", error instanceof Error ? error.name : "unknown");
      }
    }
    const jobs = result.rows.map(row => passiveIds.has(row.id)
      ? { ...row, queue_classification: "PASSIVE_EVENT" } : row);
    res.json({ jobs, hiddenTaskIds: hidden.rows.map(row => Number(row.entity_id)),
      ...(passiveEventClassification ? { passiveEventClassification } : {}) });
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

    // CST-DEV only. Enrich a selected failed bridge-command with bounded
    // diagnostics from its own canonical source. Do not expose response text,
    // metadata, attestation, credentials or command instructions; no writes.
    let failureDiagnostic = null;
    if (process.env.NODE_ENV === "development" &&
        (process.env.APP_ENV === undefined || process.env.APP_ENV === "development") &&
        process.env.PUBLIC_APP_BASE_URL === "https://dev-ai-task.cstlogistic.co.id" &&
        process.env.SUPABASE_URL_DEV === "https://xssrfshdrtdfupgqwfdw.supabase.co" &&
        result.rows.some(row => row.kind === "WORKER_FAILED")) {
      try {
        const diagnostics = await pool.query(
          `SELECT
            CASE
              WHEN r.id IS NULL THEN 'NO_FAILED_RESPONSE'
              WHEN r.metadata_json->>'reason' = 'CDP_STAGE_NAVIGATION_UNKNOWN_NO_RETRY' THEN 'NAVIGATION_UNKNOWN_NO_RETRY'
              WHEN r.metadata_json->>'reason' = 'NATIVE_CAPTURE_RATE_LIMITED_RECONCILIATION_REQUIRED' THEN 'RATE_LIMITED_RECONCILIATION_REQUIRED'
              WHEN coalesce(r.metadata_json->>'reason','') ~* '(rate.?limit|too many requests|429)' THEN 'RATE_LIMITED'
              WHEN coalesce(r.metadata_json->>'reason','') ~* '(attest|challenge|signature|proof|verif)' THEN 'VERIFICATION_FAILED'
              WHEN coalesce(r.metadata_json->>'reason','') ~* '(timeout|timed out|deadline)' THEN 'TIMEOUT'
              WHEN coalesce(r.metadata_json->>'reason','') ~* '(browser|cdp|navigation|tab|playwright)' THEN 'BROWSER_UNCONFIRMED'
              WHEN coalesce(r.metadata_json->>'reason','') ~* '(auth|login|session|permission)' THEN 'AUTH_OR_SESSION'
              WHEN nullif(btrim(r.metadata_json->>'reason'),'') IS NULL THEN 'NOT_RECORDED'
              ELSE 'OTHER_RECORDED_REASON'
            END AS reason_category,
            coalesce(c.metadata_json->>'deliveryCode' = 'UNKNOWN_UNVERIFIED', false) AS delivery_unverified,
            coalesce(c.metadata_json->>'e2eCode' = 'UNKNOWN_UNVERIFIED', false) AS e2e_unverified,
            CASE
              WHEN r.id IS NULL THEN 'MISSING_FAILED_RESPONSE'
              WHEN (c.metadata_json->>'statusCode' = 'FAILED'
                AND r.metadata_json->>'statusCode' = 'FAILED'
                AND r.checkpoint_json->>'status' = 'FAILED'
                AND r.checkpoint_json->>'statusCode' = 'FAILED'
                AND c.metadata_json->>'deliveryCode' = 'UNKNOWN_UNVERIFIED'
                AND c.metadata_json->>'e2eCode' = 'UNKNOWN_UNVERIFIED'
                AND r.metadata_json->>'deliveryCode' = c.metadata_json->>'deliveryCode'
                AND r.metadata_json->>'e2eCode' = c.metadata_json->>'e2eCode'
                AND r.checkpoint_json->>'deliveryCode' = c.metadata_json->>'deliveryCode'
                AND r.checkpoint_json->>'e2eCode' = c.metadata_json->>'e2eCode') IS NOT TRUE
                THEN 'TERMINAL_EVIDENCE_UNCONFIRMED'
              WHEN r.metadata_json->'chatgptSubmitted' = 'true'::jsonb
                OR r.metadata_json->'modelInvoked' = 'true'::jsonb
                OR r.metadata_json->'browserConfirmed' = 'true'::jsonb
                OR r.metadata_json->'verifiedAssistantReply' = 'true'::jsonb
                OR r.metadata_json->'verified' = 'true'::jsonb
                THEN 'REPORTED_EXECUTION_SIGNAL'
              WHEN r.metadata_json->'chatgptSubmitted' = 'false'::jsonb
                AND r.metadata_json->'modelInvoked' = 'false'::jsonb
                AND r.metadata_json->'browserConfirmed' = 'false'::jsonb
                AND r.metadata_json->'verifiedAssistantReply' = 'false'::jsonb
                AND r.metadata_json->'verified' = 'false'::jsonb
                THEN 'REPORTED_NO_EXECUTION_SIGNAL'
              ELSE 'INCOMPLETE_STAGE_EVIDENCE'
            END AS reconciliation_category
          FROM ai_task_bridge.jobs j
          JOIN ai_platform.ai_coding_bridge_commands c ON c.id = CASE
            WHEN j.external_id ~ '^bridge-command:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN split_part(j.external_id, ':', 2)::uuid ELSE NULL END
          LEFT JOIN LATERAL (
            SELECT id, metadata_json, checkpoint_json FROM ai_platform.ai_coding_bridge_responses
            WHERE command_id=c.id AND kind='FAILED'
            ORDER BY created_at DESC, id DESC LIMIT 1
          ) r ON true
          WHERE j.id=$1 AND j.source='AI_CORE' AND j.status='FAILED' AND c.status='FAILED'
          LIMIT 1`, [id],
        );
        const row = diagnostics.rows[0];
        if (row) failureDiagnostic = {
          source: "canonical_bridge_response",
          reasonCategory: row.reason_category,
          deliveryUnverified: row.delivery_unverified === true,
          e2eUnverified: row.e2e_unverified === true,
          reconciliationCategory: row.reconciliation_category,
          retryAllowed: false,
        };
      } catch (error) {
        // Optional diagnostic never makes the existing event history unavailable.
        console.warn("AI Task bridge failure diagnostic unavailable", error instanceof Error ? error.name : "unknown");
      }
    }
    res.json({ events: result.rows, failureDiagnostic });
  } catch (error) { queryError(res, error); }
});

attachBridgeCleanupRoutes(router);
attachBridgeDashboardVisibilityRoutes(router);

export default router;
