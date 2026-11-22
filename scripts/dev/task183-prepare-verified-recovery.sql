-- CST-DEV only. The verifier supplies this receipt after independent signature verification.
CREATE TABLE gpt02_stage.task183_verified_recovery_receipts (
    request_id text PRIMARY KEY CHECK (request_id ~ '^[a-f0-9]{36}$'),
    approval_sha256 text NOT NULL UNIQUE CHECK (approval_sha256 ~ '^[a-f0-9]{64}$'),
    predecessor_attempt_id uuid NOT NULL REFERENCES gpt02_stage.core_preparations(attempt_id),
    signed_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > signed_at AND expires_at <= signed_at + interval '120 seconds')
);
ALTER TABLE gpt02_stage.task183_verified_recovery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_stage.task183_verified_recovery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gpt02_stage.task183_verified_recovery_receipts FROM PUBLIC;

CREATE FUNCTION gpt02_stage.prepare_task183_recovery(p_request text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
    receipt gpt02_stage.task183_verified_recovery_receipts%ROWTYPE;
    prep gpt02_stage.core_preparations%ROWTYPE;
    job public.ai_execution_jobs%ROWTYPE;
    new_core uuid;
    new_hub uuid;
    attempt uuid := gen_random_uuid();
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('default:183:attempt:2',0));
    SELECT * INTO STRICT receipt FROM gpt02_stage.task183_verified_recovery_receipts
      WHERE request_id=p_request AND signed_at<=clock_timestamp() AND expires_at>clock_timestamp();
    SELECT * INTO STRICT prep FROM gpt02_stage.core_preparations
      WHERE company_id='default' AND hub_task_id=183 AND attempt_id=receipt.predecessor_attempt_id
      AND expires_at<=clock_timestamp() FOR SHARE;
    SELECT * INTO STRICT job FROM public.ai_execution_jobs WHERE id=prep.hub_execution_id
      AND company_id='default' AND task_id=183 AND status='prepared' AND command_id IS NULL
      AND assigned_client_id IS NULL AND worker_id IS NULL AND progress=0
      AND NOT callback_verified AND NOT attestation_verified AND NOT final_ack_verified
      AND metadata @> jsonb_build_object('attemptNumber',1,'coreTaskId',prep.core_task_id::text,
        'attemptId',prep.attempt_id::text,'dispatchStarted',false,'autoContinue',false,
        'lifecycleStart',false,'productionAllowed',false) FOR SHARE;
    INSERT INTO ai_platform.ai_coding_tasks(task_number,project_name,repository,branch,instruction,status,priority)
      SELECT task_number||'-A2',project_name,repository,branch,instruction,'PENDING',priority
      FROM ai_platform.ai_coding_tasks WHERE id=prep.core_task_id AND status='PENDING' FOR SHARE
      RETURNING id INTO STRICT new_core;
    INSERT INTO public.ai_execution_jobs(company_id,task_id,source,external_id,idempotency_key,title,
      instruction,status,progress,callback_verified,attestation_verified,final_ack_verified,metadata,
      command_id,worker_id,assigned_client_id)
      VALUES(job.company_id,183,job.source,job.external_id||':attempt:2',job.idempotency_key||':attempt:2',
        job.title,job.instruction,'prepared',0,false,false,false,
        job.metadata||jsonb_build_object('attemptNumber',2,'attemptId',attempt::text,
          'coreTaskId',new_core::text,'commandCandidateId',gen_random_uuid()::text),NULL,NULL,NULL)
      RETURNING id INTO new_hub;
    INSERT INTO gpt02_stage.task183_recovery_attempts(company_id,hub_task_id,attempt_number,
      predecessor_attempt_id,attempt_id,core_task_id,hub_execution_id,request_id,approval_sha256,signed_at,approval_expires_at)
      VALUES('default',183,2,prep.attempt_id,attempt,new_core,new_hub,p_request,receipt.approval_sha256,
        receipt.signed_at,receipt.expires_at);
    RETURN attempt;
END $$;
REVOKE ALL ON FUNCTION gpt02_stage.prepare_task183_recovery(text) FROM PUBLIC;

-- DEV may grant default privileges to API roles on newly created objects.
DO $$
DECLARE grantee_name name;
BEGIN
    FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_class c
        CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee
        WHERE c.oid='gpt02_stage.task183_verified_recovery_receipts'::regclass AND r.oid<>c.relowner
    LOOP EXECUTE format('REVOKE ALL ON gpt02_stage.task183_verified_recovery_receipts FROM %I',grantee_name); END LOOP;
    FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p
        CROSS JOIN LATERAL aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee
        WHERE p.oid='gpt02_stage.prepare_task183_recovery(text)'::regprocedure AND r.oid<>p.proowner
    LOOP EXECUTE format('REVOKE ALL ON FUNCTION gpt02_stage.prepare_task183_recovery(text) FROM %I',grantee_name); END LOOP;
END $$;
