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
