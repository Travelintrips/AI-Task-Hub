-- CST-DEV (xssrfshdrtdfupgqwfdw) diagnostic ONLY.
-- Read-only. Compares PR196 lib/db/src/schema/users.ts contract to the
-- actual public.users PostgreSQL catalog. Never run DDL, migrations,
-- schema rewrites, or a session reassignment to pass this gate.
--
-- App DB contract: id=serial/int4; company_id=text NOT NULL;
-- password_hash=text NOT NULL; is_active=boolean NOT NULL.
-- Hub canonical identity: public.users.id TEXT; Issue159 maps Supabase
-- auth.users UUID to canonical Hub TEXT subject. These namespaces must
-- NEVER be merged via a cast of app-local integer id or a matching email.
WITH requirements(column_name, type_name, not_nullable) AS (
 VALUES
  ('id','integer',TRUE),
  ('company_id','text',TRUE),
  ('password_hash','text',TRUE),
  ('is_active','boolean',TRUE)
),
actual AS (
 SELECT c.column_name,c.data_type,c.is_nullable
 FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name='users'
),
parity AS (
 SELECT r.column_name,r.type_name AS expected_type,r.not_nullable AS expected_not_null,
  a.data_type AS actual_type,a.is_nullable AS actual_nullability,
  COALESCE(a.data_type=r.type_name AND (NOT r.not_nullable OR a.is_nullable='NO'),FALSE) AS matched
 FROM requirements r LEFT JOIN actual a USING(column_name)
)
SELECT 'CST-DEV READ ONLY' AS scope,
 CASE WHEN bool_and(matched) THEN 'PASS' ELSE 'NO_GO_SCHEMA_CONFLICT' END AS release_gate,
 COUNT(*) FILTER(WHERE NOT matched)::int AS mismatched_contract_columns
FROM parity;
