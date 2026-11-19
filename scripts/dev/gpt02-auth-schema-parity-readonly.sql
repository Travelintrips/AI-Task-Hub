-- CST-DEV (xssrfshdrtdfupgqwfdw) DIAGNOSTIC ONLY, read-only.
-- Source Drizzle model is NOT the authoritative shared PostgreSQL schema.
-- A model/type mismatch must NEVER trigger shared DDL, account duplication,
-- permission escalation, a signer release, or a claim that login failed.
--
-- ACTUAL READBACK (verified separately against live DEV through actual pg +
-- Drizzle projection): public.users.id returns TEXT and company_id is nullable
-- int4; the existing PR196 Google profile code intentionally accepts these
-- runtime values. The source model's serial/text annotations can diverge
-- without the SELECT failing. Google OAuth token exchange itself has NOT
-- been tested with a real operator session by this SQL check.
--
-- The actual Hub public.users TEXT id is carried by the signed DEV JWT.
-- The separate Supabase auth.users UUID is joined ONLY by the existing
-- Issue159 trusted mapping, NEVER by numeric cast, browser claim or email.
WITH requirements(column_name,type_name,not_nullable) AS (
 VALUES ('id','integer',TRUE),
        ('company_id','text',TRUE),
        ('password_hash','text',TRUE),
        ('is_active','boolean',TRUE)
),
actual AS (
 SELECT column_name,data_type,is_nullable
 FROM information_schema.columns
 WHERE table_schema='public' AND table_name='users'
),
parity AS (
 SELECT r.column_name,
  COALESCE(a.data_type=r.type_name
   AND (NOT r.not_nullable OR a.is_nullable='NO'),FALSE) AS matched
 FROM requirements r LEFT JOIN actual a USING (column_name)
),
super_admin_shapes AS (
 SELECT count(*)::int AS super_admin_count,
  count(*) FILTER(WHERE is_active IS TRUE AND status='active')::int AS active_count,
  count(*) FILTER(WHERE id !~ '^[0-9]+$')::int AS nonnumeric_text_ids,
  count(*) FILTER(WHERE company_id IS NULL)::int AS nullable_companies,
  count(*) FILTER(WHERE company_id IS NOT NULL)::int AS integer_companies
 FROM public.users
 WHERE role='super_admin'
)
SELECT 'CST-DEV READ ONLY' AS scope,
 CASE WHEN bool_and(p.matched) THEN 'SOURCE_TYPE_PARITY_PASS'
      ELSE 'SOURCE_TYPE_PARITY_DIFFERS_REVIEW_WRITES' END AS source_model_contract,
 count(*) FILTER(WHERE NOT p.matched)::int AS source_field_mismatches,
 a.super_admin_count,a.active_count,a.nonnumeric_text_ids,
 a.nullable_companies,a.integer_companies,
 'NOT_A_GOOGLE_LOGIN_VERDICT' AS actual_oauth_runtime_status,
 'NO_SHARED_DDL_NO_AUTOMATIC_PRIVILEGE' AS action
FROM parity p CROSS JOIN super_admin_shapes a
GROUP BY a.super_admin_count,a.active_count,a.nonnumeric_text_ids,
 a.nullable_companies,a.integer_companies;
