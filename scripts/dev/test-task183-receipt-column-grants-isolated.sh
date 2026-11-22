#!/usr/bin/env bash
# Synthetic PostgreSQL 17 ONLY: verify Task183 column-scoped INSERT and FORCE RLS.
# Never connects to CST-DEV, PROD, Supavisor, Google, signer or any external host.
set -euo pipefail

name="task183-column-grants-${GITHUB_RUN_ID:-local}-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$name" --network none --restart no \
  --security-opt no-new-privileges \
  --memory 350m --memory-swap 350m --pids-limit 80 \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=220m \
  -e POSTGRES_PASSWORD=synthetic_only_not_a_real_database_password_183 \
  postgres:17-alpine >/dev/null

test -z "$(docker port "$name")"
test "$(docker inspect "$name" -f '{{.HostConfig.NetworkMode}}')" = none
for i in $(seq 1 50); do
  if docker exec "$name" pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
  sleep .2
done
docker exec "$name" pg_isready -U postgres -d postgres >/dev/null

docker exec -i "$name" psql -Xv ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL' >/dev/null
CREATE SCHEMA gpt02_stage;
CREATE TABLE gpt02_stage.task183_verified_recovery_receipts(
 request_id text PRIMARY KEY, approval_sha256 text NOT NULL,
 predecessor_attempt_id uuid NOT NULL, signed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, unauthorized_marker text
);
CREATE ROLE gpt02_task183_receipt_verifier NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
CREATE ROLE gpt02_task183_verifier_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS CONNECTION LIMIT 1;
GRANT gpt02_task183_receipt_verifier TO gpt02_task183_verifier_login
 WITH SET TRUE, INHERIT FALSE;
GRANT USAGE ON SCHEMA gpt02_stage TO gpt02_task183_receipt_verifier;
GRANT INSERT(request_id,approval_sha256,predecessor_attempt_id,signed_at,expires_at)
 ON gpt02_stage.task183_verified_recovery_receipts TO gpt02_task183_receipt_verifier;
ALTER TABLE gpt02_stage.task183_verified_recovery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_stage.task183_verified_recovery_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY task183_verifier_current_receipt ON gpt02_stage.task183_verified_recovery_receipts
 FOR INSERT TO gpt02_task183_receipt_verifier WITH CHECK (
  predecessor_attempt_id='8f5ab85a-8300-4118-a14c-5fc701ae5a7c'
  AND signed_at <= clock_timestamp() AND expires_at > clock_timestamp()
 );
SQL

proof=$(docker exec "$name" psql -XAtq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
SELECT
 (NOT has_table_privilege('gpt02_task183_receipt_verifier',
  'gpt02_stage.task183_verified_recovery_receipts','INSERT'))
 AND has_schema_privilege('gpt02_task183_receipt_verifier','gpt02_stage','USAGE')
 AND (SELECT bool_and(has_column_privilege('gpt02_task183_receipt_verifier',
  'gpt02_stage.task183_verified_recovery_receipts',col,'INSERT'))
  FROM unnest(ARRAY['request_id','approval_sha256','predecessor_attempt_id',
  'signed_at','expires_at']) col)
 AND NOT has_column_privilege('gpt02_task183_receipt_verifier',
  'gpt02_stage.task183_verified_recovery_receipts','unauthorized_marker','INSERT')
 AND (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
  WHERE oid='gpt02_stage.task183_verified_recovery_receipts'::regclass)
")
test "$proof" = t
echo "COLUMN_ONLY_GRANTS_AND_FORCED_RLS_PASS"

docker exec -i "$name" psql -Xv ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL' >/dev/null
BEGIN;
SET LOCAL ROLE gpt02_task183_receipt_verifier;
INSERT INTO gpt02_stage.task183_verified_recovery_receipts
(request_id,approval_sha256,predecessor_attempt_id,signed_at,expires_at)
VALUES ('a',repeat('b',64),'8f5ab85a-8300-4118-a14c-5fc701ae5a7c',
 clock_timestamp(),clock_timestamp()+interval '60 seconds');
ROLLBACK;
SQL
echo "SCOPED_INSERT_WITH_ROLLBACK_PASS"

# A forbidden extra column cannot be written, despite the five allowed columns.
if docker exec -i "$name" psql -Xv ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL' >/dev/null 2>&1
BEGIN;
SET LOCAL ROLE gpt02_task183_receipt_verifier;
INSERT INTO gpt02_stage.task183_verified_recovery_receipts(unauthorized_marker) VALUES ('forbidden');
ROLLBACK;
SQL
then
  echo "FORBIDDEN_COLUMN_WRITE_UNEXPECTEDLY_SUCCEEDED" >&2
  exit 1
fi
echo "EXTRA_COLUMN_INSERT_DENIED_PASS"

test "$(docker exec "$name" psql -XAtq -U postgres -d postgres -c \
 "SELECT count(*) FROM gpt02_stage.task183_verified_recovery_receipts")" = 0
echo "ISOLATED_POSTGRES_17_ZERO_PERSISTED_ROWS_PASS"
