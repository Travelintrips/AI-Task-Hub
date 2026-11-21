# Task #183 expired preparation: versioned recovery candidate

Scope: CST-DEV only, Supabase project xssrfshdrtdfupgqwfdw, Task #183.
No modification of PROD, no renewal of the old reservation, no worker or signer action.

## Evidence and actual root cause

The genuine Super Admin preparation on 21 Nov 2026 produced one Core Task (PENDING), one Hub execution (prepared) and one append-only gpt02_stage.core_preparations row. It expired at 2026-11-21T11:25:28.870Z. The preparer was relocked: NOLOGIN, NULL password, connection limit zero, zero sessions.

No official command matching the candidate, valid command-bound approval, or immutable attempt binding has been observed. The post-preparation release gate returns NO_GO_RESERVATION_EXPIRED.

The existing preparation key is (company_id,hub_task_id) with a UNIQUE index. Its trigger blocks UPDATE, DELETE and TRUNCATE. Hub execution also has unique idempotency_key and (source,external_id). The existing function prepare_core_task is deliberately idempotent and refuses to replace an expired reservation; it also does not issue an actual command.

Therefore repeat clicks, manual expiry edits, general bridge-command submission and Issue159 approval reuse are invalid recovery shortcuts.

## Non-operational, isolated design candidate

- scripts/dev/gpt02-expired-reservation-v2-candidate.sql is hard-guarded to run only in a disposable database named gpt02_recovery_isolated. It is NOT a deployable Supabase migration.
- Versioned recovery_review_candidates_v2 rows point to original Core/Hub/attempt evidence. A version-specific external ID and idempotency key are mandatory; original identifiers may not be reused.
- An exclusion constraint blocks overlapping attempt windows; a trigger rejects a live original reservation, mismatched original evidence, wrong task and identity collision.
- Rows are append-only, with status awaiting_independent_owner_review, owner approval always false, command issuance always NULL and dispatch always false. No app/authenticated role has CRUD privileges or RLS grants.
- The fixture tests use a synthetic PostgreSQL 16 container with no network or published port.

This candidate issues NO Core Task, Hub Job, command, approval or lease. It is solely a security-reviewable recovery data contract.

## Gates required before operational recovery

1. Independent review of a versioned attempt lifecycle with immutable linkage to the original failed/expired attempt.
2. Genuine signed Super Admin/Owner recovery authorization bound to the exact attempt, nonce, expiry and replay protection.
3. Separate least-privilege issuer transaction that atomically prepares a distinct versioned Core Task and Hub job only after that authorization. Do not use the general bridge command endpoint that publishes ACK/wake events as a shortcut.
4. Official command creation and attempt binding, owner command approval, issuer lease/fence, optional dispatch, receiver ACK and replay denial, all fully verified in DEV before any PROD change.

Release status: NO-GO. A synthetic recovery review is not a successful operational recovery.
