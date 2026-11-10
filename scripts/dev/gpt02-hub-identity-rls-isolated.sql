-- Synthetic, isolated PostgreSQL 16 proof only. Not a CST-DEV migration.
-- Unlike user-settable GUC, authorization is derived from CURRENT_USER's
-- fixed DB identity. The application must prove authenticated role routing.
BEGIN;
CREATE SCHEMA gpt02_identity_test;
CREATE ROLE gpt02_tenant_a_login NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE gpt02_tenant_b_login NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE gpt02_superadmin_reader NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE TABLE gpt02_identity_test.ai_tasks(id integer PRIMARY KEY,company_id text NOT NULL,title text);
CREATE TABLE gpt02_identity_test.ai_execution_jobs(id integer PRIMARY KEY,company_id text NOT NULL);
CREATE TABLE gpt02_identity_test.team_members(id integer PRIMARY KEY,company_id text NOT NULL);
CREATE TABLE gpt02_identity_test.audit_logs(id integer PRIMARY KEY,company_id text,action text);
INSERT INTO gpt02_identity_test.ai_tasks VALUES (1,'tenant_a','a'),(2,'tenant_b','b');
INSERT INTO gpt02_identity_test.ai_execution_jobs VALUES (1,'tenant_a'),(2,'tenant_b');
INSERT INTO gpt02_identity_test.team_members VALUES (1,'tenant_a'),(2,'tenant_b');
INSERT INTO gpt02_identity_test.audit_logs VALUES (1,'tenant_a','a'),(2,'tenant_b','b'),(3,NULL,'legacy');
GRANT USAGE ON SCHEMA gpt02_identity_test TO gpt02_tenant_a_login,gpt02_tenant_b_login,gpt02_superadmin_reader;
DO $$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['ai_tasks','ai_execution_jobs','team_members','audit_logs'] LOOP
  EXECUTE format('ALTER TABLE gpt02_identity_test.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE gpt02_identity_test.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY read_tenant_a ON gpt02_identity_test.%I FOR SELECT TO gpt02_tenant_a_login USING (company_id = ''tenant_a'')',tab);
  EXECUTE format('CREATE POLICY read_tenant_b ON gpt02_identity_test.%I FOR SELECT TO gpt02_tenant_b_login USING (company_id = ''tenant_b'')',tab);
  EXECUTE format('CREATE POLICY read_superadmin ON gpt02_identity_test.%I FOR SELECT TO gpt02_superadmin_reader USING (true)',tab);
  EXECUTE format('GRANT SELECT ON gpt02_identity_test.%I TO gpt02_tenant_a_login,gpt02_tenant_b_login,gpt02_superadmin_reader',tab);
 END LOOP;
END $$;
COMMIT;
-- Test DB identities separately; no membership is granted between them.
SET SESSION AUTHORIZATION gpt02_tenant_a_login;
SELECT 'TENANT_A_ROLE_FENCED', (SELECT count(*) FROM gpt02_identity_test.ai_tasks)=1 AND (SELECT count(*) FROM gpt02_identity_test.audit_logs)=1;
SELECT set_config('app.company_id','tenant_b',false);
SELECT 'TENANT_A_GUC_CANNOT_ESCALATE', (SELECT count(*) FROM gpt02_identity_test.ai_tasks WHERE company_id='tenant_b')=0;
SELECT 'TENANT_A_NO_ADMIN_MEMBERSHIP', NOT pg_has_role(current_user,'gpt02_superadmin_reader','MEMBER');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION gpt02_tenant_b_login;
SELECT 'TENANT_B_ROLE_FENCED', (SELECT count(*) FROM gpt02_identity_test.ai_tasks)=1 AND (SELECT count(*) FROM gpt02_identity_test.audit_logs)=1;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION gpt02_superadmin_reader;
SELECT 'ADMIN_READ_TWO_TENANTS', (SELECT count(*) FROM gpt02_identity_test.ai_tasks)=2;
SELECT 'ADMIN_AUDIT_NULL_LEGACY', (SELECT count(*) FROM gpt02_identity_test.audit_logs)=3;
SELECT 'ADMIN_NO_INSERT_PRIVILEGE', NOT has_table_privilege(current_user,'gpt02_identity_test.ai_tasks','INSERT');
RESET SESSION AUTHORIZATION;
