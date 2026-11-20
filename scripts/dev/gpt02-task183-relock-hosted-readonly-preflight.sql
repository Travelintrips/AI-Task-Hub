-- CST-DEV ONLY. READ-ONLY catalog preflight for independent Task #183
-- relock review. Requires an authorized catalog reader connected to the exact
-- CST-DEV project xssrfshdrtdfupgqwfdw; this query does not identify the
-- Supabase project independently from the connection configuration.
-- No DDL, DML, secret extraction, privilege elevation, login or dispatch.
WITH expected(name, sha) AS (
  VALUES
   ('prepare_core_task','a759ab94ab38e0f0fcf0b42bc14dbbf30308274344a14ade666e1bae38a1c456'),
   ('prepare_core_task_v1_internal','b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4')
), functions AS (
  SELECT p.proname,pg_catalog.pg_get_userbyid(p.proowner) AS owner,p.prosecdef,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') AS digest
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gpt02_stage'
    AND p.proname IN ('prepare_core_task','prepare_core_task_v1_internal')
), scoped_tables AS (
  SELECT c.oid,c.relrowsecurity
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname='public' AND c.relname IN
    ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
    OR (n.nspname='ai_platform' AND c.relname IN
    ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands'))
)
SELECT
  pg_catalog.current_database()='postgres' AS expected_db_name,
  (SELECT count(*)=2 FROM functions) AS both_functions_present,
  (SELECT pg_catalog.bool_and(f.owner='gpt02_core_prep_owner'
    AND f.prosecdef AND f.digest=e.sha) FROM expected e
    JOIN functions f ON f.proname=e.name) AS trusted_function_source_hashes,
  (SELECT count(*)=8 AND pg_catalog.bool_and(relrowsecurity)
    FROM scoped_tables) AS scoped_tables_rls_enabled,
  (SELECT count(*)=0 FROM scoped_tables
    WHERE pg_catalog.has_table_privilege('gpt02_core_prep_login',oid,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    AS preparer_no_direct_table_privileges,
  (SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE member='gpt02_core_prep_login'::pg_catalog.regrole))
    AS preparer_no_role_memberships,
  (SELECT NOT rolcanlogin AND rolpassword IS NULL AND rolconnlimit=0
    FROM pg_catalog.pg_authid WHERE rolname='gpt02_core_prep_login')
    AS preparer_locked_and_password_cleared,
  (SELECT pg_catalog.has_function_privilege('gpt02_core_prep_login',
    'gpt02_stage.prepare_core_task(text,integer,text,text,text,text)','EXECUTE'))
    AS scoped_wrapper_execute_only,
  (SELECT NOT pg_catalog.has_function_privilege('gpt02_core_prep_login',
    'gpt02_stage.prepare_core_task_v1_internal(text,integer,text,text,text,text)','EXECUTE'))
    AS direct_internal_execute_denied,
  (SELECT count(*)::integer FROM pg_catalog.pg_roles
    WHERE rolname='gpt02_task183_relock_login') AS independent_relock_role_count,
  (SELECT count(*)::integer FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gpt02_guard' AND p.proname='relock_task183_preparer')
    AS independent_relock_function_count,
  (SELECT count(*)::integer FROM public.ai_execution_jobs WHERE task_id=183)
    AS task183_job_count,
  (SELECT count(*)::integer FROM gpt02_stage.core_preparations WHERE hub_task_id=183)
    AS task183_preparation_count,
  (SELECT count(*)::integer FROM gpt02_private.approvals WHERE task_id=183)
    AS task183_signed_approval_count;
