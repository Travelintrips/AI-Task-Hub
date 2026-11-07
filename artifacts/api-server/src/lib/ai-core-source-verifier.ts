/**
 * AI Core is the only coding dispatcher. This module observes canonical
 * AI Core task/workstream records in the shared private database and never
 * grants a new worker lease or executes a job.
 */
import { pool } from "@workspace/db";

type SourceRow = {
  status: string;
  worker_id?: string | null;
  result_summary?: string | null;
  error_message?: string | null;
};
export type SourceLookup = { kind: "coding-task" | "coding-workstream" | "bridge-command"; id: string };

export function parseAiCoreExternalId(value: string): SourceLookup | null {
  const match = /^(coding-task|coding-workstream|bridge-command):([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.exec(value);
  if (!match) return null;
  return { kind: match[1] as SourceLookup["kind"], id: match[2]! };
}

export async function canonicalAiCoreSource(input: SourceLookup): Promise<SourceRow | null> {
  const sql = input.kind === "coding-task"
    ? "SELECT status,result_summary FROM ai_platform.ai_coding_tasks WHERE id=$1"
    : input.kind === "coding-workstream" ? "SELECT status,worker_id,error_message FROM ai_platform.ai_coding_workstreams WHERE id=$1" : "SELECT status FROM ai_platform.ai_coding_bridge_commands WHERE id=$1";
  const query = await pool.query<SourceRow>(sql, [input.id]);
  return query.rows[0] ?? null;
}

export function isCanonicalAiCoreDone(status: string): boolean {
  return status === "COMPLETED";
}

export function observeKind(status: string): string {
  if (status === "COMPLETED") return "RESULT_RECORDED";
  if (status === "FAILED" || status === "CANCELLED") return "WORKER_FAILED";
  if (status === "RUNNING" || status === "CLAIMED" || status === "CODING") return "JOB_CLAIMED";
  return "SOURCE_PROGRESS";
}

/** Independent, source-database-based ACK receiver; a producer cannot
 * authorize this receipt merely by claiming a successful status. */
export async function verifyAndAckAiCoreSource(
  jobId: string,
  callbackId: string,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      source: string; external_id: string; status: string; callback_id: string | null;
    }>(
      "SELECT source,external_id,status,callback_id FROM ai_task_bridge.jobs WHERE id=$1 FOR UPDATE",
      [jobId],
    );
    const job = current.rows[0];
    if (!job || job.source !== "AI_CORE" || job.status !== "WAITING_FOR_ACK" ||
        job.callback_id !== callbackId) {
      await client.query("ROLLBACK");
      return false;
    }
    const source = parseAiCoreExternalId(job.external_id);
    if (!source) { await client.query("ROLLBACK"); return false; }
    const canonical = await client.query<{ status: string }>(
      source.kind === "coding-task"
        ? "SELECT status FROM ai_platform.ai_coding_tasks WHERE id=$1"
        : source.kind === "coding-workstream" ? "SELECT status FROM ai_platform.ai_coding_workstreams WHERE id=$1" : "SELECT status FROM ai_platform.ai_coding_bridge_commands WHERE id=$1",
      [source.id],
    );
    if (!canonical.rows[0] || !isCanonicalAiCoreDone(canonical.rows[0].status)) {
      await client.query("ROLLBACK");
      return false;
    }
    const receiptId = "core-verified:" + jobId + ":" + callbackId;
    await client.query(
      `INSERT INTO ai_task_bridge.job_events(job_id,event_id,kind,sender,payload)
       VALUES ($1,$2,'CALLBACK_ACK','ai-task-source-verifier',jsonb_build_object('callbackId',$3::text))
       ON CONFLICT (event_id) DO NOTHING`,
      [jobId, receiptId, callbackId],
    );
    await client.query(
      `UPDATE ai_task_bridge.jobs SET status='COMPLETED',
        callback_received_at=now(),result_verified_at=now(),updated_at=now()
       WHERE id=$1 AND status='WAITING_FOR_ACK' AND callback_id=$2`,
      [jobId,callbackId],
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
