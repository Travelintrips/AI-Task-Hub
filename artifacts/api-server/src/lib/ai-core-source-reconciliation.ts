/**
 * DEV-only source-database reconciliation for passive AI Core ledger events.
 * It never claims or dispatches a worker, and independently verifies every ACK.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { canonicalAiCoreSource, parseAiCoreExternalId, verifyAndAckAiCoreSource } from "./ai-core-source-verifier";
import { devSourceReconciliationEnabled } from "./ai-core-source-reconciliation-policy";

type Job = { id: string; external_id: string; status: string; callback_id: string | null; source?: string };
const POLL_MS = 60_000;
const BATCH_SIZE = 16;

async function reconcileOne(job: Job): Promise<boolean> {
  const source = parseAiCoreExternalId(job.external_id);
  if (!source) return false;
  if (job.status === "WAITING_FOR_ACK") {
    if (job.callback_id !== "core-source:" + job.id) return false;
    return verifyAndAckAiCoreSource(job.id, job.callback_id);
  }
  if (!["QUEUED", "WAITING_FOR_WORKER", "SUSPECTED_STALL", "RUNNING"].includes(job.status)) return false;

  const initial = await canonicalAiCoreSource(source);
  if (initial?.status !== "COMPLETED" && initial?.status !== "FAILED") return false;
  const terminal = initial.status;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<Job>(
      "SELECT id,source,external_id,status,callback_id FROM ai_task_bridge.jobs WHERE id=$1 FOR UPDATE",
      [job.id],
    );
    const latest = locked.rows[0];
    if (!latest || latest.source !== "AI_CORE" ||
        !["QUEUED", "WAITING_FOR_WORKER", "SUSPECTED_STALL", "RUNNING"].includes(latest.status) ||
        latest.external_id !== job.external_id) {
      await client.query("ROLLBACK");
      return false;
    }
    const record = await client.query<{ status: string; result_summary?: string | null; error_message?: string | null }>(
      source.kind === "coding-task"
        ? "SELECT status,result_summary FROM ai_platform.ai_coding_tasks WHERE id=$1"
        : "SELECT status,error_message FROM ai_platform.ai_coding_workstreams WHERE id=$1",
      [source.id],
    );
    if (record.rows[0]?.status !== terminal) {
      await client.query("ROLLBACK");
      return false;
    }
    const kind = terminal === "COMPLETED" ? "RESULT_RECORDED" : "WORKER_FAILED";
    const eventId = "ai-task:source-reconcile:" + job.id + ":" + terminal;
    const summary = String(record.rows[0]?.result_summary ??
      record.rows[0]?.error_message ?? "AI Core canonical source " + terminal).slice(0, 2000);
    await client.query(
      "INSERT INTO ai_task_bridge.job_events(job_id,event_id,kind,sender,payload) " +
      "VALUES($1,$2,$3,'ai-task-source-reconciler',jsonb_build_object('status',$4::text)) " +
      "ON CONFLICT(event_id) DO NOTHING",
      [job.id, eventId, kind, terminal],
    );
    if (terminal === "COMPLETED") {
      await client.query(
        "UPDATE ai_task_bridge.jobs SET status='WAITING_FOR_ACK',callback_id=$2," +
        "result_summary=$3,updated_at=now() WHERE id=$1",
        [job.id, "core-source:" + job.id, summary],
      );
    } else {
      await client.query(
        "UPDATE ai_task_bridge.jobs SET status='FAILED',result_summary=$2,updated_at=now() WHERE id=$1",
        [job.id, summary],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  // The receiver ACK is a separate transaction and independently rechecks
  // the persisted AI Core source. No ACK is inferred from result insertion.
  return terminal === "FAILED" || verifyAndAckAiCoreSource(job.id, "core-source:" + job.id);
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function reconcileAiCoreSourceTerminalJobs(): Promise<{
  scanned: number; repaired: number; errors: number;
}> {
  if (!devSourceReconciliationEnabled() || running) return { scanned: 0, repaired: 0, errors: 0 };
  running = true;
  try {
    const result = await pool.query<Job>(
      "SELECT id,external_id,status,callback_id FROM ai_task_bridge.jobs " +
      "WHERE source='AI_CORE' AND status IN ('QUEUED','WAITING_FOR_WORKER','SUSPECTED_STALL','RUNNING','WAITING_FOR_ACK') " +
      "AND created_at >= now() - interval '14 days' ORDER BY updated_at ASC LIMIT $1",
      [BATCH_SIZE],
    );
    let repaired = 0;
    let errors = 0;
    for (const job of result.rows) {
      try {
        if (await reconcileOne(job)) repaired += 1;
      } catch (error) {
        errors += 1;
        logger.warn({ jobId: job.id, errorName: error instanceof Error ? error.name : "unknown" },
          "[ai-task-dev] source reconciliation will retry");
      }
    }
    if (repaired > 0 || errors > 0) logger.info({
      scanned: result.rows.length, repaired, errors,
    }, "[ai-task-dev] source reconciliation batch");
    return { scanned: result.rows.length, repaired, errors };
  } finally {
    running = false;
  }
}

export function startDevAiCoreSourceReconciliationRuntime(): void {
  if (!devSourceReconciliationEnabled() || timer) return;
  const poll = () => void reconcileAiCoreSourceTerminalJobs().catch((error: unknown) => {
    logger.warn({ errorName: error instanceof Error ? error.name : "unknown" },
      "[ai-task-dev] reconciliation batch will retry");
  });
  poll();
  timer = setInterval(poll, POLL_MS);
  timer.unref?.();
}
