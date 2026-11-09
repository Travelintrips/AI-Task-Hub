# GPT02 DEV: atomic Core coding task preparation, no dispatch

## Why this work is limited

The user's **Task136 / WA-2611-4633** proved one native text response with final ACK. It used the direct ChatGPT wake route, which does not create a Core coding task and cannot be retroactively represented as a complete lifecycle. The existing strict lineage correctly reports missing Core coding task, immutable pre-dispatch claim and operator-bound nonce. Task135 is the failed forensic task; neither #135 nor #136 can be retried to satisfy new lifecycle criteria.

The current DEV lifecycleStart endpoint is already safely closed with HTTP409 and an inactive UI control. This change prepares only **one missing pre-dispatch capability**: reserving a real PENDING Core coding task and stable candidate command/attempt IDs **atomically**, using a dedicated nonprivileged database role. It does not issue commands, sign operator approvals, generate a worker grant, consume an authorization nonce or change any existing task.

## Implemented candidate module

`artifacts/api-server/src/lib/gpt02-core-task-preparation.mjs` validates a strictly bounded DEV coding-preparation request (tenant `default`, a NEW Hub task ID greater than 136, the configured Core-AI-Foundation repository/branch, and a short one-line instruction). Caller-supplied Core task IDs, command IDs, signatures, grants and other extra fields are rejected. The connector requires a separate CST-DEV scoped `gpt02_core_prep_login` account on the explicitly pinned session pooler with certificate validation. It never falls back to the Hub's `postgres` login and rejects production/insecure connection settings. It checks actual session/current-user identity and elevated privileges, requires zero role memberships, and rejects direct writes to Core task/command/staging tables. Database transactions enforce statement/lock timeouts, sanitize errors, roll back and retire connections on failure. Every returned preparation result has `operatorApprovalRecorded=false`, `issuerGrantReady=false`, `dispatchPermitted=false`, and `lifecycleStartPermitted=false`.

This module is **not imported by any live API route or worker** and does not activate a Core coding task or dispatch. Its schema/function remain synthetic only; no role/credential/schema was added to CST-DEV. No other Hub/PROD module is changed.

## Actual isolated PostgreSQL behavior

`scripts/dev/gpt02-core-task-preparation-isolated.sql` creates a fake Hub task/PIC/audit, synthetic Core `ai_coding_tasks`, and a private immutable preparation ledger **only inside** database `gpt02_core_preparation_isolated`. The fixture exits with an error for any other database name. Its `gpt02_stage.prepare_core_task` function is SECURITY DEFINER owned by a **NOLOGIN, NOSUPERUSER, NOBYPASSRLS** role, not `postgres`, and callable only by a distinct nonprivileged preparer session. It checks the real synthetic Hub task/PIC/last audit and active Super Admin identity, zero prior Hub executions, exact project/repository/branch and a stable content hash. One transaction writes one Core coding task in `PENDING` plus its immutable task/command-candidate/attempt IDs. The function cannot create a Core bridge command or worker run.

The isolated shell suite demonstrated:

- Task #135 and previously executed Task #136 refused; foreign tenant and unrelated repo refused.
- A normal role cannot directly write the preparation or Core coding-task tables or assume the owner role; a postgres session using SET SESSION AUTHORIZATION fails the dedicated-login check unless actually authenticated as preparer.
- **Two simultaneous preparer sessions** converge to the exact same Core task / command-candidate / attempt IDs; exactly one reports `created=true` and the other `created=false`.
- Repeated identical preparation preserves all IDs; changed instructions, a started Core run or an altered Super Admin audit reject reuse.
- Synthetic failure after inserting a Core task rolls back **both** coding task and preparation ledger; there is no orphan row.
- The ledger is append-only, all recorded Core tasks remain `PENDING`, and **zero** `ai_coding_bridge_commands` were inserted.
- An additional actual Node module integration on the same isolated PostgreSQL socket verified a stable replay, failure sanitization, and no dispatch permission. The module uses only an isolated Docker volume and no CST credentials. Its diagnostic shows SQLSTATE55000 for a deliberately changed instruction; that exception is sanitized before leaving the module.

Ten Node unit/security cases also verify input rejection, role privileges, rollback/connection disposal, result validation, TLS/project pinning and the fact the module cannot be invoked by HTTP yet. GitHub CI runs the PostgreSQL suite and Node unit suite. On a runner without the locally built DEV container image, the optional real Node-to-PG socket check is skipped explicitly; it already ran successfully on the authorized VPS. This distinction must be preserved in CI claims.

## Not an operational PASS

An actual future lifecycle still needs: (a) a legitimate fresh Hub task/PIC and independently authenticated Super Admin, (b) a Core coding task approved for a specific coding repository and instruction, (c) independent server-signed command-bound origin and approval, (d) durable pre-dispatch binding and atomic nonce consume, and (e) one leased Core command/DELL native result and final ACK. The candidate `commandCandidateId` is NOT yet an actual Core command. No operator signature/issuer grant/worker send can be inferred from this preparation.

**Decision:** isolated idempotent Core task preparation PASS, runtime lifecycle still NO-GO. Never backfill or repeat Task135/Task136 to make diagnostics green.

## Hosted-schema compatibility correction (2026-11-09)

Read-only inspection of actual CST-DEV `public.users` confirmed a subtle prototype mismatch: `users.id` is TEXT but `users.company_id` is a nullable INTEGER, while Hub `ai_tasks.company_id` is tenant TEXT (`default`). The earlier isolated fixture incorrectly declared both as TEXT and compared them directly. This could not be deployed unchanged against the actual hosted schema. The disposable fixture now models the true nullable INTEGER column and the preparer accepts only an **active global Super Admin (`company_id IS NULL`)** for the currently pinned `default` tenant when the audited actor identity, email, role and PIC audit all match. An account with a numeric company ID is fail-closed until a separately verified tenant-mapping service exists; numeric IDs are not cast to tenant slugs. A regression asserts that a synthetic company-scoped Super Admin with an otherwise matching audit is rejected. This is a stage-only correction: no hosted table, user, login, role, command or business data was changed.

The candidate Node preparer now additionally reads the five authoritative `pg_attribute` column contracts (Hub user TEXT ID, nullable INTEGER company ID, Hub task TEXT tenant, audit actor email TEXT, Core task UUID) inside the same transaction and rejects any schema drift **before** invoking the write-capable preparation routine. Negative unit tests independently flip every catalog condition and confirm no prepare call occurs. No route imports or live credentials were added.

## Exact PostgreSQL extension namespace compatibility

An additional read-only hosted-catalog query confirmed `pgcrypto.digest(text,text)` and `digest(bytea,text)` are installed under `extensions`, NOT `public`, in real CST-DEV. The candidate had mistakenly used `public.digest`, which passed its earlier PostgreSQL fixture because pgcrypto was installed in the default public schema. The disposable fixture now installs pgcrypto into `extensions`, calls the fully qualified `extensions.digest`, explicitly grants only schema USAGE and digest(text,text) EXECUTE to its NOLOGIN preparation owner, and tests revocation: without the grant the real isolated preparer is denied before writing any Core task. This is a source/isolated-fixture fix only; no hosted role, extension, account, project or task was changed.
