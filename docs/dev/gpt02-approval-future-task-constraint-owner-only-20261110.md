# CST-DEV GPT02 approval boundary: owner-only migration candidate

Scope: Supabase project `xssrfshdrtdfupgqwfdw` ONLY; no PROD, no Task135/136 mutation, no command/worker, no role/credential activation.

## Confirmed direct hosted readback

The existing private approval table has legacy CHECK `task_id>0 AND task_id<>135`, not `task_id>136`. It has FORCE RLS, belongs to `gpt02_store_owner`, and approvals/receipts contain zero rows. The issued preparer, issuer and attestor roles are all NOLOGIN. The shared app `postgres` is NOT superuser and its membership in private owner has `SET=false`, `INHERIT=false`. It therefore cannot safely add the new constraint as the table owner. Do not widen or rotate its permissions as an ad hoc workaround.

## Source-only candidate

`scripts/dev/gpt02-cst-dev-approval-future-task-constraint.sql` is an additive, idempotent, transaction-scoped migration that requires `session_user=postgres` **and** a deliberately authorized `current_user=gpt02_store_owner` with SET-role permission, exact database/role identity, empty approval/receipt tables, old constraint fingerprint, FORCE RLS, dormant evidence roles, and absent live issuer routines. It introduces only the validated `CHECK(task_id>136)` constraint and never removes the original constraint. Any unexpected schema, role, history, or permission state aborts with no table changes.

`scripts/dev/test-gpt02-approval-future-task-constraint-isolated.sh` tests with a disposable offline PostgreSQL16 container: wrong owner/wrong database, nonempty history, activated issuer, idempotent owner-scoped application, Task135/Task136 rejection, future synthetic Task137 acceptance, role remains NOLOGIN. This fixture **does not imply any live migration PASS**.

## Deployment gate

At this stage do not apply the migration to hosted DEV: owner privileges were deliberately revoked in a previous locked-down migration. A separate reviewed and approved owner-authorized maintenance session is required. Do not leave `SET ROLE` grants enabled or update the live Hub application DSN merely to make this check green. Independently read back `pg_constraint.convalidated`, exact expression, roles and zero operational approvals after an approved cutover. Until then `APPROVAL_SCHEMA_STILL_ACCEPTS_HISTORICAL_TASK_IDS` and managed lifecycle remain NO-GO. Task136's original native ACK is historical evidence, not new approval.
