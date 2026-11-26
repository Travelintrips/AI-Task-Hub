-- ISOLATED POSTGRES PROTOTYPE ONLY. NEVER RUN AGAINST LIVE DEV/PROD.
-- Tenant scope must originate in trusted authenticated middleware, not client input.
-- A freely mutable app.company_id is NOT an authentication boundary.
BEGIN;
CREATE SCHEMA gpt02_rls_test;
CREATE ROLE gpt02_rls_test_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA gpt02_rls_test TO gpt02_rls_test_app;
CREATE TABLE gpt02_rls_test.ai_tasks (id int PRIMARY KEY,company_id text NOT NULL,title text);
CREATE TABLE gpt02_rls_test.ai_execution_jobs (id int PRIMARY KEY,company_id text NOT NULL,task_id int,status text);
CREATE TABLE gpt02_rls_test.team_members (id int PRIMARY KEY,company_id text NOT NULL,name text);
CREATE TABLE gpt02_rls_test.audit_logs (id int PRIMARY KEY,company_id text,action text);
INSERT INTO gpt02_rls_test.ai_tasks VALUES (1,'tenant_a','a'),(2,'tenant_b','b');
INSERT INTO gpt02_rls_test.ai_execution_jobs VALUES (1,'tenant_a',1,'ready'),(2,'tenant_b',2,'ready');
INSERT INTO gpt02_rls_test.team_members VALUES (1,'tenant_a','a'),(2,'tenant_b','b');
INSERT INTO gpt02_rls_test.audit_logs VALUES (1,'tenant_a','a'),(2,'tenant_b','b'),(3,NULL,'legacy');
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['ai_tasks','ai_execution_jobs','team_members','audit_logs'] LOOP
  EXECUTE format('ALTER TABLE gpt02_rls_test.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE gpt02_rls_test.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_select ON gpt02_rls_test.%I FOR SELECT TO gpt02_rls_test_app USING (company_id = nullif(current_setting(''app.company_id'',true),''''))',t);
  EXECUTE format('CREATE POLICY tenant_insert ON gpt02_rls_test.%I FOR INSERT TO gpt02_rls_test_app WITH CHECK (company_id = nullif(current_setting(''app.company_id'',true),''''))',t);
  EXECUTE format('CREATE POLICY tenant_update ON gpt02_rls_test.%I FOR UPDATE TO gpt02_rls_test_app USING (company_id = nullif(current_setting(''app.company_id'',true),'''')) WITH CHECK (company_id = nullif(current_setting(''app.company_id'',true),''''))',t);
  EXECUTE format('CREATE POLICY tenant_delete ON gpt02_rls_test.%I FOR DELETE TO gpt02_rls_test_app USING (company_id = nullif(current_setting(''app.company_id'',true),''''))',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON gpt02_rls_test.%I TO gpt02_rls_test_app',t);
 END LOOP;
END $$;
COMMIT;
-- Do not infer security against a caller allowed to issue arbitrary SET app.company_id.
