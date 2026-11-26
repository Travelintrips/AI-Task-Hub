# GPT02 DEV — single post-nonce evidence fence, not permission to dispatch

## Scope and historical preservation

This is the next bounded security step after a synthetic Hub/Core `prepared` reservation, three independently signed approval/operator-origin matches, an append-only approval record and atomic one-time nonce receipt. The user-authorized **Task136 / WA-2611-4633** already completed one text-only DELL command with its true native ACK and must never be replayed or backfilled. Old failed **Task135** must also never be retried. The DEV full lifecycle endpoint currently rejects missing pre-dispatch proof and an existing `prepared` execution cannot be scheduled by its legacy API path.

The real CST-DEV issuer/attestor roles remain NOLOGIN. The operational `gpt02_private` foundation has no active evidence runtime functions and its approvals/receipts are empty. The new fixture is **not a live migration**, and the added issuer-store method is **not imported or mounted by any HTTP/worker route**. No user-owned authorization is signed or submitted in this change.

## Narrow new evidence-only stage

`scripts/dev/gpt02-post-consumption-fence.fixture.sql` creates a single immutable, non-authorizing `gpt02_private.post_consumption_fences` table **only in disposable** `gpt02_issuer_isolated`. Its owner is the NOLOGIN `gpt02_store_owner`, FORCE RLS is enabled, and the issuer/attestor roles have no direct table privileges. A statement-level immutable trigger rejects UPDATE/DELETE/TRUNCATE. Every fence must point to one existing `core_identity_receipts` entry and its original approval receipt, command ID, independently signed operator-link ID, prepared Hub execution UUID, Core task UUID and attempt UUID. Unique indexes forbid any second receipt/command/link/Hub-execution/attempt claim. `lease_epoch=1`; `lease_expires_at` is at most 15 seconds after the locked claim and no later than either original signed approval's expiry. Both `dispatch_allowed` and `core_ledger_written` have constant FALSE CHECK constraints.

`reserve_post_consumption_fence` can be called only by an authenticated **dedicated issuer session**. It locks the original nonce receipt, rechecks the linked Core identity and two existing signed-evidence windows *after* locking, checks the pinned GPT02 DELL worker, Hub/Core/attempt IDs and digest, then attempts `INSERT .. ON CONFLICT DO NOTHING`. A missing/altered/expired/duplicate precondition returns null. The same fence cannot be renewed or shifted to a new worker; no credentials or commands are issued. This record is a **one-time evidence claim** only, not a ready-to-use worker lease or token granting dispatch. A real send still requires a separate reviewed issuer service, real Core/Hub ledger writes and valid command-specific operator approval and lease fencing.

`Gpt02IssuerStore.reserveNonDispatchFence` uses the previously pinned independent Ed25519 approval/Hub/Core public keys. It verifies all signatures *before opening a database session*, requires the exact nonce receipt UUID and dedicated issuer identity, verifies no elevated rights/direct DML/schema drift, then stores the evidence atomically and returns `evidenceFenceReserved=true`, `issuerLeaseGranted=false`, `coreLedgerWritten=false`, `operatorApprovalGranted=false`, and `dispatchPermitted=false`. It sanitizes database errors, rolls back failed transactions and destroys pooled sessions.

## Actual isolated tests

- **56/56** actual SCRAM PostgreSQL16/Node issuer integration tests passed, including all 48 older checks and **8 new fence checks**.
- Eight simultaneous issuer claims after an authenticated, double-signed nonce receipt yield **exactly one** immutable fence; seven are rejected. One fence has lease epoch1 and TTL no more than15 seconds, with `dispatch_allowed=false`.
- A legacy approval receipt without a matching Core identity, a changed command/link ID, and a different worker cannot claim. Nonissuer roles and direct table DML cannot claim or modify it.
- Expiry is tested **after a lock wait**: no lease appears when approval expires while waiting. Forced insert failure rolls back and can be retried once, without phantom rows. Unexpected table grants or schema-version changes cause explicit denial before writing. Malformed signatures and request-supplied public keys are rejected before DB connection.
- **5/5** additional static contract regressions ensure the named disposable database guard, unique/FK/RLS/append-only properties, exact no-dispatch response, and no live API import remain in place.
- The fixture runs `--network none` with throwaway SCRAM credentials and ephemeral Ed25519 keys. No CST-DEV/PROD SQL session, signer or worker receives these synthetic materials. Existing tests were adjusted for the new fifth private evidence table/FK: a plain TRUNCATE is denied by FK (`0A000`) while cascade is denied by immutable trigger (`55000`). These are both fail-closed, not a relaxation.

## Remaining real work

A **genuine** prepared Hub execution and Core coding task are still absent from the hosted DEV environment; active issuer role, durable operator consent/lease and write-side grant remain unavailable. This change does not make an arbitrary synthetic signature into a legitimate Super Admin approval. It does not enable the disabled lifecycle button, route POST, automatic continuation or DELL dispatch, and it does not alter Task135/136, host authentication, passwords or PROD.

**Decision:** isolated post-consumption evidence fencing PASS; full GPT02 lifecycle stays **NO-GO** pending a separately reviewed, user-approved real command with an independently verified active issuer/lease and final native ACK.
