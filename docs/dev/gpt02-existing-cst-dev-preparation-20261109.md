# Existing CST-DEV selected; inactive evidence foundation applied

## User decision and corrected topology

The user explicitly chose the existing CST-DEV project rather than a new branch or paid project. This supersedes the separate-project requirement introduced in commit 8d6f64e. That requirement was our proposed isolation design, not a mandatory Supabase platform requirement.

Target: existing CST-DEV, `xssrfshdrtdfupgqwfdw`. No create-branch, create-project or cost-confirmation action was called in this change. No cost was approved. No changes were made to production project `nzdweipzckfszczzqtuw`.

`hostedEvidenceTarget` now requires the evidence and Hub DEV project references to match, rejects PROD, and rejects an unapproved separate project/branch. The fixed dedicated role usernames, exact direct host/database/port, mandatory certificate verification, no DSN options and no fallback to the general Hub pool remain enforced. Same project is an allowed topology, NOT a statement that administrative isolation is already solved.

## Applied, bounded LIVE CST-DEV preparation

Supabase migration `20261109130156_gpt02_cst_dev_inactive_evidence_foundation` succeeded on CST-DEV after the same logical DDL passed isolated PostgreSQL checks. Reproducible source: `scripts/dev/gpt02-cst-dev-evidence-preparation.sql`. This file is an audited DDL source, not an automatic runtime migration; an operator must select and verify the exact DEV project before submitting it.

Created only:
- Private schema `gpt02_private`.
- Empty `gpt02_private.approvals` and `gpt02_private.receipts` tables, with ENABLE/FORCE RLS, policies restricted to their NOLOGIN owner, and append-only triggers.
- Three inactive roles: `gpt02_store_owner`, `dev_gpt02_attestor_evidence`, `dev_gpt02_issuer_evidence`. All NOLOGIN, zero connection limit, no password, NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB and NOREPLICATION.
- One SECURITY INVOKER trigger helper, `reject_mutation`, with a fixed search_path and no PUBLIC execution.

No record/consume/issue function was installed. The issuer and attestor have no schema USAGE, no direct table rights and no membership in another role. The owner construction SET/INHERIT capability for postgres was removed before commit. The existing Hub `postgres` credential retains administrative capability/ADMIN OPTION; this risk is explicit and NOT considered solved by the new schema.

## Actual readback

A separate read-only query confirmed both table row counts are zero, both tables are owned by `gpt02_store_owner` and FORCE RLS is enabled. All three candidate roles are NOLOGIN with connection limit zero. `anon`, `authenticated`, `service_role`, issuer and attestor cannot use the new schema or insert into either table. `postgres_can_set_owner=false`, but `postgres_owner_admin_option=true`.

The project's security advisor was run after DDL. It still reports pre-existing project-wide RLS/policy, search_path, public function and auth configuration notices. No notice for the newly created gpt02_private objects was present in the returned result. This is NOT a clean bill of health for the shared project, and unrelated modules were not changed to suppress notices.

## Tests and operational boundary

Eight hosted-target tests cover reuse of the existing DEV project, PROD denial, unapproved branch denial, malformed configuration, wrong roles/host/port/TLS options and redaction. The inactive foundation test verifies seven schema/role/empty-table/denial conditions in a disposable no-network PostgreSQL container. Existing SCRAM/signature/atomic-receipt integration and regression tests are rerun; live evidence tables are not used for synthetic test transactions.

No application image, runtime environment, connection string, passwordless dashboard login, existing task or command was changed. No Task #135 retry or real native GPT02 dispatch was performed. The issuer-store client remains unmounted by the HTTP routes. Creating inactive candidate roles does not enable them.

## Activation and rollback

Continue within this same CST-DEV project. Before activation, establish restricted application/issuer credentials, review all callable routines and administrative escalation paths, keep the signing key outside the database, prove real Super Admin consent, then validate nonce/receipt readback and Core/DELL grant/lease/ACK gates. Do not treat approval rows or advisory booleans as executable authority.

The safe operational rollback is to leave the empty schema and roles inactive: no live application references them. Removing the new objects is a separate reviewed cleanup, allowed only after proving the tables remain empty and no new dependencies exist. Do not use CASCADE or change existing role grants to other schemas.

**Current result:** existing CST-DEV selected and inactive foundation applied/read back. No branch cost authorization is needed. Issuer login activation, approval issuance and native E2E are still NO_GO.
