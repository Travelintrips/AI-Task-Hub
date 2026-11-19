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
 RETURNS TABLE(role_locked boolean, sessions_terminated integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $relock$
DECLARE
 target pg_catalog.pg_authid%ROWTYPE;
 sess record;
 killed integer := 0;
BEGIN
 SELECT * INTO target FROM pg_catalog.pg_authid WHERE rolname='gpt02_core_prep_login' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TASK183_PREPARER_ROLE_MISSING'; END IF;
 -- A valid bounded (at most 3-minute) canary is allowed to finish its read-only
 -- transaction. Everything else, including stale sessions, is relocked.
 IF target.rolcanlogin AND target.rolconnlimit=1 AND target.rolpassword IS NOT NULL
   AND target.rolvaliduntil > pg_catalog.clock_timestamp()
   AND target.rolvaliduntil <= pg_catalog.clock_timestamp() + INTERVAL '3 minutes'
   AND NOT (target.rolsuper OR target.rolbypassrls OR target.rolcreaterole
     OR target.rolcreatedb OR target.rolreplication OR target.rolinherit)
 THEN
   RETURN QUERY SELECT false,0;
   RETURN;
 END IF;
 EXECUTE 'ALTER ROLE gpt02_core_prep_login NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION CONNECTION LIMIT 0 PASSWORD NULL VALID UNTIL ''2000-01-01''';
 FOR sess IN SELECT pid FROM pg_catalog.pg_stat_activity
    WHERE usename='gpt02_core_prep_login' AND pid<>pg_catalog.pg_backend_pid()
 LOOP
   IF NOT pg_catalog.pg_terminate_backend(sess.pid) THEN
      RAISE EXCEPTION 'TASK183_PREPARER_SESSION_TERMINATION_FAILED';
   END IF;
   killed := killed + 1;
 END LOOP;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_authid
   WHERE rolname='gpt02_core_prep_login' AND rolcanlogin=false
     AND rolconnlimit=0 AND rolpassword IS NULL AND rolvaliduntil < pg_catalog.clock_timestamp()
     AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit))
 THEN RAISE EXCEPTION 'TASK183_RELOCK_READBACK_FAILED'; END IF;
 RETURN QUERY SELECT true,killed;
END $relock$;
REVOKE ALL ON FUNCTION gpt02_guard.relock_task183_preparer() FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_guard TO gpt02_task183_relock_login;
GRANT EXECUTE ON FUNCTION gpt02_guard.relock_task183_preparer() TO gpt02_task183_relock_login;
COMMIT;
