# GPT02 DEV — SCRAM-authenticated dedicated preparer identity, isolated only

## Purpose and exact boundary

This is a **source/CI security test only**. It does not activate `gpt02_core_prep_login` on hosted CST-DEV, issue a credential, alter any production or DEV application connection string, call the real dormant preparer function, or dispatch a DELL command. The staged real function remains `gpt02_stage.prepare_core_task_dormant`, owned by `gpt02_core_prep_owner` and with no EXECUTE for the application or preparer login. The operational `prepare_core_task` function remains absent.

The independent 2026-11-10 CST-DEV audit already found four candidate owner/preparer/issuer/attestor roles NOLOGIN, ten dedicated owner-only RLS policies and no preparer parent DML. Earlier integration tests demonstrated Hub/Core atomic reservation and RLS using an isolated local socket role, but **did not demonstrate a separate authenticated TCP session with a real password verifier**. This fixture isolates that missing proof.

## New test and safe settings

`scripts/dev/test-gpt02-preparer-scram-auth-isolated.sh` runs the official `postgres:17-alpine` image in CI with Docker `--network none` and no published port. A `postgres:16-alpine` local test mode is also supported. The ephemeral synthetic `fixture_root` superuser and both test-only passwords exist **only in the disposable container**. The role named `gpt02_core_prep_login` initially has NOLOGIN, NOINHERIT, no superuser/CREATEROLE/BYPASSRLS, connection limit zero, no password and expired validity.

The fixture tests **SCRAM-SHA-256** with the database's host TCP password authentication, first denying the inactive role, then enabling it **only in the synthetic PostgreSQL container**. It verifies that an incorrect password is rejected, a correct password yields `current_user=session_user=gpt02_core_prep_login`, and the account cannot create objects, assume the superuser, perform any direct DML on Hub/Core/staging or execute the private dormant function. The function in this test is an inert sentinel with matching signature, **not the live function body**. No Core task, Hub execution, Core command or preparation is inserted. Finally, the fixture restores NOLOGIN, connection limit zero, NULL password and expired validity, and proves a new login attempt is denied.

The existing function-specific PostgreSQL 17 test continues to verify the **exact actual dormant body** and owner grants. The separate atomic preparation test continues to verify the actual conditional RLS policy source. Combining all three gives stronger safety evidence, but it is **not** an end-to-end hosted Supabase authentication, real operator consent or worker dispatch proof.

## Gate outcomes and next prerequisites

Expected machine evidence: `GPT02_PREPARER_SCRAM_SEPARATE_LOGIN_OFFLINE_PASS_NO_FUNCTION_OR_COMMAND`; every failed-login, wrong-password, prohibited-role-switch, direct-privilege and function-execution negative check must behave as expected. CI runs it inside the existing `Verify idempotent Core coding task preparation without command dispatch` step, without changing production workflows or removing existing checks.

Before hosted activation, a separately authorized change must demonstrate:
1. an externally verified **exact CST-DEV project** and certified/pinned Supabase database endpoint (never PROD);
2. a genuine dedicated SCRAM credential stored in a secret manager and issued independently from shared Hub `postgres` login, with rotation and rollback;
3. a separately reviewed *hosted-compatible* minimum owner parent GRANT change, without widening any login's direct table DML;
4. a real dedicated session identity and effective permission read-back under the existing RLS policies, with forbidden role switch, no arbitrary task/command access and no unknown default privileges;
5. signed independent Super Admin / Core operator approval, consumed nonce and leased one-shot issuer authorization before exactly one new (>136) DEV task and one native ACK.

**Operational release remains NO-GO; PR stays draft.** No historical Task #135/#136 replay, no new command, no PROD change. This fixture's disposable `ALTER ROLE LOGIN` must never be run on hosted CST-DEV.
