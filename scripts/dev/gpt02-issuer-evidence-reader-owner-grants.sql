-- CST-DEV ONLY. Owner-escrow least-privilege grants for Issue #159 issuer reader.
-- Temporarily enables only the existing postgres self-grant SET option, then
-- revokes it before COMMIT. No LOGIN/password/signer/dispatch authority.
BEGIN;

DO $pre$
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'GPT02_ISSUER_READER_POSTGRES_SESSION_REQUIRED';
  END IF;
  IF pg_has_role('postgres','gpt02_store_owner','SET')
     OR pg_has_role('postgres','gpt02_store_owner','USAGE') THEN
    RAISE EXCEPTION 'GPT02_STORE_OWNER_AUTHORITY_ALREADY_USABLE';
  END IF;
  IF (SELECT count(*) FROM pg_auth_members
      WHERE roleid='gpt02_store_owner'::regrole
        AND member='postgres'::regrole) <> 2
     OR NOT EXISTS(
       SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
       WHERE m.roleid='gpt02_store_owner'::regrole
         AND m.member='postgres'::regrole
         AND g.rolname='postgres'
         AND NOT m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
     OR NOT EXISTS(
       SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
       WHERE m.roleid='gpt02_store_owner'::regrole
         AND m.member='postgres'::regrole
         AND g.rolname='supabase_admin'
         AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) THEN
    RAISE EXCEPTION 'GPT02_STORE_OWNER_ESCROW_BASELINE_CHANGED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname='gpt02_store_owner'
      AND r.rolcanlogin IS FALSE
      AND r.rolconnlimit=0
      AND r.rolsuper IS FALSE
      AND r.rolcreatedb IS FALSE
      AND r.rolcreaterole IS FALSE
      AND r.rolinherit IS FALSE
      AND r.rolreplication IS FALSE
      AND r.rolbypassrls IS FALSE
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname='gpt02_issuer_evidence_reader'
      AND r.rolcanlogin IS FALSE
      AND r.rolconnlimit=0
      AND r.rolsuper IS FALSE
      AND r.rolcreatedb IS FALSE
      AND r.rolcreaterole IS FALSE
      AND r.rolinherit IS FALSE
      AND r.rolreplication IS FALSE
      AND r.rolbypassrls IS FALSE
  ) THEN
    RAISE EXCEPTION 'GPT02_ISSUER_READER_ROLE_BASELINE_UNSAFE';
  END IF;
  IF (SELECT count(*) FROM pg_auth_members m
      WHERE m.member='gpt02_issuer_evidence_reader'::regrole) <> 0
     OR (SELECT count(*) FROM pg_auth_members m
         WHERE m.roleid='gpt02_issuer_evidence_reader'::regrole) <> 1
     OR NOT EXISTS(
       SELECT 1 FROM pg_auth_members m
       JOIN pg_roles member ON member.oid=m.member
       JOIN pg_roles grantor ON grantor.oid=m.grantor
       WHERE m.roleid='gpt02_issuer_evidence_reader'::regrole
         AND member.rolname='postgres'
         AND grantor.rolname='supabase_admin'
         AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
     OR EXISTS(SELECT 1 FROM pg_stat_activity
       WHERE usename='gpt02_issuer_evidence_reader') THEN
    RAISE EXCEPTION 'GPT02_ISSUER_READER_MANAGEMENT_BASELINE_UNSAFE';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='gpt02_private'
        AND c.relname IN ('approvals','operator_links','receipts','core_identity_receipts','post_consumption_fences')
        AND pg_get_userbyid(c.relowner)='gpt02_store_owner'
        AND c.relrowsecurity AND c.relforcerowsecurity) <> 5 THEN
    RAISE EXCEPTION 'GPT02_ISSUER_READER_EVIDENCE_OWNER_OR_RLS_DRIFT';
  END IF;
END
$pre$;

GRANT gpt02_store_owner TO postgres WITH SET TRUE GRANTED BY postgres;
SET LOCAL ROLE gpt02_store_owner;

DO $owner$
BEGIN
  IF current_user <> 'gpt02_store_owner'
     OR session_user <> 'postgres'
     OR pg_has_role(session_user,'gpt02_store_owner','SET') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'GPT02_STORE_OWNER_SESSION_REQUIRED';
  END IF;
END
$owner$;

REVOKE ALL ON SCHEMA gpt02_private FROM gpt02_issuer_evidence_reader;
GRANT USAGE ON SCHEMA gpt02_private TO gpt02_issuer_evidence_reader;

REVOKE ALL ON gpt02_private.approvals FROM gpt02_issuer_evidence_reader;
REVOKE ALL ON gpt02_private.operator_links FROM gpt02_issuer_evidence_reader;
REVOKE ALL ON gpt02_private.receipts FROM gpt02_issuer_evidence_reader;
REVOKE ALL ON gpt02_private.core_identity_receipts FROM gpt02_issuer_evidence_reader;
REVOKE ALL ON gpt02_private.post_consumption_fences FROM gpt02_issuer_evidence_reader;

REVOKE SELECT (command_id,attempt_id,nonce,task_id,company_id,approver_id,claims,signature,digest,expires_at,recorded_at,operator_namespace)
  ON gpt02_private.approvals FROM gpt02_issuer_evidence_reader;
REVOKE SELECT (link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,attempt_number,company_id,assignee_id,accountable_owner_id,hub_operator_id,core_operator_user_id,approval_digest,link_digest,hub_signature,core_signature,claims,expires_at,created_at)
  ON gpt02_private.operator_links FROM gpt02_issuer_evidence_reader;
REVOKE SELECT (id,command_id,nonce,digest,consumed_at)
  ON gpt02_private.receipts FROM gpt02_issuer_evidence_reader;
REVOKE SELECT (receipt_id,command_id,link_id,operator_user_id,recorded_by,hub_operator_id,link_digest,binding_verified,may_dispatch_worker,may_close_job,may_issue_grant,core_ledger_written,created_at)
  ON gpt02_private.core_identity_receipts FROM gpt02_issuer_evidence_reader;
REVOKE SELECT (fence_id,receipt_id,command_id,link_id,hub_execution_id,core_task_id,attempt_id,worker_id,lease_epoch,lease_started_at,lease_expires_at,dispatch_allowed,core_ledger_written,created_at)
  ON gpt02_private.post_consumption_fences FROM gpt02_issuer_evidence_reader;

GRANT SELECT (command_id,attempt_id,nonce,task_id,company_id,approver_id,claims,digest)
  ON gpt02_private.approvals TO gpt02_issuer_evidence_reader;
GRANT SELECT (
  link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,
  company_id,hub_operator_id,approval_digest,link_digest,claims
) ON gpt02_private.operator_links TO gpt02_issuer_evidence_reader;
GRANT SELECT (id,command_id,nonce,digest,consumed_at)
  ON gpt02_private.receipts TO gpt02_issuer_evidence_reader;
GRANT SELECT (
  receipt_id,command_id,link_id,operator_user_id,recorded_by,hub_operator_id,
  link_digest,binding_verified,may_dispatch_worker,may_close_job,may_issue_grant,
  core_ledger_written,created_at
) ON gpt02_private.core_identity_receipts TO gpt02_issuer_evidence_reader;
GRANT SELECT (
  fence_id,receipt_id,command_id,link_id,hub_execution_id,core_task_id,attempt_id,
  worker_id,lease_epoch,lease_started_at,lease_expires_at,dispatch_allowed,
  core_ledger_written,created_at
) ON gpt02_private.post_consumption_fences TO gpt02_issuer_evidence_reader;

DROP POLICY IF EXISTS issuer_evidence_reader_select ON gpt02_private.approvals;
CREATE POLICY issuer_evidence_reader_select ON gpt02_private.approvals
  FOR SELECT TO gpt02_issuer_evidence_reader
  USING (company_id='default' AND task_id>136 AND claims->>'environment'='DEV');

DROP POLICY IF EXISTS issuer_evidence_reader_select ON gpt02_private.operator_links;
CREATE POLICY issuer_evidence_reader_select ON gpt02_private.operator_links
  FOR SELECT TO gpt02_issuer_evidence_reader
  USING (company_id='default' AND hub_task_id>136 AND attempt_number=1
         AND claims->>'environment'='DEV');

DROP POLICY IF EXISTS issuer_evidence_reader_select ON gpt02_private.receipts;
CREATE POLICY issuer_evidence_reader_select ON gpt02_private.receipts
  FOR SELECT TO gpt02_issuer_evidence_reader USING (true);

DROP POLICY IF EXISTS issuer_evidence_reader_select ON gpt02_private.core_identity_receipts;
CREATE POLICY issuer_evidence_reader_select ON gpt02_private.core_identity_receipts
  FOR SELECT TO gpt02_issuer_evidence_reader USING (true);

DROP POLICY IF EXISTS issuer_evidence_reader_select ON gpt02_private.post_consumption_fences;
CREATE POLICY issuer_evidence_reader_select ON gpt02_private.post_consumption_fences
  FOR SELECT TO gpt02_issuer_evidence_reader USING (true);

RESET ROLE;
REVOKE SET OPTION FOR gpt02_store_owner FROM postgres GRANTED BY postgres RESTRICT;

DO $post$
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR pg_has_role('postgres','gpt02_store_owner','SET')
     OR pg_has_role('postgres','gpt02_store_owner','USAGE')
     OR (SELECT count(*) FROM pg_auth_members
         WHERE roleid='gpt02_store_owner'::regrole
           AND member='postgres'::regrole) <> 2
     OR NOT EXISTS(
       SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
       WHERE m.roleid='gpt02_store_owner'::regrole
         AND m.member='postgres'::regrole
         AND g.rolname='postgres'
         AND NOT m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
     OR NOT EXISTS(
       SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.grantor
       WHERE m.roleid='gpt02_store_owner'::regrole
         AND m.member='postgres'::regrole
         AND g.rolname='supabase_admin'
         AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) THEN
    RAISE EXCEPTION 'GPT02_STORE_OWNER_ESCROW_NOT_RESTORED';
  END IF;
  IF EXISTS(
    SELECT 1 FROM pg_roles r
    WHERE r.rolname='gpt02_issuer_evidence_reader'
      AND (r.rolcanlogin OR r.rolconnlimit<>0 OR r.rolsuper OR r.rolcreatedb
        OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
  ) OR EXISTS(SELECT 1 FROM pg_stat_activity
       WHERE usename='gpt02_issuer_evidence_reader') THEN
    RAISE EXCEPTION 'GPT02_ISSUER_READER_ACTIVATED_DURING_GRANT';
  END IF;
  IF (SELECT count(*) FROM pg_auth_members m
      WHERE m.member='gpt02_issuer_evidence_reader'::regrole) <> 0
     OR (SELECT count(*) FROM pg_auth_members m
         WHERE m.roleid='gpt02_issuer_evidence_reader'::regrole) <> 1
     OR NOT EXISTS(
       SELECT 1 FROM pg_auth_members m
       JOIN pg_roles member ON member.oid=m.member
       JOIN pg_roles grantor ON grantor.oid=m.grantor
       WHERE m.roleid='gpt02_issuer_evidence_reader'::regrole
         AND member.rolname='postgres'
         AND grantor.rolname='supabase_admin'
         AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option) THEN
    RAISE EXCEPTION 'GPT02_ISSUER_READER_MANAGEMENT_BASELINE_CHANGED';
  END IF;
END
$post$;

COMMIT;
