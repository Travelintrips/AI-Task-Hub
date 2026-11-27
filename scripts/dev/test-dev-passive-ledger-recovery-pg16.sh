#!/usr/bin/env bash
# Disposable, no-network PostgreSQL with synthetic rows only. Never use live DB.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
name="ledger-recovery-fixture-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
docker run --rm -d --network none --name "$name" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for i in $(seq 1 45); do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$name" pg_isready -U postgres >/dev/null
# Pull the exact checked-in query into PREPARE, not a duplicated test approximation.
python3 - "$root" "$tmp/test.sql" <<'PY'
from pathlib import Path
import sys
root, out = map(Path, sys.argv[1:])
source=(root/'artifacts/api-server/src/lib/dev-passive-ledger-recovery.ts').read_text()
query=source.split('export const SCOPED_DEV_PING_EVIDENCE_SQL = '+chr(96),1)[1].split(chr(96)+';',1)[0]
assert query.startswith('SELECT EXISTS') and '$1::uuid' in query
schema="""
\\set ON_ERROR_STOP on
CREATE SCHEMA ai_platform;
CREATE SCHEMA ai_task_bridge;
CREATE TABLE ai_platform.ai_coding_bridge_commands(
 id uuid PRIMARY KEY, source text, command_type text, task_id uuid, instruction text, status text, metadata_json jsonb
);
CREATE TABLE ai_platform.ai_coding_bridge_responses(
 id uuid PRIMARY KEY, command_id uuid, task_id uuid, kind text, message text, acknowledged_at timestamptz, metadata_json jsonb, checkpoint_json jsonb
);
CREATE TABLE ai_task_bridge.jobs(
 id uuid PRIMARY KEY, source text, external_id text, idempotency_key text, owner text, lease_token uuid,
 lease_until timestamptz, source_session_id text, status text, callback_id text, result_verified_at timestamptz, callback_received_at timestamptz
);
CREATE TABLE ai_task_bridge.job_events(job_id uuid,kind text);
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES(
 '11111111-1111-4111-8111-111111111111','ai-task-hub','EXTERNAL_AGENT_WORK',NULL,'ping','COMPLETED',
 '{"environment":"development","productionAllowed":false,"syntheticAudit":true,"auditPurpose":"DEV_PC_PING_ISSUE_249","explicitWorkerTarget":true,"assignedClientId":"openclaw-pc-worker-dev","claimedBy":"openclaw-pc-worker-dev","completedBy":"openclaw-pc-worker-dev","statusCode":"JOB_COMPLETED","deliveryCode":"UNKNOWN_UNVERIFIED","e2eCode":"UNKNOWN_UNVERIFIED"}'
);
INSERT INTO ai_platform.ai_coding_bridge_responses VALUES(
 '33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',NULL,'COMPLETED','pong from DELL',now(),
 '{"mode":"ping","runtime":"openclaw-pc2","statusCode":"JOB_COMPLETED","deliveryCode":"UNKNOWN_UNVERIFIED","e2eCode":"UNKNOWN_UNVERIFIED"}',
 '{"clientId":"openclaw-pc-worker-dev"}'
);
"""
# PostgreSQL PL/pgSQL can execute the exact prepared read-only query in the
# transaction and assert its scalar result. Each negative fixture rolls back.
sql=schema+"\nPREPARE evidence(uuid) AS "+query+";\n"
# Prepare is session-local. \gset converts the boolean to a psql conditional.
id="11111111-1111-4111-8111-111111111111"
def check(label, allowed, mutation=None, command_id=id):
 global sql
 sql+="BEGIN;\n"
 if mutation: sql+=mutation+";\n"
 sql+=f"EXECUTE evidence('{command_id}') \\gset\n"
 sql+="\\if :eligible\n"
 sql+=(f"\\echo PASS {label}\n" if allowed else f"\\echo FAIL {label}\\n\\quit 1\n")
 sql+="\\else\n"
 sql+=(f"\\echo FAIL {label}\\n\\quit 1\n" if allowed else f"\\echo PASS {label}\n")
 sql+="\\endif\\nROLLBACK;\n"
check("canonical_ping",True)
check("other_command",False,command_id="22222222-2222-4222-8222-222222222222")
check("wrong_source",False,"UPDATE ai_platform.ai_coding_bridge_commands SET source='ai-core'")
check("handshake",False,"UPDATE ai_platform.ai_coding_bridge_commands SET command_type='HANDSHAKE_CONTINUE'")
check("protected_wake",False,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"wakeBinding\":{}}'")
check("linked_task",False,"UPDATE ai_platform.ai_coding_bridge_commands SET task_id='22222222-2222-4222-8222-222222222222'")
check("nonterminal",False,"UPDATE ai_platform.ai_coding_bridge_commands SET status='PROCESSING'")
check("wrong_worker",False,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"completedBy\":\"other\"}'")
check("unacked_response",False,"UPDATE ai_platform.ai_coding_bridge_responses SET acknowledged_at=NULL")
check("wrong_result",False,"UPDATE ai_platform.ai_coding_bridge_responses SET message='pong from other'")
check("wrong_binding",False,"UPDATE ai_platform.ai_coding_bridge_responses SET checkpoint_json='{\"clientId\":\"other\"}'")
check("duplicate_terminal",False,"INSERT INTO ai_platform.ai_coding_bridge_responses SELECT '44444444-4444-4444-8444-444444444444',command_id,task_id,kind,message,acknowledged_at,metadata_json,checkpoint_json FROM ai_platform.ai_coding_bridge_responses")
check("unverified_e2e_not_promoted",False,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"e2eCode\":\"E2E_VERIFIED\"}'")
reg="INSERT INTO ai_task_bridge.jobs VALUES('22222222-2222-4222-8222-222222222222','AI_CORE','bridge-command:"+id+"','bridge-command:"+id+"',NULL,NULL,NULL,NULL,'QUEUED',NULL,NULL,NULL)"
check("same_idempotent_queued_ledger",True,reg)
check("conflicting_ledger_key",False,reg+"; UPDATE ai_task_bridge.jobs SET idempotency_key='wrong'")
check("leased_ledger",False,reg+"; UPDATE ai_task_bridge.jobs SET owner='other',lease_until=now()")
check("archived_ledger",False,reg+"; INSERT INTO ai_task_bridge.job_events VALUES('22222222-2222-4222-8222-222222222222','DASHBOARD_ARCHIVED')")
check("inconsistent_terminal_ledger",False,reg+"; UPDATE ai_task_bridge.jobs SET status='COMPLETED'")
check("source_ack_completed_ledger",True,reg+"; UPDATE ai_task_bridge.jobs SET status='COMPLETED',callback_id='core-source:'||id::text,callback_received_at=now(),result_verified_at=now()")
# Python source uses escaped newlines to construct psql meta commands.
out.write_text(sql)
PY
docker exec -i "$name" psql -X -U postgres -v ON_ERROR_STOP=1 < "$tmp/test.sql" | tee "$tmp/result"
test "$(grep -c '^PASS ' "$tmp/result")" -eq 19
! grep -q '^FAIL ' "$tmp/result"
echo 'SCOPED_DEV_LEDGER_SQL_FIXTURES=19/19_PASS'
