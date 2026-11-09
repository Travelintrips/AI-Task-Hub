-- CST-DEV ONLY, INACTIVE SCHEMA. No worker or reservation command is enabled.
-- Apply only to CST-DEV postgres after the approved NOLOGIN preparer role is verified.
-- Does NOT alter any existing business table or app connection. No DML grants.
DO $gpt02_schema$
DECLARE r record;
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR current_setting('transaction_read_only')<>'off' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GPT02_SCHEMA_WRONG_DB_OR_USER';
 END IF;
 SELECT rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil
 INTO r FROM pg_roles WHERE rolname='gpt02_core_prep_login';
 IF NOT FOUND OR r.rolcanlogin IS DISTINCT FROM false OR r.rolsuper IS DISTINCT FROM false OR
  r.rolinherit IS DISTINCT FROM false OR r.rolcreaterole IS DISTINCT FROM false OR
  r.rolcreatedb IS DISTINCT FROM false OR r.rolreplication IS DISTINCT FROM false OR
  r.rolbypassrls IS DISTINCT FROM false OR r.rolconnlimit IS DISTINCT FROM 0 OR
  r.rolvaliduntil IS NULL OR r.rolvaliduntil >= clock_timestamp() OR
  EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='gpt02_core_prep_login')) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GPT02_PREPARER_NOT_DORMANT';
 END IF;
 -- Never repair, overwrite, activate or change an existing owner role.
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='gpt02_core_prep_owner') THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='GPT02_OWNER_ALREADY_EXISTS_REQUIRE_REVIEW';
 END IF;
 CREATE ROLE gpt02_core_prep_owner WITH NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE
   NOCREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0 PASSWORD NULL;
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='gpt02_stage') THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='GPT02_STAGE_ALREADY_EXISTS_REQUIRE_MANUAL_REVIEW';
 END IF;
END
$gpt02_schema$;
-- Supabase postgres is deliberately NOT SUPERUSER. PostgreSQL 16/17 requires
-- temporary SET-role membership to set a different schema/table/function OWNER.
-- The membership is revoked before the migration commits. It is NOT a grant
-- of business-table DML, and NOLOGIN is never relaxed.
GRANT gpt02_core_prep_owner TO postgres WITH SET TRUE, INHERIT FALSE;
-- All privilege grants below exist ONLY for the migration transaction: they
-- allow a non-superuser to create a table under the NOLOGIN owner, with UUID
-- foreign keys to the two already-existing hosted tables. All are revoked.
GRANT CREATE ON DATABASE postgres TO gpt02_core_prep_owner;
GRANT USAGE ON SCHEMA public, ai_platform TO gpt02_core_prep_owner;
GRANT REFERENCES(id) ON TABLE public.ai_execution_jobs TO gpt02_core_prep_owner;
GRANT REFERENCES(id) ON TABLE ai_platform.ai_coding_tasks TO gpt02_core_prep_owner;
SET LOCAL ROLE gpt02_core_prep_owner;
CREATE SCHEMA gpt02_stage AUTHORIZATION gpt02_core_prep_owner;
REVOKE ALL ON SCHEMA gpt02_stage FROM PUBLIC;
CREATE TABLE gpt02_stage.core_preparations(
 company_id text NOT NULL CHECK(company_id='default'),
 hub_task_id integer NOT NULL CHECK(hub_task_id>136),
 member_id integer NOT NULL CHECK(member_id>0),
 member_audit_id integer NOT NULL CHECK(member_audit_id>0),
 operator_subject text NOT NULL CHECK(operator_subject ~ '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$'),
 core_task_id uuid NOT NULL UNIQUE REFERENCES ai_platform.ai_coding_tasks(id),
 hub_execution_id uuid NOT NULL UNIQUE REFERENCES public.ai_execution_jobs(id),
 command_candidate_id uuid NOT NULL UNIQUE,
 attempt_id uuid NOT NULL UNIQUE,
 config_sha256 text NOT NULL CHECK(config_sha256 ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(company_id,hub_task_id),
 CHECK(core_task_id<>hub_execution_id AND core_task_id<>command_candidate_id AND core_task_id<>attempt_id AND
       hub_execution_id<>command_candidate_id AND hub_execution_id<>attempt_id AND command_candidate_id<>attempt_id)
);
ALTER TABLE gpt02_stage.core_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_stage.core_preparations FORCE ROW LEVEL SECURITY;
CREATE POLICY gpt02_owner_only_preparation ON gpt02_stage.core_preparations
 TO gpt02_core_prep_owner USING(true) WITH CHECK(true);
-- SECURITY INVOKER; no callable API grant is given. No writes to Hub or Core.
CREATE FUNCTION gpt02_stage.preparation_contract_version()
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT 1::integer $$;
REVOKE ALL ON FUNCTION gpt02_stage.preparation_contract_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_stage.preparation_contract_version() FROM gpt02_core_prep_login;
-- Permanent append-only guard even if the owner is granted write later.
CREATE FUNCTION gpt02_stage.reject_preparation_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='APPEND_ONLY_PREPARATION'; END $$;
REVOKE ALL ON FUNCTION gpt02_stage.reject_preparation_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_stage.reject_preparation_mutation() FROM gpt02_core_prep_login;
CREATE TRIGGER gpt02_preparation_immutable
 BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_stage.core_preparations
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_stage.reject_preparation_mutation();
REVOKE ALL ON ALL TABLES IN SCHEMA gpt02_stage FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA gpt02_stage FROM gpt02_core_prep_login;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gpt02_stage FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gpt02_stage FROM gpt02_core_prep_login;
RESET ROLE;
REVOKE REFERENCES(id) ON TABLE public.ai_execution_jobs FROM gpt02_core_prep_owner;
REVOKE REFERENCES(id) ON TABLE ai_platform.ai_coding_tasks FROM gpt02_core_prep_owner;
REVOKE USAGE ON SCHEMA public,ai_platform FROM gpt02_core_prep_owner;
REVOKE CREATE ON DATABASE postgres FROM gpt02_core_prep_owner;
REVOKE gpt02_core_prep_owner FROM postgres;
-- Fail closed if any membership or elevated role setting survived the transaction.
DO $gpt02_owner_final$
DECLARE v record;
BEGIN
 SELECT rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,
  rolconnlimit INTO STRICT v FROM pg_roles WHERE rolname='gpt02_core_prep_owner';
 IF v.rolcanlogin OR v.rolsuper OR v.rolinherit OR v.rolcreaterole OR v.rolcreatedb OR
    v.rolreplication OR v.rolbypassrls OR v.rolconnlimit IS DISTINCT FROM 0 OR
    -- Supabase auto-grants a creator-admin edge (grantor supabase_admin)
    -- to postgres with ADMIN=true, SET=false, INHERIT=false. This must NOT be
    -- mistaken for a usable owner login. Reject any *effective* SET/INHERIT
    -- edge or membership of another role; never grant extra authorities.
    EXISTS(SELECT 1 FROM pg_auth_members m
      WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname='gpt02_core_prep_owner')
        AND (m.member IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='postgres')
          OR m.set_option IS DISTINCT FROM false OR m.inherit_option IS DISTINCT FROM false
          OR m.admin_option IS DISTINCT FROM true)) OR
    has_database_privilege('gpt02_core_prep_owner',current_database(),'CREATE') OR
    has_table_privilege('gpt02_core_prep_owner','public.ai_execution_jobs','SELECT,INSERT,UPDATE,DELETE,REFERENCES') OR
    has_table_privilege('gpt02_core_prep_owner','ai_platform.ai_coding_tasks','SELECT,INSERT,UPDATE,DELETE,REFERENCES') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GPT02_OWNER_MEMBERSHIP_NOT_REVOKED';
 END IF;
END
$gpt02_owner_final$;
-- Existing Hub/Core production-oriented routines intentionally NOT installed.
-- Role remains NOLOGIN, no function EXECUTE, no insert/update/delete grants.
