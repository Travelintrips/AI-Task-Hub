-- CST-DEV ONLY. VERIFICATION-ONLY migration (NO DDL or business writes).
-- The original CREATE function persisted although its migration ledger insert
-- collided with an independent migration at the same second. DO NOT fabricate
-- or overwrite that old migration history. This records CURRENT verified state.
-- Supabase migration manager supplies BEGIN/COMMIT; DO NOT embed transaction control.
DO $gpt02_attestation$
DECLARE f record; n integer;
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres' THEN
   RAISE EXCEPTION 'GPT02_DORMANT_VERIFICATION_WRONG_PROJECT_OR_ROLE';
 END IF;
 SELECT p.oid,p.prosecdef,pg_get_userbyid(p.proowner) AS owner_name,p.proconfig,
   encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_hash
 INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task_dormant';
 IF NOT FOUND OR f.owner_name<>'gpt02_core_prep_owner' OR f.prosecdef IS NOT TRUE OR
   f.body_hash<>'b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4' OR
   NOT ('search_path=pg_catalog'=ANY(f.proconfig)) THEN
   RAISE EXCEPTION 'GPT02_DORMANT_VERIFICATION_BODY_OR_OWNER_MISMATCH';
 END IF;
 IF has_function_privilege('postgres',f.oid,'EXECUTE') OR
    has_function_privilege('gpt02_core_prep_login',f.oid,'EXECUTE') OR
    has_function_privilege('anon',f.oid,'EXECUTE') OR
    has_function_privilege('authenticated',f.oid,'EXECUTE') OR
    has_function_privilege('service_role',f.oid,'EXECUTE') OR
    has_schema_privilege('gpt02_core_prep_login','gpt02_stage','USAGE') OR
    has_table_privilege('gpt02_core_prep_owner','public.ai_execution_jobs','SELECT,INSERT,UPDATE,DELETE,REFERENCES') OR
    has_table_privilege('gpt02_core_prep_owner','ai_platform.ai_coding_tasks','SELECT,INSERT,UPDATE,DELETE,REFERENCES') OR
    pg_has_role('postgres','gpt02_core_prep_owner','SET') OR
    pg_has_role('postgres','gpt02_core_prep_owner','USAGE') THEN
   RAISE EXCEPTION 'GPT02_DORMANT_VERIFICATION_AUTHORITY_LEAK';
 END IF;
 IF (SELECT count(*) FROM pg_auth_members m
     WHERE m.roleid='gpt02_core_prep_owner'::regrole AND m.member='postgres'::regrole)<>1 OR
    NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
      WHERE m.roleid='gpt02_core_prep_owner'::regrole AND m.member='postgres'::regrole AND
        g.rolname='supabase_admin' AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option) OR
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('gpt02_core_prep_owner','gpt02_core_prep_login')
      AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolconnlimit<>0)) OR
    (SELECT count(*) FROM gpt02_stage.core_preparations)<>0 OR
    (SELECT count(*) FROM gpt02_private.approvals)<>0 OR
    (SELECT count(*) FROM gpt02_private.receipts)<>0 OR
    (SELECT count(*) FROM public.ai_execution_jobs WHERE status='prepared' AND company_id='default')<>0 OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task') THEN
    RAISE EXCEPTION 'GPT02_DORMANT_VERIFICATION_PREPARER_NOT_INERT';
 END IF;
END $gpt02_attestation$;
