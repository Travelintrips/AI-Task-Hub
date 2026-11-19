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
  tg.*, rg.*, iss.*, fn.phase_function_count,
  'EXTERNAL_SYSTEMD_AND_SIGNER_NOT_CHECKED' AS external_operational_checks
FROM task_gate tg
CROSS JOIN role_gate rg
CROSS JOIN issuance iss
CROSS JOIN phase_functions fn;

ROLLBACK;
