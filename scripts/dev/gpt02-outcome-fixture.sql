-- Isolated synthetic fixture only. This is not a migration.
CREATE SCHEMA ai_platform;
CREATE TABLE public.ai_tasks(id integer PRIMARY KEY,status text,assigned_to text,assigned_to_id integer,company_id text);
CREATE TABLE public.team_members(id integer PRIMARY KEY,name text,company_id text,is_active boolean);
CREATE TABLE public.ai_execution_jobs(id uuid PRIMARY KEY,task_id integer,company_id text,source text,status text,command_id uuid,correlation_id uuid,callback_verified boolean,attestation_verified boolean,final_ack_verified boolean,metadata jsonb,external_id text,worker_id text,created_at timestamptz DEFAULT now());
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY,task_id uuid,status text,command_type text,source text,metadata_json jsonb);
CREATE TABLE ai_platform.ai_coding_tasks(id uuid PRIMARY KEY);
CREATE TABLE ai_platform.ai_coding_bridge_responses(id uuid PRIMARY KEY,command_id uuid,kind text,message text,acknowledged_at timestamptz,metadata_json jsonb);
CREATE TABLE ai_platform.dev_gpt02_task_attempt_binding_claims(id uuid,tenant_id text,hub_ai_task_id integer,hub_execution_job_id uuid,core_command_id uuid,core_coding_task_id uuid,assignee_id integer,binding_verified boolean,attempt_id uuid,operator_user_id integer,evidence_sha256 text,may_dispatch_worker boolean,may_close_job boolean);
CREATE TABLE ai_platform.dev_gpt02_binding_attestation_nonces(nonce uuid,tenant_id text,hub_execution_job_id uuid,core_command_id uuid,attempt_id uuid,evidence_sha256 text,operator_user_id integer,expires_at timestamptz,may_issue_grant boolean,may_dispatch_worker boolean);
INSERT INTO ai_tasks VALUES(1001,'new_inquiry','Fixture',5,'tenant');
INSERT INTO team_members VALUES(5,'Fixture','tenant',true);
INSERT INTO ai_execution_jobs(id,task_id,company_id,source,status,command_id,correlation_id,callback_verified,attestation_verified,final_ack_verified,metadata,external_id,worker_id)
VALUES('11111111-1111-4111-8111-111111111111',1001,'tenant','AI_TASK','completed','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',true,true,true,
'{"environment":"development","verificationMode":"chatgpt-attested","accountAlias":"GPT02","remoteCorrelationId":"ai-task:tenant:1001:33333333-3333-4333-8333-333333333333"}',
'ai-task:tenant:1001','openclaw-dell-chatgpt-wake-dev');
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES('22222222-2222-4222-8222-222222222222',NULL,'COMPLETED','EXTERNAL_AGENT_WORK','ai-core',
jsonb_build_object('source','authorized-dev-browser-wake','capability','chatgpt:wake','devOnly',true,'assignedClientId','openclaw-dell-chatgpt-wake-dev','correlationId','ai-task:tenant:1001:33333333-3333-4333-8333-333333333333',
'eventId',repeat('a',64),'assistantAttestationChallenge',repeat('b',64),'targetConversationId','44444444-4444-4444-8444-444444444444',
'wakeBinding',jsonb_build_object('accountAlias','GPT02','workerId','openclaw-dell-chatgpt-wake-dev','browserProfile','gpt02-dell-dev','targetConversationId','44444444-4444-4444-8444-444444444444','bindingFingerprint',repeat('c',64))));
INSERT INTO ai_platform.ai_coding_bridge_responses VALUES('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','COMPLETED','synthetic result',now(),
jsonb_build_object('e2eCode','E2E_VERIFIED','deliveryCode','DELIVERY_CONFIRMED','verifiedAssistantReply',true,'browserPairingVerified',true,'workerId','openclaw-dell-chatgpt-wake-dev','eventId',repeat('a',64),'challenge',repeat('b',64),'bindingFingerprint',repeat('c',64),'browserProfile','gpt02-dell-dev','conversationId','44444444-4444-4444-8444-444444444444','assistantResponseText','synthetic result',
'attestation',jsonb_build_object('version',2,'algorithm','Ed25519','workerId','openclaw-dell-chatgpt-wake-dev','eventId',repeat('a',64),'challenge',repeat('b',64),'bindingFingerprint',repeat('c',64),'browserProfile','gpt02-dell-dev','conversationId','44444444-4444-4444-8444-444444444444','assistantResponseText','synthetic result','assistantResponseHash',repeat('d',64),'signature','synthetic noncryptographic SQL fixture')));
-- QUERY_FUNCTION
DO $$
DECLARE r jsonb; initial jsonb; cm jsonb;
BEGIN
 SELECT * INTO r FROM outcome_query(1001,'tenant');
 IF (r->>'exact_native_response_count')::integer<>1 OR r->>'transport_context_matched'<>'true' OR r->>'direct_wake_route'<>'true' OR r->>'claim_id' IS NOT NULL OR r->>'nonce' IS NOT NULL OR r->>'core_task_id' IS NOT NULL THEN RAISE EXCEPTION 'POSITIVE_OR_MISSING_LIFECYCLE_NOT_PRESERVED'; END IF;
 IF EXISTS(SELECT 1 FROM outcome_query(1001,'other')) THEN RAISE EXCEPTION 'CROSS_TENANT_LEAK'; END IF;
 SELECT metadata_json INTO initial FROM ai_platform.ai_coding_bridge_responses;
 UPDATE ai_platform.ai_coding_bridge_responses SET metadata_json=jsonb_set(initial,'{eventId}',to_jsonb(repeat('e',64)));
 SELECT * INTO r FROM outcome_query(1001,'tenant');IF (r->>'exact_native_response_count')::integer<>0 THEN RAISE EXCEPTION 'WRONG_EVENT_ACCEPTED'; END IF;
 UPDATE ai_platform.ai_coding_bridge_responses SET metadata_json=jsonb_set(initial,'{attestation,challenge}',to_jsonb(repeat('e',64)));
 SELECT * INTO r FROM outcome_query(1001,'tenant');IF (r->>'exact_native_response_count')::integer<>0 THEN RAISE EXCEPTION 'WRONG_SIGNED_CHALLENGE_ACCEPTED'; END IF;
 UPDATE ai_platform.ai_coding_bridge_responses SET metadata_json=jsonb_set(initial,'{workerId}','"other-worker"');
 SELECT * INTO r FROM outcome_query(1001,'tenant');IF (r->>'exact_native_response_count')::integer<>0 THEN RAISE EXCEPTION 'WRONG_WORKER_ACCEPTED'; END IF;
 UPDATE ai_platform.ai_coding_bridge_responses SET metadata_json=initial,acknowledged_at=NULL;
 SELECT * INTO r FROM outcome_query(1001,'tenant');IF (r->>'exact_native_response_count')::integer<>0 THEN RAISE EXCEPTION 'MISSING_ACK_ACCEPTED'; END IF;
 UPDATE ai_platform.ai_coding_bridge_responses SET acknowledged_at=now();
 SELECT metadata_json INTO cm FROM ai_platform.ai_coding_bridge_commands;
 UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=jsonb_set(cm,'{correlationId}','"ai-task:other:1001:33333333-3333-4333-8333-333333333333"');
 SELECT * INTO r FROM outcome_query(1001,'tenant');IF r->>'transport_context_matched'<>'false' THEN RAISE EXCEPTION 'WRONG_CORRELATION_ACCEPTED'; END IF;
 UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=cm;
 INSERT INTO ai_platform.ai_coding_bridge_responses SELECT '66666666-6666-4666-8666-666666666666',command_id,kind,message,acknowledged_at,metadata_json FROM ai_platform.ai_coding_bridge_responses;
 SELECT * INTO r FROM outcome_query(1001,'tenant');IF (r->>'completed_response_count')::integer<>2 OR (r->>'exact_native_response_count')::integer<>2 THEN RAISE EXCEPTION 'DUPLICATE_HIDDEN'; END IF;
 DELETE FROM ai_platform.ai_coding_bridge_responses WHERE id='66666666-6666-4666-8666-666666666666';
 UPDATE ai_platform.ai_coding_bridge_responses SET command_id='77777777-7777-4777-8777-777777777777';
 SELECT * INTO r FROM outcome_query(1001,'tenant');IF (r->>'exact_native_response_count')::integer<>0 THEN RAISE EXCEPTION 'UNRELATED_RECEIPT_ACCEPTED'; END IF;
 RAISE NOTICE 'EXACT_QUERY_ISOLATED_PASS: positive, tenant, event, signed challenge, worker, ACK, correlation, duplicate, unrelated receipt';
END $$;
