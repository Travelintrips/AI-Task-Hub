> Superseded by the user decision to use existing CST-DEV. See `gpt02-existing-cst-dev-preparation-20261109.md`. No new branch or cost confirmation is required by the revised topology. Historical observations below remain audit context, not the current deployment policy.

# GPT02 hosted evidence boundary — 2026-11-09

## Confirmed live read-only finding

Supabase CST-DEV is PostgreSQL 17.6. Its general Hub application still uses `postgres`. A direct catalog query shows `postgres` has membership in `dev_gpt02_evidence_owner` and `dev_gpt02_claim_writer_nologin` with ADMIN OPTION true, INHERIT false and SET false. The inability to SET ROLE is therefore not a sufficient isolation argument: the application credential retains role-administration capability. No membership/role/privilege was changed by this investigation.

The account has the production project and CST-DEV project. CST-DEV currently has its default main branch plus an existing `test` branch reporting MIGRATIONS_FAILED. That old test branch was not reset, reused, migrated, or modified. No unrelated schema, module, task or production project was changed.

## Implemented configuration boundary

The hosted `issuerPoolConfig` now requires all three project references:

- `GPT02_EVIDENCE_DEV_PROJECT_REF`
- `GPT02_HUB_DEV_PROJECT_REF`
- `GPT02_PROD_PROJECT_REF`

These references must be valid, distinct, server-configured Supabase project references. The evidence host must exactly equal `db.<evidence-ref>.supabase.co`, the database must be `postgres`, and the direct connection port must be 5432 or omitted. The existing fixed issuer/attestor usernames, independent credentials, strict TLS validation, no startup/SSL URL options, and no fallback to the Hub DSN remain enforced. An invalid deployment target is rejected **before constructing the connection pool**.

No credentials or secret values are committed. The tests use intentionally synthetic project refs. The direct-host requirement deliberately does not enable a Supavisor pooler route; any future pooler integration must be separately checked for login/session identity and TLS/project binding rather than silently widening this allowlist.

## Verification

Seven new tests cover independent hosted target selection, denial of the Hub/PROD project even when the host and URL agree, missing/malformed project refs, localhost/pooler/lookalike hostnames, altered database/port/startup options, rejection before pool construction, and error-message credential redaction. The existing real SCRAM PostgreSQL integration suite is rerun with the modified hosted configuration test. Its local Unix-socket dependency injection is only the isolated harness, not a hosted deployment configuration.

This extends the previous signed evidence-store integration; it does not fabricate a live issuer, operator identity, nonce, task, grant, lease, or ACK.

## Actual provisioning attempt and blocker

A request to create a new **DEV child branch**, `gpt02-evidence-dev`, under CST-DEV was rejected by the connected Supabase action with an explicit cost-confirmation-ID requirement. No branch was created and no cost was confirmed. The action requires a cost quote, user agreement to that quote, and a subsequent confirmation ID before retry. Its cost lookup also requires confirmation of the organization; none has been assumed or charged by this change.

Do not retry creation with an invented confirmation ID, reuse the unrelated failed test branch, change the main CST-DEV database, create an alternative persistent database on VPS, or alter PROD to work around that requirement. A future branch inherits migrations and must be inspected for failed migrations and inherited credentials/routines before being treated as a safe evidence boundary. Branch creation alone is not security acceptance.

**Status:** hosted-target enforcement implemented; branch provisioning awaiting organization/cost authorization. Runtime PR #156, passwordless DEV dashboard, Task #135 and PROD unchanged. No real GPT02 dispatch.

## Primary technical references

- PostgreSQL 17 membership semantics: https://www.postgresql.org/docs/17/role-membership.html
- Supabase branching isolation and migrations: https://supabase.com/docs/guides/deployment/branching
