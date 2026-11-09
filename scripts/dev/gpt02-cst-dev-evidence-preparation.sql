-- Authorized scope: existing CST-DEV only. Inactive foundation, not approval or dispatch.
-- Applied via Supabase migration action to project xssrfshdrtdfupgqwfdw.
-- The caller must verify project identity before submitting; this script never changes runtime DSNs.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
SELECT pg_advisory_xact_lock(hashtextextended('gpt02-cst-dev-evidence-preparation-v1',0));
DO $$
BEGIN
 IF current_user<>'postgres' OR current_database()<>'postgres' THEN
  RAISE EXCEPTION 'EXPECTED_CST_DEV_MIGRATION_ROLE_AND_DATABASE';
 END IF;
 IF to_regnamespace('gpt02_private') IS NOT NULL OR EXISTS(
 SELECT 1 FROM pg_roles WHERE rolname IN ('gpt02_store_owner','dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence')) THEN
  RAISE EXCEPTION 'CANDIDATE_ALREADY_EXISTS_REVIEW_BEFORE_CHANGE';
 END IF;
END $$;
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION CONNECTION LIMIT 0 PASSWORD NULL;
CREATE ROLE dev_gpt02_attestor_evidence NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION CONNECTION LIMIT 0 PASSWORD NULL;
CREATE ROLE dev_gpt02_issuer_evidence NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION CONNECTION LIMIT 0 PASSWORD NULL;
-- Transaction-local construction authority on a NEW owner only, removed below.
GRANT gpt02_store_owner TO postgres WITH SET TRUE, INHERIT FALSE;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
SET LOCAL ROLE gpt02_store_owner;
REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE gpt02_private.approvals(
 command_id uuid PRIMARY KEY,attempt_id uuid NOT NULL UNIQUE,
 nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[A-Za-z0-9_-]{32,128}$'),
 task_id integer NOT NULL CHECK(task_id>0 AND task_id<>135),
 company_id text NOT NULL CHECK(company_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
 approver_id bigint NOT NULL CHECK(approver_id>0),claims jsonb NOT NULL,
 signature text NOT NULL CHECK(signature ~ '^[A-Za-z0-9_-]{86}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),expires_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(command_id<>attempt_id));
CREATE TABLE gpt02_private.receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.approvals(command_id),
 nonce text NOT NULL UNIQUE,digest text NOT NULL,consumed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_owner_only ON gpt02_private.approvals TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE POLICY evidence_owner_only ON gpt02_private.receipts TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE FUNCTION gpt02_private.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='APPEND_ONLY_EVIDENCE'; END $$;
CREATE TRIGGER immutable_approvals BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_private.approvals FOR EACH STATEMENT EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_private.receipts FOR EACH STATEMENT EXECUTE FUNCTION gpt02_private.reject_mutation();
REVOKE ALL ON ALL TABLES IN SCHEMA gpt02_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gpt02_private FROM PUBLIC;
COMMENT ON SCHEMA gpt02_private IS 'GPT02 CST-DEV inactive evidence foundation; no LOGIN, no issue/consume functions or dispatch authorization';
RESET ROLE;
REVOKE SET OPTION FOR gpt02_store_owner FROM postgres;
REVOKE INHERIT OPTION FOR gpt02_store_owner FROM postgres;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('gpt02_store_owner','dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence') AND
 (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolconnlimit<>0)) THEN
  RAISE EXCEPTION 'INACTIVE_ROLE_POSTCONDITION_FAILED';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private' AND c.relkind='r' AND
 (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR pg_get_userbyid(c.relowner)<>'gpt02_store_owner')) THEN
  RAISE EXCEPTION 'EVIDENCE_TABLE_POSTCONDITION_FAILED';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN ('dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence')) THEN
  RAISE EXCEPTION 'CANDIDATE_MUST_NOT_ASSUME_ANOTHER_ROLE';
 END IF;
END $$;
COMMIT;
