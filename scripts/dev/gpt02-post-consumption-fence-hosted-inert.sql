-- CST-DEV xssrfshdrtdfupgqwfdw ONLY. Source-only migration candidate.
-- Must be applied only through a separately authorized transaction-owning migration runner.
-- NEVER run this file as psql autocommit; no live functions or issuer grants are created.
-- All issuer/attestor/preparer roles remain NOLOGIN, credentials unchanged.
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='20s';
SELECT pg_advisory_xact_lock(hashtextextended('gpt02_inert_post_consumption_fence_20261110',0));
DO $pre$
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
 OR current_setting('transaction_read_only')<>'off'
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolcreaterole AND rolbypassrls)
 OR pg_has_role('postgres','gpt02_store_owner','SET')
 OR pg_has_role('postgres','gpt02_store_owner','USAGE')
 OR NOT pg_has_role('postgres','pg_read_all_data','USAGE')
 OR pg_has_role('postgres','pg_write_all_data','USAGE')
 THEN RAISE EXCEPTION 'GPT02_INERT_FENCE_UNSAFE_MIGRATOR'; END IF;
 IF (SELECT count(*) FROM pg_auth_members m WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole)<>2
 OR NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
   WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole
   AND g.rolname='postgres' AND NOT m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
 OR NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
   WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole
   AND g.rolname='supabase_admin' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
 THEN RAISE EXCEPTION 'GPT02_INERT_FENCE_GRANT_GRAPH_CHANGED'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('gpt02_store_owner','gpt02_core_prep_owner',
  'gpt02_core_prep_login','dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence')
  AND NOT rolcanlogin AND rolconnlimit=0 AND NOT(rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication OR rolinherit))<>5
 THEN RAISE EXCEPTION 'GPT02_INERT_FENCE_ROLE_STATE_CHANGED'; END IF;
 IF to_regclass('gpt02_private.post_consumption_fences') IS NOT NULL
 THEN RAISE EXCEPTION 'GPT02_INERT_FENCE_ALREADY_EXISTS'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='gpt02_private' AND c.relkind='r'
  AND c.relname IN ('approvals','receipts','operator_links','core_identity_receipts')
  AND c.relrowsecurity AND c.relforcerowsecurity
  AND pg_get_userbyid(c.relowner)='gpt02_store_owner')<>4
 OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='gpt02_private.receipts'::regclass
  AND c.conname='receipt_identity_tuple' AND c.contype='u' AND c.convalidated)
 OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gpt02_private' AND p.proname='reject_mutation'
  AND NOT p.prosecdef AND pg_get_userbyid(p.proowner)='gpt02_store_owner')
 OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='gpt02_private.approvals'::regclass
  AND c.conname='gpt02_approvals_future_task_only' AND c.contype='c' AND c.convalidated
  AND regexp_replace(pg_get_expr(c.conbin,c.conrelid),'[[:space:]()]','','g')='task_id>136')
 THEN RAISE EXCEPTION 'GPT02_INERT_FENCE_EVIDENCE_SCHEMA_DRIFT'; END IF;
 IF (SELECT count(*) FROM gpt02_private.approvals)<>0 OR
  (SELECT count(*) FROM gpt02_private.receipts)<>0 OR
  (SELECT count(*) FROM gpt02_private.operator_links)<>0 OR
  (SELECT count(*) FROM gpt02_private.core_identity_receipts)<>0 OR
  (SELECT count(*) FROM gpt02_stage.core_preparations)<>0 OR
  (SELECT count(*) FROM public.ai_tasks WHERE id>136)<>0 OR
  (SELECT count(*) FROM public.ai_execution_jobs WHERE company_id='default' AND status='prepared')<>0 OR
  (SELECT count(*) FROM ai_platform.ai_coding_tasks WHERE task_number LIKE 'GPT02DEV-%')<>0
 THEN RAISE EXCEPTION 'GPT02_INERT_FENCE_PREEXISTING_ACTIVITY'; END IF;
 IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gpt02_private' AND p.proname IN('record_approval','consume_approval',
   'record_linked_approval','consume_linked_approval','reserve_post_consumption_fence'))
 OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task')
 THEN RAISE EXCEPTION 'GPT02_INERT_FENCE_OPERATIONAL_FUNCTION_ALREADY_PRESENT'; END IF;
END $pre$;
GRANT gpt02_store_owner TO postgres WITH SET TRUE GRANTED BY postgres;
SET ROLE gpt02_store_owner;
CREATE TABLE gpt02_private.post_consumption_fences (
 fence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.core_identity_receipts(receipt_id),
 command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.receipts(command_id),
 link_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.operator_links(link_id),
 hub_execution_id uuid NOT NULL UNIQUE,
 core_task_id uuid NOT NULL,
 attempt_id uuid NOT NULL UNIQUE,
 worker_id text NOT NULL CHECK(worker_id='openclaw-dell-chatgpt-wake-dev'),
 lease_epoch bigint NOT NULL DEFAULT 1 CHECK(lease_epoch=1),
 lease_started_at timestamptz NOT NULL,
 lease_expires_at timestamptz NOT NULL,
 dispatch_allowed boolean NOT NULL DEFAULT false CHECK(dispatch_allowed=false),
 core_ledger_written boolean NOT NULL DEFAULT false CHECK(core_ledger_written=false),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(lease_expires_at>lease_started_at AND lease_expires_at<=lease_started_at+interval '15 seconds'),
 UNIQUE(receipt_id,command_id,link_id)
);
ALTER TABLE gpt02_private.post_consumption_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.post_consumption_fences FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON gpt02_private.post_consumption_fences TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE TRIGGER immutable_post_consumption_fences BEFORE UPDATE OR DELETE OR TRUNCATE
 ON gpt02_private.post_consumption_fences FOR EACH STATEMENT EXECUTE FUNCTION gpt02_private.reject_mutation();

REVOKE ALL ON gpt02_private.post_consumption_fences FROM PUBLIC,anon,authenticated,service_role,
 gpt02_core_prep_login,dev_gpt02_issuer_evidence,dev_gpt02_attestor_evidence;
COMMENT ON TABLE gpt02_private.post_consumption_fences IS
 'INERT ONLY: immutable signed-evidence fence, NO real lease/issuer grant/dispatch authority';
RESET ROLE;
REVOKE SET OPTION FOR gpt02_store_owner FROM postgres GRANTED BY postgres RESTRICT;
DO $post$
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR pg_has_role('postgres','gpt02_store_owner','SET')
 OR pg_has_role('postgres','gpt02_store_owner','USAGE')
 OR (SELECT count(*) FROM pg_auth_members m
  WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole)<>2
 OR EXISTS (SELECT 1 FROM pg_auth_members m
  WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole
   AND (m.set_option OR m.inherit_option))
 OR NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
  WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole
  AND g.rolname='postgres' AND NOT m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
 OR NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
  WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole
  AND g.rolname='supabase_admin' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
 THEN RAISE EXCEPTION 'GPT02_INERT_FENCE_ROLE_RESTORATION_FAILED'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='gpt02_private' AND c.relname='post_consumption_fences'
   AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity
   AND pg_get_userbyid(c.relowner)='gpt02_store_owner')<>1
 OR (SELECT count(*) FROM pg_trigger t
  WHERE t.tgrelid='gpt02_private.post_consumption_fences'::regclass
   AND t.tgname='immutable_post_consumption_fences' AND t.tgenabled='O' AND NOT t.tgisinternal)<>1
 OR (SELECT count(*) FROM gpt02_private.post_consumption_fences)<>0
 THEN RAISE EXCEPTION 'GPT02_INERT_FENCE_TABLE_POSTCONDITION_FAILED'; END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='gpt02_private' AND c.relname='post_consumption_fences'
  AND (has_table_privilege('postgres',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('gpt02_core_prep_login',c.oid,'SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('dev_gpt02_issuer_evidence',c.oid,'SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('dev_gpt02_attestor_evidence',c.oid,'SELECT,INSERT,UPDATE,DELETE')))
 OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gpt02_private' AND p.proname IN ('reserve_post_consumption_fence',
   'record_approval','consume_approval','record_linked_approval','consume_linked_approval'))
 THEN RAISE EXCEPTION 'GPT02_INERT_FENCE_AUTHORITY_LEAK'; END IF;
 IF (SELECT count(*) FROM pg_roles r WHERE r.rolname IN
  ('gpt02_store_owner','gpt02_core_prep_owner','gpt02_core_prep_login',
   'dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence')
   AND NOT r.rolcanlogin AND r.rolconnlimit=0)<>5
 THEN RAISE EXCEPTION 'GPT02_INERT_FENCE_ROLE_ACTIVATED'; END IF;
END $post$;
