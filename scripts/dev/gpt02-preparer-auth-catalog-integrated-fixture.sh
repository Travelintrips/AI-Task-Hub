#!/usr/bin/env bash
# Sourced only from the network-isolated PG17 dormant function/owner-grant fixture.
# All credentials here are synthetic; NEVER run against a hosted database.
set -euo pipefail
[[ "${NODE_IMAGE:-}" == 'postgres:17-alpine' ]] || { echo GPT02_PG17_ONLY >&2; return 2; }
[[ "${NAME:-}" == gpt02-dormant-fn-pg17-* ]] || { echo GPT02_FIXTURE_CONTAINER_REQUIRED >&2; return 2; }
[[ "$(docker inspect "$NAME" --format '{{.HostConfig.NetworkMode}}')" == none ]] || {
 echo GPT02_FIXTURE_MUST_HAVE_NO_NETWORK >&2; return 2;
}
[[ "$(q postgres "SELECT (NOT rolcanlogin AND rolconnlimit=0 AND rolvaliduntil<clock_timestamp()) FROM pg_roles WHERE rolname='gpt02_core_prep_login'")" == t ]] || {
 echo GPT02_FIXTURE_ROLE_NOT_DORMANT >&2; return 2;
}
[[ "$(q fixture_root "SELECT count(*) FROM pg_hba_file_rules WHERE type='host' AND auth_method='scram-sha-256' AND error IS NULL")" -ge 1 ]] || {
 echo GPT02_FIXTURE_HOST_SCRAM_REQUIRED >&2; return 2;
}
# The old worker/issuer never runs. This is password AUTHENTICATION only.
FIXTURE_PASS='gpt02-fixture-scram-not-a-real-secret'
expiry="$(date -u -d '+30 minutes' '+%Y-%m-%d %H:%M:%S+00')"
run fixture_root <<SQL >/dev/null
SET password_encryption='scram-sha-256';
ALTER ROLE gpt02_core_prep_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1
  PASSWORD '$FIXTURE_PASS' VALID UNTIL '$expiry';
SQL
[[ "$(q fixture_root "SELECT rolpassword LIKE 'SCRAM-SHA-256$%' FROM pg_authid WHERE rolname='gpt02_core_prep_login'")" == t ]] || {
 echo GPT02_FIXTURE_LOGIN_PASSWORD_NOT_SCRAM >&2; return 1;
}
auth(){
 docker exec -e "PGPASSWORD=$1" "$NAME" psql -X -v ON_ERROR_STOP=1 -Atq -h 127.0.0.1 -p 5432 \
  -U gpt02_core_prep_login -d postgres
}
if printf 'SELECT 1;\n' | auth 'intentionally-wrong-synthetic' >"$WORK/login-wrong.log" 2>&1; then
 echo GPT02_FIXTURE_WRONG_PASSWORD_ACCEPTED >&2; return 1;
fi
grep -Fq 'password authentication failed' "$WORK/login-wrong.log" || {
 echo GPT02_FIXTURE_WRONG_PASSWORD_REASON >&2; return 1;
}
echo PASS:PG17_SCOPED_LOGIN_WRONG_PASSWORD_REJECTED
# Read the EXACT checker's query from source (not a parallel hand-written query).
node --input-type=module - "$ROOT/scripts/dev/gpt02-preparer-dedicated-login-readonly.mjs" >"$WORK/dedicated-catalog.sql" <<'JS'
import {pathToFileURL} from 'node:url';
const {QUERY}=await import(pathToFileURL(process.argv[2]).href);
if(typeof QUERY!=='string'||!QUERY.startsWith('SELECT')||!QUERY.includes('exact_rls'))
 throw Error('CATALOG_ONLY_QUERY_REQUIRED');
process.stdout.write('BEGIN READ ONLY;\nSELECT row_to_json(v) FROM ('+QUERY+') AS v;\nROLLBACK;\n');
JS
auth "$FIXTURE_PASS" <"$WORK/dedicated-catalog.sql" >"$WORK/dedicated-result.log" 2>&1 || {
 tail -20 "$WORK/dedicated-result.log" >&2; return 1;
}
node - "$WORK/dedicated-result.log" <<'JS'
const fs=require('node:fs');
const lines=fs.readFileSync(process.argv[2],'utf8').split('\n').map(x=>x.trim());
const rows=lines.filter(x=>x.startsWith('{'));
if(rows.length!==1)throw Error('ONE_AUTHENTICATED_READBACK_REQUIRED');
const row=JSON.parse(rows[0]);
const required={db:'postgres',login:'gpt02_core_prep_login',session:'gpt02_core_prep_login',
 in_readonly_tx:true,bounded_role:true,no_memberships:true,no_database_create:true,
 no_stage_usage:true,no_core_schema_usage:true,dormant_unusable:true,no_operational_function:true,
 exact_owner_grants_no_direct_dml:true,exact_rls:true,dormant_other_roles:true};
for(const [k,v] of Object.entries(required)){
 if(row[k]!==v)throw Error('CST_DEV_CATALOG_PROOF_MISMATCH:'+k+':'+String(row[k]));
}
JS
echo PASS:PG17_REAL_SCRAM_SESSION_EXACT_READONLY_CATALOG_QUERY
# A successful authenticated read does not create command/approval/task state.
[[ "$(q postgres "SELECT (SELECT COUNT(*) FROM gpt02_stage.core_preparations)::text||':'||
 (SELECT COUNT(*) FROM public.ai_execution_jobs)||':'||
 (SELECT COUNT(*) FROM ai_platform.ai_coding_tasks)||':'||
 (SELECT COUNT(*) FROM gpt02_private.approvals)||':'||
 (SELECT COUNT(*) FROM gpt02_private.receipts)")" == '0:0:0:0:0' ]] || {
 echo GPT02_FIXTURE_AUTH_PROBE_MUTATED_LEDGER >&2; return 1;
}
# Revoke the LOGIN capability and clear the SCRAM verifier. No role credentials
# or activation are ever stored in Git, Supabase or the user's environment.
run fixture_root <<'SQL' >/dev/null
ALTER ROLE gpt02_core_prep_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
 NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0
 PASSWORD NULL VALID UNTIL '2000-01-01';
SQL
[[ "$(q fixture_root "SELECT (NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL
  AND rolvaliduntil<clock_timestamp()) FROM pg_authid WHERE rolname='gpt02_core_prep_login'")" == t ]] || {
 echo GPT02_FIXTURE_LOGIN_NOT_RESTORED >&2; return 1;
}
if printf 'SELECT 1;\n' | auth "$FIXTURE_PASS" >"$WORK/login-restored-denied.log" 2>&1;then
 echo GPT02_FIXTURE_ROLE_STILL_AUTHENTICATES >&2; return 1;
fi
echo PASS:PG17_SCOPED_LOGIN_REVERTED_TO_NOLOGIN_PASSWORD_NULL
echo GPT02_PREPARER_PG17_AUTHENTICATED_CATALOG_ISOLATED_PASS_NO_DISPATCH
