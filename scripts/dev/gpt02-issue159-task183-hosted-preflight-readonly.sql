-- GPT02 Issue #159 / Task #183: consolidated CST-DEV catalogue preflight.
-- Diagnostic only. Run only against Supabase project xssrfshdrtdfupgqwfdw
-- through an authorized read-only administrative connection.
--
-- This query does NOT test recent Google login, actual Owner intent,
-- encrypted credential custody, signer mounting, issuer/DELL runtime,
-- systemd independent relock watchdog or native Final ACK.
-- Its release_decision is intentionally ALWAYS NO_GO.
--
-- The installed relock Phase A/B routines manage only the allowlisted
-- attestor, issuer and issuer-reader writer issuance windows. They do NOT
-- automatically relock the auditor itself or the separate core preparer.
-- Their 2/2 presence and zero outstanding windows are NOT readiness proof.
-- The original issuer reader's permissive policy may expose multiple
-- task IDs in one company. A server-side exact query filter is NOT a
-- database-enforced task boundary if credentials are compromised.
-- Report direct column SELECT + policy threshold, never mark task-183
-- confidentiality PASS from tenant-only / numeric threshold RLS.
-- pg_authid is used ONLY to return password-verifier presence booleans;
-- this preflight requires an authorized administrative read-only session.
--
-- Never use this query's output to enable a PostgreSQL LOGIN role, reset a
-- password, bypass NOLOGIN, start a signer, approve a command or dispatch.
-- Task 171 has an expired immutable preparation: never replay or mutate it.
-- Task 183 PIC #5 was already assigned with audit ID #2636; do not repeat.
BEGIN READ ONLY;

WITH
task_gate AS (
  SELECT
    (SELECT count(*) FROM public.ai_tasks
      WHERE id = 183 AND company_id = 'default'
        AND status = 'new_inquiry' AND assigned_to_id = 5)::int
      AS task183_expected_rows,
    (SELECT count(*) FROM public.audit_logs
      WHERE entity_type = 'ai_task' AND entity_id = '183'
        AND action = 'gpt02_pic_assigned')::int
      AS task183_pic_audit_rows,
    (SELECT count(*) FROM public.ai_execution_jobs
      WHERE task_id = 183)::int AS task183_job_rows,
    (SELECT count(*) FROM gpt02_stage.core_preparations
      WHERE hub_task_id = 183)::int AS task183_preparation_rows,
    (SELECT count(*) FROM gpt02_private.approvals
      WHERE task_id = 183)::int AS task183_approval_rows,
    (SELECT count(*) FROM public.ai_execution_jobs
      WHERE task_id = 171)::int AS historical171_job_rows,
    (SELECT count(*) FROM gpt02_stage.core_preparations
      WHERE hub_task_id = 171)::int AS historical171_preparation_rows
),
role_gate AS (
  SELECT
    count(*) FILTER (
      WHERE rolname IN (
        'gpt02_core_prep_login',
        'dev_gpt02_attestor_evidence',
        'dev_gpt02_issuer_evidence',
        'gpt02_issuer_evidence_reader',
        'dev_gpt02_relock_catalog_auditor'
      )
      AND NOT rolcanlogin AND rolconnlimit = 0
      AND NOT rolbypassrls
    )::int AS protected_roles_nologin_out_of_5,
    bool_or(rolname = 'gpt02_issuer_evidence_reader'
      AND NOT rolcanlogin AND rolconnlimit = 0
      AND rolvaliduntil < clock_timestamp())
      AS issuer_reader_locked_and_expired,
    bool_or(rolname = 'dev_gpt02_relock_catalog_auditor'
      AND NOT rolcanlogin AND rolconnlimit = 0)
      AS relock_auditor_locked
  FROM pg_roles
),
credential_presence AS (
  SELECT
    bool_or(rolname = 'gpt02_issuer_evidence_reader'
      AND rolpassword IS NOT NULL) AS issuer_reader_verifier_present,
    bool_or(rolname = 'dev_gpt02_relock_catalog_auditor'
      AND rolpassword IS NOT NULL) AS relock_auditor_verifier_present
  FROM pg_authid
  WHERE rolname IN (
    'gpt02_issuer_evidence_reader',
    'dev_gpt02_relock_catalog_auditor'
  )
),
issuer_rls_policies AS (
  SELECT
    count(*) FILTER (
      WHERE 'gpt02_issuer_evidence_reader' = ANY(roles)
        AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
    )::int AS issuer_permissive_select_policies,
    count(*) FILTER (
      WHERE 'gpt02_issuer_evidence_reader' = ANY(roles)
        AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
        AND (
          strpos(coalesce(qual, ''), 'task_id > 136') > 0
          OR strpos(coalesce(qual, ''), 'hub_task_id > 136') > 0
        )
    )::int AS issuer_threshold_scope_policies,
    count(*) FILTER (
      WHERE 'gpt02_issuer_evidence_reader' = ANY(roles)
        AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
        AND strpos(coalesce(qual, ''), '183') > 0
    )::int AS issuer_task183_literal_policies
  FROM pg_policies
  WHERE schemaname = 'gpt02_private'
    AND tablename IN (
      'approvals', 'operator_links', 'receipts',
      'core_identity_receipts', 'post_consumption_fences'
    )
),
issuer_table_grants AS (
  SELECT count(*) FILTER (
    WHERE has_any_column_privilege(
      'gpt02_issuer_evidence_reader', c.oid, 'SELECT'
    )
  )::int AS issuer_direct_column_select_tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'gpt02_private'
    AND c.relkind IN ('r', 'p')
    AND c.relname IN (
      'approvals', 'operator_links', 'receipts',
      'core_identity_receipts', 'post_consumption_fences'
    )
),
issuance AS (
  SELECT
    count(*)::int AS total_windows,
    count(*) FILTER (WHERE cleaned_at IS NULL)::int
      AS uncleaned_windows,
    count(*) FILTER (
      WHERE cleaned_at IS NULL AND expires_at <= clock_timestamp()
    )::int AS expired_uncleaned_windows
  FROM gpt02_relock_audit.writer_issuance_watchdog
),
phase_functions AS (
  SELECT count(*)::int AS phase_function_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'gpt02_relock_audit'
    AND p.proname IN (
      'relock_expired_phase_a', 'relock_expired_phase_b'
    )
)
SELECT
  'CST-DEV' AS scope,
  'NO_GO_NEVER_AUTHORIZES' AS release_decision,
  tg.*, rg.*, cp.*, rp.*, gr.*, iss.*, fn.phase_function_count,
  CASE
    WHEN rp.issuer_permissive_select_policies = 5
      AND rp.issuer_threshold_scope_policies = 5
      AND gr.issuer_direct_column_select_tables = 5
      THEN 'ISSUER_RLS_MULTI_TASK_READ_SCOPE_NO_GO'
    ELSE 'ISSUER_RLS_DRIFT_REQUIRES_INDEPENDENT_REVIEW'
  END AS issuer_task_isolation_verdict,
  FALSE AS task183_exclusive_database_access_proven,
  'EXTERNAL_SYSTEMD_AND_SIGNER_NOT_CHECKED' AS external_operational_checks
FROM task_gate tg
CROSS JOIN role_gate rg
CROSS JOIN credential_presence cp
CROSS JOIN issuer_rls_policies rp
CROSS JOIN issuer_table_grants gr
CROSS JOIN issuance iss
CROSS JOIN phase_functions fn;

ROLLBACK;
