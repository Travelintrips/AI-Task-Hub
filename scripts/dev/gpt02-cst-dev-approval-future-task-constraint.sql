-- CST-DEV Supabase xssrfshdrtdfupgqwfdw ONLY. Reviewed migration candidate.
-- Enforce Task >136 without deleting old history or activating issuer/attestor.
-- Must be run by an independently authorized owner session, never by
-- elevating the shared app's postgres permissions as a side effect.
BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '12s';
DO $gpt02_boundary$
DECLARE
  tbl record;
  legacy_expression text;
  future_expression text;
  future_valid boolean;
  a_count bigint;
  r_count bigint;
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres'
     OR session_user IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'gpt02_store_owner'
     OR current_setting('transaction_read_only') IS DISTINCT FROM 'off'
     OR pg_has_role(session_user,'gpt02_store_owner','SET') IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='GPT02_APPROVAL_BOUNDARY_OWNER_AUTH_REQUIRED';
  END IF;
  SELECT cl.oid,cl.relrowsecurity,cl.relforcerowsecurity,
         pg_get_userbyid(cl.relowner) AS owner_name
    INTO tbl
    FROM pg_catalog.pg_class cl
    JOIN pg_catalog.pg_namespace n ON n.oid=cl.relnamespace
   WHERE n.nspname='gpt02_private' AND cl.relname='approvals' AND cl.relkind='r';
  IF NOT FOUND OR tbl.owner_name IS DISTINCT FROM 'gpt02_store_owner' OR
     tbl.relrowsecurity IS DISTINCT FROM true OR tbl.relforcerowsecurity IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='GPT02_APPROVAL_BOUNDARY_TABLE_DRIFT';
  END IF;
  SELECT regexp_replace(pg_catalog.pg_get_expr(c.conbin,c.conrelid),'[[:space:]()]','','g')
    INTO legacy_expression FROM pg_catalog.pg_constraint c
   WHERE c.conrelid=tbl.oid AND c.conname='approvals_task_id_check'
     AND c.contype='c' AND c.convalidated=true;
  IF NOT FOUND OR legacy_expression IS DISTINCT FROM 'task_id>0ANDtask_id<>135' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='GPT02_APPROVAL_LEGACY_CHECK_DRIFT';
  END IF;
  SELECT count(*) INTO a_count FROM gpt02_private.approvals;
  SELECT count(*) INTO r_count FROM gpt02_private.receipts;
  IF a_count<>0 OR r_count<>0 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='GPT02_APPROVAL_HISTORY_NOT_EMPTY';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN
       ('dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence','gpt02_core_prep_login')) <> 3 OR
     EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN
       ('dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence','gpt02_core_prep_login')
       AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication
            OR rolconnlimit<>0 OR rolvaliduntil IS NULL OR rolvaliduntil>=clock_timestamp())) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='GPT02_APPROVAL_EVIDENCE_ROLES_NOT_DORMANT';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n
       ON n.oid=p.pronamespace WHERE n.nspname='gpt02_private'
       AND p.proname IN ('record_approval','consume_approval','record_linked_approval','consume_linked_approval')) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='GPT02_APPROVAL_ISSUER_FUNCTION_ALREADY_ACTIVE';
  END IF;
  SELECT regexp_replace(pg_catalog.pg_get_expr(c.conbin,c.conrelid),'[[:space:]()]','','g'),c.convalidated
    INTO future_expression,future_valid FROM pg_catalog.pg_constraint c
   WHERE c.conrelid=tbl.oid AND c.conname='gpt02_approvals_future_task_only';
  IF FOUND THEN
    IF future_valid IS DISTINCT FROM true OR future_expression IS DISTINCT FROM 'task_id>136' THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='GPT02_APPROVAL_FUTURE_CHECK_DRIFT';
    END IF;
  ELSE
    EXECUTE 'ALTER TABLE gpt02_private.approvals ADD CONSTRAINT gpt02_approvals_future_task_only CHECK (task_id > 136)';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=tbl.oid
      AND c.conname='gpt02_approvals_future_task_only' AND c.contype='c' AND c.convalidated=true
      AND regexp_replace(pg_catalog.pg_get_expr(c.conbin,c.conrelid),'[[:space:]()]','','g')='task_id>136') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='GPT02_APPROVAL_FUTURE_CHECK_NOT_VALIDATED';
  END IF;
END
$gpt02_boundary$;
COMMIT;
