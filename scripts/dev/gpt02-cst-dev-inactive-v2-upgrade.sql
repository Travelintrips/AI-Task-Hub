-- CST-DEV only; empty, inactive evidence foundation -> exact TEXT approver v2.
-- No LOGIN activation, operational routine, grants, writes or task/command dispatch.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $preflight$
DECLARE n integer;
BEGIN
 IF current_user<>'postgres' OR current_database()<>'postgres' THEN RAISE EXCEPTION 'EXPECTED_DEV_MIGRATION_IDENTITY'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('gpt02-cst-dev-bounded-login-smoke-v1',0)) OR
    NOT pg_try_advisory_xact_lock(hashtextextended('gpt02-cst-dev-evidence-preparation-v1',0)) THEN RAISE EXCEPTION 'CONCURRENT_CANDIDATE_OPERATION'; END IF;
 SELECT count(*) INTO n FROM pg_roles WHERE rolname IN ('gpt02_store_owner','dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence');
 IF n<>3 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('gpt02_store_owner','dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence') AND
  (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR rolconnlimit<>0)) THEN RAISE EXCEPTION 'CANDIDATE_ROLES_NOT_LOCKED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename IN ('gpt02_store_owner','dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence')) THEN RAISE EXCEPTION 'CANDIDATE_SESSIONS_PRESENT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname IN ('dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence','gpt02_store_owner')) THEN RAISE EXCEPTION 'CANDIDATE_ROLE_MEMBERSHIPS_PRESENT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid='gpt02_store_owner'::regrole AND (m.set_option OR m.inherit_option)) THEN RAISE EXCEPTION 'OWNER_AUTHORITY_ALREADY_DELEGATED'; END IF;
 SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='gpt02_private' AND c.relkind IN ('r','p');
 IF n<>2 OR (SELECT count(*) FROM pg_class WHERE oid IN ('gpt02_private.approvals'::regclass,'gpt02_private.receipts'::regclass) AND relkind='r' AND relrowsecurity AND relforcerowsecurity AND relowner='gpt02_store_owner'::regrole)<>2 THEN RAISE EXCEPTION 'FOUNDATION_OWNERSHIP_OR_RLS_DRIFT'; END IF;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gpt02_private')<>1 OR
 NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('gpt02_private.reject_mutation()') AND NOT prosecdef AND proowner='gpt02_store_owner'::regrole) THEN RAISE EXCEPTION 'FOUNDATION_NOT_INACTIVE'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('gpt02_private.approvals'::regclass,'gpt02_private.receipts'::regclass) AND NOT tgisinternal AND tgenabled='O' AND tgfoid=to_regprocedure('gpt02_private.reject_mutation()'))<>2 THEN RAISE EXCEPTION 'IMMUTABLE_TRIGGER_DRIFT'; END IF;
END $preflight$;
-- Construction authority changes are transaction-local in effect: no other session
-- can observe the temporary SET grant before the final revocation commits.
GRANT gpt02_store_owner TO postgres WITH SET TRUE, INHERIT FALSE;
SET LOCAL ROLE gpt02_store_owner;
LOCK TABLE gpt02_private.approvals,gpt02_private.receipts IN ACCESS EXCLUSIVE MODE NOWAIT;
DO $empty_and_shape$
DECLARE role_name text; table_name text;
BEGIN
 IF EXISTS(SELECT 1 FROM gpt02_private.approvals) OR EXISTS(SELECT 1 FROM gpt02_private.receipts) THEN RAISE EXCEPTION 'NONEMPTY_EVIDENCE_REFUSES_RETYPE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='gpt02_private.approvals'::regclass AND attname='approver_id' AND atttypid='bigint'::regtype AND attnotnull AND NOT attisdropped) OR
 EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='gpt02_private.approvals'::regclass AND attname='operator_namespace' AND NOT attisdropped) OR
 NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='gpt02_private.approvals'::regclass AND conname='approvals_approver_id_check' AND pg_get_constraintdef(oid)='CHECK ((approver_id > 0))') THEN RAISE EXCEPTION 'EXPECTED_EMPTY_LEGACY_SCHEMA'; END IF;
 FOREACH role_name IN ARRAY ARRAY['dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence'] LOOP
  IF has_schema_privilege(role_name,'gpt02_private','USAGE,CREATE') THEN RAISE EXCEPTION 'CANDIDATE_SCHEMA_ACCESS_PRESENT'; END IF;
  FOREACH table_name IN ARRAY ARRAY['gpt02_private.approvals','gpt02_private.receipts'] LOOP
   IF has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'CANDIDATE_DIRECT_ACCESS_PRESENT'; END IF;
  END LOOP;
 END LOOP;
END $empty_and_shape$;
ALTER TABLE gpt02_private.approvals DROP CONSTRAINT approvals_approver_id_check;
-- Locks and mandatory empty-table check above ensure no historic ID is coerced.
ALTER TABLE gpt02_private.approvals ALTER COLUMN approver_id TYPE text USING approver_id::text;
ALTER TABLE gpt02_private.approvals ADD COLUMN operator_namespace text NOT NULL;
ALTER TABLE gpt02_private.approvals ADD CONSTRAINT approvals_operator_namespace_check CHECK(operator_namespace='ai-task-hub.public.users');
ALTER TABLE gpt02_private.approvals ADD CONSTRAINT approvals_approver_id_check CHECK(approver_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$');
COMMENT ON TABLE gpt02_private.approvals IS 'GPT02 v2 exact TEXT Hub-account evidence contract; empty inactive foundation, no operational record/consume functions';
RESET ROLE;
REVOKE SET OPTION FOR gpt02_store_owner FROM postgres;
REVOKE INHERIT OPTION FOR gpt02_store_owner FROM postgres;
DO $postflight$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole AND (m.set_option OR m.inherit_option)) THEN RAISE EXCEPTION 'CONSTRUCTION_AUTHORITY_NOT_REMOVED'; END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='gpt02_private.approvals'::regclass AND attname IN ('approver_id','operator_namespace') AND atttypid='text'::regtype AND attnotnull AND NOT attisdropped)<>2 THEN RAISE EXCEPTION 'V2_SCHEMA_POSTCONDITION_FAILED'; END IF;
 IF (SELECT count(*) FROM pg_class WHERE oid IN ('gpt02_private.approvals'::regclass,'gpt02_private.receipts'::regclass) AND relrowsecurity AND relforcerowsecurity AND relowner='gpt02_store_owner'::regrole)<>2 THEN RAISE EXCEPTION 'RLS_OWNER_POSTCONDITION_FAILED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('gpt02_store_owner','dev_gpt02_attestor_evidence','dev_gpt02_issuer_evidence') AND (rolcanlogin OR rolconnlimit<>0 OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN RAISE EXCEPTION 'ROLES_CHANGED_DURING_UPGRADE'; END IF;
END $postflight$;
COMMIT;
