-- Apply only through the CST-DEV migration role. No runtime grants here.
CREATE TABLE gpt02_stage.task183_recovery_attempts (
    company_id text NOT NULL CHECK (company_id = 'default'),
    hub_task_id integer NOT NULL CHECK (hub_task_id = 183),
    attempt_number integer NOT NULL CHECK (attempt_number = 2),
    predecessor_attempt_id uuid NOT NULL UNIQUE
        REFERENCES gpt02_stage.core_preparations(attempt_id)
        CHECK (predecessor_attempt_id = '8f5ab85a-8300-4118-a14c-5fc701ae5a7c'),
    attempt_id uuid PRIMARY KEY CHECK (attempt_id <> predecessor_attempt_id),
    core_task_id uuid NOT NULL UNIQUE REFERENCES ai_platform.ai_coding_tasks(id),
    hub_execution_id uuid NOT NULL UNIQUE REFERENCES public.ai_execution_jobs(id),
    request_id text NOT NULL UNIQUE CHECK (request_id ~ '^[a-f0-9]{36}$'),
    approval_sha256 text NOT NULL UNIQUE CHECK (approval_sha256 ~ '^[a-f0-9]{64}$'),
    signed_at timestamptz NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    approval_expires_at timestamptz NOT NULL,
    dispatch_permitted boolean NOT NULL DEFAULT false CHECK (NOT dispatch_permitted),
    CHECK (signed_at <= issued_at AND issued_at < approval_expires_at),
    UNIQUE (company_id, hub_task_id, attempt_number),
    FOREIGN KEY (company_id, hub_task_id)
        REFERENCES gpt02_stage.core_preparations(company_id, hub_task_id)
);
REVOKE ALL ON gpt02_stage.task183_recovery_attempts FROM PUBLIC;
