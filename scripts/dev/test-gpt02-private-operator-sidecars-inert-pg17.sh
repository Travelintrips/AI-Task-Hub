#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FILE="$ROOT/scripts/dev/gpt02-private-operator-sidecars-inert.sql"
NAME="gpt02-inert-operator-pg17-$$"
WORK="$(mktemp -d)"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
docker run -d --rm --network none --name "$NAME" -e POSTGRES_USER=fixture_root -e POSTGRES_DB=postgres -e POSTGRES_PASSWORD=fixture-only postgres:17-alpine >/dev/null
ready=false
for i in $(seq 1 55);do
 logs="$(docker logs "$NAME" 2>&1||true)"
 if [[ "$logs" == *'PostgreSQL init process complete'*'database system is ready to accept connections'* ]] &&
 docker exec "$NAME" psql -X -U fixture_root -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1;then ready=true;break;fi
 sleep 1
done
[[ "$ready" == true ]]||{ echo PG17_NOT_READY >&2;exit 2; }
run(){ docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U "$1" -d postgres -q; }
q(){ docker exec "$NAME" psql -X -v ON_ERROR_STOP=1 -U "$1" -d postgres -Atqc "$2"; }
run_migration(){ { printf 'BEGIN;\n';cat "$1";printf '\nCOMMIT;\n'; }|run postgres; }
[[ "$(q fixture_root 'SHOW server_version_num')" == 17* ]]||{ echo WRONG_PG_VERSION >&2;exit 2; }
run fixture_root <<'SQL' >/dev/null
CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE BYPASSRLS;
CREATE ROLE supabase_admin LOGIN NOSUPERUSER CREATEROLE;
CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
CREATE ROLE gpt02_core_prep_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
CREATE ROLE gpt02_core_prep_login NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
CREATE ROLE dev_gpt02_issuer_evidence NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
CREATE ROLE dev_gpt02_attestor_evidence NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE CONNECTION LIMIT 0;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
CREATE SCHEMA gpt02_stage AUTHORIZATION gpt02_core_prep_owner;
CREATE SCHEMA ai_platform;
CREATE TABLE public.ai_tasks(id integer PRIMARY KEY);
CREATE TABLE public.ai_execution_jobs(id uuid PRIMARY KEY,company_id text,status text);
CREATE TABLE ai_platform.ai_coding_tasks(id uuid PRIMARY KEY,task_number text);
CREATE TABLE gpt02_stage.core_preparations(id integer PRIMARY KEY);
GRANT USAGE ON SCHEMA gpt02_private,gpt02_stage,ai_platform TO postgres;
GRANT SELECT ON gpt02_stage.core_preparations TO postgres;
SET ROLE gpt02_store_owner;
CREATE TABLE gpt02_private.approvals(command_id uuid PRIMARY KEY,task_id integer NOT NULL,
 CONSTRAINT gpt02_approvals_future_task_only CHECK(task_id>136));
CREATE TABLE gpt02_private.receipts(id uuid PRIMARY KEY,command_id uuid NOT NULL UNIQUE
 REFERENCES gpt02_private.approvals(command_id),nonce text);
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON gpt02_private.approvals TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_only ON gpt02_private.receipts TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE FUNCTION gpt02_private.reject_mutation() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
 BEGIN RAISE EXCEPTION 'APPEND_ONLY_EVIDENCE'; END $$;
CREATE TRIGGER immutable_approvals BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_private.approvals
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_private.receipts
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_private.reject_mutation();
RESET ROLE;
GRANT SELECT ON gpt02_private.approvals,gpt02_private.receipts TO postgres;
GRANT gpt02_store_owner TO supabase_admin WITH ADMIN TRUE;
GRANT gpt02_store_owner TO supabase_admin WITH SET FALSE;
GRANT gpt02_store_owner TO supabase_admin WITH INHERIT FALSE;
SQL
run supabase_admin <<'SQL' >/dev/null
GRANT gpt02_store_owner TO postgres WITH ADMIN TRUE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
GRANT gpt02_store_owner TO postgres WITH INHERIT FALSE;
SQL
run postgres <<'SQL' >/dev/null
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
GRANT gpt02_store_owner TO postgres WITH INHERIT FALSE;
SQL
membership(){ q postgres "SELECT g.rolname||':'||m.admin_option||':'||m.inherit_option||':'||m.set_option FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole ORDER BY g.rolname"; }
initial="$(membership)"
[[ "$initial" == "$(printf 'postgres:false:false:false\nsupabase_admin:true:false:false')" ]]||{ echo BAD_OWNER_BASELINE >&2;exit 1; }
echo PASS:INERT_OWNER_ROLE_GRAPH
python3 - "$FILE" "$WORK/fail.sql" <<'PY'
import sys
from pathlib import Path
s=Path(sys.argv[1]).read_text();needle='SET ROLE gpt02_store_owner;\n'
assert s.count(needle)==1
Path(sys.argv[2]).write_text(s.replace(needle,needle+"DO $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$;\n"))
PY
if run_migration "$WORK/fail.sql" >"$WORK/fail.log" 2>&1;then echo PARTIAL_COMMIT_ON_FAIL >&2;exit 1;fi
grep -Fq 'synthetic rollback' "$WORK/fail.log"||{ tail -20 "$WORK/fail.log";exit 1; }
[[ "$(membership)" == "$initial" ]]||{ echo LEAKED_SET_ROLE >&2;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private' AND c.relname IN('operator_links','core_identity_receipts')")" == 0 ]]||{ echo STAGED_AFTER_ROLLBACK >&2;exit 1; }
echo PASS:POST_GRANT_TRANSACTION_ROLLBACK
run fixture_root <<<"INSERT INTO gpt02_private.approvals VALUES ('8cc32c08-f9c2-4312-b1ad-a65fd4f14e2e',137);" >/dev/null
if run_migration "$FILE" >"$WORK/history.log" 2>&1;then echo NONEMPTY_APPROVAL_ACCEPTED >&2;exit 1;fi
grep -Fq GPT02_INERT_EVIDENCE_HISTORY_NOT_EMPTY "$WORK/history.log"||{ tail -15 "$WORK/history.log";exit 1; }
run fixture_root <<<"DELETE FROM gpt02_private.approvals;" >/dev/null
echo PASS:NONEMPTY_APPROVAL_REJECTED
run_migration "$FILE" >"$WORK/staged.log" 2>&1||{ tail -40 "$WORK/staged.log";exit 1; }
[[ "$(membership)" == "$initial" ]]||{ echo ROLE_GRAPH_DRIFT >&2;exit 1; }
[[ "$(q postgres "SELECT pg_has_role('postgres','gpt02_store_owner','SET')")" == f ]]||{ echo OWNER_ROLE_USABLE >&2;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private' AND c.relname IN('operator_links','core_identity_receipts') AND pg_get_userbyid(c.relowner)='gpt02_store_owner' AND c.relrowsecurity AND c.relforcerowsecurity")" == 2 ]]||{ echo SIDE_CAR_PRIVATE_RLS_DRIFT >&2;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM pg_constraint c WHERE c.conrelid='gpt02_private.receipts'::regclass AND c.conname='receipt_identity_tuple' AND c.contype='u'")" == 1 ]]||{ echo RECEIPT_UNIQUENESS_MISSING >&2;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private' AND c.relname IN('operator_links','core_identity_receipts') AND has_table_privilege('postgres',c.oid,'SELECT,INSERT,UPDATE,DELETE')")" == 0 ]]||{ echo PRIVILEGED_APP_SEES_PRIVATE_SIDECAR >&2;exit 1; }
[[ "$(q fixture_root "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private' AND c.relname IN('operator_links','core_identity_receipts') AND has_table_privilege('dev_gpt02_issuer_evidence',c.oid,'SELECT,INSERT,UPDATE,DELETE')")" == 0 ]]||{ echo ISSUER_RECEIVED_PRIVATE_DML >&2;exit 1; }
[[ "$(q fixture_root "SELECT (SELECT count(*) FROM gpt02_private.operator_links)||':'||(SELECT count(*) FROM gpt02_private.core_identity_receipts)||':'||(SELECT count(*) FROM gpt02_private.approvals)||':'||(SELECT count(*) FROM gpt02_private.receipts)")" == 0:0:0:0 ]]||{ echo EVIDENCE_MUTATED >&2;exit 1; }
echo PASS:EXACT_PRIVATE_LINK_FK_RLS_ACL_NO_DATA
if run fixture_root <<<"UPDATE gpt02_private.operator_links SET company_id='other';" >"$WORK/update.log" 2>&1;then echo IMMUTABILITY_UPDATE_BYPASSED >&2;exit 1;fi
grep -Fq APPEND_ONLY_EVIDENCE "$WORK/update.log"||{ tail -10 "$WORK/update.log";exit 1; }
if run fixture_root <<<"TRUNCATE gpt02_private.core_identity_receipts CASCADE;" >"$WORK/truncate.log" 2>&1;then echo IMMUTABILITY_TRUNCATE_BYPASSED >&2;exit 1;fi
grep -Fq APPEND_ONLY_EVIDENCE "$WORK/truncate.log"||{ tail -10 "$WORK/truncate.log";exit 1; }
echo PASS:APPEND_ONLY_LINKED_EVIDENCE
if run_migration "$FILE" >"$WORK/reapply.log" 2>&1;then echo DUPLICATE_STAGING_ALLOWED >&2;exit 1;fi
grep -Fq GPT02_INERT_EVIDENCE_ALREADY_STAGED "$WORK/reapply.log"||{ tail -20 "$WORK/reapply.log";exit 1; }
[[ "$(membership)" == "$initial" ]]||{ echo ROLE_GRAPH_CHANGED_ON_RETRY >&2;exit 1; }
echo PASS:RETRY_FAIL_CLOSED
echo GPT02_PRIVATE_LINKED_PROOF_SCHEMA_INERT_PG17_PASS
