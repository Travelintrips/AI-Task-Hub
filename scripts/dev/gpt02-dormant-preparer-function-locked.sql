-- CST-DEV ONLY. Dormant, unreachable GPT02 preparation function.
-- Derived verbatim from successfully tested synthetic Hub/Core atomic transaction.
-- Tested function renamed to prepare_core_task_dormant to keep operational readiness NO-GO.
-- No FUNCTION EXECUTE grant, no parent SELECT/INSERT/REFERENCES grant, no role LOGIN, no dispatch.
-- Function-body SHA256: 31800f9e1de321d26ddf5f989a8e1977296b70ddbab11759bec9495ce349dc4b
-- Supabase migration manager provides the transaction; do not embed COMMIT.
SET LOCAL lock_timeout='4s';
SET LOCAL statement_timeout='15s';
SELECT pg_advisory_xact_lock(hashtextextended('gpt02_dormant_preparer_function_20261110',0));
DO $pre$
DECLARE v record;
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres' OR
   current_setting('transaction_read_only')<>'off' OR
   (SELECT rolsuper OR NOT rolcreaterole FROM pg_roles WHERE rolname='postgres') OR
   pg_has_role('postgres','gpt02_core_prep_owner','SET') OR
   pg_has_role('postgres','gpt02_core_prep_owner','USAGE') OR
   (SELECT count(*) FROM pg_auth_members WHERE roleid='gpt02_core_prep_owner'::regrole AND member='postgres'::regrole)<>1 OR
   NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
     WHERE m.roleid='gpt02_core_prep_owner'::regrole AND m.member='postgres'::regrole
       AND g.rolname='supabase_admin' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) THEN
    RAISE EXCEPTION 'GPT02_DORMANT_PREPARER_OWNER_BASELINE_CHANGED';
 END IF;
 SELECT rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolconnlimit
   INTO v FROM pg_roles WHERE rolname='gpt02_core_prep_owner';
 IF NOT FOUND OR v.rolcanlogin OR v.rolsuper OR v.rolinherit OR v.rolcreaterole OR v.rolcreatedb OR v.rolreplication OR v.rolbypassrls OR v.rolconnlimit<>0 THEN
   RAISE EXCEPTION 'GPT02_DORMANT_PREPARER_OWNER_PRIVILEGES_CHANGED';
 END IF;
 SELECT rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolconnlimit
   INTO v FROM pg_roles WHERE rolname='gpt02_core_prep_login';
 IF NOT FOUND OR v.rolcanlogin OR v.rolsuper OR v.rolinherit OR v.rolcreaterole OR v.rolcreatedb OR v.rolreplication OR v.rolbypassrls OR v.rolconnlimit<>0 THEN
   RAISE EXCEPTION 'GPT02_DORMANT_PREPARER_LOGIN_ACTIVATED';
 END IF;
 IF (SELECT count(*) FROM gpt02_stage.core_preparations)<>0 OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='gpt02_stage' AND p.proname IN('prepare_core_task','prepare_core_task_dormant')) OR
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='gpt02_stage' AND c.relname='core_preparations'
        AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR pg_get_userbyid(c.relowner)<>'gpt02_core_prep_owner')) OR
    NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='gpt02_stage' AND c.relname='core_preparations' AND c.relrowsecurity AND c.relforcerowsecurity) OR
    (SELECT count(*) FROM pg_constraint c WHERE c.conrelid='gpt02_stage.core_preparations'::regclass AND c.contype='f')<>2 OR
    (SELECT count(*) FROM gpt02_private.approvals)<>0 OR
    (SELECT count(*) FROM gpt02_private.receipts)<>0 OR
    (SELECT count(*) FROM public.ai_execution_jobs WHERE status='prepared' AND company_id='default')<>0 OR
    NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='gpt02_private.approvals'::regclass AND
      c.conname='gpt02_approvals_future_task_only' AND c.convalidated AND
      regexp_replace(pg_get_expr(c.conbin,c.conrelid),'[[:space:]()]','','g')='task_id>136') OR
    has_table_privilege('gpt02_core_prep_owner','public.ai_execution_jobs','SELECT,INSERT,UPDATE,DELETE,REFERENCES') OR
    has_table_privilege('gpt02_core_prep_owner','ai_platform.ai_coding_tasks','SELECT,INSERT,UPDATE,DELETE,REFERENCES') THEN
   RAISE EXCEPTION 'GPT02_DORMANT_PREPARER_STAGING_OR_TASK_BOUNDARY_CHANGED';
 END IF;
END $pre$;
-- Existing owner has a single administrative (SET=false) grant from supabase_admin.
-- Temporary self-granted SET membership is revoked IN THIS TRANSACTION.
GRANT gpt02_core_prep_owner TO postgres WITH SET TRUE, INHERIT FALSE GRANTED BY postgres;
SET ROLE gpt02_core_prep_owner;
-- Creating a PL/pgSQL function does not execute or dispatch its body.
CREATE FUNCTION gpt02_stage.prepare_core_task_dormant(p_company text,p_task integer,p_project text,p_repo text,p_branch text,p_instruction text)
RETURNS TABLE(core_task_id uuid,command_candidate_id uuid,attempt_id uuid,hub_execution_id uuid,created boolean,dispatch_permitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_task record; v_audit record; v_user record; v_existing record; v_core record; v_job record; v_hash text;v_c uuid;v_cmd uuid;v_attempt uuid;v_hub uuid;
BEGIN
 IF session_user<>'gpt02_core_prep_login' OR p_task<=136 OR
   p_company IS DISTINCT FROM 'default' OR p_project IS DISTINCT FROM 'GPT02 DEV coding lifecycle' OR
   p_repo IS DISTINCT FROM 'Travelintrips/Core-AI-Foundation' OR p_branch IS DISTINCT FROM 'develop' OR
   p_instruction IS NULL OR length(p_instruction) NOT BETWEEN 1 AND 2000 OR p_instruction ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PREPARATION_SCOPE_DENIED';
 END IF;
 -- Same advisory lock identity as the Hub PIC assignment/execution admission;
 -- two app instances cannot swap the PIC while Core/Hub are prepared.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_company||':'||p_task::text,0));
 SELECT t.id,t.title,t.status,t.assigned_to_id,t.assigned_to,m.email
 INTO v_task FROM public.ai_tasks t JOIN public.team_members m ON m.id=t.assigned_to_id AND m.company_id=t.company_id
 WHERE t.id=p_task AND t.company_id=p_company AND m.is_active IS TRUE AND m.name=t.assigned_to
 AND t.status NOT IN ('completed','cancelled') LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACTIVE_HUB_TASK_PIC_REQUIRED'; END IF;
 SELECT a.id,a.after,a.user_email INTO v_audit FROM public.audit_logs a
 WHERE a.company_id=p_company AND a.entity_id=p_task::text AND a.action='gpt02_pic_assigned'
 ORDER BY a.id DESC LIMIT 1;
 IF NOT FOUND OR v_audit.after IS NULL OR
    (v_audit.after::jsonb->>'taskId') IS DISTINCT FROM p_task::text OR
    (v_audit.after::jsonb->>'companyId') IS DISTINCT FROM p_company OR
    (v_audit.after::jsonb->>'memberId') IS DISTINCT FROM v_task.assigned_to_id::text OR
    (v_audit.after::jsonb->>'memberName') IS DISTINCT FROM v_task.assigned_to OR
    (v_audit.after::jsonb->'actorIdentity'->>'version') IS DISTINCT FROM '1' OR
    (v_audit.after::jsonb->'actorIdentity'->>'role') IS DISTINCT FROM 'super_admin' OR
    (v_audit.after::jsonb->'actorIdentity'->>'email') IS DISTINCT FROM lower(trim(v_audit.user_email)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACTUAL_AUDITED_SUPER_ADMIN_REQUIRED';
 END IF;
 SELECT u.id INTO v_user FROM public.users u WHERE u.id=v_audit.after::jsonb->'actorIdentity'->>'id'
 AND lower(trim(u.email))=lower(trim(v_audit.user_email))
 -- Default-tenant Hub Super Admin may be global (company_id NULL). Integer company IDs
 -- must not be compared/cast to task tenant "default" or silently accepted.
 AND u.company_id IS NULL
 AND u.is_active IS TRUE AND u.role='super_admin' LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACTIVE_OPERATOR_IDENTITY_REQUIRED'; END IF;
 v_hash:=encode(extensions.digest(concat_ws(E'\x1f',p_company,p_task::text,v_task.assigned_to_id::text,v_audit.id::text,v_user.id,p_project,p_repo,p_branch,p_instruction),'sha256'),'hex');
 SELECT * INTO v_existing FROM gpt02_stage.core_preparations p WHERE p.company_id=p_company AND p.hub_task_id=p_task;
 -- No PREPARE can coexist with an unrelated historical attempt (including a
 -- failed or completed execution), and no retry can replace the prepared ID.
 IF EXISTS(SELECT 1 FROM public.ai_execution_jobs e WHERE e.task_id=p_task AND e.company_id=p_company
  AND (v_existing.hub_execution_id IS NULL OR e.id<>v_existing.hub_execution_id)) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='HUB_TASK_ALREADY_EXECUTED_NO_REPREPARE'; END IF;
 IF v_existing.core_task_id IS NOT NULL THEN
  SELECT id,status,repository,branch,instruction INTO v_core FROM ai_platform.ai_coding_tasks WHERE id=v_existing.core_task_id;
  SELECT * INTO v_job FROM public.ai_execution_jobs WHERE id=v_existing.hub_execution_id;
  IF v_existing.config_sha256 IS DISTINCT FROM v_hash OR v_existing.member_id IS DISTINCT FROM v_task.assigned_to_id OR
    v_existing.member_audit_id IS DISTINCT FROM v_audit.id OR v_existing.operator_subject IS DISTINCT FROM v_user.id OR
    v_existing.expires_at<=clock_timestamp() OR v_core.status IS DISTINCT FROM 'PENDING' OR
    v_core.repository IS DISTINCT FROM p_repo OR v_core.branch IS DISTINCT FROM p_branch OR v_core.instruction IS DISTINCT FROM p_instruction OR
    EXISTS(SELECT 1 FROM ai_platform.ai_coding_runs WHERE task_id=v_existing.core_task_id) OR
    EXISTS(SELECT 1 FROM ai_platform.ai_coding_bridge_commands WHERE task_id=v_existing.core_task_id) OR
    v_job.id IS DISTINCT FROM v_existing.hub_execution_id OR v_job.company_id IS DISTINCT FROM p_company OR
    v_job.task_id IS DISTINCT FROM p_task OR v_job.status IS DISTINCT FROM 'prepared' OR
    v_job.source IS DISTINCT FROM 'AI_TASK' OR v_job.external_id IS DISTINCT FROM 'ai-task:'||p_company||':'||p_task::text OR
    v_job.idempotency_key IS DISTINCT FROM 'gpt02-managed-preparation:'||p_company||':'||p_task::text OR
    v_job.title IS DISTINCT FROM v_task.title OR v_job.instruction IS DISTINCT FROM p_instruction OR
    v_job.command_id IS NOT NULL OR v_job.worker_id IS NOT NULL OR v_job.assigned_client_id IS NOT NULL OR
    v_job.callback_verified IS NOT FALSE OR v_job.attestation_verified IS NOT FALSE OR v_job.final_ack_verified IS NOT FALSE OR
    v_job.progress IS DISTINCT FROM 0 OR
    v_job.metadata->>'accountAlias' IS DISTINCT FROM 'GPT02' OR
    v_job.metadata->>'environment' IS DISTINCT FROM 'development' OR
    v_job.metadata->>'verificationMode' IS DISTINCT FROM 'chatgpt-attested' OR
    v_job.metadata->>'coreTaskId' IS DISTINCT FROM v_existing.core_task_id::text OR
    v_job.metadata->>'commandCandidateId' IS DISTINCT FROM v_existing.command_candidate_id::text OR
    v_job.metadata->>'attemptId' IS DISTINCT FROM v_existing.attempt_id::text OR
    v_job.metadata->>'memberId' IS DISTINCT FROM v_task.assigned_to_id::text OR
    v_job.metadata->>'memberAuditId' IS DISTINCT FROM v_audit.id::text OR
    v_job.metadata->>'operatorSubject' IS DISTINCT FROM v_user.id OR
    v_job.metadata->>'autoContinue' IS DISTINCT FROM 'false' OR
    v_job.metadata->>'dispatchStarted' IS DISTINCT FROM 'false' OR
    v_job.metadata->>'productionAllowed' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PREPARATION_CHANGED_OR_ALREADY_STARTED';
  END IF;
  RETURN QUERY SELECT v_existing.core_task_id,v_existing.command_candidate_id,v_existing.attempt_id,v_existing.hub_execution_id,false,false;RETURN;
 END IF;
 INSERT INTO ai_platform.ai_coding_tasks(task_number,project_name,repository,branch,instruction,status,priority)
 VALUES('GPT02DEV-'||p_task::text||'-'||substr(v_hash,1,14),p_project,p_repo,p_branch,p_instruction,'PENDING',50)
 RETURNING id INTO v_c;
 v_cmd:=gen_random_uuid();v_attempt:=gen_random_uuid();
 IF v_c=v_cmd OR v_c=v_attempt OR v_cmd=v_attempt THEN RAISE EXCEPTION 'UNEXPECTED_UUID_COLLISION'; END IF;
 -- Insert one PENDING Core task + one Hub execution in the SAME transaction.
 -- Every active worker/command/callback field stays NULL or false. This row is
 -- preparation evidence only and NEVER grants permission to send the candidate.
 INSERT INTO public.ai_execution_jobs(company_id,task_id,source,external_id,idempotency_key,
   title,instruction,command_id,assigned_client_id,worker_id,status,progress,
   callback_verified,attestation_verified,final_ack_verified,metadata)
 VALUES(p_company,p_task,'AI_TASK','ai-task:'||p_company||':'||p_task::text,
   'gpt02-managed-preparation:'||p_company||':'||p_task::text,
   v_task.title,p_instruction,NULL,NULL,NULL,'prepared',0,false,false,false,
   jsonb_build_object('environment','development','verificationMode','chatgpt-attested',
    'accountAlias','GPT02','executionType','managed_prepared','lifecycleStart',false,
    'autoContinue',false,'dispatchStarted',false,'productionAllowed',false,
    'attemptNumber',1,'coreTaskId',v_c::text,'commandCandidateId',v_cmd::text,
    'attemptId',v_attempt::text,'memberId',v_task.assigned_to_id,
    'memberAuditId',v_audit.id,'operatorSubject',v_user.id)) RETURNING id INTO v_hub;
 IF v_hub IN (v_c,v_cmd,v_attempt) THEN RAISE EXCEPTION 'UNEXPECTED_UUID_COLLISION'; END IF;
 INSERT INTO gpt02_stage.core_preparations(company_id,hub_task_id,member_id,member_audit_id,operator_subject,core_task_id,hub_execution_id,command_candidate_id,attempt_id,config_sha256,expires_at)
 VALUES(p_company,p_task,v_task.assigned_to_id,v_audit.id,v_user.id,v_c,v_hub,v_cmd,v_attempt,v_hash,clock_timestamp()+interval '15 minutes');
 RETURN QUERY SELECT v_c,v_cmd,v_attempt,v_hub,true,false;
END $$;

-- Revoke PUBLIC default EXECUTE before migration manager commits.
REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text) FROM gpt02_core_prep_login;
REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task_dormant(text,integer,text,text,text,text) FROM anon,authenticated,service_role;
RESET ROLE;
REVOKE gpt02_core_prep_owner FROM postgres GRANTED BY postgres;
DO $post$
DECLARE f record;
BEGIN
 IF pg_has_role('postgres','gpt02_core_prep_owner','SET') OR
   pg_has_role('postgres','gpt02_core_prep_owner','USAGE') OR
   (SELECT count(*) FROM pg_auth_members m WHERE m.roleid='gpt02_core_prep_owner'::regrole AND m.member='postgres'::regrole)<>1 OR
   NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor WHERE
     m.roleid='gpt02_core_prep_owner'::regrole AND m.member='postgres'::regrole AND
     g.rolname='supabase_admin' AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option) THEN
    RAISE EXCEPTION 'GPT02_DORMANT_PREPARER_OWNER_GRANT_NOT_RESTORED';
 END IF;
 SELECT p.oid,p.prosecdef,pg_get_userbyid(p.proowner) AS owner_name,
    p.proconfig INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task_dormant';
 IF NOT FOUND OR f.owner_name<>'gpt02_core_prep_owner' OR f.prosecdef IS DISTINCT FROM true OR
   NOT ('search_path=pg_catalog'=ANY(f.proconfig)) OR
   has_function_privilege('anon',f.oid,'EXECUTE') OR
   has_function_privilege('authenticated',f.oid,'EXECUTE') OR
   has_function_privilege('service_role',f.oid,'EXECUTE') OR
   has_function_privilege('gpt02_core_prep_login',f.oid,'EXECUTE') OR
   has_function_privilege('postgres',f.oid,'EXECUTE') OR
   has_schema_privilege('gpt02_core_prep_login','gpt02_stage','USAGE') OR
   has_table_privilege('gpt02_core_prep_owner','public.ai_execution_jobs','SELECT,INSERT,UPDATE,DELETE,REFERENCES') OR
   has_table_privilege('gpt02_core_prep_owner','ai_platform.ai_coding_tasks','SELECT,INSERT,UPDATE,DELETE,REFERENCES') OR
   EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gpt02_stage' AND p.proname='prepare_core_task') THEN
    RAISE EXCEPTION 'GPT02_DORMANT_PREPARER_FUNCTION_ACCESS_NOT_LOCKED';
 END IF;
END $post$;
