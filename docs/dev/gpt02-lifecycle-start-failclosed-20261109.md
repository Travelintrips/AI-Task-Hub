# GPT02 DEV: temporary fail-closed lifecycle admission, not a completed full lifecycle

## Scope and concrete risk discovered

The already successful user-approved text-only Task136 was sent with `lifecycleStart=false` and `autoContinue=false`. Its signed native response and final ACK are persisted. It was not a Core coding task and did not produce the immutable pre-dispatch binding/nonce required for full autonomous lifecycle. Task135 is a distinct old failed attempt and is never to be replayed. Both must remain unchanged.

The existing DEV dashboard exposed an enabled **Mulai Lifecycle GPT02** control once PIC and its audit matched. That control sent `lifecycleStart:true`, which also set autoContinue=true in the existing API, even though no trusted pre-dispatch Core coding task, signed operator approval, immutable attempt-binding claim, consumed nonce or leased issuer existed. A matching PIC is **not** a cryptographically proven operator consent. Merely displaying NO-GO in a separate read-only diagnostics panel did not stop the lifecycle POST.

## Bounded source fix

Within the authenticated `/ai-tasks/:id/execution` route, requests for `NODE_ENV=development`, `APP_ENV!=production`, exact `accountAlias=GPT02`, `mode=chatgpt`, `lifecycleStart=true` now receive HTTP **409** `GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED` before any execution insert/claim, worker dispatch or continuation scheduling. Response has `dispatchNotStarted=true`, `continuationScheduled=false`, `Cache-Control:no-store` and five explicit missing pre-dispatch proof codes. Request-body booleans or a claimed `coreTaskId` cannot waive this block. Existing invalid-mode rejection remains before this gate.

This does not change ordinary text-only requests with `lifecycleStart=false`, legacy task handling or the strict GET lineage evaluator. The historical response/ACK for Task136 is not altered. No enabling feature flag has been added that could bypass these checks without a new reviewed deployment.

The dashboard's previously clickable lifecycle button is disabled with a clear "belum diaktifkan" label and a short explanation of the missing proof. The unrelated Run Worker and Sync controls are unchanged. No account/password policy, database schema or role is changed.

## Tests and non-mutating boundaries

- Five new source-level tests check exact guard location before first transaction/dispatch/scheduler, five blocking reasons, no client-asserted cryptographic bypass, unchanged one-shot path, and inert UI. With 19 prior historical-outcome tests and 23 bridge/PIC regressions, 47/47 passed locally.
- A disposable PostgreSQL 16 container + separate synthetic application container ran the **real compiled API route**. All six lifecycle refusal checks passed: unauthenticated 401, exact GPT02 lifecycle 409, forged operator/grant/nonce flags still 409, wrong mode 409, cross-tenant 404, and lifecycle 409 even with a valid synthetic PIC. No task execution was inserted and exactly one expected synthetic PIC audit was created.
- The isolated database network is internal and has no CST DEV/PROD credentials. This test **does not** claim that lifecycle works end to end. The earlier comprehensive PIC fixture was outdated for the newly expanded lineage read query, so this runner tests only lifecycle POST refusal and idempotent non-dispatch, rather than claiming the old lineage fixture passed.
- Exact deployment overlay refuses any source other than the currently deployed, known-good API/UI/HTML SHA-256 hashes. It changes only the new guard in the execution handler and the inactive lifecycle CTA/status text. Existing native acknowledgement, PIC actor handling and read-only outcome logic remain identical. Build and packaging are not deployment evidence.

## Exact future enablement contract (not implemented here)

Before any full lifecycle POST is permitted, a **separate trusted admission service** must (1) authenticate the active Super Admin with fresh, command-bound independent proof; (2) prepare a genuine Core coding task and stable command/attempt IDs without dispatch; (3) persist immutable tenant/Hub-task/PIC/Core-task/command binding using a nonprivileged issuer with atomic nonce consumption, uniqueness, expiry, and signed provenance; (4) fence the worker/issuer lease and allow exactly one send; (5) verify native attestation, final ACK and read-back on exactly that command. Missing or mismatched claims must reject without scheduling a command. This must be implemented and tested with a **new separately authorized** future task; do not replay #135 or #136 and do not forge historical approvals to clear the current warning.

**Decision:** DEV full lifecycle admission remains NO-GO until the server-side proof path is implemented. The one-shot text-only transport's historical PASS is not revoked. PROD untouched.
