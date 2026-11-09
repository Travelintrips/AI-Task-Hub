-- Synthetic PostgreSQL only. Isolated database and never deployed to CST-DEV/PROD.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database()<>'gpt02_core_preparation_isolated' THEN RAISE EXCEPTION 'FIXTURE_DATABASE_MISMATCH'; END IF; END $$;
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE,TEMP ON DATABASE gpt02_core_preparation_isolated FROM PUBLIC;
CREATE ROLE gpt02_core_prep_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE ROLE gpt02_core_prep_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE SCHEMA ai_platform;
CREATE SCHEMA gpt02_stage AUTHORIZATION gpt02_core_prep_owner;
REVOKE ALL ON SCHEMA gpt02_stage FROM PUBLIC;
CREATE TABLE public.ai_tasks(id integer PRIMARY KEY,company_id text NOT NULL,status text NOT NULL,title text NOT NULL,assigned_to_id integer,assigned_to text);
CREATE TABLE public.team_members(id integer PRIMARY KEY,company_id text NOT NULL,is_active boolean NOT NULL,name text NOT NULL,email text NOT NULL);
CREATE TABLE public.users(id text PRIMARY KEY,company_id text NOT NULL,role text NOT NULL,is_active boolean NOT NULL,email text NOT NULL);
CREATE TABLE public.audit_logs(id integer PRIMARY KEY,company_id text NOT NULL,entity_id text NOT NULL,action text NOT NULL,after text NOT NULL,user_email text NOT NULL);
CREATE TABLE public.ai_execution_jobs(id uuid PRIMARY KEY,task_id integer NOT NULL,company_id text NOT NULL);
CREATE TABLE ai_platform.ai_coding_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_number text NOT NULL UNIQUE,project_name text NOT NULL,repository text NOT NULL,branch text NOT NULL,instruction text NOT NULL,status text NOT NULL DEFAULT 'PENDING',priority integer NOT NULL DEFAULT 50);
CREATE TABLE ai_platform.ai_coding_runs(id uuid PRIMARY KEY,task_id uuid NOT NULL,status text NOT NULL);
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY,task_id uuid,external_command_id text UNIQUE,status text);
GRANT USAGE ON SCHEMA ai_platform,public TO gpt02_core_prep_owner;
GRANT SELECT ON public.ai_tasks,public.team_members,public.users,public.audit_logs,public.ai_execution_jobs TO gpt02_core_prep_owner;
GRANT SELECT,INSERT,REFERENCES ON ai_platform.ai_coding_tasks TO gpt02_core_prep_owner;
GRANT SELECT ON ai_platform.ai_coding_runs,ai_platform.ai_coding_bridge_commands TO gpt02_core_prep_owner;
SET LOCAL ROLE gpt02_core_prep_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA gpt02_stage REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE gpt02_stage.core_preparations(
 company_id text NOT NULL,hub_task_id integer NOT NULL CHECK(hub_task_id>0 AND hub_task_id<>135),
 member_id integer NOT NULL,member_audit_id integer NOT NULL,operator_subject text NOT NULL,
 core_task_id uuid NOT NULL UNIQUE REFERENCES ai_platform.ai_coding_tasks(id),
 command_candidate_id uuid NOT NULL UNIQUE,attempt_id uuid NOT NULL UNIQUE,
 config_sha256 text NOT NULL CHECK(config_sha256 ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(company_id,hub_task_id)
);
ALTER TABLE gpt02_stage.core_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_stage.core_preparations FORCE ROW LEVEL SECURITY;
CREATE POLICY owned_preparation_only ON gpt02_stage.core_preparations TO gpt02_core_prep_owner USING(true) WITH CHECK(true);
CREATE FUNCTION gpt02_stage.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='APPEND_ONLY_PREPARATION'; END $$;
CREATE TRIGGER prevent_preparation_rewrite BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_stage.core_preparations FOR EACH STATEMENT EXECUTE FUNCTION gpt02_stage.reject_mutation();
CREATE FUNCTION gpt02_stage.prepare_core_task(p_company text,p_task integer,p_project text,p_repo text,p_branch text,p_instruction text)
RETURNS TABLE(core_task_id uuid,command_candidate_id uuid,attempt_id uuid,created boolean,dispatch_permitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_task record; v_audit record; v_user record; v_existing record; v_core record; v_hash text;v_c uuid;v_cmd uuid;v_attempt uuid;
BEGIN
 IF session_user<>'gpt02_core_prep_login' OR p_task=135 OR p_task<=0 OR
   p_company IS DISTINCT FROM 'default' OR p_project IS DISTINCT FROM 'GPT02 DEV coding lifecycle' OR
   p_repo IS DISTINCT FROM 'Travelintrips/Core-AI-Foundation' OR p_branch IS DISTINCT FROM 'develop' OR
   p_instruction IS NULL OR length(p_instruction) NOT BETWEEN 1 AND 2000 OR p_instruction ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PREPARATION_SCOPE_DENIED';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gpt02-prep:'||p_company||':'||p_task::text,0));
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
 AND lower(trim(u.email))=lower(trim(v_audit.user_email)) AND u.company_id=p_company
 AND u.is_active IS TRUE AND u.role='super_admin' LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACTIVE_OPERATOR_IDENTITY_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.ai_execution_jobs e WHERE e.task_id=p_task AND e.company_id=p_company) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='HUB_TASK_ALREADY_EXECUTED_NO_REPREPARE'; END IF;
 v_hash:=encode(public.digest(concat_ws(E'\x1f',p_company,p_task::text,v_task.assigned_to_id::text,v_audit.id::text,v_user.id,p_project,p_repo,p_branch,p_instruction),'sha256'),'hex');
 SELECT * INTO v_existing FROM gpt02_stage.core_preparations p WHERE p.company_id=p_company AND p.hub_task_id=p_task;
 IF FOUND THEN
  SELECT id,status,repository,branch,instruction INTO v_core FROM ai_platform.ai_coding_tasks WHERE id=v_existing.core_task_id;
  IF v_existing.config_sha256 IS DISTINCT FROM v_hash OR v_existing.member_id IS DISTINCT FROM v_task.assigned_to_id OR
    v_existing.member_audit_id IS DISTINCT FROM v_audit.id OR v_existing.operator_subject IS DISTINCT FROM v_user.id OR
    v_existing.expires_at<=clock_timestamp() OR v_core.status IS DISTINCT FROM 'PENDING' OR
    v_core.repository IS DISTINCT FROM p_repo OR v_core.branch IS DISTINCT FROM p_branch OR v_core.instruction IS DISTINCT FROM p_instruction OR
    EXISTS(SELECT 1 FROM ai_platform.ai_coding_runs WHERE task_id=v_existing.core_task_id) OR
    EXISTS(SELECT 1 FROM ai_platform.ai_coding_bridge_commands WHERE task_id=v_existing.core_task_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PREPARATION_CHANGED_OR_ALREADY_STARTED';
  END IF;
  RETURN QUERY SELECT v_existing.core_task_id,v_existing.command_candidate_id,v_existing.attempt_id,false,false;RETURN;
 END IF;
 INSERT INTO ai_platform.ai_coding_tasks(task_number,project_name,repository,branch,instruction,status,priority)
 VALUES('GPT02DEV-'||p_task::text||'-'||substr(v_hash,1,14),p_project,p_repo,p_branch,p_instruction,'PENDING',50)
 RETURNING id INTO v_c;
 v_cmd:=gen_random_uuid();v_attempt:=gen_random_uuid();
 IF v_c=v_cmd OR v_c=v_attempt OR v_cmd=v_attempt THEN RAISE EXCEPTION 'UNEXPECTED_UUID_COLLISION'; END IF;
 INSERT INTO gpt02_stage.core_preparations(company_id,hub_task_id,member_id,member_audit_id,operator_subject,core_task_id,command_candidate_id,attempt_id,config_sha256,expires_at)
 VALUES(p_company,p_task,v_task.assigned_to_id,v_audit.id,v_user.id,v_c,v_cmd,v_attempt,v_hash,clock_timestamp()+interval '15 minutes');
 RETURN QUERY SELECT v_c,v_cmd,v_attempt,true,false;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA gpt02_stage FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gpt02_stage FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_stage TO gpt02_core_prep_login;
GRANT EXECUTE ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text) TO gpt02_core_prep_login;
COMMIT;
INSERT INTO public.team_members VALUES(5,'default',true,'Synthetic PIC','admin@example.invalid'),(6,'default',false,'Inactive PIC','admin2@example.invalid');
INSERT INTO public.users VALUES('google_fixture_super_admin','default','super_admin',true,'admin@example.invalid'),('google_fixture_staff','default','staff',true,'staff@example.invalid');
INSERT INTO public.ai_tasks VALUES(137,'default','new_inquiry','Synthetic new coding task',5,'Synthetic PIC'),(135,'default','new_inquiry','Old failed task',5,'Synthetic PIC'),(136,'default','new_inquiry','Already completed task',5,'Synthetic PIC'),(138,'other','new_inquiry','Other tenant task',5,'Synthetic PIC'),(139,'default','new_inquiry','Synthetic second task',5,'Synthetic PIC'),(140,'default','new_inquiry','Synthetic mutated audit',5,'Synthetic PIC'),(141,'default','new_inquiry','Synthetic expired preparation',5,'Synthetic PIC');
INSERT INTO public.audit_logs(id,company_id,entity_id,action,after,user_email)
SELECT 2000+id,'default',id::text,'gpt02_pic_assigned',jsonb_build_object('taskId',id,'companyId','default','memberId',5,'memberName','Synthetic PIC','actorIdentity',jsonb_build_object('id','google_fixture_super_admin','version',1,'role','super_admin','email','admin@example.invalid'))::text,'admin@example.invalid'
FROM public.ai_tasks WHERE company_id='default';
INSERT INTO public.ai_execution_jobs VALUES(gen_random_uuid(),136,'default');
