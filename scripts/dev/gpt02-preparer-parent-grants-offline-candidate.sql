-- OFFLINE FIXTURE ONLY. This is NOT an operational CST-DEV/PROD migration.
-- Intentionally requires a disposable session marker; never enable a LOGIN,
-- grant function EXECUTE, or alter any worker/issuer/attestor/approval.
-- Supabase migration manager would own the outer transaction; no COMMIT here.
DO $pre$
DECLARE r record;
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
   OR current_setting('gpt02.offline_grant_fixture',true) IS DISTINCT FROM 'yes'
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fixture_root' AND rolsuper)
   OR current_setting('transaction_read_only')<>'off'
   OR pg_has_role('postgres','gpt02_core_prep_owner','SET')
   OR pg_has_role('postgres','gpt02_core_prep_owner','USAGE') THEN
  RAISE EXCEPTION 'GPT02_OFFLINE_GRANT_TARGET_DENIED';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task_dormant'
        AND pg_get_userbyid(p.proowner)='gpt02_core_prep_owner'
        AND p.prosecdef
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')
            ='b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4')
   OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task')
   OR has_function_privilege('gpt02_core_prep_login',
         'gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text)','EXECUTE')
   OR has_schema_privilege('gpt02_core_prep_login','gpt02_stage','USAGE')
   OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN
      ('gpt02_core_prep_login','gpt02_core_prep_owner','dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence')
       AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole))
   OR (SELECT COUNT(*) FROM pg_roles WHERE rolname IN
      ('gpt02_core_prep_login','gpt02_core_prep_owner','dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence'))<>4
   OR (SELECT COUNT(*) FROM gpt02_stage.core_preparations)<>0
   OR (SELECT COUNT(*) FROM gpt02_private.approvals)<>0
   OR (SELECT COUNT(*) FROM gpt02_private.receipts)<>0
   OR (SELECT COUNT(*) FROM public.ai_execution_jobs WHERE status='prepared' AND company_id='default')<>0
   OR (SELECT COUNT(*) FROM pg_policies WHERE policyname LIKE 'gpt02_preparer_%'
       AND roles='{gpt02_core_prep_owner}'::name[])<>10 THEN
  RAISE EXCEPTION 'GPT02_OFFLINE_GRANT_SECURITY_BASELINE_CHANGED';
 END IF;
 FOR r IN SELECT c.oid, n.nspname,c.relname,c.relrowsecurity,
   pg_get_userbyid(c.relowner) AS owner_name
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE (n.nspname='public' AND c.relname IN
      ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
   OR (n.nspname='ai_platform' AND c.relname IN
      ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands'))
 LOOP
  IF r.owner_name<>'postgres' OR NOT r.relrowsecurity
    OR has_table_privilege('gpt02_core_prep_owner',r.oid,'SELECT')
    OR has_table_privilege('gpt02_core_prep_owner',r.oid,'INSERT')
    OR has_table_privilege('gpt02_core_prep_owner',r.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_table_privilege('gpt02_core_prep_login',r.oid,'SELECT,INSERT,UPDATE,DELETE') THEN
   RAISE EXCEPTION 'GPT02_OFFLINE_GRANT_PARENT_BASELINE_CHANGED:%',r.relname;
  END IF;
 END LOOP;
 IF (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE (n.nspname='public' AND c.relname IN
      ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
   OR (n.nspname='ai_platform' AND c.relname IN
      ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands')))<>8 THEN
  RAISE EXCEPTION 'GPT02_OFFLINE_GRANT_MISSING_PARENT';
 END IF;
END $pre$;
-- Table-owner-only GRANTs, with the existing ten RLS policies; no memberships.
-- NO REFERENCES/UPDATE/DELETE grants. The two parent foreign keys already exist.
GRANT USAGE ON SCHEMA ai_platform,extensions TO gpt02_core_prep_owner;
GRANT SELECT ON public.ai_tasks,public.team_members,public.users,public.audit_logs,
  public.ai_execution_jobs,ai_platform.ai_coding_tasks,
  ai_platform.ai_coding_runs,ai_platform.ai_coding_bridge_commands TO gpt02_core_prep_owner;
GRANT INSERT ON public.ai_execution_jobs,ai_platform.ai_coding_tasks TO gpt02_core_prep_owner;
DO $post$
DECLARE r record;
BEGIN
 FOR r IN SELECT c.oid,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE (n.nspname='public' AND c.relname IN
      ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
   OR (n.nspname='ai_platform' AND c.relname IN
      ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands'))
 LOOP
  IF NOT has_table_privilege('gpt02_core_prep_owner',r.oid,'SELECT')
   OR (r.relname IN ('ai_execution_jobs','ai_coding_tasks')
       AND NOT has_table_privilege('gpt02_core_prep_owner',r.oid,'INSERT'))
   OR (r.relname NOT IN ('ai_execution_jobs','ai_coding_tasks')
       AND has_table_privilege('gpt02_core_prep_owner',r.oid,'INSERT'))
   OR has_table_privilege('gpt02_core_prep_owner',r.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_table_privilege('gpt02_core_prep_login',r.oid,'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'GPT02_OFFLINE_GRANT_POSTCONDITION_FAILED:%',r.relname;
  END IF;
 END LOOP;
 IF NOT has_schema_privilege('gpt02_core_prep_owner','ai_platform','USAGE')
    OR NOT has_schema_privilege('gpt02_core_prep_owner','extensions','USAGE')
    OR has_schema_privilege('gpt02_core_prep_login','gpt02_stage','USAGE')
    OR has_function_privilege('gpt02_core_prep_login',
          'gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text)','EXECUTE')
    OR pg_has_role('postgres','gpt02_core_prep_owner','SET')
    OR pg_has_role('postgres','gpt02_core_prep_owner','USAGE')
    OR (SELECT COUNT(*) FROM gpt02_stage.core_preparations)<>0
    OR (SELECT COUNT(*) FROM gpt02_private.approvals)<>0
    OR (SELECT COUNT(*) FROM gpt02_private.receipts)<>0 THEN
   RAISE EXCEPTION 'GPT02_OFFLINE_GRANT_AUTHORITY_LEAK';
 END IF;
END $post$;
