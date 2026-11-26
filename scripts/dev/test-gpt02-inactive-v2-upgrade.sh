#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="gpt02-v2-contract-test-$$"; CID=''; OUT="$(mktemp -d)"; chmod 700 "$OUT"
trap '[[ -z "$CID" ]] || docker rm -fv "$CID" >/dev/null 2>&1 || true; rm -rf "$OUT"' EXIT
CID="$(docker run -d --network none --name "$NAME" -e POSTGRES_PASSWORD=isolated-fixture-only postgres:16-alpine)"
psqlc(){ docker exec -i "$CID" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }
for _ in $(seq 1 40); do
 if docker logs "$CID" 2>&1 | grep -Fq 'PostgreSQL init process complete' && psqlc -c 'SELECT 1' >/dev/null 2>&1; then break; fi
 sleep 1
done
psqlc -c 'SELECT 1' >/dev/null
base(){
 psqlc >"$OUT/reset.log" 2>&1 <<'SQL' || { cat "$OUT/reset.log"; exit 1; }
DROP SCHEMA IF EXISTS gpt02_private CASCADE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='gpt02_store_owner') THEN EXECUTE 'DROP OWNED BY gpt02_store_owner'; END IF; END $$;
DROP ROLE IF EXISTS dev_gpt02_attestor_evidence,dev_gpt02_issuer_evidence,gpt02_store_owner;
SQL
 psqlc < "$ROOT/scripts/dev/gpt02-cst-dev-evidence-preparation.sql" >"$OUT/base.log" 2>&1 || { cat "$OUT/base.log"; exit 1; }
}
apply(){ psqlc < "$ROOT/scripts/dev/gpt02-cst-dev-inactive-v2-upgrade.sql" >"$OUT/apply.log" 2>&1; }
expect(){ local label=$1 expected=$2; if apply; then echo "FAIL:$label:unexpected-success"; exit 1; fi; grep -Fq "$expected" "$OUT/apply.log" || { cat "$OUT/apply.log"; exit 1; }; [[ "$(psqlc -c "SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid='gpt02_private.approvals'::regclass AND attname='approver_id'")" == bigint ]]; echo "PASS:$label"; }
base; apply || { cat "$OUT/apply.log"; exit 1; }
checks="$(psqlc <<'SQL'
SELECT 'TEXT_EXACT',count(*)=2 AND bool_and(atttypid='text'::regtype AND attnotnull) FROM pg_attribute WHERE attrelid='gpt02_private.approvals'::regclass AND attname IN ('approver_id','operator_namespace') AND NOT attisdropped;
SELECT 'LOCKED',count(*)=3 AND bool_and(NOT rolcanlogin AND rolconnlimit=0 AND NOT rolbypassrls AND NOT rolcreaterole) FROM pg_roles WHERE rolname IN ('gpt02_store_owner','dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence');
SELECT 'EMPTY',(SELECT count(*) FROM gpt02_private.approvals)=0 AND (SELECT count(*) FROM gpt02_private.receipts)=0;
SELECT 'FORCE_RLS',count(*)=2 AND bool_and(relrowsecurity AND relforcerowsecurity AND relowner='gpt02_store_owner'::regrole) FROM pg_class WHERE oid IN ('gpt02_private.approvals'::regclass,'gpt02_private.receipts'::regclass);
SELECT 'NO_GRANTS',NOT has_schema_privilege('dev_gpt02_issuer_evidence','gpt02_private','USAGE,CREATE') AND NOT has_table_privilege('dev_gpt02_attestor_evidence','gpt02_private.approvals','INSERT,SELECT,UPDATE,DELETE');
SELECT 'NO_SET_AUTH',NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='gpt02_store_owner'::regrole AND member='postgres'::regrole AND (set_option OR inherit_option));
SQL
)"
for label in TEXT_EXACT LOCKED EMPTY FORCE_RLS NO_GRANTS NO_SET_AUTH; do grep -Fqx "$label|t" <<< "$checks" || exit 1; echo "PASS:$label"; done
base; psqlc >/dev/null <<'SQL'
INSERT INTO gpt02_private.approvals(command_id,attempt_id,nonce,task_id,company_id,approver_id,claims,signature,digest,expires_at) VALUES(gen_random_uuid(),gen_random_uuid(),repeat('a',32),800,'fixture',9,'{}',repeat('a',86),repeat('a',64),now()+interval '1 minute');
SQL
expect NONEMPTY_DENIED NONEMPTY_EVIDENCE_REFUSES_RETYPE
base; psqlc -c 'ALTER ROLE dev_gpt02_issuer_evidence LOGIN' >/dev/null; expect ACTIVE_ROLE_DENIED CANDIDATE_ROLES_NOT_LOCKED
base; psqlc -c 'ALTER TABLE gpt02_private.approvals NO FORCE ROW LEVEL SECURITY' >/dev/null; expect RLS_DRIFT_DENIED FOUNDATION_OWNERSHIP_OR_RLS_DRIFT
base; psqlc -c 'ALTER TABLE gpt02_private.approvals DISABLE TRIGGER immutable_approvals' >/dev/null; expect TRIGGER_DRIFT_DENIED IMMUTABLE_TRIGGER_DRIFT
base; psqlc -c 'GRANT USAGE ON SCHEMA gpt02_private TO dev_gpt02_issuer_evidence' >/dev/null; expect GRANT_DRIFT_DENIED CANDIDATE_SCHEMA_ACCESS_PRESENT
base; psqlc -c "CREATE FUNCTION gpt02_private.unexpected() RETURNS integer LANGUAGE sql AS 'SELECT 1'" >/dev/null; expect OPERATIONAL_FUNCTION_DENIED FOUNDATION_NOT_INACTIVE
base; psqlc -c 'GRANT gpt02_store_owner TO postgres WITH SET TRUE' >/dev/null; expect OWNER_DELEGATION_DENIED OWNER_AUTHORITY_ALREADY_DELEGATED
base; apply || { cat "$OUT/apply.log"; exit 1; }
if apply; then echo REAPPLY_UNEXPECTED_SUCCESS; exit 1; fi; grep -Fq EXPECTED_EMPTY_LEGACY_SCHEMA "$OUT/apply.log"; echo 'PASS:REAPPLY_REFUSES_AMBIGUITY'
psqlc >/dev/null <<'SQL'
INSERT INTO gpt02_private.approvals(command_id,attempt_id,nonce,task_id,company_id,approver_id,operator_namespace,claims,signature,digest,expires_at) VALUES(gen_random_uuid(),gen_random_uuid(),repeat('a',32),800,'fixture','google_fixture_only','ai-task-hub.public.users','{}',repeat('a',86),repeat('a',64),now()+interval '1 minute');
SQL
for q in "UPDATE gpt02_private.approvals SET approver_id='other'" 'DELETE FROM gpt02_private.approvals' 'TRUNCATE gpt02_private.approvals CASCADE'; do
 if psqlc -c "$q" >"$OUT/immutable.log" 2>&1; then echo IMMUTABILITY_FAILURE; exit 1; fi; grep -Fq APPEND_ONLY_EVIDENCE "$OUT/immutable.log";
done
echo 'PASS:IMMUTABLE_AFTER_UPGRADE'
echo 'INACTIVE_V2_UPGRADE_15_CHECKS_PASS; SYNTHETIC_ONLY; NO_HOSTED_WRITE'
