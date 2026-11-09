# AI Task Hub DEV — restricted DB login prerequisite audit (2026-11-09)

Scope: CST-DEV only. Read-only inspection from the active `ai-task-development` API container and source of AI Task Hub PR #155. **No database LOGIN, RLS policy, GRANT, credential or deployment was changed.** No Task #135 action.

## Reproducible static source inventory

`node scripts/dev/gpt02-hub-db-static-access-inventory.cjs --summary` uses the Drizzle schema definitions and backend code to emit a conservative inventory:

- 44 schema source files, 171 API source files and 99 `pgTable` export definitions scanned.
- 93 distinct referenced `public.*` table candidates; 33 raw schema-qualified SQL identifiers requiring manual classification.
- Additional CST-DEV catalog inspection resolved the 33 raw schema identifiers into **25 existing relations** and **8 non-relation identifiers**. The eight non-relations are `fleet.document`, `fleet.driver`, `fleet.fuel`, `fleet.maintenance`, `fleet.tire`, `fleet.unit`, `fleet.utilization`, and `sport_center.payment_status`. Some may refer to types or code symbols; they must not be granted as tables. Existing relations include cross-schema `ai_platform` and `sport_center` objects requiring separate operation-level privilege analysis. Merely seeing a raw identifier does not imply it is accessed at runtime.
- 230 `select`, 166 `insert`, 101 `update`, 23 `delete`, 156 `execute`, 5 `transaction` source-pattern occurrences. These counts are **regex indicators**, not distinct runtime operations or proven coverage.
- Dynamic SQL, routines, triggers, attached sequences, tenant/RLS behavior and authenticated end-to-end remain **not verified** by source parsing; script always reports `NO_GO`.

## Live CST-DEV catalog readback

A real SQL `BEGIN READ ONLY` transaction using the active Hub DEV database connection queried `to_regclass`, table privilege, RLS/policies and attached sequence metadata for all 93 candidate tables:

| Metric | Actual result |
| --- | ---: |
| Candidate referenced tables | 93 |
| Tables found in CST-DEV | 93 |
| Current login can SELECT | 93 |
| Tables with RLS enabled | 93 |
| Tables with RLS forced | 0 |
| Tables with any PostgreSQL policy | **2** |
| Linked sequences | 90 |
| Owner of all 93 tables | `postgres` |

**Critical risk:** a restricted new application login will be subject to row-level security and owner/role differences, whereas the current Hub app uses `postgres`. Even supplying all required table and sequence GRANTs does not establish correct read/write business behavior; most candidate tables have no RLS policy. Do not solve this by blindly granting `BYPASSRLS`, `CREATEROLE`, global reader or writer privileges.

The separate live cutover preflight returns `NO_GO`: `POSTGRES_APP_LOGIN_STILL_IN_USE`, `APP_DB_ROLE_HAS_ADMINISTRATIVE_PRIVILEGES`, `APP_DB_ROLE_HAS_GLOBAL_DATA_PRIVILEGES`, `APP_TENANT_RLS_NOT_VERIFIED`, `APP_AUTHENTICATED_E2E_NOT_VERIFIED` and rollback/approval required. Direct INSERT/UPDATE/DELETE/SET ROLE to GPT02 native binding/nonce evidence is already blocked for both Core DEV and Hub DEV; **the broad DB role is nevertheless not a trusted isolation boundary**.

## Required deployment gates

1. Classify the 33 raw SQL identifiers and map dynamic queries, SQL functions, triggers, audit trails, service integrations, 90 attached sequences and all mutating operations to database privileges.
2. Design explicit tenant-specific RLS policies on a disposable database, or isolate duties into tightly scoped API roles. Never silently disable RLS or grant `BYPASSRLS`.
3. Create an ephemeral candidate login that cannot assume evidence owner/writer roles, has no elevated privileges or global read/write access; prove select/insert/update/delete under realistic tenant context.
4. Execute authenticated API and browser E2E against the isolated database, including task lifecycle, audit/PIC, dashboard, scheduler, webhooks, WhatsApp paths, and rollback. Ensure original and new login reach equivalent authorized outcomes, with cross-tenant isolation tests.
5. After CI and these tests pass, perform a single **DEV-only** Compose cutover with preflight image/config diff and automatic rollback. Keep `RUN_STARTUP_MIGRATIONS=false` and preserve PROD.

**Decision: NO-GO for login cutover and native GPT02 issuer/dispatch/resume/final ACK.** RLS discovery is a significant blocker and must not be bypassed to manufacture PASS.
