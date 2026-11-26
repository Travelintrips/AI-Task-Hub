# CST-DEV GPT02 approval boundary: owner-only migration candidate

Scope: Supabase project `xssrfshdrtdfupgqwfdw` ONLY; no PROD, no Task135/136 mutation, no command/worker, no role/credential activation.

## Confirmed direct hosted readback

The existing private approval table has legacy CHECK `task_id>0 AND task_id<>135`, not `task_id>136`. It has FORCE RLS, belongs to `gpt02_store_owner`, and approvals/receipts contain zero rows. The issued preparer, issuer and attestor roles are all NOLOGIN. The shared app `postgres` is NOT superuser and its membership in private owner has `SET=false`, `INHERIT=false`. It therefore cannot safely add the new constraint as the table owner. Do not widen or rotate its permissions as an ad hoc workaround.

## Source-only candidate

`scripts/dev/gpt02-cst-dev-approval-future-task-constraint.sql` is an additive, idempotent, transaction-scoped migration that requires `session_user=postgres` **and** a deliberately authorized `current_user=gpt02_store_owner` with SET-role permission, exact database/role identity, empty approval/receipt tables, old constraint fingerprint, FORCE RLS, dormant evidence roles, and absent live issuer routines. It introduces only the validated `CHECK(task_id>136)` constraint and never removes the original constraint. Any unexpected schema, role, history, or permission state aborts with no table changes.

`scripts/dev/test-gpt02-approval-future-task-constraint-isolated.sh` tests with a disposable offline PostgreSQL16 container: wrong owner/wrong database, nonempty history, activated issuer, idempotent owner-scoped application, Task135/Task136 rejection, future synthetic Task137 acceptance, role remains NOLOGIN. This fixture **does not imply any live migration PASS**.

## Deployment gate

At this stage do not apply the migration to hosted DEV: owner privileges were deliberately revoked in a previous locked-down migration. A separate reviewed and approved owner-authorized maintenance session is required. Do not leave `SET ROLE` grants enabled or update the live Hub application DSN merely to make this check green. Independently read back `pg_constraint.convalidated`, exact expression, roles and zero operational approvals after an approved cutover. Until then `APPROVAL_SCHEMA_STILL_ACCEPTS_HISTORICAL_TASK_IDS` and managed lifecycle remain NO-GO. Task136's original native ACK is historical evidence, not new approval.


## PG17 membership-grant rollback proof (offline only)

The live CST-DEV database is PostgreSQL 17.6. Read-only grantor audit returned two grants to the shared `postgres` role for `gpt02_store_owner`: self-grant (ADMIN=false, INHERIT=false, SET=false) and independent `supabase_admin` grant (ADMIN=true, INHERIT=false, SET=false). There is currently no active owner `SET ROLE` capability.

`scripts/dev/test-gpt02-owner-grant-escrow-pg17-isolated.sh` reproduces those exact grantor arrangements using PostgreSQL 17 in a disposable Docker container with no network. It composes the earlier owner-only constraint SQL into an offline single-transaction experiment: temporarily `GRANT ... SET TRUE` only on the self grant, `SET ROLE` to the owner, run the exact original guarded constraint DDL, `RESET ROLE`, `REVOKE SET OPTION`, and check membership and effective permissions are unchanged before committing. An injected failure after the temporary grant must roll back both the grant and the DDL. Idempotence and rejection of historical Task136 are also tested.

**This is not a deployed maintenance operation or Super Admin approval**. The offline wrapper must not be copied onto hosted CST-DEV/PROD without separate review and authorization. Even if it passes, issuer/attestor/preparer roles must remain NOLOGIN, no command can be emitted, and the full managed lifecycle stays NO-GO.

## Reviewed single-transaction DEV maintenance artifact

`scripts/dev/gpt02-cst-dev-approval-owner-escrow-maintenance.sql` is now the exact SQL file executed by the PostgreSQL 17 offline role-escrow regression. It performs a strict two-grantor preflight; temporarily enables only its own `SET ROLE` edge; applies the already-tested owner-only constraint `task_id > 136`; revokes the option before `COMMIT`; and verifies both membership records retain the original values. The test uses this *identical* file for success, idempotence, and injected-failure rollback. No permanent LOGIN/EXECUTE/DML permissions, command issuance, or PROD changes are involved. This artifact can be considered for a **separately authorized CST-DEV maintenance step only after CI on its exact commit is successful**. Its existence is not evidence of hosted migration.
