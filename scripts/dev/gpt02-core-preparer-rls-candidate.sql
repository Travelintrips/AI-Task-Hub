-- DEV GPT02 scoped preparer policies. Does NOT grant login, table rights,
-- function EXECUTE or dispatch. Never run without a reviewed CST-DEV target.
-- This EXACT file is injected into the offline PostgreSQL16 integration fixture.
DO $gpt02_rls_preflight$
DECLARE existing integer;
BEGIN
 IF current_user <> 'postgres' OR
    current_database() NOT IN ('postgres','gpt02_core_preparation_isolated') OR
    to_regclass('gpt02_stage.core_preparations') IS NULL OR
    (SELECT pg_get_userbyid(relowner) FROM pg_class
      WHERE oid='gpt02_stage.core_preparations'::regclass) <> 'gpt02_core_prep_owner' OR
    (SELECT NOT(relrowsecurity AND relforcerowsecurity) FROM pg_class
      WHERE oid='gpt02_stage.core_preparations'::regclass) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GPT02_RLS_TARGET_OR_STAGING_NOT_VERIFIED';
 END IF;
 IF current_database()='postgres' THEN
   IF (SELECT COUNT(*) FROM pg_roles WHERE rolname IN
       ('gpt02_core_prep_login','gpt02_core_prep_owner') AND
       NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND
       NOT rolbypassrls AND rolconnlimit=0) <> 2 OR
       (SELECT COUNT(*) FROM gpt02_stage.core_preparations) <> 0 OR
       EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task') THEN
     RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='GPT02_RLS_OWNER_NOT_DORMANT_OR_PREPARATION_STARTED';
   END IF;
 END IF;
 SELECT COUNT(*) INTO existing
 FROM pg_policies WHERE policyname LIKE 'gpt02_preparer_%' AND
 ((schemaname='public' AND tablename IN ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
   OR (schemaname='ai_platform' AND tablename IN ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands')));
 IF existing<>0 THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='GPT02_RLS_ALREADY_PRESENT_REVIEW_FIRST';
 END IF;
END
$gpt02_rls_preflight$;
-- RLS must remain enabled. Policies are dedicated to the NOLOGIN preparer
-- function OWNER only; app users, anon, authenticated and PUBLIC gain nothing.
ALTER TABLE public.ai_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_execution_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_coding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_coding_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_coding_bridge_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY gpt02_preparer_hub_task_read ON public.ai_tasks
 FOR SELECT TO gpt02_core_prep_owner
 USING (company_id='default' AND id>136);
CREATE POLICY gpt02_preparer_pic_read ON public.team_members
 FOR SELECT TO gpt02_core_prep_owner
 USING (company_id='default' AND is_active IS TRUE);
CREATE POLICY gpt02_preparer_pic_audit_read ON public.audit_logs
 FOR SELECT TO gpt02_core_prep_owner
 USING (company_id='default' AND action='gpt02_pic_assigned'
   AND entity_id ~ '^[0-9]+$');
CREATE POLICY gpt02_preparer_operator_read ON public.users
 FOR SELECT TO gpt02_core_prep_owner
 USING (company_id IS NULL AND is_active IS TRUE AND role='super_admin');
-- Observe ALL prior Hub executions for the same new task, including FAILED,
-- so reuse cannot be hidden by filtering only status='prepared'.
CREATE POLICY gpt02_preparer_hub_execution_read ON public.ai_execution_jobs
 FOR SELECT TO gpt02_core_prep_owner
 USING (company_id='default' AND task_id>136);
CREATE POLICY gpt02_preparer_hub_execution_insert ON public.ai_execution_jobs
 FOR INSERT TO gpt02_core_prep_owner
 WITH CHECK (company_id='default' AND task_id>136
   AND source='AI_TASK' AND external_id='ai-task:default:'||task_id::text
   AND idempotency_key='gpt02-managed-preparation:default:'||task_id::text
   AND status='prepared' AND progress=0 AND command_id IS NULL
   AND worker_id IS NULL AND assigned_client_id IS NULL
   AND callback_verified IS FALSE AND attestation_verified IS FALSE
   AND final_ack_verified IS FALSE
   AND metadata->>'accountAlias'='GPT02'
   AND metadata->>'environment'='development'
   AND metadata->>'verificationMode'='chatgpt-attested'
   AND metadata->>'autoContinue'='false'
   AND metadata->>'dispatchStarted'='false'
   AND metadata->>'productionAllowed'='false');
CREATE POLICY gpt02_preparer_core_task_read ON ai_platform.ai_coding_tasks
 FOR SELECT TO gpt02_core_prep_owner
 USING (task_number ~ '^GPT02DEV-[1-9][0-9]*-[a-f0-9]{14}$'
  AND project_name='GPT02 DEV coding lifecycle'
  AND repository='Travelintrips/Core-AI-Foundation' AND branch='develop');
CREATE POLICY gpt02_preparer_core_task_insert ON ai_platform.ai_coding_tasks
 FOR INSERT TO gpt02_core_prep_owner
 WITH CHECK (task_number ~ '^GPT02DEV-[1-9][0-9]*-[a-f0-9]{14}$'
  AND project_name='GPT02 DEV coding lifecycle'
  AND repository='Travelintrips/Core-AI-Foundation' AND branch='develop'
  AND status='PENDING' AND priority=50 AND length(instruction) BETWEEN 1 AND 2000);
-- Existing run/command tables must never reveal unrelated Core tasks.
CREATE POLICY gpt02_preparer_core_runs_read ON ai_platform.ai_coding_runs
 FOR SELECT TO gpt02_core_prep_owner
 USING (task_id IN (SELECT core_task_id FROM gpt02_stage.core_preparations));
CREATE POLICY gpt02_preparer_core_commands_read ON ai_platform.ai_coding_bridge_commands
 FOR SELECT TO gpt02_core_prep_owner
 USING (task_id IN (SELECT core_task_id FROM gpt02_stage.core_preparations));

DO $gpt02_rls_post$
DECLARE n integer;
BEGIN
 SELECT COUNT(*) INTO n FROM pg_policies
  WHERE policyname LIKE 'gpt02_preparer_%'
    AND roles='{gpt02_core_prep_owner}'::name[]
    AND cmd IN ('SELECT','INSERT');
 IF n<>10 THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='GPT02_RLS_POLICY_SET_INCOMPLETE';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('gpt02_core_prep_login','gpt02_core_prep_owner')
      AND current_database()='postgres' AND rolcanlogin) THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='GPT02_RLS_OWNER_LOGIN_CHANGED';
 END IF;
END $gpt02_rls_post$;
