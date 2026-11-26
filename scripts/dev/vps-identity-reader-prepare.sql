-- PREPARATION ONLY. DO NOT APPLY TO CST-DEV BY CI OR BY DEPLOYMENT.
-- Provisioned role intentionally NOLOGIN. A separate authorized security
-- change is required before a connection can authenticate.
-- Uses actual CST-DEV public.users shape: id TEXT, company_id INTEGER NULL.
BEGIN;
CREATE ROLE ai_task_vps_identity_reader_dev WITH
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
GRANT USAGE ON SCHEMA public TO ai_task_vps_identity_reader_dev;
-- No password_hash/phone; no DML.
GRANT SELECT (id, email, company_id, role, is_active, status)
    ON TABLE public.users TO ai_task_vps_identity_reader_dev;
CREATE POLICY ai_task_vps_identity_reader_dev_select
    ON public.users AS PERMISSIVE
    FOR SELECT TO ai_task_vps_identity_reader_dev
    USING (
        role = 'super_admin'
        AND is_active IS TRUE
        AND status = 'active'
        AND id = NULLIF(current_setting('ai_task_vps.identity_id', true), '')
        AND lower(btrim(email)) = NULLIF(current_setting('ai_task_vps.identity_email', true), '')
        AND COALESCE(company_id::text, '@NULL@') =
            NULLIF(current_setting('ai_task_vps.identity_company', true), '')
    );
COMMIT;
