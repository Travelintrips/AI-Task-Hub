# GPT02 DEV — candidate minimum Hub/Core parent grants, offline only

## Boundary and safety

The existing CST-DEV project is `xssrfshdrtdfupgqwfdw`. Its locked function `gpt02_stage.prepare_core_task_dormant` has a verified body hash `b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4` and remains **unusable**. Its SECURITY DEFINER owner is `gpt02_core_prep_owner`, which is NOLOGIN. Its only intended caller `gpt02_core_prep_login` is also NOLOGIN and has neither `gpt02_stage` schema USAGE nor function EXECUTE. No operational `prepare_core_task` exists.

The candidate SQL `scripts/dev/gpt02-preparer-parent-grants-offline-candidate.sql` is **NOT** a deployment migration, and **MUST NOT** be submitted to Supabase or production. It expressly requires a disposable PostgreSQL superuser role `fixture_root` and a transaction-scoped `gpt02.offline_grant_fixture=yes` marker. This guard makes the file unsuitable as a hosted migration; a separate reviewed and independently approved migration must be written for any future real change.

## What is being tested

The candidate would, in a synthetic isolated PostgreSQL fixture only, grant table `SELECT` on exactly eight previously audited parent tables to the **NOLOGIN function owner**, and `INSERT` on exactly two (`public.ai_execution_jobs` and `ai_platform.ai_coding_tasks`). It grants schema USAGE to the owner for `ai_platform` and `extensions`. It does **not** grant table UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, does not grant any table DML to the login role, does not grant function EXECUTE or a role membership, and does not enable LOGIN, an operational function, worker dispatch, attestor, nonce or issuer.

The hosted CST-DEV catalog was independently inspected **read-only** before authoring this candidate. All eight parent relations are owned by `postgres`, all eight have RLS enabled, all eight currently deny parent SELECT/INSERT to `gpt02_core_prep_owner`. The `ai_platform` and `extensions` schemas are currently not USABLE by the owner. Existing ten `gpt02_preparer_%` policies apply only to the NOLOGIN owner and are not changed by this candidate.

The synthetic fixture deliberately installs ten denial-only RLS policies. It does NOT claim to reproduce the hosted policy semantics; the existing separate exact RLS integration fixture exercises the checked-in RLS source. This candidate test proves the *role privilege* separation and transactional rollback. A future operational proof must combine exact hosted RLS policy semantics with separately authenticated login, verified permissions, and actual (one-only) new Hub/Core task preparation.

## Test cases and activation decision

`scripts/dev/test-gpt02-dormant-preparer-function-pg17.sh` is extended to exercise the candidate **after** its existing dormant-function owner/ACL/rollback checks. Each disposable Docker PostgreSQL container uses `--network none`. The new checks require:
- an injected post-GRANT failure rolls back ALL relation and schema privileges;
- a candidate without the fixture-only marker refuses before modifying privileges;
- disabling RLS on one parent refuses; no residual GRANT;
- an existing synthetic approval refuses; no residual GRANT;
- owner privileges after a successful synthetic transaction are exactly eight SELECT and two INSERT, zero UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER;
- the login role remains NOLOGIN, has no direct parent DML, no stage USAGE or dormant function EXECUTE, and the two historical task IDs are not touched;
- core_preparations, approvals, receipts, Hub/Core tasks stay empty;
- reapplying a candidate refuses rather than silently changing the authorization state.

The test passed locally on disposable PostgreSQL **16**. GitHub CI runs the same shell file with its default `postgres:17-alpine` image, which must pass on the exact new commit before claiming a PG17 result. No real CST-DEV grants, login, credential, new task, command or PROD change were made during this preparation.

**Decision: offline minimum-privilege candidate only. Full GPT02 managed lifecycle is NO-GO.** Keep PR #156 draft, Task #135 failed/non-replayed and Task #136 completed historical ACK unchanged. The next distinct gate is live-compatible preparer caller authentication and the separately reviewed minimal grant migration with independent owner/read-back proof, before separately signed Super Admin admission and one authorized new task.
