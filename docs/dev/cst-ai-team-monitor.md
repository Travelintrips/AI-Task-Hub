# CST AI Team Monitor — DEV-only gated canary

Feature location after candidate deployment: /cst-ai-team (existing authenticated super_admin, DEV hostname only).

## Existing components reused
- Existing session JWT and Super Admin role; no new password, service account, OTP, role or approval.
- Existing ai_execution_jobs and ai_execution_events tables; no duplicate task subsystem or new Supabase project.
- Team GET reads Company 1 canary jobs only.
- Team POST accepts only the predefined dev_read_only_canary scenario.

## Four coordinated role executors
- Coding: execution-ledger contract query and deterministic digest.
- Infrastructure: real local HTTP health check.
- Security: DEV-only runtime + existing session-secret guard.
- QA: independent DB readback of the other three persisted results.
- First three checks run concurrently, QA waits and evaluates persisted results.
- Every role result gets timestamp, role-scoped worker label and evidence in ledger.
- Four labels refer to role executors within one API process. They are NOT four independent GPT sessions or autonomous AI coding agents.

## Safety
- Default OFF. Explicit enablement requires CST_AI_TEAM_DEV_ENABLED=true and both NODE_ENV and APP_ENV set to development.
- JWT super_admin and explicit companyId=1 are required.
- Read API does not modify data, write API does not modify historical tasks or launch external workers.
- No GPT02 signing, authorization, dispatch, worker handoff or PROD writes.
- Callback, attestation and Final ACK intentionally remain false and distinct from internal canary completion.
- Existing dirty DEV checkout, deployed containers, DELL and PROD remain unchanged.

## Verification
Run: node --experimental-strip-types --test scripts/dev/cst-ai-team-monitor.test.mjs
Run: pnpm run typecheck
Run: pnpm run build
Do not promote if E2E is unverified or any existing gate fails.

## Next release criterion
Real autonomous AI team would additionally require separate authorized external worker runtimes, a safe task dispatch protocol, verified return receipts, and a nonprivileged task with real external Final ACK. This canary cannot satisfy those criteria.
