#!/usr/bin/env bash
# Synthetic fixture only: separate, no-network disposable PostgreSQL.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
name="dev-source-coverage-fixture-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
docker run --rm -d --network none --name "$name" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for i in $(seq 1 45); do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$name" pg_isready -U postgres >/dev/null
python3 - "$root" "$tmp/fixture.sql" <<'PY'
from pathlib import Path
import sys
root,out=map(Path,sys.argv[1:])
def extract(path,name):
    text=(root/path).read_text()
    return text.split('export const '+name+' = '+chr(96),1)[1].split(chr(96)+';',1)[0]
auto=extract('artifacts/api-server/src/lib/dev-passive-ledger-recovery.ts','AUTO_DEV_PING_EVIDENCE_SQL')
gap=extract('artifacts/api-server/src/lib/dev-bridge-source-gap.ts','DEV_BRIDGE_SOURCE_GAP_SQL')
assert auto.startswith('SELECT EXISTS') and gap.startswith('WITH missing AS')
# Reuse the exact previous synthetic schema, not any live business table.
old=(root/'scripts/dev/test-dev-passive-ledger-recovery-pg16.sh').read_text()
schema=old.split('schema="""',1)[1].split('"""',1)[0]
schema=schema.replace(chr(92)*2+'set',chr(92)+'set')
sql=schema+"""
ALTER TABLE ai_platform.ai_coding_bridge_commands ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||
 '{"origin":"ai-task-hub","executionBoundary":"role-scoped","requiredCapability":"tools:bounded","criticalActionsRequireAiCoreApproval":true}';
"""
sql+="PREPARE auto_evidence(uuid,timestamptz) AS "+auto+";\n"
id='11111111-1111-4111-8111-111111111111'
job='22222222-2222-4222-8222-222222222222'
bs=chr(92)
def check(label,expected,query,mutation=None):
    global sql
    sql+="BEGIN;\n"
    if mutation: sql+=mutation+";\n"
    sql+=query+" "+bs+"gset\n"
    sql+=bs+"if :eligible\n"
    sql+=bs+"echo "+("PASS" if expected else "FAIL")+" "+label+"\n"
    sql+=bs+"else\n"
    sql+=bs+"echo "+("FAIL" if expected else "PASS")+" "+label+"\n"
    sql+=bs+"endif\nROLLBACK;\n"
def evidence(label,expected,mutation=None,cutoff="now()-interval '1 day'"):
    check(label,expected,"EXECUTE auto_evidence('"+id+"',"+cutoff+")",mutation)
evidence('future_only_canonical_ping',True)
evidence('before_cutover',False,cutoff="now()+interval '1 day'")
evidence('unknown_metadata_denied',False,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"unreviewedField\":true}'")
evidence('protected_conversation_denied',False,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"conversationId\":\"fixture\"}'")
evidence('wrong_role_denied',False,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"executionBoundary\":\"other\"}'")
evidence('wrong_origin_denied',False,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"origin\":\"other\"}'")
evidence('unacknowledged_denied',False,"UPDATE ai_platform.ai_coding_bridge_responses SET acknowledged_at=NULL")
evidence('duplicate_terminal_denied',False,"INSERT INTO ai_platform.ai_coding_bridge_responses SELECT '44444444-4444-4444-8444-444444444444',command_id,task_id,kind,message,acknowledged_at,metadata_json,checkpoint_json FROM ai_platform.ai_coding_bridge_responses")
evidence('different_worker_denied',False,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"completedBy\":\"other\"}'")
evidence('handshake_denied',False,"UPDATE ai_platform.ai_coding_bridge_commands SET command_type='HANDSHAKE_CONTINUE'")
evidence('other_instruction_denied',False,"UPDATE ai_platform.ai_coding_bridge_commands SET instruction='other'")
reg="INSERT INTO ai_task_bridge.jobs VALUES('"+job+"','AI_CORE','bridge-command:"+id+"','bridge-command:"+id+"',NULL,NULL,NULL,NULL,'QUEUED',NULL,NULL,NULL)"
evidence('leased_registry_denied',False,reg+"; UPDATE ai_task_bridge.jobs SET lease_until=now()")
evidence('completed_replay',True,reg+"; UPDATE ai_task_bridge.jobs SET status='COMPLETED',callback_id='core-source:'||id::text,result_verified_at=now(),callback_received_at=now()")
def gap_check(label,expr,mutation=None):
    check(label,True,"WITH actual AS ("+gap+") SELECT ("+expr+") AS eligible FROM actual",mutation)
gap_check('gap_has_one_acked_source', "count(*)=1 AND min(total_count)=1 AND bool_and(source_ack_recorded) AND min(category)='OTHER_COMMAND'")
gap_check('gap_no_ack_invented', "count(*)=1 AND NOT bool_or(source_ack_recorded)", "UPDATE ai_platform.ai_coding_bridge_responses SET acknowledged_at=NULL")
gap_check('gap_duplicate_ack_not_verified', "count(*)=1 AND NOT bool_or(source_ack_recorded)", "INSERT INTO ai_platform.ai_coding_bridge_responses SELECT '44444444-4444-4444-8444-444444444444',command_id,task_id,kind,message,acknowledged_at,metadata_json,checkpoint_json FROM ai_platform.ai_coding_bridge_responses")
gap_check('gap_mirrored_excluded', "count(*)=0",reg)
gap_check('gap_archived_excluded', "count(*)=0",reg+"; INSERT INTO ai_task_bridge.job_events VALUES('"+job+"','DASHBOARD_ARCHIVED')")
gap_check('gap_old_excluded', "count(*)=0","UPDATE ai_platform.ai_coding_bridge_commands SET created_at=now()-interval '15 days'")
gap_check('gap_handshake_category', "count(*)=1 AND min(category)='HANDSHAKE'","UPDATE ai_platform.ai_coding_bridge_commands SET command_type='HANDSHAKE_CONTINUE'")
gap_check('gap_protected_category', "count(*)=1 AND min(category)='PROTECTED_WAKE'","UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"wakeBinding\":{}}'")
gap_check('gap_passive_category', "count(*)=1 AND min(category)='PASSIVE_EVENT' AND NOT bool_or(source_ack_recorded)","UPDATE ai_platform.ai_coding_bridge_commands SET command_type='EVENT_BINDING',status='RECEIVED'")
gap_check('gap_limit_and_exact_total', "count(*)=100 AND min(total_count)=106 AND max(total_count)=106",
    "INSERT INTO ai_platform.ai_coding_bridge_commands(id,source,command_type,task_id,instruction,status,metadata_json,created_at) SELECT gen_random_uuid(),'fixture','EXTERNAL_AGENT_WORK',NULL,'fixture','FAILED','{}',now() FROM generate_series(1,105)")
out.write_text(sql)
PY
docker exec -i "$name" psql -X -U postgres -v ON_ERROR_STOP=1 < "$tmp/fixture.sql" | tee "$tmp/result"
test "$(grep -c '^PASS ' "$tmp/result")" -eq 23
! grep -q '^FAIL ' "$tmp/result"
echo 'DEV_SOURCE_COVERAGE_SQL_FIXTURES=23/23_PASS'
