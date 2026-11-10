-- CST-DEV xssrfshdrtdfupgqwfdw ONLY. Inert operator identity evidence schema.
-- Supabase migration manager owns the transaction; NO embedded COMMIT.
-- No issuer/attestor/preparer LOGIN, function EXECUTE, task or dispatch.
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='20s';
SELECT pg_advisory_xact_lock(hashtextextended('gpt02_inert_operator_sidecars_20261110',0));
DO $pre$
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres' OR
 current_setting('transaction_read_only')<>'off' OR
 NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolcreaterole AND rolbypassrls) OR
 pg_has_role('postgres','gpt02_store_owner','SET') OR
 pg_has_role('postgres','gpt02_store_owner','USAGE') OR
 NOT pg_has_role('postgres','pg_read_all_data','USAGE') OR
 pg_has_role('postgres','pg_write_all_data','USAGE') THEN
  RAISE EXCEPTION 'GPT02_INERT_EVIDENCE_SCOPE_DENIED';
 END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid='gpt02_store_owner'::regrole AND member='postgres'::regrole)<>2 OR
 NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles grantor ON grantor.oid=m.grantor
 WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole AND
 grantor.rolname='postgres' AND NOT m.admin_option AND NOT m.inherit_option AND NOT m.set_option) OR
 NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles grantor ON grantor.oid=m.grantor
 WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole AND
 grantor.rolname='supabase_admin' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) OR
 (SELECT count(*) FROM pg_roles r WHERE r.rolname IN
 ('gpt02_store_owner','gpt02_core_prep_owner','gpt02_core_prep_login',
 'dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence') AND
 NOT r.rolcanlogin AND r.rolconnlimit=0 AND NOT(r.rolsuper OR r.rolbypassrls OR r.rolcreaterole))<>5 THEN
  RAISE EXCEPTION 'GPT02_INERT_EVIDENCE_ROLE_DRIFT';
 END IF;
 IF to_regclass('gpt02_private.operator_links') IS NOT NULL OR
 to_regclass('gpt02_private.core_identity_receipts') IS NOT NULL OR
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='gpt02_private.receipts'::regclass
 AND conname='receipt_identity_tuple') THEN
  RAISE EXCEPTION 'GPT02_INERT_EVIDENCE_ALREADY_STAGED';
 END IF;
 IF (SELECT count(*) FROM gpt02_private.approvals)<>0 OR
 (SELECT count(*) FROM gpt02_private.receipts)<>0 OR
 (SELECT count(*) FROM gpt02_stage.core_preparations)<>0 OR
 (SELECT count(*) FROM public.ai_tasks WHERE id>136)<>0 OR
 (SELECT count(*) FROM public.ai_execution_jobs WHERE company_id='default' AND status='prepared')<>0 OR
 (SELECT count(*) FROM ai_platform.ai_coding_tasks WHERE task_number LIKE 'GPT02DEV-%')<>0 THEN
  RAISE EXCEPTION 'GPT02_INERT_EVIDENCE_HISTORY_NOT_EMPTY';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_private' AND p.proname IN
 ('record_approval','consume_approval','record_linked_approval','consume_linked_approval','valid_operator_link')) OR
 EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task') OR
 NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='gpt02_private.approvals'::regclass
 AND c.conname='gpt02_approvals_future_task_only' AND c.contype='c' AND c.convalidated
 AND regexp_replace(pg_get_expr(c.conbin,c.conrelid),'[[:space:]()]','','g')='task_id>136') THEN
  RAISE EXCEPTION 'GPT02_INERT_EVIDENCE_ACTIVE_ISSUER_OR_BOUNDARY_DRIFT';
 END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='gpt02_private' AND c.relname IN('approvals','receipts')
 AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='gpt02_store_owner')<>2 OR
 NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
 n.nspname='gpt02_private' AND p.proname='reject_mutation' AND
 pg_get_userbyid(p.proowner)='gpt02_store_owner' AND NOT p.prosecdef) THEN
  RAISE EXCEPTION 'GPT02_INERT_EVIDENCE_PARENT_RLS_DRIFT';
 END IF;
END $pre$;
GRANT gpt02_store_owner TO postgres WITH SET TRUE GRANTED BY postgres;
SET ROLE gpt02_store_owner;
CREATE TABLE gpt02_private.operator_links(
 link_id uuid PRIMARY KEY,command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.approvals(command_id),
 hub_execution_id uuid NOT NULL UNIQUE,core_task_id uuid NOT NULL,
 hub_task_id integer NOT NULL CHECK(hub_task_id>136),
 attempt_id uuid NOT NULL UNIQUE,attempt_number integer NOT NULL CHECK(attempt_number=1),
 company_id text NOT NULL CHECK(company_id='default'),
 assignee_id integer NOT NULL CHECK(assignee_id>0),accountable_owner_id text NOT NULL,
 hub_operator_id text NOT NULL CHECK(hub_operator_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$'),
 core_operator_user_id integer NOT NULL CHECK(core_operator_user_id>0),
 approval_digest text NOT NULL CHECK(approval_digest ~ '^[0-9a-f]{64}$'),
 link_digest text NOT NULL UNIQUE CHECK(link_digest ~ '^[0-9a-f]{64}$'),
 hub_signature text NOT NULL CHECK(hub_signature ~ '^[A-Za-z0-9_-]{86}$'),
 core_signature text NOT NULL CHECK(core_signature ~ '^[A-Za-z0-9_-]{86}$'),
 claims jsonb NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(link_id,command_id,core_operator_user_id,hub_operator_id,link_digest),
 UNIQUE(company_id,hub_task_id,attempt_number));
-- Evidence readback only: these are not the hosted Core claim/nonce tables.
ALTER TABLE gpt02_private.receipts ADD CONSTRAINT receipt_identity_tuple UNIQUE(id,command_id);
CREATE TABLE gpt02_private.core_identity_receipts(
 receipt_id uuid PRIMARY KEY,command_id uuid NOT NULL UNIQUE,link_id uuid NOT NULL UNIQUE,
 operator_user_id integer NOT NULL CHECK(operator_user_id>0),
 recorded_by text NOT NULL CHECK(recorded_by='internal:'||operator_user_id::text),
 hub_operator_id text NOT NULL,link_digest text NOT NULL,
 binding_verified boolean NOT NULL DEFAULT false CHECK(binding_verified=false),
 may_dispatch_worker boolean NOT NULL DEFAULT false CHECK(may_dispatch_worker=false),
 may_close_job boolean NOT NULL DEFAULT false CHECK(may_close_job=false),
 may_issue_grant boolean NOT NULL DEFAULT false CHECK(may_issue_grant=false),
 core_ledger_written boolean NOT NULL DEFAULT false CHECK(core_ledger_written=false),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(receipt_id,command_id) REFERENCES gpt02_private.receipts(id,command_id),
 FOREIGN KEY(link_id,command_id,operator_user_id,hub_operator_id,link_digest)
 REFERENCES gpt02_private.operator_links(link_id,command_id,core_operator_user_id,hub_operator_id,link_digest));
ALTER TABLE gpt02_private.operator_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.operator_links FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.core_identity_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.core_identity_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON gpt02_private.operator_links TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_only ON gpt02_private.core_identity_receipts TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_operator_links BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_private.operator_links FOR EACH STATEMENT EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER immutable_identity_receipts BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_private.core_identity_receipts FOR EACH STATEMENT EXECUTE FUNCTION gpt02_private.reject_mutation();

REVOKE ALL ON gpt02_private.operator_links,gpt02_private.core_identity_receipts
 FROM PUBLIC,anon,authenticated,service_role,gpt02_core_prep_login,
 dev_gpt02_issuer_evidence,dev_gpt02_attestor_evidence;
RESET ROLE;
REVOKE SET OPTION FOR gpt02_store_owner FROM postgres GRANTED BY postgres RESTRICT;
DO $post$
DECLARE v record;
BEGIN
 IF pg_has_role('postgres','gpt02_store_owner','SET') OR
 pg_has_role('postgres','gpt02_store_owner','USAGE') OR
 (SELECT count(*) FROM pg_auth_members WHERE roleid='gpt02_store_owner'::regrole AND member='postgres'::regrole)<>2 OR
 NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
 WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole AND
 g.rolname='postgres' AND NOT m.admin_option AND NOT m.inherit_option AND NOT m.set_option) OR
 NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
 WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole AND
 g.rolname='supabase_admin' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) THEN
  RAISE EXCEPTION 'GPT02_INERT_EVIDENCE_OWNER_ROLE_NOT_RESTORED';
 END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='gpt02_private' AND c.relname IN('operator_links','core_identity_receipts')
 AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='gpt02_store_owner')<>2 OR
 NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='gpt02_private.receipts'::regclass
 AND c.conname='receipt_identity_tuple' AND c.contype='u' AND c.convalidated) THEN
  RAISE EXCEPTION 'GPT02_INERT_EVIDENCE_CONSTRAINT_OR_OWNER_DRIFT';
 END IF;
 FOR v IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='gpt02_private' AND c.relname IN('operator_links','core_identity_receipts') LOOP
  IF has_table_privilege('postgres',v.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
   has_table_privilege('anon',v.oid,'SELECT,INSERT,UPDATE,DELETE') OR
   has_table_privilege('authenticated',v.oid,'SELECT,INSERT,UPDATE,DELETE') OR
   has_table_privilege('service_role',v.oid,'SELECT,INSERT,UPDATE,DELETE') OR
   has_table_privilege('gpt02_core_prep_login',v.oid,'SELECT,INSERT,UPDATE,DELETE') OR
   has_table_privilege('dev_gpt02_issuer_evidence',v.oid,'SELECT,INSERT,UPDATE,DELETE') OR
   has_table_privilege('dev_gpt02_attestor_evidence',v.oid,'SELECT,INSERT,UPDATE,DELETE') OR
   (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=v.oid AND NOT t.tgisinternal)<>1 THEN
    RAISE EXCEPTION 'GPT02_INERT_EVIDENCE_UNEXPECTED_AUTHORITY:%',v.relname;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_private' AND p.proname IN('record_linked_approval','consume_linked_approval','valid_operator_link')) THEN
  RAISE EXCEPTION 'GPT02_INERT_EVIDENCE_OPERATIONAL_FUNCTION_EXISTS';
 END IF;
END $post$;
