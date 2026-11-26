BEGIN IMMEDIATE;
CREATE TABLE gpt02_task189_owner_recovery_decisions(
 id TEXT PRIMARY KEY,
 task_id INTEGER NOT NULL CHECK(task_id=189),
 request_id TEXT NOT NULL UNIQUE CHECK(length(request_id)=36),
 company_id TEXT NOT NULL CHECK(company_id='default'),
 evidence_sha256 TEXT NOT NULL CHECK(length(evidence_sha256)=64),
 claims_sha256 TEXT NOT NULL UNIQUE CHECK(length(claims_sha256)=64),
 owner_subject TEXT NOT NULL CHECK(substr(owner_subject,1,6)='owner:'),
 nonce TEXT NOT NULL UNIQUE CHECK(length(nonce)>=32),
 auth_user_id TEXT NOT NULL,
 role_at_decision TEXT NOT NULL CHECK(role_at_decision='super_admin'),
 auth_method TEXT NOT NULL CHECK(auth_method='supabase_admin_session'),
 decision TEXT NOT NULL CHECK(decision='APPROVE_RECOVERY_ATTEMPT2_ONLY'),
 recorded_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 CHECK(expires_at_ms>recorded_at_ms AND expires_at_ms-recorded_at_ms<=120000)
);
CREATE TABLE gpt02_task189_owner_recovery_outbox(
 id TEXT PRIMARY KEY,
 decision_id TEXT NOT NULL UNIQUE REFERENCES gpt02_task189_owner_recovery_decisions(id),
 task_id INTEGER NOT NULL CHECK(task_id=189),
 request_id TEXT NOT NULL UNIQUE CHECK(length(request_id)=36),
 company_id TEXT NOT NULL CHECK(company_id='default'),
 evidence_sha256 TEXT NOT NULL,
 claims_sha256 TEXT NOT NULL UNIQUE,
 owner_subject TEXT NOT NULL,
 nonce TEXT NOT NULL UNIQUE,
 auth_user_id TEXT NOT NULL,
 role_at_decision TEXT NOT NULL,
 auth_method TEXT NOT NULL,
 recorded_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL
);
CREATE TRIGGER task189_decision_no_update BEFORE UPDATE ON gpt02_task189_owner_recovery_decisions
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER_DECISION'); END;
CREATE TRIGGER task189_decision_no_delete BEFORE DELETE ON gpt02_task189_owner_recovery_decisions
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER_DECISION'); END;
CREATE TRIGGER task189_outbox_no_update BEFORE UPDATE ON gpt02_task189_owner_recovery_outbox
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER_OUTBOX'); END;
CREATE TRIGGER task189_outbox_no_delete BEFORE DELETE ON gpt02_task189_owner_recovery_outbox
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_OWNER_OUTBOX'); END;
COMMIT;
