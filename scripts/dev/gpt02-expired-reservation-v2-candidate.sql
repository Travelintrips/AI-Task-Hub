-- DESIGN CANDIDATE ONLY; NEVER deploy directly to CST-DEV or PROD.
-- A versioned, non-dispatching recovery review of an expired GPT02 reservation.
-- This intentionally DOES NOT prepare a new Core task/Hub Job or grant approval.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF current_database() <> 'gpt02_recovery_isolated' THEN
  RAISE EXCEPTION 'ISOLATED_DATABASE_REQUIRED';
 END IF;
END $$;

BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS gpt02_stage;

-- Fixture declares the existing immutable v1 reservation under its real key
-- shape. The recovery candidate MUST reference it and cannot overwrite it.
CREATE TABLE gpt02_stage.core_preparations (
 company_id text NOT NULL,
 hub_task_id integer NOT NULL,
 attempt_id uuid NOT NULL UNIQUE,
 core_task_id uuid NOT NULL UNIQUE,
 hub_execution_id uuid NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY (company_id, hub_task_id)
);

CREATE TABLE gpt02_stage.recovery_review_candidates_v2 (
 review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id text NOT NULL CHECK (company_id='default'),
 hub_task_id integer NOT NULL CHECK (hub_task_id=183),
 attempt_number integer NOT NULL CHECK(attempt_number>=2),
 original_attempt_id uuid NOT NULL REFERENCES gpt02_stage.core_preparations(attempt_id),
 original_core_task_id uuid NOT NULL REFERENCES gpt02_stage.core_preparations(core_task_id),
 original_hub_execution_id uuid NOT NULL REFERENCES gpt02_stage.core_preparations(hub_execution_id),
 -- These are reserved identifiers ONLY. No job is submitted and no command
 -- may be published from the recovery review table.
 candidate_attempt_id uuid NOT NULL UNIQUE,
 candidate_core_task_id uuid NOT NULL UNIQUE,
 candidate_hub_execution_id uuid NOT NULL UNIQUE,
 candidate_command_id uuid NOT NULL UNIQUE,
 idempotency_key text NOT NULL UNIQUE,
 source_external_id text NOT NULL UNIQUE,
 review_status text NOT NULL DEFAULT 'awaiting_independent_owner_review'
   CHECK(review_status='awaiting_independent_owner_review'),
 owner_approval_granted boolean NOT NULL DEFAULT false CHECK(owner_approval_granted=false),
 dispatch_permitted boolean NOT NULL DEFAULT false CHECK(dispatch_permitted=false),
 issued_command_id uuid CHECK(issued_command_id IS NULL),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL CHECK (expires_at>created_at),
 CONSTRAINT recovery_v2_only_one_sequence UNIQUE (company_id,hub_task_id,attempt_number),
 CONSTRAINT recovery_v2_original_task_fk FOREIGN KEY (company_id,hub_task_id)
  REFERENCES gpt02_stage.core_preparations(company_id,hub_task_id),
 CONSTRAINT recovery_v2_window_nonoverlap EXCLUDE USING gist (
  company_id WITH =,
  hub_task_id WITH =,
  tstzrange(created_at,expires_at,'[)') WITH &&
 )
);

CREATE FUNCTION gpt02_stage.guard_recovery_review_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $$
DECLARE parent RECORD;
BEGIN
 SELECT attempt_id,core_task_id,hub_execution_id,expires_at
 INTO parent
 FROM gpt02_stage.core_preparations
 WHERE company_id=NEW.company_id AND hub_task_id=NEW.hub_task_id;
 IF NOT FOUND OR
    parent.attempt_id IS DISTINCT FROM NEW.original_attempt_id OR
    parent.core_task_id IS DISTINCT FROM NEW.original_core_task_id OR
    parent.hub_execution_id IS DISTINCT FROM NEW.original_hub_execution_id OR
    parent.expires_at >= clock_timestamp() OR
    NEW.created_at < parent.expires_at OR
    NEW.idempotency_key IS DISTINCT FROM
       ('gpt02-managed-preparation:'||NEW.company_id||':'||NEW.hub_task_id::text||
         ':attempt:'||NEW.attempt_number::text) OR
    NEW.source_external_id IS DISTINCT FROM
       ('ai-task:'||NEW.company_id||':'||NEW.hub_task_id::text||
         ':attempt:'||NEW.attempt_number::text)
 THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='RECOVERY_REVIEW_SOURCE_OR_SCOPE_INVALID';
 END IF;
 IF NEW.candidate_attempt_id IN (NEW.original_attempt_id,NEW.original_core_task_id,NEW.original_hub_execution_id)
    OR NEW.candidate_core_task_id IN (NEW.original_attempt_id,NEW.original_core_task_id,NEW.original_hub_execution_id,NEW.candidate_attempt_id)
    OR NEW.candidate_hub_execution_id IN (NEW.original_attempt_id,NEW.original_core_task_id,NEW.original_hub_execution_id,NEW.candidate_attempt_id,NEW.candidate_core_task_id)
    OR NEW.candidate_command_id IN (NEW.original_attempt_id,NEW.original_core_task_id,NEW.original_hub_execution_id,NEW.candidate_attempt_id,NEW.candidate_core_task_id,NEW.candidate_hub_execution_id)
 THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='RECOVERY_IDENTITY_COLLISION';
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER recovery_review_insert_gate BEFORE INSERT
 ON gpt02_stage.recovery_review_candidates_v2
 FOR EACH ROW EXECUTE FUNCTION gpt02_stage.guard_recovery_review_insert();

CREATE FUNCTION gpt02_stage.block_recovery_review_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog AS $$
BEGIN
 RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='APPEND_ONLY_RECOVERY_REVIEW';
END $$;
CREATE TRIGGER recovery_review_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE
 ON gpt02_stage.recovery_review_candidates_v2
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_stage.block_recovery_review_mutation();

-- No API role, authenticated user, legacy preparer or other writer is granted
-- INSERT, SELECT, UPDATE, DELETE, TRUNCATE, or EXECUTE. Candidate is inert.
REVOKE ALL ON SCHEMA gpt02_stage FROM PUBLIC;
REVOKE ALL ON TABLE gpt02_stage.recovery_review_candidates_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_stage.guard_recovery_review_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_stage.block_recovery_review_mutation() FROM PUBLIC;
ALTER TABLE gpt02_stage.recovery_review_candidates_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_stage.recovery_review_candidates_v2 FORCE ROW LEVEL SECURITY;
COMMIT;
