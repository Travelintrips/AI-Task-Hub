-- Disposable Postgres evidence fixture only. NOT a hosted DB migration.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database()<>'gpt02_issuer_isolated' THEN RAISE EXCEPTION 'ISOLATED_DATABASE_REQUIRED'; END IF; END $$;
BEGIN;
SET LOCAL ROLE gpt02_store_owner;
-- An immutable one-time post-consumption claim, never a dispatch authority.
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
CREATE FUNCTION gpt02_private.reserve_post_consumption_fence(p_receipt uuid,p_command uuid,p_link uuid,p_worker text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a gpt02_private.approvals%ROWTYPE;
        r gpt02_private.receipts%ROWTYPE;
        i gpt02_private.core_identity_receipts%ROWTYPE;
        l gpt02_private.operator_links%ROWTYPE;
        token uuid;now_exact timestamptz;deadline timestamptz;
BEGIN
 IF session_user<>'dev_gpt02_issuer_evidence' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DEDICATED_ISSUER_REQUIRED';
 END IF;
 IF p_receipt IS NULL OR p_command IS NULL OR p_link IS NULL OR
    p_worker IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev' THEN RETURN NULL; END IF;
 -- Existing core identity receipt is necessary; a plain legacy approval receipt
 -- cannot acquire a fence or be treated as a signed dual-origin identity.
 SELECT * INTO r FROM gpt02_private.receipts WHERE id=p_receipt AND command_id=p_command FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO i FROM gpt02_private.core_identity_receipts
  WHERE receipt_id=p_receipt AND command_id=p_command AND link_id=p_link FOR SHARE;
 IF NOT FOUND OR i.binding_verified IS DISTINCT FROM false OR i.may_dispatch_worker IS DISTINCT FROM false OR
    i.core_ledger_written IS DISTINCT FROM false OR i.may_issue_grant IS DISTINCT FROM false OR
    i.may_close_job IS DISTINCT FROM false THEN RETURN NULL; END IF;
 SELECT * INTO l FROM gpt02_private.operator_links WHERE link_id=p_link AND command_id=p_command FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO a FROM gpt02_private.approvals WHERE command_id=p_command FOR SHARE;
 now_exact:=clock_timestamp();
 IF NOT FOUND OR a.expires_at<=now_exact OR l.expires_at<=now_exact OR
    l.hub_task_id<=136 OR l.claims->>'workerId' IS DISTINCT FROM p_worker OR
    l.approval_digest IS DISTINCT FROM a.digest OR
    i.link_digest IS DISTINCT FROM l.link_digest OR i.hub_operator_id IS DISTINCT FROM l.hub_operator_id OR
    i.operator_user_id IS DISTINCT FROM l.core_operator_user_id OR
    r.nonce IS DISTINCT FROM a.nonce OR r.digest IS DISTINCT FROM a.digest OR
    l.claims->>'nonce' IS DISTINCT FROM a.nonce OR
    l.claims->>'coreTaskId' IS DISTINCT FROM l.core_task_id::text OR
    l.claims->>'hubExecutionId' IS DISTINCT FROM l.hub_execution_id::text OR
    l.claims->>'attemptId' IS DISTINCT FROM l.attempt_id::text OR
    l.claims->>'workerId' IS DISTINCT FROM p_worker THEN RETURN NULL; END IF;
 deadline:=LEAST(a.expires_at,l.expires_at,now_exact+interval '15 seconds');
 IF deadline<=now_exact THEN RETURN NULL; END IF;
 INSERT INTO gpt02_private.post_consumption_fences(receipt_id,command_id,link_id,
   hub_execution_id,core_task_id,attempt_id,worker_id,lease_started_at,lease_expires_at)
 VALUES(p_receipt,p_command,p_link,l.hub_execution_id,l.core_task_id,l.attempt_id,p_worker,now_exact,deadline)
 ON CONFLICT DO NOTHING RETURNING fence_id INTO token;
 RETURN token;
END $$;
REVOKE ALL ON gpt02_private.post_consumption_fences FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_private.reserve_post_consumption_fence(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_private.reserve_post_consumption_fence(uuid,uuid,uuid,text) TO dev_gpt02_issuer_evidence;
COMMIT;
