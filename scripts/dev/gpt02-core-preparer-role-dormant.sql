-- CST-DEV xssrfshdrtdfupgqwfdw ONLY. Inactive role staging, not login cutover.
-- Apply only to the `postgres` database of CST-DEV, via a reviewed migration.
-- One new NOLOGIN role, no password, no grants, no schema/data/worker change.
-- No grants to `public`, `ai_platform`, `gpt02_private` or `gpt02_stage`.
DO $gpt02_role$
DECLARE identity record;
BEGIN
 IF current_database() IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres' OR
    current_setting('transaction_read_only') IS DISTINCT FROM 'off' THEN
   RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='GPT02_DORMANT_ROLE_WRONG_DATABASE_OR_USER';
 END IF;
 SELECT rolname,rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,
        rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil
 INTO identity FROM pg_roles WHERE rolname='gpt02_core_prep_login';
 IF NOT FOUND THEN
   CREATE ROLE gpt02_core_prep_login WITH NOLOGIN NOINHERIT NOSUPERUSER
     NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS
     CONNECTION LIMIT 0 PASSWORD NULL VALID UNTIL '2000-01-01 00:00:00+00';
 END IF;
 SELECT rolname,rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,
        rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil
 INTO STRICT identity FROM pg_roles WHERE rolname='gpt02_core_prep_login';
 IF identity.rolcanlogin IS DISTINCT FROM false OR identity.rolsuper IS DISTINCT FROM false OR
    identity.rolinherit IS DISTINCT FROM false OR identity.rolcreaterole IS DISTINCT FROM false OR
    identity.rolcreatedb IS DISTINCT FROM false OR identity.rolreplication IS DISTINCT FROM false OR
    identity.rolbypassrls IS DISTINCT FROM false OR identity.rolconnlimit IS DISTINCT FROM 0 OR
    identity.rolvaliduntil IS NULL OR identity.rolvaliduntil>=clock_timestamp() OR
    EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='gpt02_core_prep_login')) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GPT02_DORMANT_ROLE_CONFIG_UNSAFE';
 END IF;
END
$gpt02_role$;
