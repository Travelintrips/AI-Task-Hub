-- Synthetic PostgreSQL 17 fixture for PR196 code-review integration only.
-- No user records, production IDs, secrets, commands or external services.
BEGIN;
CREATE SCHEMA gpt02_stage;
CREATE SCHEMA gpt02_private;
CREATE SCHEMA ai_platform;
CREATE TABLE public.conversation_intake_sessions (id integer);
CREATE TABLE public.admin_notifications (id integer);
CREATE TABLE public.ai_tasks (
  id integer, company_id text, task_number text, source text, status text,
  title text, description text, assigned_to_id integer
);
CREATE TABLE public.audit_logs (
  id integer, company_id text, entity_id text, action text, module text
);
INSERT INTO public.ai_tasks(id,company_id,task_number,source,status,title,description,assigned_to_id) VALUES
 (171,'default','WA-2611-7621','manual','new_inquiry','Synthetic immutable old Task171','Synthetic historical task',5),
 (183,'default','WA-2611-7669','manual','new_inquiry',
 '[INTERNAL-E2E] GPT02 DEV linked Task171 replacement 20261119',
 'DEV synthetic fixture. Linked historical Task #171 (WA-2611-7621). Exactly GPT02_DEV_E2E_LINKED_171_ACK.',
 NULL);
INSERT INTO public.audit_logs(id,company_id,entity_id,action,module) VALUES
 (999,'default','183','task_created','tasks');
-- All columns of the existing Drizzle select() projection must be present.
CREATE TABLE public.ai_execution_jobs (
  id uuid, company_id text, task_id integer, source text,
  external_id text, idempotency_key text, title text, instruction text,
  session_id text, correlation_id uuid, command_id uuid,
  assigned_client_id text, worker_id text, worker_type text,
  status text, progress integer, result_summary text, error_message text,
  callback_verified boolean, attestation_verified boolean,
  final_ack_verified boolean, metadata jsonb,
  started_at timestamptz, completed_at timestamptz,
  created_at timestamptz, updated_at timestamptz
);
CREATE TABLE public.ai_execution_events (id uuid, execution_id uuid);
CREATE TABLE gpt02_stage.core_preparations (
  company_id text, hub_task_id integer, hub_execution_id uuid,
  core_task_id uuid, command_candidate_id uuid, attempt_id uuid,
  created_at timestamptz, expires_at timestamptz
);
CREATE TABLE ai_platform.ai_coding_tasks(id uuid,status text);
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid,task_id uuid);
CREATE TABLE ai_platform.ai_coding_bridge_responses(id uuid,task_id uuid,command_id uuid);
CREATE TABLE ai_platform.ai_coding_runs(id uuid,task_id uuid);
CREATE TABLE gpt02_private.approvals(company_id text,task_id integer);
CREATE TABLE gpt02_private.issuer_evidences(company_id text,hub_task_id integer);
CREATE TABLE gpt02_private.issuer_lease_consumptions(company_id text,hub_task_id integer);
CREATE TABLE gpt02_private.receipts(command_id uuid);
CREATE TABLE gpt02_private.core_identity_receipts(command_id uuid);
-- Same immutable-preparation guard as hosted CST-DEV, in the disposable fixture.
CREATE OR REPLACE FUNCTION gpt02_stage.reject_preparation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $fixture$
BEGIN
 RAISE EXCEPTION 'SYNTHETIC_PREPARATION_IMMUTABLE';
END;
$fixture$;
CREATE TRIGGER gpt02_preparation_immutable
BEFORE DELETE OR UPDATE OR TRUNCATE ON gpt02_stage.core_preparations
FOR EACH STATEMENT EXECUTE FUNCTION gpt02_stage.reject_preparation_mutation();
-- Archive is fake and empty; the E2E test adds fake conflicting proof later.
CREATE TABLE ai_platform.gpt02_dev_command_archive_20261030 (
 command_id uuid,
 command_record jsonb
);
INSERT INTO public.ai_execution_jobs (
  id,company_id,task_id,source,external_id,idempotency_key,
  title,instruction,correlation_id,status,progress,
  callback_verified,attestation_verified,final_ack_verified,
  metadata,created_at,updated_at
) VALUES (
  '11111111-1111-4111-8111-111111111171','default',171,'AI_TASK',
  'ai-task:default:171','synthetic-pr196-171-unique',
  'Synthetic Task171 (not a real user task)',
  'Synthetic read-only fixture; never dispatch.',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'prepared',0,false,false,false,
  '{"environment":"development","executionType":"managed_prepared",
    "verificationMode":"chatgpt-attested",
    "lifecycleStart":false,"autoContinue":false,
    "dispatchStarted":false,"productionAllowed":false}'::jsonb,
  now()-interval '2 days', now()-interval '2 days'
);
INSERT INTO ai_platform.ai_coding_tasks(id,status)
 VALUES('22222222-2222-4222-8222-222222222222','PENDING');
INSERT INTO gpt02_stage.core_preparations (
 company_id,hub_task_id,hub_execution_id,core_task_id,
 command_candidate_id,attempt_id,created_at,expires_at
) VALUES (
 'default',171,'11111111-1111-4111-8111-111111111171',
 '22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333',
 '44444444-4444-4444-8444-444444444444',
 now()-interval '2 days',now()-interval '2 days'+interval '15 minutes'
);
COMMIT;
