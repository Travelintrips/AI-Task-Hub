-- SYNTHETIC ONLY. Never run this against DEV/PROD data or user-created approvals.
-- This proves atomic one-time claims, NOT operational signatures or approval.
BEGIN;
CREATE SCHEMA gpt02_approval_test;
CREATE ROLE gpt02_test_attestor LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE gpt02_test_issuer LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE TABLE gpt02_approval_test.approved_commands(
 task_id integer NOT NULL CHECK (task_id > 0 AND task_id <> 135),
 command_id uuid PRIMARY KEY,
 attempt_id uuid NOT NULL UNIQUE,
 nonce text NOT NULL UNIQUE CHECK (length(nonce) BETWEEN 32 AND 128),
 company_id text NOT NULL,
 approver_id integer NOT NULL CHECK (approver_id > 0),
 signature_digest text NOT NULL CHECK (length(signature_digest) = 64),
 expires_at timestamptz NOT NULL
);
CREATE TABLE gpt02_approval_test.nonce_claims(
 command_id uuid PRIMARY KEY REFERENCES gpt02_approval_test.approved_commands(command_id),
 nonce text NOT NULL UNIQUE,
 task_id integer NOT NULL,
 company_id text NOT NULL,
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE gpt02_approval_test.approved_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_approval_test.approved_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_approval_test.nonce_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_approval_test.nonce_claims FORCE ROW LEVEL SECURITY;
-- Roles deliberately lack direct table permissions and assume no other roles.
GRANT USAGE ON SCHEMA gpt02_approval_test TO gpt02_test_attestor,gpt02_test_issuer;
CREATE FUNCTION gpt02_approval_test.consume_once(
 p_task_id integer,p_command_id uuid,p_nonce text,p_company_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE claim_id uuid;
BEGIN
 -- In this isolated test SET SESSION AUTHORIZATION simulates a distinct
 -- nonprivileged login. An actual deployment MUST have separate DB logins.
 IF session_user <> 'gpt02_test_issuer' THEN RETURN false; END IF;
 IF p_task_id = 135 OR p_task_id <= 0 THEN RETURN false; END IF;
 INSERT INTO gpt02_approval_test.nonce_claims(command_id,nonce,task_id,company_id)
 SELECT a.command_id,a.nonce,a.task_id,a.company_id
 FROM gpt02_approval_test.approved_commands a
 WHERE a.task_id=p_task_id
   AND a.command_id=p_command_id
   AND a.nonce=p_nonce
   AND a.company_id=p_company_id
   AND a.expires_at>clock_timestamp()
 ON CONFLICT DO NOTHING
 RETURNING command_id INTO claim_id;
 RETURN claim_id IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION gpt02_approval_test.consume_once(integer,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_approval_test.consume_once(integer,uuid,text,text) TO gpt02_test_issuer;
-- Seeding is done only by synthetic fixture owner. No "verified" booleans are
-- accepted as signature proof. Operational approval storage remains blocked.
INSERT INTO gpt02_approval_test.approved_commands
 (task_id,command_id,attempt_id,nonce,company_id,approver_id,signature_digest,expires_at)
VALUES
 (136,'28cbdd95-b19c-45b1-8ec8-ac3b1fef182e','dce3d0b7-4e9e-4a0e-bac0-b0e654ea77b0',
 'rQCfYm6TDsPvxgf9QEM3m8Rdpqba32Py','default',10,repeat('a',64),now()+interval '5 minutes'),
 (137,'817b62e6-b7fa-41ea-a4b3-2d1a6aa129d1','8c21dc8c-7c96-470e-b82b-11a8a38ca8a9',
 'AqZeh5Hx4TLY8CGg6VmHs2e7NpRVcm64','default',10,repeat('b',64),now()-interval '1 minute');
COMMIT;
