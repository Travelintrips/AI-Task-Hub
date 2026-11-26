# GPT02 DEV: dual-origin Hub/Core operator identity evidence

## Concrete integration problem

A read-only inspection of the running DEV database confirmed that Hub `public.users.id` is TEXT, whereas Core `ai_platform.internal_users.id` and the existing Core binding/nonce `operator_user_id` are INTEGER. Existing Core claim constraints also require `recorded_by = 'internal:' || operator_user_id`. The Hub team-member/PIC ID is a separate INTEGER. Neither casting a Google-prefixed Hub ID nor substituting the PIC ID proves the Core operator identity.

This change keeps all three namespaces separate. It does not modify the existing Core schema or guess an account mapping from an email, name, numeric suffix, or matching integer.

## Candidate implementation

`gpt02-operator-link.mjs` verifies a canonical, command-bound pairing transcript with **two independently pinned Ed25519 public keys**, one for Hub and one for Core. Each origin signs a different domain prefix over the same transcript, so a Hub signature cannot substitute for a Core signature. No private key or signing operation exists in the runtime module; request-supplied keys and shared origin keys are rejected.

The transcript binds the exact Hub TEXT account ID, Core INTEGER account ID, allowed role/active assertions, Core password-change-complete assertion, tenant, Hub task and execution IDs, Core task and command IDs, attempt and sequence, separate PIC ID, accountable owner, worker ID, the signed approval digest and nonce, and a maximum two-minute window. The Core numeric ID must be independently attested, not derived from the Hub ID. Legacy Task135 and its known command/execution are forbidden. Only the current `default` tenant and first new attempt are supported by this candidate.

The existing v2 approval envelope is retained. `recordLinkedApproval` and `consumeLinkedApproval` require both a valid original approval and a matching dual-origin proof. The old evidence-only consume method cannot consume a linked approval. Existing signatures are not upgraded or backfilled.

## Transaction boundary actually tested

The disposable PostgreSQL fixture adds private `operator_links` and `core_identity_receipts`. These are **evidence-store sidecar records, not the live Core ledger**. Both tables have FORCE RLS, a NOLOGIN/non-BYPASSRLS owner, revoked PUBLIC privileges, and append-only triggers. Attestor and issuer log in independently through SCRAM, have no direct table access and can only call their own narrow routines.

Recording an approval and its identity link is one transaction. Consuming the approval and inserting its Core-compatible identity receipt is one transaction. A link collision rolls back the approval; a receipt insertion failure rolls back consumption. Link and approval expiration are checked using the database clock after waiting for the approval row lock. The receipt retains the Hub TEXT ID separately and produces Core `operator_user_id` / `internal:<id>` from the signed Core assertion. It does not mark an operational binding as verified or issue a worker grant.

The linked result explicitly reports `coreLedgerWritten=false`, `authorizationGranted=false`, `dispatchPermitted=false`; all equivalent database authority flags remain constrained to false. No HTTP route imports these clients. This work is preparation, not a newly enabled admission path.

## Isolated validation

The existing issuer runner now loads both disposable fixtures and exercises **46 behavioral scenarios** (47 Node tests including the parent). The original 26 issuer cases remain. Twenty additional scenarios cover missing/forged/swapped origin signatures, same-key rejection, exact approval/identity/namespace binding, inactive accounts and incomplete password changes, legacy task rejection, role and type substitution, raw SQL denial, actual TEXT/INTEGER persistence, uniqueness rollback, legacy-consume bypass denial, eight concurrent consumes yielding one linked receipt, replay/re-signing denial, historical evidence not being silently linked, injected identity-write rollback, expiry after lock wait, immutability, privilege drift, and exact schema-version/type drift.

The initial run exposed tests expecting an immutability-trigger error for plain TRUNCATE after new foreign keys were added. PostgreSQL correctly rejected the operation earlier through its FK guard. Tests now independently verify both plain TRUNCATE rejection and cascading TRUNCATE rejection by the append-only triggers; neither protection was removed.

Tests run on disposable PostgreSQL 16 and Node 24 containers with `--network none`, a private temporary Unix socket and fresh fixture-only passwords. No live secrets or actual account IDs are supplied. Containers/volumes/credentials are removed on exit.

## Existing CST-DEV preparation and remaining work

During this work, parallel PR155 advanced from `8d6f64e` to `4a6408c` and selected the existing CST-DEV private-schema preparation. The final candidate preserves that latest target guard: existing nominated DEV only, never PROD or an unapproved new project. It also preserves the locked NOLOGIN foundation test. No new project, billing action, hosted credential, hosted migration or role activation was performed by this work. Sharing a project is not proof that the privileged Hub account is isolated from the evidence owner; that administrative boundary remains a blocker.

Origin signers are still unimplemented/unproven for real sessions: they must independently re-read active roles, require fresh authentication and explicit pairing/command consent, and keep keys outside the unrestricted Hub process. The SQL routines rely on the dedicated attestor client to verify Ed25519; they do not themselves validate cryptographic signatures. A compromised trusted attestor/issuer service or DB administrator is outside the assurance proven here. Post-issuance revocation propagation is not proven by a short-lived signature alone.

No writes to hosted Hub/Core binding tables, no native DELL action, no real task creation, no live role/DSN/environment change and no PROD change were made. The existing unrestricted Hub login and inactive hosted issuer/attestor accounts are not fixed by this test. The parallel inactive foundation has BIGINT approver storage, unlike the v2 TEXT contract; it must not be activated against the v2 client without a reviewed schema transition. The candidate now checks exact evidence-column types before any write and rejects such schema drift. Real signer endpoints, isolated hosted deployment, verified Core ledger import, grant/lease/fencing and a new native final-ACK-to-Hub completion test remain required.

References reviewed: PostgreSQL 16 row-security policies and explicit locking documentation; Supabase changelog on 2026-11-09 (no CLI or hosted migration performed).
