-- CST-DEV only; guarded, atomically rolled-back if the live snapshot drifts.
-- The preparer LOGIN stays NOLOGIN. No grant, issuer, nonce or worker dispatch.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SELECT pg_advisory_xact_lock(hashtextextended('gpt02_preparer_wrapper_hardening_20261114',0));
DO $guarded_pre$
DECLARE f record; r record; internal_oid oid;
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
    OR current_setting('transaction_read_only')<>'off'
    OR NOT pg_has_role('postgres','gpt02_core_prep_owner','MEMBER') THEN
   RAISE EXCEPTION 'GPT02_WRAPPER_CST_DEV_ADMIN_CONTEXT_REQUIRED';
 END IF;
 SELECT rolcanlogin,rolconnlimit,rolvaliduntil INTO r
 FROM pg_roles WHERE rolname='gpt02_core_prep_login';
 IF NOT FOUND OR r.rolcanlogin IS DISTINCT FROM false OR r.rolconnlimit<>0
    OR r.rolvaliduntil IS NULL OR r.rolvaliduntil>=clock_timestamp()
    OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='gpt02_core_prep_login') THEN
   RAISE EXCEPTION 'GPT02_PREPARER_LOGIN_NOT_LOCKED';
 END IF;
 SELECT p.oid,p.prosecdef,p.proacl::text AS acl,
        pg_get_userbyid(p.proowner) AS owner,
        encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex') AS sha
 INTO f
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task'
   AND p.proargtypes='25 23 25 25 25 25'::oidvector;
 IF NOT FOUND OR f.owner<>'gpt02_core_prep_owner' OR f.prosecdef IS DISTINCT FROM true
    OR f.acl IS DISTINCT FROM '{gpt02_core_prep_owner=X/gpt02_core_prep_owner,gpt02_core_prep_login=X/gpt02_core_prep_owner}'
    OR f.sha IS DISTINCT FROM 'b5cf331682d291f61a012853671cd40c1dc3068fc7e1c57f81354c755f7d47c7'
    OR NOT has_function_privilege('gpt02_core_prep_login',f.oid,'EXECUTE') THEN
   RAISE EXCEPTION 'GPT02_BASELINE_WRAPPER_SIGNATURE_OWNER_OR_PRIVILEGE_DRIFT';
 END IF;
 SELECT p.oid INTO internal_oid
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task_v1_internal'
   AND p.proargtypes='25 23 25 25 25 25'::oidvector
   AND pg_get_userbyid(p.proowner)='gpt02_core_prep_owner' AND p.prosecdef;
 IF internal_oid IS NULL OR
    has_function_privilege('gpt02_core_prep_login',internal_oid,'EXECUTE') THEN
   RAISE EXCEPTION 'GPT02_INTERNAL_ENTRYPOINT_NOT_RESTRICTED';
 END IF;
 IF EXISTS(SELECT 1 FROM gpt02_stage.core_preparations WHERE expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM gpt02_stage.core_preparations WHERE company_id='default' AND hub_task_id=171)
    OR EXISTS(SELECT 1 FROM public.ai_execution_jobs WHERE company_id='default' AND task_id=171)
    OR NOT EXISTS(SELECT 1 FROM public.ai_tasks WHERE company_id='default' AND id=171
      AND assigned_to_id=5 AND status='new_inquiry' AND source='manual') THEN
   RAISE EXCEPTION 'GPT02_TASK171_OR_PREPARER_STATE_CHANGED';
 END IF;
END $guarded_pre$;

-- SOURCE CANDIDATE ONLY — security review required, NEVER auto-deploy.
-- CST-DEV preparer public entrypoint hardening for Task #171 and future
-- manually created, fresh GPT02 tasks. Does not create a new function, role,
-- grant, issuer, nonce, command, worker lease or execution itself.
--
-- A qualified operator must verify the project/role owner, inherited ACL,
-- current function body and rollback under a reviewed migration before any
-- hosted CST-DEV application. This statement should be run AS the existing
-- function owner gpt02_core_prep_owner. CREATE OR REPLACE preserves its ACL.
CREATE OR REPLACE FUNCTION gpt02_stage.prepare_core_task(
  p_company text,p_task integer,p_project text,p_repo text,
  p_branch text,p_instruction text
) RETURNS TABLE (
  core_task_id uuid,command_candidate_id uuid,attempt_id uuid,
  hub_execution_id uuid,created boolean,dispatch_permitted boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $gpt02_preparer_guard$
BEGIN
  -- Retain the hosted wrapper's original Task>139 and dedicated-login fences.
  IF session_user <> 'gpt02_core_prep_login' OR p_task <= 139 OR
     p_company IS DISTINCT FROM 'default' OR
     p_project IS DISTINCT FROM 'GPT02 DEV coding lifecycle' OR
     p_repo IS DISTINCT FROM 'Travelintrips/Core-AI-Foundation' OR
     p_branch IS DISTINCT FROM 'develop' OR
     p_instruction IS NULL OR length(p_instruction) NOT BETWEEN 1 AND 2000 OR
     p_instruction ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='PREPARATION_SCOPE_DENIED';
  END IF;
  -- Obtain precisely the same transaction advisory lock used by the original
  -- Hub assignment and internal preparation. This prevents a PIC/task edit
  -- from racing between instruction readback and Core/Hub reservation.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_company || ':' || p_task::text,0));
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_tasks t
    WHERE t.id=p_task AND t.company_id=p_company
      AND t.status='new_inquiry' AND t.source='manual'
      AND t.description IS NOT NULL AND t.description=p_instruction
      AND t.title NOT ILIKE 'AI Core bridge command%'
      AND t.description NOT ILIKE 'AI Core bridge command%'
      AND t.description NOT ILIKE 'bridge-command:%'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='PREPARATION_TASK_INSTRUCTION_NOT_BOUND';
  END IF;
  -- The independently restricted internal function still verifies PIC FK,
  -- Super Admin audit, tenant, operator, idempotency and atomic Core/Hub
  -- preparation. It remains unreachable to the preparer LOGIN directly.
  RETURN QUERY SELECT *
    FROM gpt02_stage.prepare_core_task_v1_internal(
      p_company,p_task,p_project,p_repo,p_branch,p_instruction);
END;
$gpt02_preparer_guard$;


DO $guarded_post$
DECLARE f record; r record;
BEGIN
 SELECT p.oid,p.prosecdef,p.proacl::text AS acl,
        pg_get_userbyid(p.proowner) AS owner,
        pg_get_functiondef(p.oid) AS definition
 INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task'
   AND p.proargtypes='25 23 25 25 25 25'::oidvector;
 IF f.oid IS NULL OR f.owner<>'gpt02_core_prep_owner' OR f.prosecdef IS DISTINCT FROM true
    OR f.acl IS DISTINCT FROM '{gpt02_core_prep_owner=X/gpt02_core_prep_owner,gpt02_core_prep_login=X/gpt02_core_prep_owner}'
    OR position('pg_advisory_xact_lock' in f.definition)=0
    OR position('t.description=p_instruction' in f.definition)=0
    OR position('t.status=''new_inquiry''' in f.definition)=0
    OR position('t.source=''manual''' in f.definition)=0 THEN
   RAISE EXCEPTION 'GPT02_HARDENED_WRAPPER_POST_READBACK_FAILED';
 END IF;
 SELECT rolcanlogin,rolconnlimit INTO r FROM pg_roles WHERE rolname='gpt02_core_prep_login';
 IF NOT FOUND OR r.rolcanlogin OR r.rolconnlimit<>0
    OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='gpt02_core_prep_login')
    OR EXISTS(SELECT 1 FROM gpt02_stage.core_preparations WHERE company_id='default' AND hub_task_id=171)
    OR EXISTS(SELECT 1 FROM public.ai_execution_jobs WHERE company_id='default' AND task_id=171) THEN
   RAISE EXCEPTION 'GPT02_HARDENED_WRAPPER_POST_STATE_NOT_INERT';
 END IF;
END $guarded_post$;
COMMIT;
