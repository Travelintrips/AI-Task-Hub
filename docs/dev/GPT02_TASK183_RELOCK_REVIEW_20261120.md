# GPT02 Task #183 — independent relock review package (CST-DEV only)

**SOURCE-ONLY / DRAFT / DO NOT DEPLOY OR APPLY TO HOSTED POSTGRESQL.** This packages previously tested source-only relock code; it does **not** authorize preparation, signer activity, approval, DELL dispatch or production changes.

## Evidence checked on 20 Nov 2026

- The existing `gpt02_core_prep_login` database role is `NOLOGIN`, connection limit 0, password verifier NULL, expired, with no privileged role flags.
- The official preparer DSN is already stored as a host-encrypted `systemd-creds` item (`gpt02-task183-preparer-dsn`). A local offline check decrypted it and verified the expected CST-DEV custom role, Supavisor session port 5432, and pinned Supabase CA **without printing the DSN or password**.
- The hosted database has `gpt02_stage.prepare_core_task` (wrapper, callable by preparer) and `gpt02_stage.prepare_core_task_v1_internal` (owner-only), with distinct validated body digests. There is no need to recreate the function.
- The Task #183 dedicated relock SQL function `gpt02_guard.relock_task183_preparer` and the `gpt02_task183_relock_login` role **do not exist** in CST-DEV.
- The corresponding encrypted relock credential **does not exist**; the dedicated relock timer is disabled, and the source-only service references an uninstalled `/opt/ai-task-gpt02-preparer/current` path.
- The regular OC-to-Hub scoped Task #183 reader is already LIVE in a separate DEV canary, with GET authorized and unauthorized writes rejected. This is **not** preparation authorization.

- The custody-only service candidate references `corePreparationPoolConfigFromFiles`, available in the isolated QA bundle but **not exported by the current AI Task Hub develop library**; do not deploy this unit without a compatible, reviewed library and its tests.

## Verification performed, no hosted database mutation

- `node --test scripts/dev/gpt02-task183-relock-once.test.mjs`: **12/12 PASS**.
- `bash scripts/dev/test-gpt02-task183-relock-isolated.sh`: **PASS** using local `postgres:16-alpine` with `--network none`; verified idempotent relock, session termination, password clearing, crash/failure behavior and no retained authorization.
- Existing dedicated preparer auth read-only proof and post-test relock historically **PASS 10 Nov 2026** ([Issue #157](https://github.com/Travelintrips/AI-Task-Hub/issues/157)). **Do not repeat the old proof as if it had never passed.**
- Current Task #183 has 0 execution jobs and 0 preparations; Owner-signed per-task preparation and Final ACK are **not present**.

## Gates before independent activation

1. Independent security/Owner review of the full hosted relock migration, including immutable function ACL and residual-session failure handling.
2. Provision a **distinct** `gpt02_task183_relock_login` credential in the already-approved managed custody system. Do not share admin/bridge credentials or print any secret.
3. Validate PostgreSQL role/function ownership, schema access and SQL-scoped permissions in CST-DEV; demonstrate *actual* independent watchdog readback using pinned TLS and no retries on auth failure.
4. **Resolve the canary-vs-operational scope explicitly**. This candidate permits a bounded authentication-only canary only when the preparer cannot EXECUTE `gpt02_stage.prepare_core_task`, while the hosted operational wrapper currently grants EXECUTE to the preparer role. Do not activate a timer and assume it will preserve a legitimate preparation session; review separate bounded states and fail-closed transitions first.
5. One fresh, real Google Super Admin/Owner approval must be bound cryptographically to exactly Task #183, its Hub/Core identities and nonce. A chat message such as “lanjut” is not that signature.
6. Only after approved DEV-only E2E tests with rollback and no duplicate dispatch may any broader activation be considered; PROD remains untouched.

Do not merge/deploy this review package as an operational unlock. Link with [Issue #208](https://github.com/Travelintrips/AI-Task-Hub/issues/208).
