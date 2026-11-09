-- DISPOSABLE evidence DB only. NOT a migration of hosted Core/Hub ledgers.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database()<>'gpt02_issuer_isolated' THEN RAISE EXCEPTION 'ISOLATED_DATABASE_REQUIRED'; END IF; END $$;
BEGIN;
SET LOCAL ROLE gpt02_store_owner;
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

CREATE FUNCTION gpt02_private.valid_operator_link(p jsonb,d text,l jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
DECLARE k text; exp timestamptz; issued timestamptz;
BEGIN
 IF p IS NULL OR l IS NULL OR jsonb_typeof(l)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(l))<>27 OR
 NOT(l ?& ARRAY['v','environment','audience','linkId','companyId','hubTaskId','hubExecutionId','coreTaskId','coreCommandId','attemptId','attemptNumber','assigneeId','accountableOwnerId','hubOperatorNamespace','hubOperatorId','hubRole','hubActive','coreOperatorNamespace','coreOperatorUserId','coreRole','coreActive','corePasswordChanged','workerId','approvalDigest','nonce','issuedAt','expiresAt']) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['v','hubTaskId','attemptNumber','assigneeId','coreOperatorUserId','issuedAt','expiresAt'] LOOP
  IF jsonb_typeof(l->k) IS DISTINCT FROM 'number' OR (l->>k) !~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['environment','audience','linkId','companyId','hubExecutionId','coreTaskId','coreCommandId','attemptId','accountableOwnerId','hubOperatorNamespace','hubOperatorId','hubRole','coreOperatorNamespace','coreRole','workerId','approvalDigest','nonce'] LOOP
  IF jsonb_typeof(l->k) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['hubActive','coreActive','corePasswordChanged'] LOOP
  IF l->k IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['linkId','hubExecutionId','coreTaskId','coreCommandId','attemptId'] LOOP
  IF (l->>k) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
 END LOOP;
 IF l->>'v'<>'1' OR l->>'environment'<>'DEV' OR l->>'audience'<>'GPT02_DUAL_ACCOUNT_COMMAND_LINK' OR
 l->>'companyId'<>'default' OR l->>'hubOperatorNamespace'<>'ai-task-hub.public.users' OR
 l->>'coreOperatorNamespace'<>'ai-core.ai_platform.internal_users' OR l->>'hubRole'<>'super_admin' OR
 l->>'coreRole' NOT IN ('owner','admin') OR l->>'workerId'<>'openclaw-dell-chatgpt-wake-dev' OR
 (l->>'hubTaskId')::integer<=136 OR
 (l->>'assigneeId')::integer<=0 OR (l->>'coreOperatorUserId')::integer<=0 OR l->>'attemptNumber'<>'1' OR
 (l->>'hubOperatorId') !~ '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$' OR
 (l->>'accountableOwnerId') !~ '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$' OR
 l->>'coreCommandId'='83db99f5-cbda-4e60-be71-3090fb411bbb' OR l->>'hubExecutionId'='4eb75fa9-f9e4-4573-8e00-d3084b4c2c8a' OR
 (SELECT count(DISTINCT x) FROM unnest(ARRAY[l->>'hubExecutionId',l->>'coreTaskId',l->>'coreCommandId',l->>'attemptId']) AS t(x))<>4 OR
 l->>'approvalDigest' IS DISTINCT FROM d OR d !~ '^[0-9a-f]{64}$' OR
 l->>'hubTaskId' IS DISTINCT FROM p->>'taskId' OR l->>'coreCommandId' IS DISTINCT FROM p->>'commandId' OR
 l->>'attemptId' IS DISTINCT FROM p->>'attemptId' OR l->>'companyId' IS DISTINCT FROM p->>'companyId' OR
 l->>'hubOperatorNamespace' IS DISTINCT FROM p->>'operatorNamespace' OR l->>'hubOperatorId' IS DISTINCT FROM p->>'superAdminId' OR
 l->>'nonce' IS DISTINCT FROM p->>'nonce' OR (l->>'nonce') !~ '^[A-Za-z0-9_-]{32,128}$' OR
 (l->>'issuedAt')::bigint < (p->>'issuedAt')::bigint OR (l->>'expiresAt')::bigint > (p->>'expiresAt')::bigint THEN RETURN false; END IF;
 exp:=to_timestamp((l->>'expiresAt')::numeric/1000);issued:=to_timestamp((l->>'issuedAt')::numeric/1000);
 RETURN exp>clock_timestamp() AND issued<=clock_timestamp()+interval '5 seconds' AND exp>issued AND exp-issued<=interval '2 minutes';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN RETURN false;
END $$;

CREATE FUNCTION gpt02_private.record_linked_approval(p jsonb,s text,d text,l jsonb,hs text,cs text,ld text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user<>'dev_gpt02_attestor_evidence' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DEDICATED_ATTESTOR_REQUIRED'; END IF;
 IF gpt02_private.valid_operator_link(p,d,l) IS DISTINCT FROM true OR
 hs IS NULL OR cs IS NULL OR ld IS NULL OR hs !~ '^[A-Za-z0-9_-]{86}$' OR cs !~ '^[A-Za-z0-9_-]{86}$' OR ld !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
 IF NOT gpt02_private.record_approval(p,s,d) THEN RETURN false; END IF;
 IF gpt02_private.valid_operator_link(p,d,l) IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='IDENTITY_EXPIRED_DURING_RECORD'; END IF;
 -- Any uniqueness/FK failure aborts the same statement, including the approval insert.
 INSERT INTO gpt02_private.operator_links(link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,attempt_number,company_id,assignee_id,accountable_owner_id,hub_operator_id,core_operator_user_id,approval_digest,link_digest,hub_signature,core_signature,claims,expires_at)
 VALUES((l->>'linkId')::uuid,(l->>'coreCommandId')::uuid,(l->>'hubExecutionId')::uuid,(l->>'coreTaskId')::uuid,(l->>'hubTaskId')::integer,(l->>'attemptId')::uuid,(l->>'attemptNumber')::integer,l->>'companyId',(l->>'assigneeId')::integer,l->>'accountableOwnerId',l->>'hubOperatorId',(l->>'coreOperatorUserId')::integer,d,ld,hs,cs,l,to_timestamp((l->>'expiresAt')::numeric/1000));
 RETURN true;
END $$;

CREATE FUNCTION gpt02_private.consume_linked_approval(p jsonb,s text,d text,l jsonb,hs text,cs text,ld text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a gpt02_private.approvals%ROWTYPE; o gpt02_private.operator_links%ROWTYPE; receipt uuid;
BEGIN
 IF session_user<>'dev_gpt02_issuer_evidence' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DEDICATED_ISSUER_REQUIRED'; END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR (p->>'taskId')::integer<=136 THEN RETURN NULL; END IF;
 SELECT * INTO a FROM gpt02_private.approvals WHERE command_id=(p->>'commandId')::uuid FOR UPDATE;
 IF NOT FOUND OR a.claims IS DISTINCT FROM p OR a.signature IS DISTINCT FROM s OR a.digest IS DISTINCT FROM d OR a.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 SELECT * INTO o FROM gpt02_private.operator_links WHERE command_id=a.command_id FOR SHARE;
 -- Recheck BOTH windows after acquiring the locks; no pre-lock time is reused.
 IF NOT FOUND OR o.claims IS DISTINCT FROM l OR o.hub_signature IS DISTINCT FROM hs OR o.core_signature IS DISTINCT FROM cs OR
 o.link_digest IS DISTINCT FROM ld OR o.approval_digest IS DISTINCT FROM d OR o.expires_at<=clock_timestamp() OR
 gpt02_private.valid_operator_link(p,d,l) IS DISTINCT FROM true THEN RETURN NULL; END IF;
 INSERT INTO gpt02_private.receipts(command_id,nonce,digest) VALUES(a.command_id,a.nonce,a.digest)
 ON CONFLICT DO NOTHING RETURNING id INTO receipt;
 IF receipt IS NULL THEN RETURN NULL; END IF;
 -- A failure here rolls back the receipt above: neither half is independently committed.
 INSERT INTO gpt02_private.core_identity_receipts(receipt_id,command_id,link_id,operator_user_id,recorded_by,hub_operator_id,link_digest)
 VALUES(receipt,a.command_id,o.link_id,o.core_operator_user_id,'internal:'||o.core_operator_user_id::text,o.hub_operator_id,o.link_digest);
 RETURN receipt;
END $$;

-- Keep the old evidence-only method, but it cannot consume a linked approval.
CREATE OR REPLACE FUNCTION gpt02_private.consume_approval(p jsonb,s text,d text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a gpt02_private.approvals%ROWTYPE; receipt uuid;
BEGIN
 IF session_user<>'dev_gpt02_issuer_evidence' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DEDICATED_ISSUER_REQUIRED'; END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR (p->>'taskId')::integer<=136 THEN RETURN NULL; END IF;
 SELECT * INTO a FROM gpt02_private.approvals WHERE command_id=(p->>'commandId')::uuid FOR UPDATE;
 IF NOT FOUND OR a.claims IS DISTINCT FROM p OR a.signature IS DISTINCT FROM s OR a.digest IS DISTINCT FROM d OR a.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM gpt02_private.operator_links WHERE command_id=a.command_id) THEN RETURN NULL; END IF;
 INSERT INTO gpt02_private.receipts(command_id,nonce,digest) VALUES(a.command_id,a.nonce,a.digest)
 ON CONFLICT DO NOTHING RETURNING id INTO receipt;
 RETURN receipt;
END $$;
REVOKE ALL ON gpt02_private.operator_links,gpt02_private.core_identity_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_private.valid_operator_link(jsonb,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_private.consume_linked_approval(jsonb,text,text,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text) TO dev_gpt02_attestor_evidence;
GRANT EXECUTE ON FUNCTION gpt02_private.consume_linked_approval(jsonb,text,text,jsonb,text,text,text) TO dev_gpt02_issuer_evidence;
COMMIT;
