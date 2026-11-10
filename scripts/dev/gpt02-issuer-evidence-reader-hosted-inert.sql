-- CST-DEV ONLY. Dedicated read-only issuer evidence reader for GPT02 Issue #159.
-- No LOGIN/password, no signer key, no function authority, no dispatch.
BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'GPT02_ISSUER_READER_POSTGRES_DB_REQUIRED';
  END IF;
  IF to_regclass('gpt02_private.receipts') IS NULL
     OR to_regclass('gpt02_private.core_identity_receipts') IS NULL
     OR to_regclass('gpt02_private.post_consumption_fences') IS NULL THEN
    RAISE EXCEPTION 'GPT02_ISSUER_READER_EVIDENCE_SCHEMA_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gpt02_issuer_evidence_reader') THEN
    CREATE ROLE gpt02_issuer_evidence_reader
      NOLOGIN NOINHERIT CONNECTION LIMIT 0;
  END IF;
END
$guard$;

ALTER ROLE gpt02_issuer_evidence_reader
  NOLOGIN NOINHERIT CONNECTION LIMIT 0;

DO $role_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname='gpt02_issuer_evidence_reader'
      AND r.rolcanlogin IS FALSE
      AND r.rolconnlimit=0
      AND r.rolsuper IS FALSE
      AND r.rolcreatedb IS FALSE
      AND r.rolcreaterole IS FALSE
      AND r.rolinherit IS FALSE
      AND r.rolreplication IS FALSE
      AND r.rolbypassrls IS FALSE
  ) THEN
    RAISE EXCEPTION 'GPT02_ISSUER_READER_ROLE_BASELINE_UNSAFE';
  END IF;
END
$role_guard$;
ALTER ROLE gpt02_issuer_evidence_reader SET default_transaction_read_only='on';
ALTER ROLE gpt02_issuer_evidence_reader SET search_path='pg_catalog';
ALTER ROLE gpt02_issuer_evidence_reader SET statement_timeout='5s';
ALTER ROLE gpt02_issuer_evidence_reader SET lock_timeout='1s';
ALTER ROLE gpt02_issuer_evidence_reader SET idle_in_transaction_session_timeout='10s';

REVOKE ALL ON SCHEMA gpt02_private FROM gpt02_issuer_evidence_reader;
GRANT USAGE ON SCHEMA gpt02_private TO gpt02_issuer_evidence_reader;

REVOKE ALL ON gpt02_private.receipts FROM gpt02_issuer_evidence_reader;
REVOKE ALL ON gpt02_private.core_identity_receipts FROM gpt02_issuer_evidence_reader;
REVOKE ALL ON gpt02_private.post_consumption_fences FROM gpt02_issuer_evidence_reader;

GRANT SELECT (id,command_id,nonce,digest,consumed_at)
  ON gpt02_private.receipts TO gpt02_issuer_evidence_reader;
GRANT SELECT (
  receipt_id,command_id,link_id,operator_user_id,recorded_by,hub_operator_id,
  link_digest,binding_verified,may_dispatch_worker,may_close_job,may_issue_grant,
  core_ledger_written,created_at
) ON gpt02_private.core_identity_receipts TO gpt02_issuer_evidence_reader;
GRANT SELECT (
  fence_id,receipt_id,command_id,link_id,hub_execution_id,core_task_id,attempt_id,
  worker_id,lease_epoch,lease_started_at,lease_expires_at,dispatch_allowed,
  core_ledger_written,created_at
) ON gpt02_private.post_consumption_fences TO gpt02_issuer_evidence_reader;

DROP POLICY IF EXISTS issuer_evidence_reader_select ON gpt02_private.receipts;
CREATE POLICY issuer_evidence_reader_select ON gpt02_private.receipts
  FOR SELECT TO gpt02_issuer_evidence_reader USING (true);

DROP POLICY IF EXISTS issuer_evidence_reader_select ON gpt02_private.core_identity_receipts;
CREATE POLICY issuer_evidence_reader_select ON gpt02_private.core_identity_receipts
  FOR SELECT TO gpt02_issuer_evidence_reader USING (true);

DROP POLICY IF EXISTS issuer_evidence_reader_select ON gpt02_private.post_consumption_fences;
CREATE POLICY issuer_evidence_reader_select ON gpt02_private.post_consumption_fences
  FOR SELECT TO gpt02_issuer_evidence_reader USING (true);

COMMIT;
