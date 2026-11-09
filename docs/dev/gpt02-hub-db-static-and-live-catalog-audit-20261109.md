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

## Expanded live RLS scope and executable preflight — 2026-11-09

A separate **BEGIN READ ONLY** catalog query from the live Hub DEV container examined **all 828 public tables** (not just the 93 source candidates). **825** have RLS enabled; **776** RLS-enabled tables have no policy; **49** tables have at least one policy. These totals describe the wider shared CST-DEV schema and should not be mistaken for 776 required AI Task Hub migrations.

The four minimum Hub candidate tables in the existing login-cutover preflight are all RLS-enabled with **zero policies** in the current live snapshot:

- `public.ai_tasks`
- `public.ai_execution_jobs`
- `public.team_members`
- `public.audit_logs`

The preflight now reports a read-only `requiredRlsReadback` with exact missing-policy table identifiers and adds `APP_REQUIRED_TABLE_RLS_POLICIES_MISSING` when evidence is absent. It **does not** claim that the presence of policies proves correct tenant semantics, and it never authorizes DB cutover, issuer or native worker dispatch. The new source is not yet deployed to the active Hub DEV image; its unit checks are part of the PR's required DEV Verify workflow.

**Implementation boundary:** first define and independently test tenant predicate semantics for these task/PIC/audit tables on an isolated database, alongside privilege and cross-tenant negative tests. Do not roll out blanket policies over all 828 tables; do not grant `BYPASSRLS`, adopt evidence-owner roles, or switch Hub DEV credentials until authenticated full-module parity and rollback are demonstrated.

## Four-table RLS isolated prototype — 2026-11-09

A disposable, **network-disconnected PostgreSQL 16** instance tested `scripts/dev/gpt02-hub-rls-isolated-prototype.sql` with a no-login non-BYPASSRLS role. Observed four expected outcomes (`NO_CONTEXT|t`, `TENANT_A|t`, `CROSS_TENANT_UNSEEN|t`, `TENANT_B|t`), test exit 0. These checks are now reproducible through `scripts/dev/test-gpt02-hub-rls-isolated-postgres.sh`, wired to the DEV CI workflow.

The proposed SQL is deliberately **not** a live migration and uses small synthetic tables within `gpt02_rls_test`. It does not edit or copy CST-DEV data. `audit_logs.company_id` is nullable in the real schema: null-company audit rows are excluded rather than shared across tenants.

**Crucial trust limitation:** PostgreSQL's custom setting `app.company_id` can be set by a connected SQL-capable app role. These RLS policies alone cannot prevent a compromised or injection-vulnerable application connection from impersonating another tenant by changing the setting. Before deploying any policy to live DEV, implement a defensible trusted-tenant context (including session transaction boundaries and injection resistance), independently validate privileges against the actual login, and test API/browser functional parity. The isolated smoke test is policy-behavior evidence only, **not sufficient tenant-security or login-cutover proof**.

## Actual Hub API tenant trust/read behavior — 2026-11-09

Source inspection at PR HEAD confirms two incompatible assumptions requiring a design decision before active DEV RLS migration:

1. `artifacts/api-server/src/middleware/auth.ts` defines `getCompanyId(req)`. Its Super Admin read mode **intentionally returns null** when the request does not provide `?companyId`, allowing the existing `GET /ai-tasks` route in `routes/ai-tasks.ts` to show **all companies**. The proposed strict `company_id = app.company_id` policy would break this documented behavior without a separately authorized, audited cross-company reporting path.
2. `artifacts/api-server/src/middleware/permissions.ts` contains a distinct `extractAuth` path reading `x-user-role`, `x-company-id` and other headers. This source fact alone does not establish exploitability; its trust/proxy boundaries and usage must be audited before headers can be used for DB RLS context. Such headers must never be assumed equivalent to validated JWT session identity.

The isolated regression on commit `9f925e9` deliberately demonstrates `GUC_SPOOFABLE`: the SQL-capable test role can reassign `app.company_id` and read another tenant's rows. **This is an expected vulnerability demonstration and a live-deployment blocker**, not evidence that tenant isolation is secure.

To close: define trusted authenticated tenant context and an audited Super Admin all-company read plan; bind requests to DB transactions with proper role/privilege separation; deny role/header spoofing; prove cross-company and company-scoped paths plus legacy null-company audit handling in authenticated API and browser E2E. No existing `postgres` login or RLS policy is modified by this analysis.

## Required deployment gates

1. Classify the 33 raw SQL identifiers and map dynamic queries, SQL functions, triggers, audit trails, service integrations, 90 attached sequences and all mutating operations to database privileges.
2. Design explicit tenant-specific RLS policies on a disposable database, or isolate duties into tightly scoped API roles. Never silently disable RLS or grant `BYPASSRLS`.
3. Create an ephemeral candidate login that cannot assume evidence owner/writer roles, has no elevated privileges or global read/write access; prove select/insert/update/delete under realistic tenant context.
4. Execute authenticated API and browser E2E against the isolated database, including task lifecycle, audit/PIC, dashboard, scheduler, webhooks, WhatsApp paths, and rollback. Ensure original and new login reach equivalent authorized outcomes, with cross-tenant isolation tests.
5. After CI and these tests pass, perform a single **DEV-only** Compose cutover with preflight image/config diff and automatic rollback. Keep `RUN_STARTUP_MIGRATIONS=false` and preserve PROD.

**Decision: NO-GO for login cutover and native GPT02 issuer/dispatch/resume/final ACK.** RLS discovery is a significant blocker and must not be bypassed to manufacture PASS.
