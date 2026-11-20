# Task #183 — CST-DEV hosted relock release and rollback gate

**Status: REVIEW ONLY / NO DEPLOY / NO ROLE UNLOCK / NO DELL DISPATCH.**
This document is a release checklist, not authorization. It covers only Supabase CST-DEV
`xssrfshdrtdfupgqwfdw` and the existing VPS `srv1792369`.
The original PostgreSQL relock watchdog remains enabled. Do not touch PROD.

## Exact-source evidence

- Candidate: PR #211, source SHA `bad47ba6f944a482b103af6442be9212c81b611b`.
- Migration: `scripts/dev/gpt02-task183-relock-hosted-candidate.sql`.
- The installed canonical wrapper and internal preparation functions are NOT to be replaced.
- Hosted PG17.6 read-only checks: the preparer role is NOLOGIN, connection limit 0,
  password NULL and no elevated flags; the 8 protected tables have RLS with no
  preparer direct DML/SELECT; the preparer has EXECUTE on the wrapper only;
  `gpt02_guard` and the dedicated relock role do not yet exist.
- SHA256 of hosted `pg_proc.prosrc` must equal:
  - wrapper `a759ab94ab38e0f0fcf0b42bc14dbbf30308274344a14ade666e1bae38a1c456`
  - internal `b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4`
- Independent disposable PostgreSQL 17 / `--network none` relock regression PASS:
  canary/operational separation, body-hash drift denial, privilege drift, NOLOGIN
  on termination failure, session termination, NULL password and retry.
  This is **not** proof of hosted active-session termination.

## Human / platform release gates (all required)

1. Obtain a review by a qualified *different* reviewer of the exact migration,
   `SECURITY DEFINER`, function ACL, PostgreSQL role capabilities, code SHA pins,
   partial session-termination behavior and this rollback plan. A PR comment by
   the code author or an automated test is not an independent approval.
2. Obtain explicit, scoped approval to mutate **only** CST-DEV on this exact
   source commit, including role creation. Chat continuation and generic prior
   approval do not substitute for command-specific Owner consent later.
3. Use the authorized DBA/credential custodian; do not evade managed database
   restrictions on `CREATE ROLE`. Confirm that the managed platform permits
   each DDL operation before applying the reviewed SQL.
4. Pin the matching prepared runtime and dependency attestation. All secrets
   must be managed via root-held `systemd-creds` / `LoadCredentialEncrypted`;
   never put passwords in chat, source, process arguments, HTTP requests or logs.

## Preflight before any hosted write

- Confirm `current_database()=postgres` on project `xssrfshdrtdfupgqwfdw`.
- Re-read the immutable Task #183 (`WA-2611-7669`), tenant `default`, PIC ID 5.
- Require zero Task #183 preparations, execution jobs, approved intents, scoped
  sessions and outstanding reader/writer cleanup windows before initial release.
- Require preparer NOLOGIN, connlimit 0, `rolpassword IS NULL`, no membership,
  no direct business-table DML and no unexpected function EXECUTE.
- Require the two hosted preparation function SHA256 digests above to match.
- Confirm original relock auditor timer is ACTIVE with recent SUCCESS.
- Take a schema/ACL/function/role *metadata* snapshot and independent audit
  record without reading or exporting password verifiers.
- If any check fails, **STOP**, preserve NOLOGIN, and do not start a service.

## Two-stage installation, never combined with an unlocked preparer

**Stage A — restricted relock only:** only after the separate review and explicit
CST-DEV migration approval, apply the *exact* reviewed migration transaction.
It creates `gpt02_task183_relock_login` as NOLOGIN/PASSWORD NULL/connlimit 0,
private `gpt02_guard` and an explicitly granted relock-only function.
The migration must not open preparer LOGIN or create a Task #183 preparation.
Verify immediately that PUBLIC / anon / authenticated lack function EXECUTE,
the only intended relock role has the scoped rights, and existing wrapper
owners/digests/ACL and original watchdog are unchanged. Any DDL failure is NO-GO.

**Stage B — credential / runtime custody:** separate approval from the credential
custodian to issue a *new, distinct* bounded relock identity and encrypted file.
Validate pinned DEV host, role, TLS and project; no shared DBA/application DSN.
Only when its independent relock service can prove actual hosted active-backend
termination, NOLOGIN/password NULL, zero sessions, bounded TTL and negative
tests may the explicit, temporary preparer LOGIN window be considered.

Neither successful Stage A nor Stage B permits signer execution or DELL dispatch.
The preparer must use the existing official `prepare_core_task` wrapper, with a
fresh authenticated Google Super Admin preparation-only intent; owner-signed
authorization for the exact task/command/attempt and the DELL receiver-owned
Final ACK are later, separate gates.

## Fail-closed recovery / rollback

1. Freeze any new preparer window and do not start the original one-shot,
   issuer or DELL dispatch. Preserve the main relock watchdog.
2. Close the preparer identity using the *authorized* relock path, prove
   `NOLOGIN`, `PASSWORD NULL`, connlimit 0, expired validity and **0 live
   sessions**. An incomplete termination is NO-GO and requires another audited
   cleanup tick, not a success label.
3. If a role remains active, retain the independent relock mechanism and
   escalate to the authorized DBA. **Do not drop the relock function, delete
   its credential, or disable its timer while it is still needed.**
4. Keep added relock schema/role locked and inert until separately approved
   cleanup. Never restore a password or widen EXECUTE to speed rollback.
5. Verify Task #183 job/preparation/approval counts, original wrapper digests,
   role/ACL state, watchdog status and that PROD/DELL remained unchanged.
6. Retain nonsecret evidence: exact commit/migration digest, CI run, independent
   reviewer decision, DBA authorization, timestamps, scoped audit/result, and
   rollback/no-rollback decision. No secrets or end-user identifiers in logs.

## GO / NO-GO contract

GO for **hosted relock proof** requires separate human review, authorized
Stage A/B, real active-session termination and verified cleanup. GO for
**GPT02 Task #183 E2E** additionally requires one genuine task/command-specific
Owner approval, original broker/issuer lineage, single receiver-owned DELL Final
ACK, replay denial and final relock. Without every observed item: **NO-GO**.
