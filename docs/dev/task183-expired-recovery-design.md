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

## Isolated Owner signature review gate (not deployed)

The standalone verifier `scripts/dev/gpt02-task183-recovery-signature-gate.mjs` only verifies a synthetic-compatible Ed25519 review signature with domain-separated bytes. It requires an **independently trusted, pinned Ed25519 public key fingerprint**, exact original Task/Core/Hub/attempt identifiers, an authoritative Owner identity mapping, a narrowly scoped review-only purpose, current bounded expiry and an original reservation already expired. It rejects alternate tenants, Task IDs, reused attempts, foreign Owners, tampered signatures, invalid key types and wrong signers. Every result, including a valid synthetic signature, explicitly sets `approvalGranted=false`, `dispatchPermitted=false`, `canIssueAttempt=false`. No private key, database, HTTP or signing capability exists in the module.

The test suite creates **synthetic, ephemeral Ed25519 keys** only inside the fixture and does not connect to CST-DEV. The verifier is not connected to the VPS signer custody or any user-session approval endpoint. Verification is not nonce consumption and is **not permission for a versioned attempt**, issuer lease, worker or command. Operational integration needs trusted public-key custody, genuine Owner action, transactionally consumed nonce, separate issuer authority and the complete E2E review.

## One-click request for independent Owner review (CST-DEV)

A **request for review** endpoint is added to the existing localhost Task183 broker, distinct from the signer/issuer. The signed Super Admin Google JWT and exact same-origin POST of {"requestReview":true}, with intent recovery-review-only, are required.

Before accepting the request, the service reads the genuine Task183 Core/Hub/attempt and expiry from CST-DEV PostgreSQL using a READ ONLY transaction, checks the old reservation has expired, exactly one Core and Hub exist, no command or binding exists, and the preparer is locked with zero sessions. The request then enters a root-owned, append-only local review queue, using a unique original-attempt key. Replaying the same request returns the existing request ID without creating a duplicate. Other task/company/actor scopes and forged sessions are denied.

The queue's only state is PENDING_INDEPENDENT_OWNER_REVIEW. ApprovalGranted, issuer grant and dispatch always remain false; its records are not an approved command and are deliberately not part of any issuer's trust store. An Owner must independently sign a separate versioned recovery authorization before a new attempt is possible. No Google KMS, new signer, new container, Supabase migration, production change, or worker dispatch is introduced.

The Task183 UI shows a button "Ajukan review pemulihan (tanpa eksekusi)" only after the real read-only status reports NO_GO_RESERVATION_EXPIRED. The user must explicitly click and confirm the request. No automatic submission, approval or execution occurs. A pending request disables further submissions. The current review request is not an E2E PASS.
## Read-only Owner review evidence packet

After the signed-in Super Admin request is recorded, an independently read-only evidence packet is returned under the exact Task183 authenticated endpoint. The packet links the canonical request ID, original Core Task, Hub job, original attempt, command candidate, request timestamp, expiry and SHA-256 checksum. The VPS service rechecks the saved request against fresh READ ONLY CST-DEV PostgreSQL facts on every retrieval. A foreign operator, modified original ID, newly issued bridge command, active preparer, or evidence mismatch is denied.

This packet is intentionally not signed by Owner; all fields ownerApprovalGranted, signedApprovalReceived, nonceConsumed, issuerGrant, commandIssued, dispatchPermitted, and attemptIssued are false. No action to approve, update the request, issue command or dispatch is exposed by the evidence endpoint. The existing Task183 UI renders the read-only evidence under the pending review request for the signed-in Super Admin requester. Other accounts are denied. Original Task183, reservation expiry, role custody and PROD remain unchanged.
