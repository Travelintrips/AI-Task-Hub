# Task #171 — GPT02 DEV preparer source-binding (review candidate)

Scope: CST-DEV project xssrfshdrtdfupgqwfdw ONLY. This change does not
enable issuer, database login, signer, nonce, worker, lease or command.

## Read-only hosted findings, 14 Nov 2026

- The existing gpt02_stage.prepare_core_task(text,integer,text,text,text,text)
  function is SECURITY DEFINER, owned by gpt02_core_prep_owner.
- gpt02_core_prep_login is NOLOGIN and had 0 active sessions.
- The dedicated LOGIN can execute this outer wrapper, but NOT its restricted
  prepare_core_task_v1_internal function.
- The wrapper currently checks session, task number and fixed project/repo;
  internal checks PIC, Super Admin audit and advisory transaction lock. Neither
  checks whether p_instruction exactly matches the persisted description,
  whether status is new_inquiry, or whether the source is manual.
- Baseline wrapper pg_get_functiondef() SHA-256:
  b5cf331682d291f61a012853671cd40c1dc3068fc7e1c57f81354c755f7d47c7.
- Task #171 still has a historical bridge-command placeholder and no
  preparation/execution/binding.

## Proposed minimum hardening

scripts/dev/gpt02-preparer-instruction-bound-wrapper-candidate.sql replaces
ONLY the existing outer wrapper definition and preserves the internal atomic
Core/Hub preparation function. Checks:

1. Preserve session_user=dedicated preparer, task ID >139, and pinned DEV
   company, repo, project and branch.
2. Take the identical task advisory transaction lock before reading task.
3. Require stored task status new_inquiry, source manual, and exact stored
   description equal to p_instruction; deny bridge-command placeholders.
4. Delegate unchanged to the restricted, audit-checked internal function.
5. No role/grant/permission expansion and no issuer/worker/command operation.

## Synthetic proof

bash scripts/dev/test-gpt02-preparer-instruction-bound-wrapper-isolated.sh

The test uses a PostgreSQL 16 Docker container with --network none, cloned
source fixture, a synthetic task #171, a dedicated nonprivileged login and
the untouched internal preparer. Deny tests cover old command placeholders,
wrong instruction, non-new inquiry, nonmanual source, old Task IDs, session
impersonation and direct internal EXECUTE. A valid task produces one Core
PENDING + Hub prepared pair, zero commands, idempotent retry. Existing owner
and EXECUTE ACL are preserved on CREATE OR REPLACE.

## Hosted DEV migration gate

Do NOT apply to hosted DB until independently reviewing the exact project,
baseline function SHA, function owner/ACL, role NOLOGIN/zero sessions,
restricted internal EXECUTE, task schema, rollback and concurrent runtime
activity. Apply only as the preexisting function owner in a bounded
transaction. Verify readback and preserve NOLOGIN.

This patch alone does not enable Task #171 preparation or dispatch. Other
issuer/approval/nonce work (#172, #177) and release gating (#179) remain
separate blockers. Task #171 and PIC must be reused, not recreated.

## Guarded hosted migration package (follow-up)

- Atomic, baseline-fingerprint pinned candidate:
  scripts/dev/gpt02-preparer-wrapper-guarded-atomic-dev.sql.
- Original wrapper definition for reviewed emergency rollback:
  scripts/dev/gpt02-preparer-wrapper-baseline-rollback-dev.sql.
- Isolated full migration fixture:
  scripts/dev/test-gpt02-preparer-guarded-migration-isolated.sh.

The migration begins with the exact live SHA-256 of the old function,
exact role owner and EXECUTE ACL, the original restricted internal function,
a dedicated preparer with NOLOGIN/zero sessions/expired password, no unexpired
preparations and zero Task #171 execution/preparation. The DO preflight fails
closed on any change. It executes CREATE OR REPLACE FUNCTION once inside
a bounded transaction and verifies its new task-bound clauses, owner,
unchanged ACL, and locked account BEFORE COMMIT.

Synthetic PostgreSQL 16 proof used a dedicated existing wrapper with the
exact same ACL shape; replaced the pinned baseline hash and database name
with fixture-local values ONLY for that isolated run. An intentionally bad
fingerprint rolled back without changing the old function; the correct
migration preserved owner and ACL; repeated application was rejected; no
Core command or role activation occurred.

The reviewed migration must NEVER be run from an active generic dashboard
app session or under the dedicated preparer. If the actual hosted baseline
differs, stop rather than overwriting unexpected code. A rollback must pin
the post-migration function SHA before executing the preserved baseline.
No automatic login, database password rotation or external dispatch is
included.
