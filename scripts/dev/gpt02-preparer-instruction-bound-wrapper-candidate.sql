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
