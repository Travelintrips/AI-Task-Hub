# AI Task Center DEV database login cutover — 2026-11-09

## Verified runtime and reasons for NO-GO

DEV service `ai-task-development` uses PostgreSQL login `postgres`, confirmed by a real authenticated, read-only SQL transaction from inside its live container. Its account has elevated role-management and global data-reader rights. An earlier CST-DEV migration moved GPT02 native evidence table ownership to NOLOGIN `dev_gpt02_evidence_owner`, and a real direct-connection readback now verifies that neither Hub DEV nor Core DEV app login may directly INSERT, UPDATE, DELETE or SET ROLE to the dedicated GPT02 claim/nonce writer.

However, direct DML denial does **not** make `postgres` an acceptable restricted application identity. `postgres` retains broad DB privileges. It must not be treated as fully isolated from privileged SQL or evidence reads.

The API codebase has ~435 database operation invocations across multiple modules and at least `public`, `ai_platform`, `sport_center` and `fleet` schema references. A 4-table grant cannot prove safe application parity.

## Implemented DEV-only guard

- `scripts/dev/gpt02-hub-db-login-cutover-readonly.cjs`: executes a bounded `BEGIN READ ONLY` permission census **using the current actual application login**; redacts credentials; reports privilege and selected table/operation counts. It intentionally labels its list of four critical tables non-exhaustive.
- `scripts/dev/gpt02-hub-db-login-cutover-readonly.test.cjs`: 4/4 PASS. Even with fabricated all-green indicators it returns `NO_GO` until separate approval, complete permission/RLS coverage and authenticated application E2E exist.
- `.github/workflows/dev-verify.yml` now requires the safety regression.

Live snapshot: role `postgres`, 9/9 minimum operation checks allowed across four critical tables, no direct GPT02 evidence write, but `POSTGRES_APP_LOGIN_STILL_IN_USE`, `APP_DB_ROLE_HAS_ADMINISTRATIVE_PRIVILEGES`, `APP_DB_ROLE_HAS_GLOBAL_DATA_PRIVILEGES`, `APP_TENANT_RLS_NOT_VERIFIED`, `APP_AUTHENTICATED_E2E_NOT_VERIFIED`, and `CUTOVER_REQUIRES_SEPARATE_APPROVAL_AND_ROLLBACK`.

## Safe next transition boundary

Before changing `SUPABASE_DATABASE_URL_DEV` in the running DEV container:

1. Inventory **every** actual SQL/Drizzle path including writes, migrations, jobs, triggers, sequences, and cross-schema function execution, not just critical task tables.
2. Provision restricted candidate LOGIN **without** role-admin, global reader/writer, evidence owner/writer memberships or broad `PUBLIC` grants. Match its privileges to the audited app requirements.
3. Prove tenant/RLS boundaries, session auth, dashboard, task lifecycle, scheduler and webhook flows on an isolated deployment and database; assert forbidden GPT02 evidence DML and non-authorization.
4. Perform a single image/config-only DEV cutover with explicit known-good rollback after all gates pass. Keep `RUN_STARTUP_MIGRATIONS=false`; never touch PROD or command #135.

**No restricted candidate credentials or app-login cutover were created in this stage.** GPT02 issuer/worker dispatch remain OFF and both Core and Hub PRs Draft.
