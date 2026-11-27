/** One-command DEV-only passive ledger recovery. No dispatch or grant authority. */
const host = "dev-ai-task.cstlogistic.co.id";
const project = "xssrfshdrtdfupgqwfdw";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function scopedDevLedgerRecoveryCommand(env: NodeJS.ProcessEnv, hostname: string): string | null {
  const id = env.AI_TASK_DEV_PASSIVE_LEDGER_RECOVERY_COMMAND_ID;
  if (hostname !== host || env.NODE_ENV !== "development" ||
      (env.APP_ENV !== undefined && env.APP_ENV !== "development") ||
      env.PUBLIC_APP_BASE_URL !== "https://" + host ||
      env.SUPABASE_URL_DEV !== "https://" + project + ".supabase.co" ||
      env.RUN_STARTUP_MIGRATIONS !== "false" ||
      env.SUPABASE_DATABASE_URL || env.SUPABASE_PROD_DATABASE_URL ||
      env.SUPABASE_DEV_DATABASE_URL || env.DATABASE_URL ||
      env.AI_TASK_PROD_SOURCE_RECONCILE_ENABLED === "true" ||
      !id || !uuid.test(id)) return null;
  try {
    const u = new URL(env.SUPABASE_DATABASE_URL_DEV ?? "");
    if (!["postgres:", "postgresql:"].includes(u.protocol) ||
        (u.hostname !== "db." + project + ".supabase.co" &&
         !(u.hostname.endsWith(".pooler.supabase.com") && u.username.endsWith("." + project)))) return null;
  } catch { return null; }
  return id;
}
export function scopedDevLedgerRegistrationAllowed(id: string, input: {
  source: unknown; externalId: unknown; key: unknown; title: unknown; sessionId: unknown;
}): boolean {
  const externalId = "bridge-command:" + id;
  return input.source === "AI_CORE" && input.externalId === externalId &&
    input.key === externalId && input.title === "AI Core bridge command " + id.slice(0,8) &&
    input.sessionId === null;
}
export function scopedDevLedgerEventAllowed(id: string, input: {
  source: unknown; externalId: unknown; key: unknown; owner: unknown;
  leaseToken: unknown; leaseUntil: unknown; status: unknown; eventId: unknown;
  callbackId: unknown; jobId: string;
}): boolean {
  const externalId = "bridge-command:" + id;
  const validState = input.status === "QUEUED" ? input.callbackId === null :
    ["WAITING_FOR_ACK","COMPLETED"].includes(String(input.status)) &&
    input.callbackId === "core-source:" + input.jobId;
  return input.source === "AI_CORE" && input.externalId === externalId &&
    input.key === externalId && input.owner === null && input.leaseToken === null &&
    input.leaseUntil === null && validState &&
    input.eventId === "ai-core:" + externalId + ":COMPLETED:terminal";
}

// Query only the pinned, real, completed model-free DEV audit. Generic source
// COMPLETED, a browser claim, or a producer-provided ACK is not sufficient.
// No raw instruction, metadata, or response message is returned.
export const SCOPED_DEV_PING_EVIDENCE_SQL = `SELECT EXISTS (
 SELECT 1
 FROM ai_platform.ai_coding_bridge_commands c
 WHERE c.id=$1::uuid AND c.source='ai-task-hub'
   AND c.command_type='EXTERNAL_AGENT_WORK' AND c.task_id IS NULL
   AND c.instruction='ping' AND c.status='COMPLETED'
   AND c.metadata_json->>'environment'='development'
   AND c.metadata_json->>'productionAllowed'='false'
   AND c.metadata_json->>'syntheticAudit'='true'
   AND c.metadata_json->>'auditPurpose'='DEV_PC_PING_ISSUE_249'
   AND c.metadata_json->>'explicitWorkerTarget'='true'
   AND c.metadata_json->>'assignedClientId'='openclaw-pc-worker-dev'
   AND c.metadata_json->>'claimedBy'='openclaw-pc-worker-dev'
   AND c.metadata_json->>'completedBy'='openclaw-pc-worker-dev'
   AND c.metadata_json->>'statusCode'='JOB_COMPLETED'
   AND c.metadata_json->>'deliveryCode'='UNKNOWN_UNVERIFIED'
   AND c.metadata_json->>'e2eCode'='UNKNOWN_UNVERIFIED'
   AND NOT (c.metadata_json ?| array['executionJobId','wakeBinding','assistantAttestationChallenge','gpt02TaskId','accountAlias','browserProfile'])
   AND COALESCE(c.metadata_json->>'capability','')<>'chatgpt:wake'
   AND (SELECT count(*) FROM ai_platform.ai_coding_bridge_responses r
        WHERE r.command_id=c.id AND r.kind IN ('COMPLETED','FAILED'))=1
   AND EXISTS (SELECT 1 FROM ai_platform.ai_coding_bridge_responses r
     WHERE r.command_id=c.id AND r.task_id IS NULL AND r.kind='COMPLETED'
       AND r.message='pong from DELL' AND r.acknowledged_at IS NOT NULL
       AND r.metadata_json->>'mode'='ping' AND r.metadata_json->>'runtime'='openclaw-pc2'
       AND r.checkpoint_json->>'clientId'='openclaw-pc-worker-dev'
       AND r.metadata_json->>'statusCode'='JOB_COMPLETED'
       AND r.metadata_json->>'deliveryCode'='UNKNOWN_UNVERIFIED'
       AND r.metadata_json->>'e2eCode'='UNKNOWN_UNVERIFIED')
   AND NOT EXISTS (SELECT 1 FROM ai_task_bridge.jobs j
     WHERE j.source='AI_CORE' AND j.external_id='bridge-command:'||c.id::text
       AND (j.idempotency_key<>j.external_id OR j.owner IS NOT NULL OR j.lease_token IS NOT NULL
         OR j.lease_until IS NOT NULL OR j.source_session_id IS NOT NULL
         OR j.status NOT IN ('QUEUED','WAITING_FOR_ACK','COMPLETED')
         OR (j.status='QUEUED' AND (j.callback_id IS NOT NULL OR j.result_verified_at IS NOT NULL OR j.callback_received_at IS NOT NULL))
         OR (j.status='WAITING_FOR_ACK' AND (j.callback_id IS DISTINCT FROM 'core-source:'||j.id::text OR j.result_verified_at IS NOT NULL OR j.callback_received_at IS NOT NULL))
         OR (j.status='COMPLETED' AND (j.callback_id IS DISTINCT FROM 'core-source:'||j.id::text OR j.result_verified_at IS NULL OR j.callback_received_at IS NULL))
         OR EXISTS(SELECT 1 FROM ai_task_bridge.job_events ev WHERE ev.job_id=j.id AND ev.kind='DASHBOARD_ARCHIVED')))
) AS eligible`;
