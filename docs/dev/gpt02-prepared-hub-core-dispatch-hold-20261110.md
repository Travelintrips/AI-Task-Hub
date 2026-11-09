# GPT02 DEV: reserve safely, never dispatch a `prepared` Hub/Core execution

## Scope, reconciliation, and why this patch is small

The already user-approved text-only Task136 / WA-2611-4633 completed with a verified native response and final ACK. That task must not be replayed; historical Task135 must not be retried. Full GPT02 coding lifecycle is separately held at HTTP409 because its signed operator approval, immutable binding, nonce consumption and issuer lease remain unavailable.

During continuation of that work, upstream PR #156 commit `5feed64` had already implemented an **atomic Hub execution + Core coding task reservation** in the original restricted Core preparer and synthetic PostgreSQL fixture. The module adds one Hub `status=prepared` execution alongside a Core `PENDING` task before any command, with stable candidate IDs, idempotency and rollback. Its fixture now also tests matching a synthetic signed triple-origin proof against actual isolated DB readbacks. This change **does not add a competing reservation module or second schema**; it retains and independently reruns the existing parallel implementation.

## Risk in the real existing API

`POST /ai-tasks/:id/execution` checked the existing attempt and returned it through `scheduleExecutionTracking` when its status was not `failed`, `blocked` or `cancelled`. `prepared` was not listed in those blocked states. Therefore even when `lifecycleStart=true` was held, a caller could instead send `lifecycleStart=false`, choose GPT01 or worker mode, and cause the old generic route to schedule a not-yet-authorized reservation. The source lacked a server-side check of the persisted `prepared` status.

**Fix:** as soon as the existing AI_TASK execution is found, before scheduling/tracking/retry or Core dispatch, any `status=prepared` returns HTTP409 `GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER`, `dispatchNotStarted=true`, `continuationScheduled=false`, `Cache-Control:no-store`. It does not require the caller's GPT alias or lifecycleStart flag to be truthful. The existing strict `lifecycleStart=true` guard, the successful text-only path, and other execution logic are otherwise unchanged. The block does NOT claim or consume an issuer grant. Enabling a future lifecycle requires a *separately reviewed* authorization and one-shot transition from prepared to allowed, not deleting this check.

## Direct evidence

- Reran the existing **atomic Hub/Core PostgreSQL16 fixture**, which passed real concurrent identical reservations (one durable Hub `prepared`, one Core `PENDING`, one set of IDs), stable replay, modified state/instruction/audit denial, locked-role privilege boundaries and Hub/Core rollback. Exactly zero worker commands or native sends. The fixture's optional real Node-to-PostgreSQL isolated socket smoke also passed and verified synthetic three-signature matching.
- **11 new Node/source tests** (8 contract and 3 prepared-state guard) passed in the initial independent implementation; after dropping duplicate modules only the three unique guard tests are kept in PR to avoid parallel preparer drift. The combined final clean-source test against commit `5feed64` had 14/14 successful tests (3 prepared guard + 11 existing Core preparer tests).
- A content-pinned offline API image layered the 18-line prepared-state check onto the exact current DEV server bundle without changing other API bytes. A separate synthetic PostgreSQL + API image test executed seven authentic HTTP requests: no authentication401; prepared GPT02 text, worker, GPT01 alias, fake approval flags all409; lifecycleStart=true still409 from the old signed-proof hold; cross-tenant404. The underlying prepared row remained exactly one with command_id/worker NULL. No real Hub session tokens, database credentials, user data or PROD resources were used. The offline image was **not deployed**.
- CI includes a mandatory Node prepared-state regression. The existing atomic Core/Hub fixture, issuer signature tests, Typecheck and Build remain mandatory.

## Live boundary

The new reservation SQL/roles are **synthetic only**. No `gpt02_stage` schema was deployed to CST-DEV, no actual future task reserved, and the candidate prepare module remains unmounted. This PR change also does not deploy the prepared-state API guard automatically. The live app still holds `lifecycleStart=true`, and there are no live `prepared` GPT02 executions to track. Task135/Task136 and both PROD services remain unchanged.

**Decision:** atomic Hub/Core reservation PASS in isolation, and legacy prepared-state dispatch bypass demonstrably blocked by source/offline API test. Live lifecycle still **NO-GO** until the Core operator, signed approval, nonce, binding and lease are actually deployed and proven under a separate consent-bound task.
