# Unified Job Registry — AI Task

## Purpose

AI Task is the authoritative ledger, AI Core orchestrates workers, OpenClaw operates only registered sessions, ChatGPT codes via GitHub. This feature provides a **storage and verification layer**, not live delivery to ChatGPT; do not claim OpenClaw / MCP E2E before a separate integration test.

## Data & privacy

- Private PostgreSQL schema `ai_task_bridge`: `jobs`, `job_events`, `sessions`.
- No Supabase Data API exposure, RLS enabled with zero public policies.
- Existing customer/operational `ai_tasks`, `tasks`, and `audit_logs` are **not modified**.
- Job title and result summary must omit secrets, passwords, and raw customer PII.
- Super-admin-only dashboard `/bridge-jobs`. No background polling.

## Secrets

Separate random service credentials (>=32 characters) in server environment only:

- `AI_TASK_BRIDGE_TOKEN`: job producer/worker for registration, lease, renewal, result/failure, heartbeat.
- `AI_TASK_BRIDGE_ACK_TOKEN`: independent authenticated receiving system for callback ACK.

Do not use the same token for the producer and callback receiver. Missing token -> service **503 fail closed**. Do not expose either token in browser, URL, GitHub logs, or repository. Rotate via approved secret-management procedure.

## API

All routes are under `/api`, JSON body, `Authorization: Bearer <service token>`. The UI list endpoints use the existing JWT and super_admin role.

1. `POST /bridge/jobs`: `{source, externalId, idempotencyKey, title, sessionId?}` -> persisted task UUID, 201 initial / 200 replay.
2. `POST /bridge/jobs/:id/claim`: `{owner, leaseSeconds?}` -> lease token valid for 30–900 seconds.
3. `POST /bridge/jobs/:id/renew`: `{owner, leaseToken, leaseSeconds?}` -> extend same fencing token.
4. `POST /bridge/jobs/:id/result`: `{eventId, owner, leaseToken, callbackId, resultSummary}` -> `WAITING_FOR_ACK` with persisted receipt.
5. `POST /bridge/jobs/:id/ack`: receiver **separate token**, `{eventId, receiver, callbackId, accepted:true}` -> `COMPLETED` with receipt.
6. `POST /bridge/jobs/:id/fail`: `{eventId, owner, leaseToken, reason}` -> `FAILED` with event record.
7. `POST /bridge/sessions/heartbeat`: `{source, sessionId, state, owner?, jobId?}`.
8. `GET /bridge/admin/jobs`, `GET /bridge/admin/sessions`, `GET /bridge/admin/jobs/:id/events`: super-admin JWT.

CallbackId must match the previously stored worker result. Neither a plain browser response nor a producer-declared ACK completes the job.

## Failure handling

- Atomic claim with lease fencing; expired worker cannot overwrite an active job.
- Idempotent source+key registration and eventId ledger; retries must reuse identifiers.
- Worker's final output records `WAITING_FOR_ACK`; only a separately authenticated receiver's ACK makes `COMPLETED`.
- A missing heartbeat indicates stale **observation**, not proof of a stalled model.
- Shared job locking remains at the orchestrator; never dispatch the same job through MCP and OpenClaw concurrently.

## Release gate

1. Run migration on **DEV database only**; inspect RLS/privileges and verify no changes to existing tasks.
2. Deploy isolated DEV service configured with DEV PostgreSQL + distinct bridge secrets.
3. E2E: register -> idempotent replay -> claim -> worker result -> independent callback ack -> query persisted COMPLETED. Also reject invalid tokens, stale leases, cross-job event reuse and duplicate callback.
4. Pass typecheck, build, unit/integration tests, login and UI tests, audit, HTTPS and environment isolation.
5. Approve and apply additive PROD migration under controlled release, provision secrets using an authorized secret store; verify PROD.
6. **Only after the above** connect AI Core, OpenClaw, ChatGPT/MCP routes with a feature flag and canary; no bulk cutover.

The API is deliberately disabled for service calls until bridge tokens are set and tested. Never silently bypass authentication to make a rollout pass.
