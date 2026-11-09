-- DISPOSABLE DATABASE ONLY. Not a live migration or dispatch authorization.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database()<>'gpt02_issuer_isolated' THEN RAISE EXCEPTION 'ISOLATED_DATABASE_REQUIRED'; END IF; END $$;
BEGIN;
REVOKE CREATE,TEMPORARY ON DATABASE gpt02_issuer_isolated FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE gpt02_store_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE ROLE dev_gpt02_attestor_evidence LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE ROLE dev_gpt02_issuer_evidence LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE ROLE gpt02_untrusted_app LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
CREATE TABLE public.unrelated_data(id integer PRIMARY KEY);
INSERT INTO public.unrelated_data VALUES (1);
REVOKE ALL ON public.unrelated_data FROM PUBLIC;
SET LOCAL ROLE gpt02_store_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA gpt02_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE gpt02_private.approvals(
 command_id uuid PRIMARY KEY,attempt_id uuid NOT NULL UNIQUE,
 nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[A-Za-z0-9_-]{32,128}$'),
 task_id integer NOT NULL CHECK(task_id>0 AND task_id<>135),
 company_id text NOT NULL CHECK(company_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
 approver_id bigint NOT NULL CHECK(approver_id>0),claims jsonb NOT NULL,
 signature text NOT NULL CHECK(signature ~ '^[A-Za-z0-9_-]{86}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),expires_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(command_id<>attempt_id));
CREATE TABLE gpt02_private.receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.approvals(command_id),
 nonce text NOT NULL UNIQUE,digest text NOT NULL,consumed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts FORCE ROW LEVEL SECURITY;
-- Only the NOLOGIN function/table owner operates on these two private tables.
CREATE POLICY owner_only ON gpt02_private.approvals TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_only ON gpt02_private.receipts TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE FUNCTION gpt02_private.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='APPEND_ONLY_EVIDENCE'; END $$;
CREATE TRIGGER immutable_approvals BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_private.approvals FOR EACH STATEMENT EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER immutable_receipts BEFORE UPDATE OR DELETE OR TRUNCATE ON gpt02_private.receipts FOR EACH STATEMENT EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE FUNCTION gpt02_private.record_approval(p jsonb,s text,d text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE exp timestamptz; issued timestamptz; inserted uuid;
BEGIN
 IF session_user<>'dev_gpt02_attestor_evidence' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DEDICATED_ATTESTOR_REQUIRED'; END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>11 OR
 NOT(p ?& ARRAY['v','environment','audience','taskId','commandId','attemptId','nonce','superAdminId','companyId','issuedAt','expiresAt']) OR
 p->>'v'<>'1' OR p->>'environment'<>'DEV' OR p->>'audience'<>'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL' OR
 (p->>'taskId')::integer<=0 OR (p->>'taskId')::integer=135 OR p->>'companyId' IN ('all','*') THEN RETURN false; END IF;
 exp:=to_timestamp((p->>'expiresAt')::numeric/1000); issued:=to_timestamp((p->>'issuedAt')::numeric/1000);
 IF exp<=clock_timestamp() OR issued>clock_timestamp()+interval '5 seconds' OR exp<=issued OR exp-issued>interval '5 minutes' THEN RETURN false; END IF;
 INSERT INTO gpt02_private.approvals(command_id,attempt_id,nonce,task_id,company_id,approver_id,claims,signature,digest,expires_at)
 VALUES((p->>'commandId')::uuid,(p->>'attemptId')::uuid,p->>'nonce',(p->>'taskId')::integer,p->>'companyId',(p->>'superAdminId')::bigint,p,s,d,exp)
 ON CONFLICT DO NOTHING RETURNING command_id INTO inserted;
 RETURN inserted IS NOT NULL;
END $$;
CREATE FUNCTION gpt02_private.consume_approval(p jsonb,s text,d text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a gpt02_private.approvals%ROWTYPE; receipt uuid;
BEGIN
 IF session_user<>'dev_gpt02_issuer_evidence' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DEDICATED_ISSUER_REQUIRED'; END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR (p->>'taskId')::integer=135 THEN RETURN NULL; END IF;
 -- Check real time AFTER waiting for the approval row lock.
 SELECT * INTO a FROM gpt02_private.approvals WHERE command_id=(p->>'commandId')::uuid FOR UPDATE;
 IF NOT FOUND OR a.claims IS DISTINCT FROM p OR a.signature IS DISTINCT FROM s OR a.digest IS DISTINCT FROM d OR a.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 INSERT INTO gpt02_private.receipts(command_id,nonce,digest) VALUES(a.command_id,a.nonce,a.digest)
 ON CONFLICT DO NOTHING RETURNING id INTO receipt;
 RETURN receipt;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA gpt02_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gpt02_private FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_private TO dev_gpt02_attestor_evidence,dev_gpt02_issuer_evidence;
GRANT EXECUTE ON FUNCTION gpt02_private.record_approval(jsonb,text,text) TO dev_gpt02_attestor_evidence;
GRANT EXECUTE ON FUNCTION gpt02_private.consume_approval(jsonb,text,text) TO dev_gpt02_issuer_evidence;
COMMIT;
