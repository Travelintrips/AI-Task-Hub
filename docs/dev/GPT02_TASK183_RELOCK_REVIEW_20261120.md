# GPT02 Task #183 — independent relock review package (CST-DEV only)

**SOURCE-ONLY / DRAFT / DO NOT DEPLOY OR APPLY TO HOSTED POSTGRESQL.** This packages previously tested source-only relock code; it does **not** authorize preparation, signer activity, approval, DELL dispatch or production changes.

## Evidence checked on 20 Nov 2026

- The existing `gpt02_core_prep_login` database role is `NOLOGIN`, connection limit 0, password verifier NULL, expired, with no privileged role flags.
- The official preparer DSN is already stored as a host-encrypted `systemd-creds` item (`gpt02-task183-preparer-dsn`). A local offline check decrypted it and verified the expected CST-DEV custom role, Supavisor session port 5432, and pinned Supabase CA **without printing the DSN or password**.
- The hosted database has `gpt02_stage.prepare_core_task` (wrapper, callable by preparer) and `gpt02_stage.prepare_core_task_v1_internal` (owner-only), with distinct validated body digests. There is no need to recreate the function.
- The Task #183 dedicated relock SQL function `gpt02_guard.relock_task183_preparer` and the `gpt02_task183_relock_login` role **do not exist** in CST-DEV.
- The corresponding encrypted relock credential **does not exist**; the dedicated relock timer is disabled, and the source-only service references an uninstalled `/opt/ai-task-gpt02-preparer/current` path.
- The regular OC-to-Hub scoped Task #183 reader is already LIVE in a separate DEV canary, with GET authorized and unauthorized writes rejected. This is **not** preparation authorization.

- The candidate branch now adds the existing QA-tested `corePreparationPoolConfigFromFiles` file-custody helper and source-only `gpt02-core-preparer.service` with credential isolation. **No operational factory cutover or live service activation** is performed. Synthetic custody / fail-closed tests PASS **8/8** (combined **36/36** with existing preparation and relock units). The operational factory now requires file custody when `GPT02_CORE_PREPARATION_ENABLED=true`; attempts to fall back to an inline/general Hub DSN are rejected before a DB pool is constructed. The separate relock-identity and operational-window review gates remain.

## Verification performed, no hosted database mutation

- `node --test scripts/dev/gpt02-task183-relock-once.test.mjs`: **14/14 PASS**, including the bounded operational readback and rejection of malformed dual windows.
- `bash scripts/dev/test-gpt02-task183-relock-isolated.sh`: **PASS** using local `postgres:16-alpine` with `--network none`; verified bounded canary **and** bounded operational wrapper-only windows, immediate relock on direct DML, unexpected role membership, private function EXECUTE or wrapper owner drift; plus idempotent relock, session termination, password clearing, crash/failure behavior and no retained authorization.
- Existing dedicated preparer auth read-only proof and post-test relock historically **PASS 10 Nov 2026** ([Issue #157](https://github.com/Travelintrips/AI-Task-Hub/issues/157)). **Do not repeat the old proof as if it had never passed.**
- Current Task #183 has 0 execution jobs and 0 preparations; Owner-signed per-task preparation and Final ACK are **not present**.

## Gates before independent activation

1. Independent security/Owner review of the full hosted relock migration, including immutable function ACL and residual-session failure handling.
2. Provision a **distinct** `gpt02_task183_relock_login` credential in the already-approved managed custody system. Do not share admin/bridge credentials or print any secret.
3. Validate PostgreSQL role/function ownership, schema access and SQL-scoped permissions in CST-DEV; demonstrate *actual* independent watchdog readback using pinned TLS and no retries on auth failure.
4. **Review the now-tested canary-vs-operational separation before activation.** The source-only relock candidate recognizes (a) a bounded authentication-only canary with no wrapper EXECUTE, and (b) a bounded preparation-only window with exactly the official wrapper EXECUTE, never the internal implementation or direct table DML. Both require **connection limit 1**, TTL at most 3 minutes, no role memberships, no CREATE, no private approval/issuer function EXECUTE, intact RLS business-table surface, trusted SECURITY DEFINER ownership, and at most one active backend. A drift or expired TTL triggers immediate NOLOGIN/password clearing. This is **test evidence**, not authority to activate either state in CST-DEV.
5. The **preparation-only** HTTP route requires a fresh verified Google Super Admin session and explicit same-origin intent; it does **not** require a per-command Ed25519 signature before creating the PENDING/prepared reservation. A **separate** Owner-signed, task-bound approval and Hub/Core/nonce checks are required **before execution/dispatch**. A chat message such as “lanjut” is not that signature.
6. Only after approved DEV-only E2E tests with rollback and no duplicate dispatch may any broader activation be considered; PROD remains untouched.

Do not merge/deploy this review package as an operational unlock. Link with [Issue #208](https://github.com/Travelintrips/AI-Task-Hub/issues/208).

## Operational review note (20 Nov 2026)

This candidate does not create a signed approval, operator session, DB role login, password, or timer activation. PostgreSQL 17 hosted metadata confirms the existing preparer role has **only wrapper EXECUTE**, cannot execute the internal function, has no role memberships, no DB CREATE, no direct business-table DML, and no access to private approval/issuer functions. Candidate preserves at most one short-lived authenticated preparation backend; it never authorizes a command. Review release gating and the genuine owner-operated preparation route before enabling any database credential.
