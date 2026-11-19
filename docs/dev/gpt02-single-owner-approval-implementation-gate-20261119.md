# GPT02 DEV — single Owner/Super Admin approval: implementation gate

Status: **DESIGN/NO-GO**, not a live approval, operational authorization or dispatch permission. Reviewed against AI Task Hub PR #196 `a576ba82a0c3d555498de2ecdc3d22da4e45ecae` and PR #207.

## Current state (source-backed)
- The existing task detail panel deliberately renders **Persetujuan operator (belum diaktifkan)** with `disabled={true}`, and a read-only evaluation of PIC, immutable attempt, Core command, approval and issuer evidence.
- `GET /api/auth/gpt02/operator-session-readiness` verifies only a recent Google-proven **signed application session**. This response **never** records command-bound consent, signs a message, grants issuer lease or dispatches work.
- `Gpt02IssuerStore.recordLinkedApproval` already exists in `artifacts/api-server/src/lib/gpt02-issuer-store.mjs`, verifies exact Ed25519 approval and Hub/Core-signed link with fixed trusted public keys, and requires a **dedicated attestor database session**. `consumeLinkedApproval` requires a **separate dedicated issuer session** and returns a non-authorizing one-time receipt.
- No application route invoking `recordLinkedApproval()` was found in the inspected `artifacts/api-server/src/routes` checkout; the only relevant non-test invocation of `consumeLinkedApproval` was through `gpt02-prepared-nonce-consumer.mjs`.
- `gpt02-four-signer-contract.mjs` defines independent approval, Hub, Core and issuer signing domains; it generates **canonical bytes only**, not signatures or leases.
- Task #171 has an **expired immutable preparation**: no reset/replay/re-prepare, no retroactive signing. At the audited time CST-DEV had no preparation or approval for a Hub Task ID greater than 171.

## Single-human-approval acceptance path
1. The Owner/Super Admin authenticates using the **existing** Google-based DEV login, without additional password, TOTP or self-entered signing secrets. Validate a fresh identity/session on the server, not a client-supplied role or browser booleans.
2. After a **new independently authorized synthetic DEV Hub task** has a valid immutable preparation, show a read-only summary of exact company, task, attempt, Core task, Hub job, command candidate, PIC, worker ID and expiry. Reject historical Task #171 and missing/expired/mismatched bindings.
3. A single explicit Owner/Super Admin approval gesture is allowed **only for that exact displayed tuple**. No second human approval. A signer with separately controlled private-key custody creates the canonical domain-separated Ed25519 **approval** signature; do not put keys in UI, database columns, request payloads or logs.
4. Independently verify Hub and Core identity signatures and bind the command, nonce, worker and expiry using existing `canonicalOperatorLink` and `operatorLinkSigningBytes`; never trust a caller-supplied green flag or signer key. Feed the resulting immutable evidence to existing `recordLinkedApproval` using only the attestor login.
5. An independently authenticated issuer verifies original evidence, exact immutable preparation and fresh facts; `consumeLinkedApproval` claims nonce atomically, rejecting duplicates, post-lock expiry, cross-tenant claims, wrong role and replay. Existing nonce receipt and non-dispatch fence **do not** confer lease/dispatch rights by themselves.
6. A distinct, reviewed issuer lease/worker dispatch authority must be established through its **existing approved gate**, with a single worker identity `openclaw-dell-chatgpt-wake-dev`, and never inferred from presence heartbeat, public key readiness, a Google session, a stored receipt, or a response boolean.
7. An independently verified canonical AI Core `COMPLETED` source and native DELL worker callback are required before receiver-owned ACK is persisted. Preserve audit, rollback and no-duplicate semantics; treat a mere transport ACK as **not** Final ACK.
8. No PROD mutation, no PR merge and no signer/issuer role LOGIN or dispatch activation until exact-head DEV-only integration tests demonstrate this authorized path. Keep a rollback plan for runtime switch and existing worker lease exclusivity.

## Required gates before enabling an approval button
- **Negative:** anonymous/staff/legacy Google JWT; fresh Google session with no specific consent; wrong company/task/worker/command/attempt/nonce; historical or expired preparation; untrusted signature/public key; missing signer; replay/concurrent requests; revoked lease; database unavailability; public role access; status spoofing, callback/ACK mismatch.
- **Positive in disposable environment only:** one human-style synthetic consent triggers precisely one signed approval evidence row; separate attestor and issuer sessions produce one immutable receipt under eight concurrent attempts; no native dispatch granted; HTTP/DB receiver ACK only after synthetic canonical AI Core `COMPLETED`. Existing isolated tests may be reused.
- **Real DEV pilot:** after explicit authorized review, one **new** synthetic task, a genuine Super Admin signed command-bound consent, independent issuer lease, DELL callback and Final ACK with evidence. Only then may real DEV E2E be marked PASS.

**Release decision: NO-GO** until the above source-to-runtime route exists and a genuine command-bound approval is present. The instruction “lanjut” is not a cryptographic approval. Public roots and offline signatures are not operational signing authority.
