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

## Explicit human evidence review acknowledgment, not command approval

The signed-in Super Admin can review the independent evidence hash and explicitly click an acknowledgment bound to the live SHA-256. A separate, append-only local review evidence_acknowledgements table stores only REVIEWED_ONLY_NO_AUTHORIZATION, reviewer identity, request ID, hash and time. Replay of the exact acknowledgment is idempotent. Foreign actor, wrong evidence hash, new command, new binding, unlocked preparer, and attempts to edit or delete the acknowledgment are rejected. A review acknowledgment is not Owner Ed25519 signature or a persisted issuer approval, and never consumes a nonce or allows an attempt, command, issuer grant or dispatch. The UI explicitly explains this before accepting the click.

No acknowledgment is created automatically. The user has to click the confirmation button in Task183 with an actual Google-signed Super Admin session. The existing signed owner issuer mechanism has not yet been connected to this new recovery domain. The original Task183 reservation remains expired and NO-GO.

## One-click Super Admin recovery intent (not issuer authorization)

The original Task183 review has a genuine signed Google Super Admin request and an immutable human hash-bound READ acknowledgment. A separate one-click recovery consent path now requires the existing live Google Super Admin JWT, matching immutable Task183 Core/Hub/attempt evidence, an explicit confirmation, and a freshly generated 48-character nonce that expires in five minutes. The nonce is stored hashed in an independent root-owned SQLite queue, consumed transactionally by the same authenticated actor and same evidence SHA-256. Wrong actor, altered evidence, old nonce, replay, expired challenge or preexisting command/binding is denied.

The only possible final record is SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER. The record deliberately has signedOwnerApproval=false, issuerAuthority=false, issuerNonceConsumed=false, attemptIssued=false and dispatchPermitted=false. This is **not** an Ed25519 signer approval, does not modify Supabase, does not create a new attempt and cannot launch a worker. It is one authentic human authorization *intent*, awaiting independent issuer and signed Owner approval requirements.

The UI uses one genuine Super Admin click and explicit confirm to request and atomically consume its single-use nonce. No automatic click or fake Owner response. The old prepared record is preserved and NO_GO_RESERVATION_EXPIRED remains active until independent issuer testing and approval.

## Independent issuer admission: current NO-GO proven

Task #183 signed Google Super Admin intent exists and its five-minute challenge nonce was locally consumed exactly once during validity. This is not an independent issuer signature or lease. The original Core/Hub reservation remains the only one and issuer/attestor/preparer database roles remain NOLOGIN.

The scoped scripts/dev/task183-recovery-issuer-preflight.py checks the root-owned append-only review, hash-bound read acknowledgment, Super Admin consent, consumed nonce, and original Hub/Core/attempt via an independent PostgreSQL READ ONLY reader. Issuer, attestor and preparer role lock states are also checked. Synthetic fixture tests cover missing ACK, missing consent, missing nonce consumption, altered Core, leaked preparer role, duplicate jobs and unapproved command/binding, all fail closed.

Real live result: NO_GO_INDEPENDENT_SIGNED_OWNER_APPROVAL_MISSING. Google Super Admin intent is not command-bound signed Owner approval, has no issuer authority, does not unlock a role and cannot replay or create an attempt. This preflight writes no database rows, creates no services and is not an operational issuer. A separately authorized versioned issuer is required before any possible second attempt.

## Offline versioned attempt 2 issuance transaction

The new SQL candidate and shell QA script operate only on a disposable PostgreSQL 16 database named task183_attempt2_isolated, in Docker without network or published ports. They are NOT a deployed Supabase migration. Separate fixture verifier and issuer roles are scoped: neither the application nor the issuer may insert a signed approval receipt, and the issuer cannot write Core/Hub tables directly.

A synthetic independently verified receipt is used to test an atomic issuer transaction. Missing or expired receipt, incorrect task/company, old attempt, or evidence hash are rejected. Two concurrent issuer calls create exactly one attempt 2 Core task (PENDING) and Hub job (prepared), with versioned idempotency keys and no worker/command/dispatch. Receipt consumption occurs in the same transaction. Attempts to replay or modify the immutable issued record are rejected. The original attempt remains untouched.

CRITICAL: the synthetic receipt is NOT a genuine cryptographic approval. Operational integration must independently validate the real approval signer signature and persist the actual Super Admin approval before inserting any such receipt; a fixture verified_by string is not proof. CST-DEV continues NO-GO, the issuer remains NOLOGIN, and no real attempt 2 was created.

## Isolated cryptographic receipt-to-issuer integration (2026-11-21)

The independent, pure verifier gpt02-task183-recovery-issuer-approval-verifier.mjs implements a NEW Ed25519 domain, GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1, intentionally separate from Issue159 and the previous read-only review signature. The canonical claims bind the exact CST-DEV default-tenant Task183, original request, SHA-256 evidence, Core/Hub/attempt IDs, independent trusted Owner subject, distinct attempt 2, fresh nonce, five-minute expiry and PREPARE_ATTEMPT2_ONLY. Only independently supplied pinned public SPKI trust and authoritative readback can validate a signature. The verifier NEVER mints a signature, writes a receipt, consumes a nonce or authorizes an issuer/dispatch.

The synthetic-only fixture gpt02-task183-recovery-issuer-approval.fixture.mjs generates ephemeral TEST keys, signs the test claims, validates them through the pure verifier and passes only a digest plus public fingerprint into the no-network PostgreSQL fixture. The isolated receipt INSERT is therefore preceded by a genuine cryptographic verification of test-only key material, and the transaction continues to prove exactly one Core/Hub pair under concurrent issuer calls. The test suite rejects modified claims, signer roots, nonce reuse, alternate domain, cross-company, wrong Owner, expired signatures and forged signatures. This closes the previous test gap in which an arbitrary synthetically claimed receipt was accepted without cryptographic verification.

**NOT operational:** The existing VPS four-role signer has NOT implemented this new domain, and no genuine Owner signature, independent trusted Owner identity mapping, persisted approval decision or issuer nonce-consumption lease for Task183 exists. Fixture keys are not CST private keys. Under no circumstances is the fixture output usable as production or CST-DEV approval authority. Real issuer/attestor/preparer login remains disabled, original booking-like preparation records remain unchanged, and Task183 stays NO-GO.

## Existing operational signer: surgical recovery-domain patch (candidate, not installed)

The existing operational signer source at /opt/ai-coding-standalone-dev/gpt02_issue159_operational_signer.py was inspected **without changing it**. The service is currently inactive; the independent verifier remains active. The new scripts/dev/task183-patch-existing-operational-signer-candidate.py applies narrowly to its source layout: it retains the existing legacy approval/hub/core/issuer routes and adds a separate /sign-recovery-approval route accessible only to the existing approval signer role. There is no second signer, KMS, new key or new container. This is a source patch **candidate**, not a deployed operational service change.

The added method only signs the distinct GPT02_TASK183_RECOVERY_ISSUER_APPROVAL_V1 canonical bytes after an independently persisted, signed Owner decision is returned by a root-owned Unix-socket reader. The source of trust is NOT the local Super Admin human review, recovery intent or Issue159 approval. A client-supplied approval field cannot satisfy it. The patch now reuses the existing restricted Unix socket /run/gpt02-approval-reader/approval.sock rather than creating a new service. Its Task183-specific /verify-owner-recovery-approval endpoint is **not yet implemented**: a live read-only probe returned HTTP 404. Therefore a recovery signing request still fails closed. The independent Task183 decision verification handler must be implemented and approved before deploying this patch. No certificate, signer key or live signature was accessed during this change.

The CI candidate test uses a minimal source-structure fixture, a synthetic ephemeral Ed25519 key and a synthetic Unix-domain readback; it verifies rejection of missing root-owned approval reader, forged/foreign domains, mismatched request fields, wrong signer roles and unverified independent Owner decision. The positive synthetic signature is verified by its corresponding synthetic public key, but even that returns releaseDecision NO_GO, issuerAuthorizationGranted false and dispatchPermitted false. A separate local smoke against the exact actual VPS signer source confirms the patch applies and compiles, with the live file unchanged.

The remaining operational blocker is not a code-generation feature: the independent trusted decision reader and an explicit genuine Owner approval for Task183's exact recovery attempt have not been issued. No automatic reuse of Issue159 authorization or mutation of the old reservation is allowed. Maintain NO_GO until those facts can be verified.

### Socket custody compatibility
The candidate independent recovery approval readback uses the same ownership model as the already-working Issue159 approval reader: root-owned Unix socket and parent directory, signer supplementary-group GID, 0750 parent and 0660 socket, plus SO_PEERCRED verification of root UID. A 0700 root-only socket would be inaccessible to the DynamicUser signer, and is explicitly disallowed. The CI runner reproduces this custody in an ephemeral root test session; the live signer remains inactive and unchanged.

## Independent Owner recovery decision reader candidate (2026-11-21)

The new standalone `task183-owner-recovery-decision-reader.py` supplies a strictly read-only, fail-closed candidate for an additional route in the **existing** approval-reader service. The existing service is deliberately not modified or restarted because its Issue159 checks are already operational. The candidate uses the same root-owned `tasks.db`, requiring a uniquely matched Task183 decision joined to a separate immutable decision outbox in the same SQLite read-only snapshot. It verifies the exact request ID and evidence SHA-256, role and enabled state of the registered Super Admin, Owner subject/operator-link match, explicit `APPROVE_RECOVERY_ATTEMPT2_ONLY`, five-minute expiry and exact claim nonce. The local Super Admin recovery-intent SQLite queue is NOT a substitute for this separate decision/outbox.

**Critical:** a matching explicit persisted Super Admin decision returns `ok=true` only for decision provenance, with `signatureVerified=false`, `issuerAuthorizationGranted=false` and `dispatchPermitted=false`. The approval signer is the component responsible for creating the detached Ed25519 signature only after trusted readback of that specific decision; requiring a signature before signing would be a circular dependency. This reader cannot grant issuer authority or dispatch. Missing schema on live `tasks.db` is denied; there are zero Issue159 approval/outbox records for Task183. This candidate is tested only against ephemeral synthetic SQLite (15 fail-closed checks) and has not been deployed to the existing reader. It creates no approvals, commands, attempts, roles or dispatch.

Before any operational rollout, an authorized Owner must be able to explicitly approve the exact canonical recovery claims through an authenticated interface, with an immutable outbox and separately verifiable cryptographic signature. Only after integration testing of that entire trust chain should the existing approval-reader route and signer patch be considered for activation. No reuse of the old command-bound Issue159 approval and no implicit approval from earlier review clicks.

## Explicit Owner recovery decision and outbox — synthetic transaction QA

The new `task183-owner-recovery-decision-writer.fixture.py` is forcibly restricted to a disposable `/tmp/task183-owner-writer-fixture-*/task183-owner-approval-fixture.sqlite` file. It cannot create tables or write records to the real `/opt/ai-coding-standalone-dev/tasks.db` or CST-DEV Supabase. Its synthetic Super Admin must have a verified Google-session provenance marker, fresh auth time, and exactly one enabled Hub operator-to-Supabase Auth identity link. It requires an explicit fixture-only user approval flag; neither earlier `REVIEWED_ONLY_NO_AUTHORIZATION` nor `SUPERADMIN_RECOVERY_INTENT_PENDING_INDEPENDENT_ISSUER` can be automatically promoted into `APPROVE_RECOVERY_ATTEMPT2_ONLY`.

In isolated QA, the decision and matching immutable outbox are inserted atomically; duplicate approval, wrong actor, invalid evidence, stale session or missing explicit action is rejected. The read-only independent decision reader can cross-check the outbox and identity. For a matching synthetic persisted decision it returns `ok=true` (provenance only), `signatureVerified=false` and `issuerAuthorizationGranted=false`; only the separately credentialed signer can later produce the Ed25519 signature. A positive decision-reader result is not a signature or dispatch permission. These fixture tests DO NOT represent an operational approval writer, signed Owner decision or a live endpoint. The full signed approval action and detached cryptographic verification must be separately designed, audited, and tested before changing the existing live signer/reader; no new user approval is requested until that entire flow can be safely completed.

## Existing signed Super Admin identity binding (read-only)

The root-owned task183-owner-identity-readiness.py now verifies that the already-issued AI Task Center signed Google Super Admin session matches exactly one enabled Supabase Auth identity, the existing enabled GPT02 Hub operator link, and the currently active root-owned approval SQLite admin role. No new account, role, OTP flow, duplicate review or login method is created. The existing broker exposes only a scoped GET Task183 owner-identity-readiness status after verification of its signed HS256 DEV session. It does not permit approval, issuer release, signing, nonce creation or dispatch. Missing/expired session, wrong company, operator, Google subject, email, disabled identity or duplicate links fail closed.

The Task183 UI displays this read-only matching status next to the previously recorded Super Admin recovery intent; its only consequence is proof of identity continuity, not a valid signed Owner decision. The independent cryptographic Owner approval and functional issuer remain NO-GO.

### Authenticated decision precedes cryptographic signing, never the reverse

The candidate's trust stages are now explicitly separated: (1) independent root-owned decision reader verifies a fresh, one-time, signed Google Super Admin decision and its matching immutable outbox; (2) the existing detached approval signer signs the dedicated Task183 recovery-domain canonical claims; (3) the separate issuer verifier validates the Ed25519 signature against pinned approval public roots, original lineage, nonce and actual hosted database approval; (4) atomic attempt2 preparation may occur, with dispatch still OFF. The read-only decision stage returns `ok=true` and `signatureVerified=false` only when the persisted decision/outbox really matches; it never claims a pre-existing signature. The signer stage requires that exact decision readback with signatureVerified=false, then returns the new signature but never issuer authority. This avoids an impossible circular pre-signature requirement without weakening the requirement for real explicit Owner/Super Admin approval. All these changes remain candidate-only; the live approval reader/signer have not been modified and the real decision schema/approval have not been installed or issued.

## Dormant DEV approval schema only — no approval issuance

The bounded root-only migration script `task183-install-dormant-owner-approval-schema.py` prepares the existing root-owned 0600 approval SQLite database for Task183 by adding two empty, immutable, uniquely keyed Task183 recovery decision and outbox tables. It never adds or authorizes a decision, creates no OTP session, signer, nonce, command, issuer lease, new Core/Hub attempt or dispatch. It does not modify any existing Issue159 table, record or index. The operational path requires an exact pinned DEV DB, a secure root-owned backup directory, an SQLite online backup before the DDL, empty new tables and a single explicit root `--install-dev`. The test covers idempotence, preservation of legacy Issue159 rows, immutable triggers, nonempty reinstallation denial, and fail-closed path/mode errors.

These tables are required preparatory storage but are NOT sufficient to approve Task183. The existing approval-reader and operational signer are still unchanged and the recovery-approval HTTP flow is NOT installed. An independent real Owner decision, signing, issuer verification and live versioned attempt remain NO-GO.

## Existing approval-reader new Task183 route — minimal scoped patch

The new candidate `task183-patch-existing-approval-reader-candidate.py` adds one POST `/verify-owner-recovery-approval` to the established root-owned approval-reader Unix socket and retains both Issue159 `/approval-intent` and `/owner-outbox-intent`. The new route uses the already tested `task183-owner-recovery-decision-reader.py` in read-only mode, trusts only the root-owned source, verifies exact Task183 canonical lookup, fresh server observation clock, independent Owner decision provenance, exact request/evidence hash, `signatureVerified=false`, issuerAuthorizationGranted=false and dispatchPermitted=false. If the decision/outbox has not been explicitly persisted it returns `404/NO_GO` and no signing is possible; a matching persisted decision may return `200` for provenance only, not an Ed25519 signature.

The 14/14 local synthetic Unix-socket tests confirm missing/invalid Owner record and request payloads are rejected and both previously PASS Issue159 routes remain reachable without any modifications. The candidate is not an approval authoring endpoint, does not connect to worker dispatch or a new signer, and creates no approval. The live signer must remain off. This is a small compatibility improvement to the existing reader, not a rebuild.

## Actual DEV-only decision writer with explicit signed user action (source prepared, not enabled)

`scripts/dev/task183-owner-approval-writer-dev.py` now carries a pinned root-owned DEV tasks.db writer function, without any public HTTP route or automatic trigger. The only possible write is one atomic Task183 `APPROVE_RECOVERY_ATTEMPT2_ONLY` decision and exact immutable outbox. It requires an explicitly authenticated Super Admin action, signed Google-session actor, unique active Owner/Hub mapping, same original Core/Hub/attempt lineage, fresh signed recovery intent, live independently recomputed SHA-256, and exact Task183 / company / attempt 2. No approval from an old acknowledgement or unconsumed review intent is inferred. Unknown DB path/custody, duplicate approval and replay fail closed. Source code for real mode rechecks authoritative review queue and root-owned approval DB before writing. Its isolated fixture test verifies denial, preservation, atomicity, immutable outbox, and that the decision is not a cryptographic Owner signature.

DO NOT expose the action to the user until the existing signer can atomically consume the fresh approval decision and prove its signed output before the two-minute expiry. The issuer is still separately blocked and must not be activated by this decision. No real Task183 approval row, Ed25519 signature, issuer lease, attempt 2, or dispatch has been created.

## Full synthetic decision-reader-signer-verifier E2E and one-shot replay fence

The new isolated `task183-signed-owner-to-verifier-e2e.test.py` now exercises the complete candidate trust chain in a single test: genuine explicit synthetic Super Admin approval → atomic decision/outbox in ephemeral SQLite → existing approval-reader's exact Task183 Unix socket HTTP route → surgically patched existing approval signer with an ephemeral Ed25519 test-only private key → independent JavaScript Ed25519 signature verifier using the matching ephemeral pinned public key and original Core/Hub/attempt fact binding. The verified signature returns `issuerAuthorized=false`, `attemptIssued=false` and `dispatchPermitted=false`. No CST private keys, live signer service, active approval DB, Supabase, PROD, or worker is accessed by this E2E test. The CI test is run with root privileges in the disposable CI runner only to reproduce the production Unix-socket ownership and signer group custody.

The isolated `task183-one-shot-signature-envelope.fixture.py` models a prospective durable signing proof envelope. Its test sends four concurrent calls and proves exactly one signer callback, one immutable envelope, replay returns the original signature without signing again, changed request/hash is denied, and no issuer or dispatch flag can be upgraded. Operational execution is explicitly prohibited by the fixture-only guard; this contract alone is not a deployed signer supervisor. An operational one-shot write-ahead envelope and crash/restart/replay recovery must still be integrated before requesting a real Owner approval, otherwise the time-limited approval could be wasted or signed twice.

The full synthetic chain is proven but NOT live E2E. A real authenticated Owner approval still has not been given; activation of issuer, new attempt #2, worker and PROD remains prohibited.
