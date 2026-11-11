-- CST-DEV xssrfshdrtdfupgqwfdw ONLY.
-- Operational evidence functions for GPT02 Issue #159.
-- No PROD, no worker dispatch, no task creation, no credential activation.
-- Tables remain FORCE RLS + append-only. Functions are SECURITY DEFINER,
-- search_path is locked to pg_catalog, and EXECUTE is scoped to dedicated roles.

BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='20s';

DO $pre$
BEGIN
  IF current_database()<>'postgres'
     OR current_setting('transaction_read_only')<>'off'
     OR to_regprocedure('gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text)') IS NULL
     OR to_regprocedure('gpt02_stage.prepare_core_task(text,integer,text,text,text,text)') IS NOT NULL
     OR to_regprocedure('gpt02_stage.prepare_core_task_v1_internal(text,integer,text,text,text,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'GPT02_OPERATIONAL_PRECONDITION_FAILED'; END IF;

  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE (n.nspname,c.relname) IN (
        ('gpt02_private','approvals'),('gpt02_private','receipts'),
        ('gpt02_private','operator_links'),('gpt02_private','core_identity_receipts'),
        ('gpt02_private','post_consumption_fences'),('gpt02_stage','core_preparations'))
      AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity)<>6
  THEN RAISE EXCEPTION 'GPT02_OPERATIONAL_RLS_DRIFT'; END IF;

  IF (SELECT count(*) FROM gpt02_private.approvals)<>0
     OR (SELECT count(*) FROM gpt02_private.receipts)<>0
     OR (SELECT count(*) FROM gpt02_private.operator_links)<>0
     OR (SELECT count(*) FROM gpt02_private.core_identity_receipts)<>0
     OR (SELECT count(*) FROM gpt02_private.post_consumption_fences)<>0
     OR (SELECT count(*) FROM public.ai_tasks WHERE id>139)<>0
  THEN RAISE EXCEPTION 'GPT02_OPERATIONAL_PREEXISTING_ACTIVITY'; END IF;
END
$pre$;

GRANT gpt02_core_prep_owner TO postgres WITH SET TRUE;
SET ROLE gpt02_core_prep_owner;
ALTER FUNCTION gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text)
  RENAME TO prepare_core_task_v1_internal;
REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task_v1_internal(text,integer,text,text,text,text) FROM PUBLIC;

CREATE FUNCTION gpt02_stage.prepare_core_task(
  p_company text,p_task integer,p_project text,p_repo text,p_branch text,p_instruction text
) RETURNS TABLE(
  core_task_id uuid,command_candidate_id uuid,attempt_id uuid,hub_execution_id uuid,
  created boolean,dispatch_permitted boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog
AS $fn$
BEGIN
  IF session_user<>'gpt02_core_prep_login' OR p_task<=139 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FRESH_TASK_AFTER_139_REQUIRED';
  END IF;
  RETURN QUERY
    SELECT * FROM gpt02_stage.prepare_core_task_v1_internal(
      p_company,p_task,p_project,p_repo,p_branch,p_instruction
    );
END
$fn$;

REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text)
  TO gpt02_core_prep_login;
GRANT USAGE ON SCHEMA gpt02_stage TO gpt02_core_prep_login;

-- Evidence functions execute as gpt02_store_owner and need a read-only view of
-- the immutable preparation tuple. No write privilege is granted.
GRANT USAGE ON SCHEMA gpt02_stage TO gpt02_store_owner;
GRANT SELECT ON gpt02_stage.core_preparations TO gpt02_store_owner;
CREATE POLICY gpt02_store_owner_preparation_read
  ON gpt02_stage.core_preparations
  FOR SELECT TO gpt02_store_owner
  USING (company_id='default' AND hub_task_id>139);
RESET ROLE;
REVOKE SET OPTION FOR gpt02_core_prep_owner FROM postgres GRANTED BY postgres RESTRICT;

GRANT gpt02_store_owner TO postgres WITH SET TRUE;
SET ROLE gpt02_store_owner;

CREATE OR REPLACE FUNCTION gpt02_private.record_linked_approval(
  p_approval jsonb,p_signature text,p_digest text,
  p_link jsonb,p_hub_signature text,p_core_signature text,p_link_digest text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog
AS $fn$
DECLARE
  v_task integer; v_command uuid; v_attempt uuid; v_link uuid;
  v_hub_execution uuid; v_core_task uuid;
  v_issued bigint; v_expires bigint; v_link_issued bigint; v_link_expires bigint;
  v_existing_approval gpt02_private.approvals%rowtype;
  v_existing_link gpt02_private.operator_links%rowtype;
BEGIN
  IF session_user<>'dev_gpt02_attestor_evidence' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ATTESTOR_SESSION_REQUIRED';
  END IF;
  IF jsonb_typeof(p_approval)<>'object' OR jsonb_typeof(p_link)<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_LINKED_APPROVAL_JSON';
  END IF;
  IF p_approval->>'v'<>'2'
     OR p_approval->>'environment'<>'DEV'
     OR p_approval->>'audience'<>'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL'
     OR p_approval->>'companyId'<>'default'
     OR p_approval->>'operatorNamespace'<>'ai-task-hub.public.users'
     OR coalesce(p_approval->>'superAdminId','') !~ '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$'
     OR coalesce(p_approval->>'nonce','') !~ '^[A-Za-z0-9_-]{32,128}$'
     OR coalesce(p_signature,'') !~ '^[A-Za-z0-9_-]{86}$'
     OR coalesce(p_digest,'') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_APPROVAL_CONTRACT'; END IF;

  BEGIN
    v_task:=(p_approval->>'taskId')::integer;
    v_command:=(p_approval->>'commandId')::uuid;
    v_attempt:=(p_approval->>'attemptId')::uuid;
    v_issued:=(p_approval->>'issuedAt')::bigint;
    v_expires:=(p_approval->>'expiresAt')::bigint;
    v_link:=(p_link->>'linkId')::uuid;
    v_hub_execution:=(p_link->>'hubExecutionId')::uuid;
    v_core_task:=(p_link->>'coreTaskId')::uuid;
    v_link_issued:=(p_link->>'issuedAt')::bigint;
    v_link_expires:=(p_link->>'expiresAt')::bigint;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_LINKED_APPROVAL_TYPES';
  END;

  IF v_task<=139 OR v_command=v_attempt
     OR v_issued<0 OR v_expires<=v_issued OR v_expires-v_issued>300000
     OR v_expires<=floor(extract(epoch from clock_timestamp())*1000)::bigint
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_OR_EXPIRED_APPROVAL'; END IF;

  IF p_link->>'v'<>'1'
     OR p_link->>'environment'<>'DEV'
     OR p_link->>'audience'<>'GPT02_DUAL_ACCOUNT_COMMAND_LINK'
     OR p_link->>'companyId'<>'default'
     OR (p_link->>'hubTaskId')::integer<>v_task
     OR (p_link->>'coreCommandId')::uuid<>v_command
     OR (p_link->>'attemptId')::uuid<>v_attempt
     OR p_link->>'hubOperatorNamespace'<>'ai-task-hub.public.users'
     OR p_link->>'hubOperatorId'<>p_approval->>'superAdminId'
     OR p_link->>'hubRole'<>'super_admin'
     OR (p_link->>'hubActive')::boolean IS NOT TRUE
     OR p_link->>'coreOperatorNamespace'<>'ai-core.ai_platform.internal_users'
     OR p_link->>'coreRole' NOT IN ('owner','admin')
     OR (p_link->>'coreActive')::boolean IS NOT TRUE
     OR (p_link->>'corePasswordChanged')::boolean IS NOT TRUE
     OR p_link->>'workerId'<>'openclaw-dell-chatgpt-wake-dev'
     OR p_link->>'approvalDigest'<>p_digest
     OR p_link->>'nonce'<>p_approval->>'nonce'
     OR (p_link->>'attemptNumber')::integer<>1
     OR v_link_issued<v_issued OR v_link_expires>v_expires
     OR v_link_expires<=v_link_issued OR v_link_expires-v_link_issued>120000
     OR coalesce(p_hub_signature,'') !~ '^[A-Za-z0-9_-]{86}$'
     OR coalesce(p_core_signature,'') !~ '^[A-Za-z0-9_-]{86}$'
     OR coalesce(p_link_digest,'') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_OPERATOR_LINK_CONTRACT'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_command::text,0));

  IF NOT EXISTS(
    SELECT 1 FROM gpt02_stage.core_preparations p
    WHERE p.company_id='default' AND p.hub_task_id=v_task
      AND p.command_candidate_id=v_command AND p.attempt_id=v_attempt
      AND p.hub_execution_id=v_hub_execution AND p.core_task_id=v_core_task
      AND p.member_id=(p_link->>'assigneeId')::integer
      AND p.operator_subject=p_approval->>'superAdminId'
      AND p.expires_at>clock_timestamp()
  ) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PREPARATION_BINDING_REQUIRED'; END IF;

  SELECT * INTO v_existing_approval FROM gpt02_private.approvals WHERE command_id=v_command;
  SELECT * INTO v_existing_link FROM gpt02_private.operator_links WHERE command_id=v_command;
  IF v_existing_approval.command_id IS NOT NULL OR v_existing_link.command_id IS NOT NULL THEN
    IF v_existing_approval.command_id IS NULL OR v_existing_link.command_id IS NULL
       OR v_existing_approval.attempt_id<>v_attempt
       OR v_existing_approval.nonce<>p_approval->>'nonce'
       OR v_existing_approval.task_id<>v_task
       OR v_existing_approval.company_id<>'default'
       OR v_existing_approval.approver_id<>p_approval->>'superAdminId'
       OR v_existing_approval.claims<>p_approval
       OR v_existing_approval.signature<>p_signature
       OR v_existing_approval.digest<>p_digest
       OR v_existing_link.link_id<>v_link
       OR v_existing_link.claims<>p_link
       OR v_existing_link.link_digest<>p_link_digest
       OR v_existing_link.hub_signature<>p_hub_signature
       OR v_existing_link.core_signature<>p_core_signature
    THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='LINKED_APPROVAL_CONFLICT'; END IF;
    RETURN true;
  END IF;

  INSERT INTO gpt02_private.approvals(
    command_id,attempt_id,nonce,task_id,company_id,approver_id,claims,signature,digest,expires_at,operator_namespace
  ) VALUES(
    v_command,v_attempt,p_approval->>'nonce',v_task,'default',p_approval->>'superAdminId',
    p_approval,p_signature,p_digest,to_timestamp(v_expires/1000.0),'ai-task-hub.public.users'
  );

  INSERT INTO gpt02_private.operator_links(
    link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,attempt_number,
    company_id,assignee_id,accountable_owner_id,hub_operator_id,core_operator_user_id,
    approval_digest,link_digest,hub_signature,core_signature,claims,expires_at
  ) VALUES(
    v_link,v_command,v_hub_execution,v_core_task,v_task,v_attempt,1,'default',
    (p_link->>'assigneeId')::integer,p_link->>'accountableOwnerId',p_link->>'hubOperatorId',
    (p_link->>'coreOperatorUserId')::integer,p_digest,p_link_digest,p_hub_signature,p_core_signature,
    p_link,to_timestamp(v_link_expires/1000.0)
  );
  RETURN true;
END
$fn$;

CREATE OR REPLACE FUNCTION gpt02_private.consume_linked_approval(
  p_approval jsonb,p_signature text,p_digest text,
  p_link jsonb,p_hub_signature text,p_core_signature text,p_link_digest text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog
AS $fn$
DECLARE
  v_command uuid; v_attempt uuid; v_link uuid; v_receipt uuid;
  v_core_operator integer; v_hub_operator text;
BEGIN
  IF session_user<>'dev_gpt02_issuer_evidence' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ISSUER_SESSION_REQUIRED';
  END IF;
  BEGIN
    v_command:=(p_approval->>'commandId')::uuid;
    v_attempt:=(p_approval->>'attemptId')::uuid;
    v_link:=(p_link->>'linkId')::uuid;
    v_core_operator:=(p_link->>'coreOperatorUserId')::integer;
    v_hub_operator:=p_link->>'hubOperatorId';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_LINKED_APPROVAL_TYPES';
  END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_command::text,0));

  IF NOT EXISTS(
    SELECT 1 FROM gpt02_private.approvals a
    JOIN gpt02_private.operator_links l ON l.command_id=a.command_id
    JOIN gpt02_stage.core_preparations p
      ON p.command_candidate_id=a.command_id AND p.attempt_id=a.attempt_id
    WHERE a.command_id=v_command AND a.attempt_id=v_attempt
      AND a.claims=p_approval AND a.signature=p_signature AND a.digest=p_digest
      AND a.nonce=p_approval->>'nonce' AND a.expires_at>clock_timestamp()
      AND l.link_id=v_link AND l.claims=p_link AND l.link_digest=p_link_digest
      AND l.hub_signature=p_hub_signature AND l.core_signature=p_core_signature
      AND l.expires_at>clock_timestamp()
      AND l.approval_digest=a.digest AND l.attempt_id=a.attempt_id
      AND l.hub_task_id=a.task_id AND l.company_id=a.company_id
      AND p.company_id=a.company_id AND p.hub_task_id=a.task_id
      AND p.hub_execution_id=l.hub_execution_id AND p.core_task_id=l.core_task_id
      AND p.expires_at>clock_timestamp()
  ) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='LINKED_APPROVAL_NOT_AVAILABLE'; END IF;

  IF EXISTS(SELECT 1 FROM gpt02_private.receipts WHERE command_id=v_command)
     OR EXISTS(SELECT 1 FROM gpt02_private.core_identity_receipts WHERE command_id=v_command)
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='LINKED_APPROVAL_ALREADY_CONSUMED'; END IF;

  INSERT INTO gpt02_private.receipts(command_id,nonce,digest)
  VALUES(v_command,p_approval->>'nonce',p_digest) RETURNING id INTO v_receipt;

  INSERT INTO gpt02_private.core_identity_receipts(
    receipt_id,command_id,link_id,operator_user_id,recorded_by,hub_operator_id,link_digest,
    binding_verified,may_dispatch_worker,may_close_job,may_issue_grant,core_ledger_written
  ) VALUES(
    v_receipt,v_command,v_link,v_core_operator,'internal:'||v_core_operator::text,
    v_hub_operator,p_link_digest,false,false,false,false,false
  );
  RETURN v_receipt;
END
$fn$;

CREATE OR REPLACE FUNCTION gpt02_private.reserve_post_consumption_fence(
  p_receipt_id uuid,p_command_id uuid,p_link_id uuid,p_worker_id text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog
AS $fn$
DECLARE
  v_fence uuid; v_attempt uuid; v_hub_execution uuid; v_core_task uuid;
  v_deadline timestamptz; v_start timestamptz;
BEGIN
  IF session_user<>'dev_gpt02_issuer_evidence' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ISSUER_SESSION_REQUIRED';
  END IF;
  IF p_worker_id<>'openclaw-dell-chatgpt-wake-dev' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='WORKER_SCOPE_DENIED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));

  SELECT l.attempt_id,l.hub_execution_id,l.core_task_id,least(a.expires_at,l.expires_at)
  INTO v_attempt,v_hub_execution,v_core_task,v_deadline
  FROM gpt02_private.receipts r
  JOIN gpt02_private.core_identity_receipts i ON i.receipt_id=r.id AND i.command_id=r.command_id
  JOIN gpt02_private.operator_links l ON l.link_id=i.link_id AND l.command_id=i.command_id
  JOIN gpt02_private.approvals a ON a.command_id=r.command_id
  WHERE r.id=p_receipt_id AND r.command_id=p_command_id AND l.link_id=p_link_id
    AND i.binding_verified=false AND i.may_dispatch_worker=false
    AND i.may_close_job=false AND i.may_issue_grant=false AND i.core_ledger_written=false
    AND a.expires_at>clock_timestamp() AND l.expires_at>clock_timestamp();

  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CONSUMED_EVIDENCE_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM gpt02_private.post_consumption_fences WHERE command_id=p_command_id)
  THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FENCE_ALREADY_RESERVED'; END IF;

  v_start:=clock_timestamp();
  v_deadline:=least(v_deadline,v_start+interval '15 seconds');
  IF v_deadline<=v_start THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='FENCE_WINDOW_EXPIRED';
  END IF;

  INSERT INTO gpt02_private.post_consumption_fences(
    receipt_id,command_id,link_id,hub_execution_id,core_task_id,attempt_id,worker_id,
    lease_epoch,lease_started_at,lease_expires_at,dispatch_allowed,core_ledger_written
  ) VALUES(
    p_receipt_id,p_command_id,p_link_id,v_hub_execution,v_core_task,v_attempt,p_worker_id,
    1,v_start,v_deadline,false,false
  ) RETURNING fence_id INTO v_fence;
  RETURN v_fence;
END
$fn$;

REVOKE ALL ON FUNCTION gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_private.consume_linked_approval(jsonb,text,text,jsonb,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_private.reserve_post_consumption_fence(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text)
  TO dev_gpt02_attestor_evidence;
GRANT EXECUTE ON FUNCTION gpt02_private.consume_linked_approval(jsonb,text,text,jsonb,text,text,text)
  TO dev_gpt02_issuer_evidence;
GRANT EXECUTE ON FUNCTION gpt02_private.reserve_post_consumption_fence(uuid,uuid,uuid,text)
  TO dev_gpt02_issuer_evidence;
GRANT USAGE ON SCHEMA gpt02_private TO dev_gpt02_attestor_evidence,dev_gpt02_issuer_evidence;
RESET ROLE;
REVOKE SET OPTION FOR gpt02_store_owner FROM postgres GRANTED BY postgres RESTRICT;

DO $post$
BEGIN
  IF to_regprocedure('gpt02_stage.prepare_core_task(text,integer,text,text,text,text)') IS NULL
     OR to_regprocedure('gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text)') IS NULL
     OR to_regprocedure('gpt02_private.consume_linked_approval(jsonb,text,text,jsonb,text,text,text)') IS NULL
     OR to_regprocedure('gpt02_private.reserve_post_consumption_fence(uuid,uuid,uuid,text)') IS NULL
  THEN RAISE EXCEPTION 'GPT02_OPERATIONAL_FUNCTION_POSTCONDITION_FAILED'; END IF;

  IF NOT has_schema_privilege('gpt02_store_owner','gpt02_stage','USAGE')
     OR NOT has_table_privilege('gpt02_store_owner','gpt02_stage.core_preparations','SELECT')
     OR has_table_privilege('gpt02_store_owner','gpt02_stage.core_preparations','INSERT,UPDATE,DELETE,TRUNCATE')
     OR NOT EXISTS(
       SELECT 1 FROM pg_policies
       WHERE schemaname='gpt02_stage'
         AND tablename='core_preparations'
         AND policyname='gpt02_store_owner_preparation_read'
         AND cmd='SELECT'
         AND roles='{gpt02_store_owner}'
     )
  THEN RAISE EXCEPTION 'GPT02_OPERATIONAL_PREPARATION_READ_BOUNDARY_FAILED'; END IF;

  IF has_function_privilege('public',
       'gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text)','EXECUTE')
     OR has_function_privilege('public',
       'gpt02_private.consume_linked_approval(jsonb,text,text,jsonb,text,text,text)','EXECUTE')
     OR has_function_privilege('public',
       'gpt02_private.reserve_post_consumption_fence(uuid,uuid,uuid,text)','EXECUTE')
  THEN RAISE EXCEPTION 'GPT02_OPERATIONAL_PUBLIC_EXECUTE_LEAK'; END IF;
END
$post$;

COMMIT;
