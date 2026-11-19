-- Disposable postgres database only, never hosted CST-DEV or PROD.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'ISOLATED_POSTGRES_REQUIRED'; END IF; END $$;
BEGIN;
CREATE SCHEMA gpt02_stage;
CREATE SCHEMA ai_platform;
CREATE ROLE gpt02_hub_evidence_reader LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE gpt02_core_evidence_reader LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
ALTER ROLE gpt02_hub_evidence_reader SET default_transaction_read_only=on;
ALTER ROLE gpt02_core_evidence_reader SET default_transaction_read_only=on;
CREATE TABLE public.ai_tasks(id integer PRIMARY KEY,company_id text NOT NULL,assigned_to_id integer,assigned_to text,status text,title text);
CREATE TABLE public.team_members(id integer PRIMARY KEY,company_id text,name text,is_active boolean);
CREATE TABLE public.users(id text PRIMARY KEY,role text,is_active boolean,status text,company_id text,email text);
CREATE TABLE public.audit_logs(id integer PRIMARY KEY,company_id text,action text,entity_id text,after jsonb,user_email text);
CREATE TABLE public.ai_execution_jobs(id uuid PRIMARY KEY,company_id text,task_id integer,status text,
 command_id uuid,worker_id text,assigned_client_id text,metadata jsonb);
CREATE TABLE gpt02_stage.core_preparations(company_id text,hub_task_id integer,member_id integer,member_audit_id integer,
 operator_subject text,core_task_id uuid,hub_execution_id uuid,command_candidate_id uuid,attempt_id uuid,expires_at timestamptz);
CREATE TABLE ai_platform.ai_coding_tasks(id uuid PRIMARY KEY,status text);
CREATE TABLE ai_platform.internal_users(id integer PRIMARY KEY,email text,role text,status text,must_change_password boolean);
CREATE TABLE ai_platform.ai_coding_runs(task_id uuid);
CREATE TABLE ai_platform.ai_coding_bridge_commands(task_id uuid);
INSERT INTO public.ai_tasks VALUES(172,'default',42,'Synthetic PIC','new_inquiry','Synthetic isolated GPT02 approval verification');
INSERT INTO public.team_members VALUES(42,'default','Synthetic PIC',true);
INSERT INTO public.users VALUES('fixture_owner_7','super_admin',true,'active','default','owner@example.invalid');
INSERT INTO public.audit_logs VALUES(9801,'default','gpt02_pic_assigned','172',
 '{"actorIdentity":{"id":"fixture_owner_7","role":"super_admin","email":"owner@example.invalid"}}'::jsonb,
 'owner@example.invalid');
INSERT INTO public.ai_execution_jobs VALUES(
 '22222222-2222-4222-8222-222222222222','default',172,'prepared',NULL,NULL,NULL,
 '{"commandCandidateId":"33333333-3333-4333-8333-333333333333","coreTaskId":"11111111-1111-4111-8111-111111111111",
 "attemptId":"44444444-4444-4444-8444-444444444444","memberId":42,"memberAuditId":9801,
 "operatorSubject":"fixture_owner_7","attemptNumber":1,"dispatchStarted":false,
 "autoContinue":false,"accountAlias":"GPT02","environment":"development","productionAllowed":false,
 "executionType":"managed_prepared","lifecycleStart":false}'::jsonb);
INSERT INTO gpt02_stage.core_preparations VALUES(
 'default',172,42,9801,'fixture_owner_7',
 '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',
 clock_timestamp()+interval '9 minutes');
INSERT INTO ai_platform.ai_coding_tasks VALUES('11111111-1111-4111-8111-111111111111','PENDING');
INSERT INTO ai_platform.internal_users VALUES(77,'owner@example.invalid','admin','active',false);
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA gpt02_stage,ai_platform FROM PUBLIC;
GRANT USAGE ON SCHEMA public,gpt02_stage,ai_platform TO gpt02_hub_evidence_reader,gpt02_core_evidence_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public,gpt02_stage,ai_platform TO gpt02_hub_evidence_reader,gpt02_core_evidence_reader;
COMMIT;
