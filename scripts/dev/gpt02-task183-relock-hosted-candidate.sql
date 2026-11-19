-- SOURCE-ONLY DEV CANDIDATE. NEVER apply to hosted Supabase without scoped
-- authorization, independent owner/custody review and a rollback runbook.
-- This installs a relock-only surface. It CANNOT activate a preparer login.
BEGIN;
DO $baseline$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_authid
  WHERE rolname='gpt02_core_prep_login'
    AND rolcanlogin=false AND rolconnlimit=0 AND rolpassword IS NULL
    AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit)
 ) THEN RAISE EXCEPTION 'TASK183_PREPARER_LOCKED_BASELINE_REQUIRED'; END IF;
END $baseline$;
CREATE ROLE gpt02_task183_relock_login NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0
 PASSWORD NULL VALID UNTIL '2000-01-01';
CREATE SCHEMA gpt02_guard;
REVOKE ALL ON SCHEMA gpt02_guard FROM PUBLIC;
CREATE FUNCTION gpt02_guard.relock_task183_preparer()
 RETURNS TABLE(role_locked boolean, sessions_terminated integer, sessions_remaining integer, canary_active boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $relock$
DECLARE
 target pg_catalog.pg_authid%ROWTYPE;
 sess record;
 killed integer := 0;
 remaining integer := 0;
 catalog_ok boolean := false;
 canary_privilege_safe boolean := false;
BEGIN
 SELECT * INTO target FROM pg_catalog.pg_authid WHERE rolname='gpt02_core_prep_login' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TASK183_PREPARER_ROLE_MISSING'; END IF;
 -- If the protected preparation function is missing or its ACL cannot be
 -- read, do not abort: treat the canary as unsafe and relock immediately.
 IF pg_catalog.to_regprocedure('gpt02_stage.prepare_core_task(text,integer,text,text,text,text)') IS NOT NULL THEN
   BEGIN
     canary_privilege_safe := NOT pg_catalog.has_function_privilege(
       'gpt02_core_prep_login',
       'gpt02_stage.prepare_core_task(text,integer,text,text,text,text)','EXECUTE');
   EXCEPTION WHEN OTHERS THEN
     canary_privilege_safe := false;
   END;
 END IF;
 -- A valid bounded (at most 3-minute) canary is allowed to finish its read-only
 -- transaction. Everything else, including stale sessions, is relocked.
 IF target.rolcanlogin AND target.rolconnlimit=1 AND target.rolpassword IS NOT NULL
   AND target.rolvaliduntil > pg_catalog.clock_timestamp()
   AND target.rolvaliduntil <= pg_catalog.clock_timestamp() + INTERVAL '3 minutes'
   AND NOT (target.rolsuper OR target.rolbypassrls OR target.rolcreaterole
     OR target.rolcreatedb OR target.rolreplication OR target.rolinherit)
   AND canary_privilege_safe
 THEN
   BEGIN
     SELECT count(*)::integer INTO remaining FROM pg_catalog.pg_stat_activity
       WHERE usename='gpt02_core_prep_login';
   EXCEPTION WHEN OTHERS THEN
     -- Failure to count canary sessions must force NOLOGIN, not abort.
     remaining := -1;
   END;
   IF remaining >= 0 THEN
     RETURN QUERY SELECT false,0,remaining,true;
     RETURN;
   END IF;
 END IF;
 EXECUTE 'ALTER ROLE gpt02_core_prep_login NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION CONNECTION LIMIT 0 PASSWORD NULL VALID UNTIL ''2000-01-01''';
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
   killed,remaining,false;
END $relock$;
REVOKE ALL ON FUNCTION gpt02_guard.relock_task183_preparer() FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_guard TO gpt02_task183_relock_login;
GRANT EXECUTE ON FUNCTION gpt02_guard.relock_task183_preparer() TO gpt02_task183_relock_login;
COMMIT;
