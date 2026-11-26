-- Only ephemeral PostgreSQL instance. No migration/application deployment.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database()<>'task183_attempt2_isolated' THEN
 RAISE EXCEPTION 'ISOLATED_DATABASE_REQUIRED'; END IF; END $$;

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE,TEMP ON DATABASE task183_attempt2_isolated FROM PUBLIC;
CREATE ROLE task183_recovery_store_owner NOLOGIN NOINHERIT;
CREATE ROLE task183_recovery_verifier LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE task183_recovery_issuer LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE task183_untrusted_app LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE SCHEMA isolated AUTHORIZATION task183_recovery_store_owner;
REVOKE ALL ON SCHEMA isolated FROM PUBLIC;
GRANT USAGE ON SCHEMA isolated TO task183_recovery_verifier,task183_recovery_issuer;

CREATE TABLE isolated.old_preparations(
 company_id text NOT NULL CHECK(company_id='default'),
 hub_task_id integer NOT NULL CHECK(hub_task_id=183),
 core_task_id uuid UNIQUE NOT NULL,
 hub_execution_id uuid UNIQUE NOT NULL,
 attempt_id uuid UNIQUE NOT NULL,
 command_candidate_id uuid UNIQUE NOT NULL,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(company_id,hub_task_id)
);
CREATE TABLE isolated.core_tasks(
 id uuid PRIMARY KEY, task_id integer NOT NULL CHECK(task_id=183),
 attempt_number integer NOT NULL CHECK(attempt_number>=1),
 status text NOT NULL CHECK(status='PENDING'),
 worker_id text CHECK(worker_id IS NULL),
 command_id uuid CHECK(command_id IS NULL),
 UNIQUE(task_id,attempt_number)
);
CREATE TABLE isolated.hub_jobs(
 id uuid PRIMARY KEY,task_id integer NOT NULL CHECK(task_id=183),
 attempt_number integer NOT NULL,
 core_task_id uuid NOT NULL REFERENCES isolated.core_tasks(id),
 status text NOT NULL CHECK(status='prepared'),
 command_id uuid CHECK(command_id IS NULL),
 worker_id text CHECK(worker_id IS NULL),
 idempotency_key text UNIQUE NOT NULL,
 source_external_id text UNIQUE NOT NULL,
 dispatch_started boolean NOT NULL DEFAULT false CHECK(dispatch_started=false),
 UNIQUE(task_id,attempt_number)
);
CREATE TABLE isolated.signed_owner_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id text NOT NULL CHECK(company_id='default'),
 task_id integer NOT NULL CHECK(task_id=183),
 attempt_number integer NOT NULL CHECK(attempt_number=2),
 old_attempt_id uuid NOT NULL,
 verified_original_evidence_sha256 text NOT NULL CHECK(verified_original_evidence_sha256 ~ '^[0-9a-f]{64}$'),
 signed_approval_digest text NOT NULL CHECK(signed_approval_digest ~ '^[0-9a-f]{64}$'),
 owner_subject text NOT NULL CHECK(length(owner_subject)>5),
 signer_public_fingerprint text NOT NULL CHECK(signer_public_fingerprint ~ '^[0-9a-f]{64}$'),
 signer_domain text NOT NULL CHECK(signer_domain='GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1'),
 verified_by text NOT NULL CHECK(verified_by='independent_ed25519_owner_verifier'),
 verified_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 UNIQUE(task_id,attempt_number),
 UNIQUE(signed_approval_digest),
 CHECK(expires_at>verified_at AND expires_at-verified_at<=interval '5 minutes')
);
CREATE TABLE isolated.issued_attempts(
 company_id text NOT NULL CHECK(company_id='default'),
 task_id integer NOT NULL CHECK(task_id=183),
 attempt_number integer NOT NULL CHECK(attempt_number=2),
 old_attempt_id uuid NOT NULL,
 core_task_id uuid UNIQUE NOT NULL REFERENCES isolated.core_tasks(id),
 hub_job_id uuid UNIQUE NOT NULL REFERENCES isolated.hub_jobs(id),
 candidate_command_id uuid UNIQUE NOT NULL,
 receipt_id uuid UNIQUE NOT NULL REFERENCES isolated.signed_owner_receipts(id),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 issuer_role text NOT NULL CHECK(issuer_role='task183_recovery_issuer'),
 dispatch_permitted boolean NOT NULL DEFAULT false CHECK(dispatch_permitted=false),
 PRIMARY KEY(company_id,task_id,attempt_number)
);
CREATE FUNCTION isolated.deny_immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='APPEND_ONLY_RECOVERY_EVIDENCE'; END $$;
CREATE TRIGGER old_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON isolated.old_preparations FOR EACH STATEMENT EXECUTE FUNCTION isolated.deny_immutable();
CREATE TRIGGER issued_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON isolated.issued_attempts FOR EACH STATEMENT EXECUTE FUNCTION isolated.deny_immutable();

CREATE FUNCTION isolated.create_attempt2(
 p_company text,p_task integer,p_old uuid,p_receipt uuid,p_original_sha text
) RETURNS TABLE(core_task_id uuid,hub_job_id uuid,candidate_command_id uuid,dispatch_permitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE oldrow record;approved record;use_time timestamptz;cc uuid;hh uuid;candidate uuid;
BEGIN
 IF session_user<>'task183_recovery_issuer' OR p_company<>'default'
    OR p_task<>183 OR p_old IS NULL OR p_receipt IS NULL OR
    p_original_sha IS NULL OR p_original_sha !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='EXACT_ISSUER_SCOPE_REQUIRED';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('default:183:attempt:2',0));
 SELECT * INTO oldrow FROM isolated.old_preparations
  WHERE company_id=p_company AND hub_task_id=p_task;
 IF NOT FOUND OR oldrow.attempt_id<>p_old OR oldrow.expires_at>=clock_timestamp()
    OR EXISTS(SELECT 1 FROM isolated.issued_attempts WHERE task_id=183)
    OR EXISTS(SELECT 1 FROM isolated.core_tasks WHERE attempt_number=2)
    OR EXISTS(SELECT 1 FROM isolated.hub_jobs WHERE attempt_number=2) THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='ORIGINAL_PREPARATION_NOT_SAFE';
 END IF;
 SELECT * INTO approved FROM isolated.signed_owner_receipts
  WHERE id=p_receipt AND company_id=p_company AND task_id=p_task
    AND attempt_number=2 AND old_attempt_id=p_old
    AND verified_original_evidence_sha256=p_original_sha
    AND signer_domain='GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1'
    AND verified_by='independent_ed25519_owner_verifier'
    AND consumed_at IS NULL
    AND verified_at<=clock_timestamp()
    AND expires_at>clock_timestamp()
  FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='INDEPENDENT_SIGNED_OWNER_RECEIPT_REQUIRED';
 END IF;
 cc:=gen_random_uuid();hh:=gen_random_uuid();candidate:=gen_random_uuid();
 IF cc IN (p_old,oldrow.core_task_id,oldrow.hub_execution_id,oldrow.command_candidate_id) OR
    hh IN (p_old,oldrow.core_task_id,oldrow.hub_execution_id,oldrow.command_candidate_id,cc) OR
    candidate IN (p_old,oldrow.core_task_id,oldrow.hub_execution_id,oldrow.command_candidate_id,cc,hh) THEN
    RAISE EXCEPTION 'ISSUER_UUID_COLLISION'; END IF;
 INSERT INTO isolated.core_tasks(id,task_id,attempt_number,status)
 VALUES(cc,183,2,'PENDING');
 INSERT INTO isolated.hub_jobs(id,task_id,attempt_number,core_task_id,
    status,idempotency_key,source_external_id)
 VALUES(hh,183,2,cc,'prepared',
    'gpt02-managed-preparation:default:183:attempt:2',
    'ai-task:default:183:attempt:2');
 use_time:=clock_timestamp();
 UPDATE isolated.signed_owner_receipts SET consumed_at=use_time
 WHERE id=p_receipt AND consumed_at IS NULL AND verified_at<=use_time AND expires_at>use_time;
 IF NOT FOUND THEN RAISE EXCEPTION 'RECEIPT_CONSUMPTION_LOST'; END IF;
 INSERT INTO isolated.issued_attempts(company_id,task_id,attempt_number,
     old_attempt_id,core_task_id,hub_job_id,candidate_command_id,receipt_id,issuer_role)
 VALUES(p_company,183,2,p_old,cc,hh,candidate,p_receipt,'task183_recovery_issuer');
 RETURN QUERY SELECT cc,hh,candidate,false;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA isolated FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA isolated FROM PUBLIC;
GRANT SELECT,INSERT ON isolated.signed_owner_receipts TO task183_recovery_verifier;
GRANT EXECUTE ON FUNCTION isolated.create_attempt2(text,integer,uuid,uuid,text)
 TO task183_recovery_issuer;
GRANT SELECT,INSERT,UPDATE ON isolated.signed_owner_receipts TO task183_recovery_store_owner;
GRANT SELECT,INSERT ON isolated.old_preparations,isolated.core_tasks,isolated.hub_jobs,isolated.issued_attempts TO task183_recovery_store_owner;
ALTER TABLE isolated.old_preparations OWNER TO task183_recovery_store_owner;
ALTER TABLE isolated.core_tasks OWNER TO task183_recovery_store_owner;
ALTER TABLE isolated.hub_jobs OWNER TO task183_recovery_store_owner;
ALTER TABLE isolated.signed_owner_receipts OWNER TO task183_recovery_store_owner;
ALTER TABLE isolated.issued_attempts OWNER TO task183_recovery_store_owner;
ALTER FUNCTION isolated.create_attempt2(text,integer,uuid,uuid,text) OWNER TO task183_recovery_store_owner;
-- SECURITY DEFINER owner is NOLOGIN with only schema-scoped objects.
COMMIT;
