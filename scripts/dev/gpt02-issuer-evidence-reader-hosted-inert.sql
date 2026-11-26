-- CST-DEV ONLY. Bootstrap the dedicated issuer evidence reader role.
-- This file intentionally grants NO schema/table/function access.
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

COMMIT;
