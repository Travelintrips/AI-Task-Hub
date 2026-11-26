-- CST-DEV candidate. The independent relock verifier pins this function body.
-- Install only on a closed preparer window after the release is accepted.
CREATE OR REPLACE FUNCTION gpt02_stage.prepare_core_task(
  p_company text,p_task integer,p_project text,p_repo text,
  p_branch text,p_instruction text
) RETURNS TABLE (
  core_task_id uuid,command_candidate_id uuid,attempt_id uuid,
  hub_execution_id uuid,created boolean,dispatch_permitted boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $gpt02_preparer_guard$
DECLARE
  binding text;
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
  -- The function owner records the active request on this function.
  -- A missing or unrecognized binding denies every call. Session settings
  -- and request parameters cannot change the catalog value.
  binding := pg_catalog.obj_description(
    'gpt02_stage.prepare_core_task(text,integer,text,text,text,text)'::pg_catalog.regprocedure, 'pg_proc');
  IF p_task IS NULL OR NOT COALESCE(
    (binding='GPT02 DEV legacy preparation' AND p_task<>189) OR
    (binding='GPT02 DEV prepare-only task 189 request 1bdbed20-ac8d-4e63-898e-6a94b729c018' AND p_task=189),
    false) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='PREPARATION_TASK_OUTSIDE_LEASE';
  END IF;
  -- Obtain precisely the same transaction advisory lock used by the original
  -- Hub assignment and internal preparation. This prevents a PIC/task edit
  -- from racing between instruction readback and Core/Hub reservation.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_company || ':' || p_task::text,0));
  IF p_task=189 AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user
      AND r.rolcanlogin AND r.rolconnlimit=1
      AND r.rolvaliduntil>pg_catalog.clock_timestamp()
      AND r.rolvaliduntil<=pg_catalog.clock_timestamp()+interval '180 seconds'
      AND NOT (r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR
               r.rolreplication OR r.rolbypassrls)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='PREPARATION_LEASE_INACTIVE';
  END IF;
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
