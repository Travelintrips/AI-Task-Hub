-- CST-DEV ONLY: reviewed NOLOGIN owner grants; no LOGIN/EXECUTE/command.
-- Exact target: Supabase project xssrfshdrtdfupgqwfdw, PostgreSQL 17.
-- Run using the Supabase project-scoped migration manager ONLY.
-- No BEGIN/COMMIT in this body; manager owns the transaction.
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='15s';
SELECT pg_advisory_xact_lock(hashtextextended('gpt02_dev_inert_owner_parent_grants_20261110',0));
DO $pre$
DECLARE r record;
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
   OR current_setting('transaction_read_only')<>'off'
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres'
      AND NOT rolsuper AND rolcreaterole AND rolbypassrls)
   OR pg_has_role('postgres','gpt02_core_prep_owner','SET')
   OR pg_has_role('postgres','gpt02_core_prep_owner','USAGE') THEN
  RAISE EXCEPTION 'GPT02_DEV_OWNER_PARENT_GRANT_TARGET_DENIED';
 END IF;
 IF (SELECT count(*) FROM pg_auth_members m
       WHERE m.roleid='gpt02_core_prep_owner'::regrole AND m.member='postgres'::regrole)<>1 OR
    NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
      WHERE m.roleid='gpt02_core_prep_owner'::regrole AND m.member='postgres'::regrole
        AND g.rolname='supabase_admin' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) OR
    (SELECT count(*) FROM pg_roles WHERE rolname IN
      ('gpt02_core_prep_owner','gpt02_core_prep_login','dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence')
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls AND rolconnlimit=0)<>4 OR
    EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles login_role ON login_role.oid=m.member
      WHERE login_role.rolname IN('gpt02_core_prep_login','dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence')) OR
    (SELECT count(*) FROM pg_policies p WHERE p.policyname LIKE 'gpt02_preparer_%')<>10 OR
    NOT EXISTS(SELECT 1 FROM pg_policies p WHERE p.policyname LIKE 'gpt02_preparer_%'
      HAVING count(*) FILTER (WHERE p.roles='{gpt02_core_prep_owner}'::name[])=10
                         AND count(*) FILTER (WHERE p.cmd='INSERT')=2
       AND encode(sha256(convert_to(string_agg(
         format('%s|%s|%s|%s|%s|%s|%s|%s',p.schemaname,p.tablename,p.policyname,p.permissive,p.roles::text,p.cmd,
           coalesce(p.qual,'<NULL>'),coalesce(p.with_check,'<NULL>')),
         E'\n' ORDER BY p.schemaname,p.tablename,p.policyname),'UTF8')),'hex')=
       'b157e1fbfe1a844309373db42743257f1996895316dc87166d385637c9f8031d') OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='gpt02_private' AND p.proname IN
        ('record_approval','consume_approval','record_linked_approval','consume_linked_approval')) THEN
   RAISE EXCEPTION 'GPT02_DEV_OWNER_ROLE_OR_RLS_FINGERPRINT_DRIFT';
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
   OR (SELECT COUNT(*) FROM public.ai_tasks WHERE id>136)<>0
   OR (SELECT COUNT(*) FROM ai_platform.ai_coding_tasks WHERE task_number LIKE 'GPT02DEV-%')<>0
   OR (SELECT count(*) FROM gpt02_private.approvals WHERE task_id<=136)<>0
   OR (SELECT COUNT(*) FROM pg_policies WHERE policyname LIKE 'gpt02_preparer_%'
       AND roles='{gpt02_core_prep_owner}'::name[])<>10 THEN
  RAISE EXCEPTION 'GPT02_DEV_OWNER_PARENT_GRANT_SECURITY_DRIFT';
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
   RAISE EXCEPTION 'GPT02_DEV_OWNER_PARENT_GRANT_PARENT_DRIFT:%',r.relname;
  END IF;
 END LOOP;
 IF (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE (n.nspname='public' AND c.relname IN
      ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
   OR (n.nspname='ai_platform' AND c.relname IN
      ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands')))<>8 THEN
  RAISE EXCEPTION 'GPT02_DEV_OWNER_PARENT_GRANT_MISSING_PARENT';
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
    RAISE EXCEPTION 'GPT02_DEV_OWNER_PARENT_GRANT_POSTCHECK_FAILED:%',r.relname;
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
    OR (SELECT COUNT(*) FROM public.ai_tasks WHERE id>136)<>0 OR
    (SELECT COUNT(*) FROM ai_platform.ai_coding_tasks WHERE task_number LIKE 'GPT02DEV-%')<>0 OR
    (SELECT COUNT(*) FROM public.ai_execution_jobs WHERE status='prepared')<>0 OR
    (SELECT COUNT(*) FROM gpt02_private.receipts)<>0 THEN
   RAISE EXCEPTION 'GPT02_DEV_OWNER_PARENT_GRANT_AUTHORITY_LEAK';
 END IF;
END $post$;
