-- Install in one transaction against CST-DEV. Service login is provisioned separately.
CREATE ROLE gpt02_task183_receipt_verifier NOLOGIN NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA gpt02_stage TO gpt02_task183_receipt_verifier;
GRANT INSERT (request_id,approval_sha256,predecessor_attempt_id,signed_at,expires_at)
    ON gpt02_stage.task183_verified_recovery_receipts TO gpt02_task183_receipt_verifier;
CREATE POLICY task183_verifier_current_receipt
    ON gpt02_stage.task183_verified_recovery_receipts FOR INSERT
    TO gpt02_task183_receipt_verifier
    WITH CHECK (
        predecessor_attempt_id = '8f5ab85a-8300-4118-a14c-5fc701ae5a7c'
        AND signed_at <= clock_timestamp()
        AND expires_at > clock_timestamp()
    );
