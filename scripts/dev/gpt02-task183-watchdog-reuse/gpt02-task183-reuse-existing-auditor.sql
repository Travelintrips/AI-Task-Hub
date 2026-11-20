-- CST-DEV only: reuse already-running independent Issue159 auditor,
-- no new service, timer, login or secret. Existing preparer must remain locked.
BEGIN;
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='15s';
DO $pre$
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR
    session_user<>'postgres' THEN
   RAISE EXCEPTION 'TASK183_RELOCK_WRONG_DATABASE_OR_MIGRATOR';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM pg_catalog.pg_authid
   WHERE rolname='gpt02_core_prep_login' AND NOT rolcanlogin AND
    rolpassword IS NULL AND rolconnlimit=0 AND
    rolvaliduntil<pg_catalog.clock_timestamp()
 ) THEN RAISE EXCEPTION 'TASK183_PREPARER_MUST_REMAIN_LOCKED'; END IF;
 IF NOT EXISTS(
   SELECT 1 FROM pg_catalog.pg_roles WHERE
   rolname='dev_gpt02_relock_catalog_auditor'
    AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit
 ) THEN RAISE EXCEPTION 'TASK183_EXISTING_AUDITOR_MISSING'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='gpt02_guard' AND p.proname='relock_task183_preparer'
    AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
    AND p.prosecdef
    AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
        = '62a37d9e5e07bb74cf9525821f4e0f2c16856e2b21d2525dd80274a79f6972d4'
 ) THEN RAISE EXCEPTION 'TASK183_RELOCK_BASELINE_HASH_MISMATCH'; END IF;
END $pre$;
CREATE OR REPLACE FUNCTION gpt02_guard.relock_task183_preparer()
 RETURNS TABLE(role_locked boolean, sessions_terminated integer, sessions_remaining integer, canary_active boolean,
 operational_active boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $relock$
DECLARE
 target pg_catalog.pg_authid%ROWTYPE;
 sess record;
 killed integer := 0;
 remaining integer := 0;
 catalog_ok boolean := false;
 canary_privilege_safe boolean := false;
 operational_window_safe boolean := false;
 bounded_surface_safe boolean := false;
BEGIN
 IF session_user <> 'dev_gpt02_relock_catalog_auditor' THEN
   RAISE EXCEPTION 'RELOCK_TASK183_INDEPENDENT_AUDITOR_REQUIRED' USING ERRCODE='42501';
 END IF;
 -- pg_authid is a protected system catalog. SELECT ... FOR UPDATE requires
 -- UPDATE privilege, absent from CST-DEV's non-superuser admin. Only read its
 -- metadata here; ALTER ROLE below obtains its own PostgreSQL catalog lock.
 -- A concurrent change can cause an early relock (fail closed), never a grant.
 SELECT * INTO target FROM pg_catalog.pg_authid WHERE rolname='gpt02_core_prep_login';
 IF NOT FOUND THEN RAISE EXCEPTION 'TASK183_PREPARER_ROLE_MISSING'; END IF;
 -- Independent safety check. Both canary and operational windows require a
 -- bounded, no-membership, no-direct-DML role with intact RLS source tables.
 -- In particular, a role with direct command/job privileges is NEVER preserved.
 IF pg_catalog.to_regprocedure('gpt02_stage.prepare_core_task(text,integer,text,text,text,text)') IS NOT NULL THEN
   BEGIN
     SELECT count(*)=8
       AND count(*) FILTER (WHERE pg_catalog.has_table_privilege(
        'gpt02_core_prep_login',c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))=0
       AND pg_catalog.bool_and(c.relrowsecurity)
     INTO bounded_surface_safe
     FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE (n.nspname='public' AND c.relname IN
       ('ai_tasks','team_members','audit_logs','users','ai_execution_jobs'))
       OR (n.nspname='ai_platform' AND c.relname IN
       ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands'));
     bounded_surface_safe := COALESCE(bounded_surface_safe,false)
       AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members m
        WHERE m.member='gpt02_core_prep_login'::pg_catalog.regrole)
       AND NOT pg_catalog.has_database_privilege(
        'gpt02_core_prep_login',pg_catalog.current_database(),'CREATE')
       AND pg_catalog.has_schema_privilege(
        'gpt02_core_prep_login','gpt02_stage','USAGE')
       AND NOT pg_catalog.has_schema_privilege(
        'gpt02_core_prep_login','ai_platform','USAGE')
       AND NOT pg_catalog.has_schema_privilege(
        'gpt02_core_prep_login','gpt02_private','USAGE')
       AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc other
        JOIN pg_catalog.pg_namespace ns ON ns.oid=other.pronamespace
        WHERE ns.nspname IN ('gpt02_stage','gpt02_private')
          AND NOT (ns.nspname='gpt02_stage' AND other.proname='prepare_core_task')
          AND pg_catalog.has_function_privilege(
            'gpt02_core_prep_login',other.oid,'EXECUTE'));
     IF bounded_surface_safe THEN
       canary_privilege_safe := NOT pg_catalog.has_function_privilege(
         'gpt02_core_prep_login',
         'gpt02_stage.prepare_core_task(text,integer,text,text,text,text)','EXECUTE');
       -- The operational window never grants EXECUTE; it can only recognize
       -- an existing trusted wrapper plus an independently opened short TTL.
       -- A public/third-party EXECUTE, changed SECURITY DEFINER owner, or
       -- direct access to the internal implementation forces immediate relock.
       operational_window_safe := NOT canary_privilege_safe
         AND NOT pg_catalog.has_function_privilege(
          'gpt02_core_prep_login',
          'gpt02_stage.prepare_core_task_v1_internal(text,integer,text,text,text,text)','EXECUTE')
         AND (SELECT count(*)=2
              AND pg_catalog.bool_and(
                p.prosecdef AND pg_catalog.pg_get_userbyid(p.proowner)='gpt02_core_prep_owner'
                AND pg_catalog.encode(pg_catalog.sha256(
                   pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=
                 CASE p.proname
                   WHEN 'prepare_core_task'
                     THEN 'a759ab94ab38e0f0fcf0b42bc14dbbf30308274344a14ade666e1bae38a1c456'
                   WHEN 'prepare_core_task_v1_internal'
                     THEN 'b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4'
                   ELSE NULL END)
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='gpt02_stage'
              AND p.proname IN ('prepare_core_task','prepare_core_task_v1_internal'))
         AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
            WHERE n.nspname='gpt02_stage'
              AND p.proname IN ('prepare_core_task','prepare_core_task_v1_internal')
              AND a.privilege_type='EXECUTE'
              AND (a.grantee=0 OR
                (p.proname='prepare_core_task' AND a.grantee NOT IN (
                   'gpt02_core_prep_owner'::pg_catalog.regrole::oid,
                   'gpt02_core_prep_login'::pg_catalog.regrole::oid))
                OR (p.proname='prepare_core_task_v1_internal'
                    AND a.grantee<>'gpt02_core_prep_owner'::pg_catalog.regrole::oid)));
     END IF;
   EXCEPTION WHEN OTHERS THEN
     canary_privilege_safe:=false;
     operational_window_safe:=false;
   END;
 END IF;
 -- For the already relocked role, don't rewrite pg_authid every watchdog tick.
 -- Still require the exact verified source/ACL/role restrictions before
 -- returning a locked readback. A live session bypasses this fast path.
 IF NOT target.rolcanlogin AND target.rolconnlimit=0 AND
    target.rolpassword IS NULL AND
    target.rolvaliduntil < pg_catalog.clock_timestamp() AND
    NOT (target.rolsuper OR target.rolbypassrls OR target.rolcreaterole OR
         target.rolcreatedb OR target.rolreplication OR target.rolinherit) AND
    bounded_surface_safe AND (canary_privilege_safe OR operational_window_safe)
 THEN
   BEGIN
     SELECT count(*)::integer INTO remaining
     FROM pg_catalog.pg_stat_activity WHERE usename='gpt02_core_prep_login';
   EXCEPTION WHEN OTHERS THEN
     remaining := -1;
   END;
   IF remaining=0 THEN
     RETURN QUERY SELECT true,0,0,false,false;
     RETURN;
   END IF;
 END IF;
 -- Only one authenticated backend and at most three minutes of role validity.
 -- This bounds a prepared-only API transaction, not signed Owner approval,
 -- command creation, issuer lease, or dispatch authority.
 IF target.rolcanlogin AND target.rolconnlimit=1 AND target.rolpassword IS NOT NULL
   AND target.rolvaliduntil > pg_catalog.clock_timestamp()
   AND target.rolvaliduntil <= pg_catalog.clock_timestamp() + INTERVAL '3 minutes'
   AND NOT (target.rolsuper OR target.rolbypassrls OR target.rolcreaterole
     OR target.rolcreatedb OR target.rolreplication OR target.rolinherit)
   AND (canary_privilege_safe OR operational_window_safe)
 THEN
   BEGIN
     SELECT count(*)::integer INTO remaining FROM pg_catalog.pg_stat_activity
       WHERE usename='gpt02_core_prep_login';
   EXCEPTION WHEN OTHERS THEN
     remaining := -1;
   END;
   IF remaining BETWEEN 0 AND 1 THEN
     RETURN QUERY SELECT false,0,remaining,canary_privilege_safe,operational_window_safe;
     RETURN;
   END IF;
 END IF;
 -- Modify only login/secret/lifetime attributes. NO[SUPERUSER|CREATEDB|
 -- REPLICATION] can be denied to a non-superuser even when disabling them.
 -- Existing privilege bits are checked, not rewritten.
 EXECUTE 'ALTER ROLE gpt02_core_prep_login NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL VALID UNTIL ''2000-01-01''';
 -- Do not throw after ALTER ROLE: a late session-termination error must
 -- NEVER roll back the earlier NOLOGIN and password-verifier removal.
 BEGIN
   FOR sess IN SELECT pid FROM pg_catalog.pg_stat_activity
      WHERE usename='gpt02_core_prep_login' AND pid<>pg_catalog.pg_backend_pid()
   LOOP
     BEGIN
       IF pg_catalog.pg_terminate_backend(sess.pid) THEN
         killed := killed + 1;
       END IF;
     EXCEPTION WHEN OTHERS THEN
       -- Continue with a catalog lock, then report any remaining live sessions.
       NULL;
     END;
   END LOOP;
 EXCEPTION WHEN OTHERS THEN
   -- Even a failure to enumerate sessions cannot undo NOLOGIN.
   NULL;
 END;
 BEGIN
   SELECT count(*)::integer INTO remaining FROM pg_catalog.pg_stat_activity
     WHERE usename='gpt02_core_prep_login';
 EXCEPTION WHEN OTHERS THEN
   remaining := -1; -- cannot establish session closure: explicitly incomplete
 END;
 BEGIN
   SELECT (NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL
     AND rolvaliduntil < pg_catalog.clock_timestamp()
     AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit))
   INTO catalog_ok FROM pg_catalog.pg_authid WHERE rolname='gpt02_core_prep_login';
 EXCEPTION WHEN OTHERS THEN
   catalog_ok := false;
 END;
 -- A partial relock commits NOLOGIN but is NEVER marked fully locked.
 RETURN QUERY SELECT (COALESCE(catalog_ok,false) AND remaining=0),
   killed,remaining,false,false;
END $relock$;

-- Strictly replace the independent credential with existing auditor only.
-- The old role stays NOLOGIN and loses its unused relock-function privileges.
REVOKE EXECUTE ON FUNCTION gpt02_guard.relock_task183_preparer()
 FROM gpt02_task183_relock_login;
REVOKE USAGE ON SCHEMA gpt02_guard FROM gpt02_task183_relock_login;
GRANT USAGE ON SCHEMA gpt02_guard TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_guard.relock_task183_preparer()
 TO dev_gpt02_relock_catalog_auditor;
COMMIT;
