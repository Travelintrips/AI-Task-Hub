-- CST-DEV-only, SOURCE CANDIDATE. Create two inert independent reader identities.
-- NO LOGIN, password or grants. NO sign/approval/nonce/lease/dispatch.
-- Must execute as ONE transaction through Supabase migration manager.
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='15s';
SELECT pg_advisory_xact_lock(hashtextextended('gpt02_two_inert_evidence_readers_v1',0));
DO $pre$
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
 OR current_setting('transaction_read_only')<>'off'
 OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres'
   AND NOT rolsuper AND rolcreaterole AND rolbypassrls)
 OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN
   ('gpt02_hub_evidence_reader','gpt02_core_evidence_reader'))
 THEN RAISE EXCEPTION 'GPT02_INERT_READERS_BASELINE_UNSAFE'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN
 ('gpt02_store_owner','gpt02_core_prep_owner','gpt02_core_prep_login',
 'dev_gpt02_issuer_evidence','dev_gpt02_attestor_evidence')
 AND NOT rolcanlogin AND rolconnlimit=0
 AND NOT(rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication OR rolinherit))<>5
 OR to_regclass('gpt02_private.operator_links') IS NULL
 OR to_regclass('gpt02_stage.core_preparations') IS NULL
 OR (SELECT count(*) FROM gpt02_private.approvals)<>0
 OR (SELECT count(*) FROM gpt02_private.receipts)<>0
 OR (SELECT count(*) FROM gpt02_private.operator_links)<>0
 OR (SELECT count(*) FROM gpt02_private.post_consumption_fences)<>0
 OR (SELECT count(*) FROM gpt02_stage.core_preparations)<>0
 OR (SELECT count(*) FROM public.ai_tasks WHERE id>136)<>0
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_private' AND p.proname IN
 ('record_approval','consume_approval','record_linked_approval',
 'consume_linked_approval','reserve_post_consumption_fence'))
 THEN RAISE EXCEPTION 'GPT02_INERT_READERS_CONTEXT_UNSAFE'; END IF;
END $pre$;
CREATE ROLE gpt02_hub_evidence_reader
 NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB
 NOREPLICATION CONNECTION LIMIT 0 PASSWORD NULL VALID UNTIL '2000-01-01';
CREATE ROLE gpt02_core_evidence_reader
 NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB
 NOREPLICATION CONNECTION LIMIT 0 PASSWORD NULL VALID UNTIL '2000-01-01';
COMMENT ON ROLE gpt02_hub_evidence_reader IS
 'CST-DEV GPT02 inert Hub read identity; no login, credentials, grants, or dispatch';
COMMENT ON ROLE gpt02_core_evidence_reader IS
 'CST-DEV GPT02 inert Core read identity; no login, credentials, grants, or dispatch';
DO $post$
DECLARE n int;ro text;
BEGIN
 SELECT count(*) INTO n FROM pg_authid WHERE rolname IN
 ('gpt02_hub_evidence_reader','gpt02_core_evidence_reader')
 AND NOT rolcanlogin AND NOT rolinherit
 AND NOT(rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)
 AND rolconnlimit=0 AND rolpassword IS NULL AND rolvaliduntil<clock_timestamp();
 IF n<>2 THEN RAISE EXCEPTION 'GPT02_INERT_READERS_ROLE_FLAGS_UNSAFE'; END IF;
 IF EXISTS (SELECT 1 FROM pg_auth_members
 WHERE member IN ('gpt02_hub_evidence_reader'::regrole,'gpt02_core_evidence_reader'::regrole)
 OR roleid IN ('gpt02_hub_evidence_reader'::regrole,'gpt02_core_evidence_reader'::regrole))
 THEN RAISE EXCEPTION 'GPT02_INERT_READERS_UNEXPECTED_MEMBERSHIP'; END IF;
 FOREACH ro IN ARRAY ARRAY['gpt02_hub_evidence_reader','gpt02_core_evidence_reader'] LOOP
  IF has_database_privilege(ro,current_database(),'CREATE') OR
     has_schema_privilege(ro,'gpt02_stage','USAGE,CREATE') OR
     has_schema_privilege(ro,'gpt02_private','USAGE,CREATE') OR
     has_schema_privilege(ro,'ai_platform','USAGE,CREATE') OR
     EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
       WHERE ((ns.nspname='public' AND c.relname IN
       ('ai_tasks','ai_execution_jobs','team_members','users','audit_logs'))
       OR (ns.nspname='ai_platform' AND c.relname IN
       ('ai_coding_tasks','ai_coding_runs','ai_coding_bridge_commands','internal_users'))
       OR (ns.nspname='gpt02_stage' AND c.relname='core_preparations')
       OR (ns.nspname='gpt02_private' AND c.relname IN
       ('approvals','receipts','operator_links','core_identity_receipts','post_consumption_fences')))
       AND c.relkind='r'
       AND has_table_privilege(ro,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
  THEN RAISE EXCEPTION 'GPT02_INERT_READERS_DATA_PRIVILEGE_LEAK'; END IF;
 END LOOP;
END $post$;
