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

## Dedicated database identity proof — 2026-11-09

An additional **network-isolated** PostgreSQL 16 prototype in `scripts/dev/gpt02-hub-identity-rls-isolated.sql` now exercises three distinct, non-BYPASSRLS SQL identities: tenant A, tenant B and a read-only cross-company Super Admin role. Seven identity/boundary assertions passed on VPS, including a deliberately forged `app.company_id=tenant_b` while connected as the tenant A SQL identity; unlike the earlier GUC-only policy, this did **not** expose tenant B rows. The Super Admin reader observed both companies and legacy NULL-company audit rows and had no INSERT permission. The shared isolated CI test requires all seven assertions alongside the original four and the expected negative demonstration of GUC spoofability.

This is an **offline behavior prototype, not an operational role-routing design or live migration**. Its test harness uses privileged `SET SESSION AUTHORIZATION` to simulate distinct identities; the Hub application must never possess such a capability. Before deployment, independently authenticate the web session, bind each authorized request to a database credential whose role cannot be switched to another tenant, preserve session-pool isolation, and design properly audited cross-company reads plus safe writes. Do not grant a generic Hub login membership in tenant/admin roles or treat forged header claims as auth. Multi-tenant provisioning, API/browser regression, actual DB login privilege inventory and full-table policy coverage remain incomplete. Native GPT02 is still NO-GO.

## Verified principal tenant admission contract — 2026-11-09

A new pure, fail-closed `scripts/dev/gpt02-verified-tenant-scope.cjs` candidate accepts only a caller-asserted **server-verified** principal with numeric user ID, role and bounded company ID. It rejects tenant switching for regular staff and requires explicit Super Admin intent for cross-company reads. It **never supplies a database credential role, grants permission, starts GPT02, or dispatches a worker**. Five adversarial/positive tests passed locally; the mandatory DEV CI now includes them.

**Critical integration gap:** this helper is NOT wired to the operational AI Task routes or the database pool. Merely passing a JavaScript object to it is not identity verification. Production-safe behavior requires live session/JWT validation against current account revocation and membership, server-side tenant resolution, safe role/connection routing and cross-company audit. The existing `permissions.ts` HTTP-header extraction is not assumed trusted, and no elevated DB credential can be chosen by client-supplied data.

## Operator-authorized NEW GPT02 DEV test preparation — 2026-11-09

The operator authorized **preparation of exactly one NEW DEV task with Super Admin as approver**, explicitly conditioned on completing security gates before any native dispatch. This conversational preparation consent **does not constitute** a logged-in Super Admin session, a signed reviewer approval, an issuer capability, or permission to retry forensic Task #135.

New fail-closed `scripts/dev/gpt02-new-test-admission-readonly.cjs` and unit test implement a non-mutating gate checklist. It requires: DEV scope, verified Super Admin session and cryptographic approval, new task ID distinct from 135, a same-company active PIC with durable audit, nonprivileged Hub login and authenticated tenant/RLS E2E, immutable claim/nonce, independently provisioned issuer, lease/fencing, trusted attestor, and tested rollback. The script always returns NO_GO and **never** creates tasks, issues commands, changes PROD, or authorizes dispatch even if all check flags are fabricated. Only native independent proof and a separate operational implementation may eventually release an explicitly authorized new attempt.

Live read-only inventory in Hub DEV confirmed application SQL role is still privileged `postgres`. The `public.users` catalog contained Super Admin role rows and `public.team_members` had active default-company member rows; these are not proof of an authenticated Super Admin principal, a particular PIC appointment, or signed admission. No new task identifier, cryptographic operator signature, immutable native command or final ACK has been created. The existing 7/18 acceptance census for forensic Task #135 is **not** the outcome for a new test.

**Decision:** preparatory implementation allowed; creation/admission/dispatch remain fail closed. Database DEV/PROD and Task #135 unchanged.

## Active DEV passwordless administrator-login exposure — 2026-11-09

A **read-only** configuration check of container `ai-task-development` returned `NODE_ENV=development`, `DEV_PASSWORDLESS_LOGIN=true`, expected DEV base URL, and `SESSION_SECRET` present (no secrets read or displayed). In the original `artifacts/api-server/src/routes/auth.ts`, the email-only passwordless branch applied to all roles including `super_admin`. Because that code could mint a JWT without proof of the operator's identity, a privileged JWT alone is **not sufficient evidence of an accountable Super Admin approval**. Any such token already issued remains subject to its original lifetime until a separate revocation mechanism is applied.

PR #155 now changes the **source only**: passwordless login is explicitly disallowed in production and privileged DEV roles (`super_admin`, `company_admin`, `owner`, `supervisor`) must supply a valid password even when legacy DEV passwordless mode is enabled. The low-privilege historical mode remains unchanged to minimize unrelated behavior changes. Four regression tests check the privileged branch and JWT signing order. **No code deployment or live configuration change has yet occurred**, so the active runtime exposure remains until a verified DEV rollout and reauthentication plan.

Gate implications: do not mark a JWT-derived Super Admin session as an independent cryptographic approval until fresh trusted reauthentication, account-current-active verification, replay-safe audit, signer ownership, and legacy token invalidation/revocation have been proven. Password reauthentication by itself is not the required Ed25519 operator attestation. Avoid enabling dispatch or creating the new test task on the strength of chat consent or a potentially passwordless JWT. Hub DB app role is still privileged `postgres`.

## 2026-11-09 revised user-approved policy: passwordless DEV dashboard + separate GPT02 identity gate

**The user clarified and reaffirmed DEV dashboard logins are intentionally passwordless, including Super Admin.** Do not break this working workflow. The previous admin-password requirement described above is superseded and has been reverted in PR #155: `/auth/login` retains the configured `DEV_PASSWORDLESS_LOGIN=true` behavior, with production excluded by the DEV flag and base URL guard. Dashboard JWTs, especially email-only issued JWTs, remain **insufficient for GPT02 command approval**.

A separate, DEV-only `POST /auth/gpt02/operator-identity-preflight` now requires an existing JWT Super Admin session **plus a separately supplied Google OAuth access token**, verified through `supabase.auth.getUser`. It checks the Google account has confirmed email and Google provider, and that the matching Hub database account is active, has the Super Admin role, and matches the JWT ID/email/company. It is a **non-mutating identity readiness check**: `operatorApprovalRecorded=false`, `issuerPermitted=false`, `dispatchPermitted=false`. The endpoint does not store the OAuth token, sign approvals, create a task, or modify the DB. A valid Google session alone is not proof of command-specific fresh consent. Signed nonce-bound approval, replay protection, auditable persistence and issuer isolation are still required.

Source-level tests for dashboard compatibility and separate identity readiness must pass before staging. No endpoint deployment has occurred; live DEV retains its existing passwordless behavior. This does not cure the privileged Hub PostgreSQL `postgres` login, grant/lease gaps or native ACK gap. **NO_GO** until those independent gates have operational proof.

## Required deployment gates

1. Classify the 33 raw SQL identifiers and map dynamic queries, SQL functions, triggers, audit trails, service integrations, 90 attached sequences and all mutating operations to database privileges.
2. Design explicit tenant-specific RLS policies on a disposable database, or isolate duties into tightly scoped API roles. Never silently disable RLS or grant `BYPASSRLS`.
3. Create an ephemeral candidate login that cannot assume evidence owner/writer roles, has no elevated privileges or global read/write access; prove select/insert/update/delete under realistic tenant context.
4. Execute authenticated API and browser E2E against the isolated database, including task lifecycle, audit/PIC, dashboard, scheduler, webhooks, WhatsApp paths, and rollback. Ensure original and new login reach equivalent authorized outcomes, with cross-tenant isolation tests.
5. After CI and these tests pass, perform a single **DEV-only** Compose cutover with preflight image/config diff and automatic rollback. Keep `RUN_STARTUP_MIGRATIONS=false` and preserve PROD.

**Decision: NO-GO for login cutover and native GPT02 issuer/dispatch/resume/final ACK.** RLS discovery is a significant blocker and must not be bypassed to manufacture PASS.
