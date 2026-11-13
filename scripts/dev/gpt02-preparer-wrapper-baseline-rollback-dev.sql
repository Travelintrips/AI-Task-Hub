-- EMERGENCY ROLLBACK CANDIDATE, CST-DEV ONLY, not auto-executable.
-- Captured from hosted live pg_get_functiondef() before wrapper hardening.
-- Restores the old function body without altering owner, ACL, login or issuer.
-- Requires independent review and a pinned post-hardening fingerprint.
CREATE OR REPLACE FUNCTION gpt02_stage.prepare_core_task(p_company text, p_task integer, p_project text, p_repo text, p_branch text, p_instruction text)
 RETURNS TABLE(core_task_id uuid, command_candidate_id uuid, attempt_id uuid, hub_execution_id uuid, created boolean, dispatch_permitted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF session_user<>'gpt02_core_prep_login' OR p_task<=139 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FRESH_TASK_AFTER_139_REQUIRED';
  END IF;
  RETURN QUERY
    SELECT * FROM gpt02_stage.prepare_core_task_v1_internal(
      p_company,p_task,p_project,p_repo,p_branch,p_instruction
    );
END;
$function$;
