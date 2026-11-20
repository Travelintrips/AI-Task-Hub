# Core AI + AI Task Hub — One-Batch CST-DEV Release Acceptance

**One final release decision, two existing Draft PRs.** Core AI
[PR #1765](https://github.com/Travelintrips/Core-AI-Foundation/pull/1765)
owns Company-1 model job, bound broker, RLS and subscriber receipt.
AI Task Hub [PR #202](https://github.com/Travelintrips/AI-Task-Hub/pull/202)
owns its cross-repository view and **independent four-agent** review.
The complete technical scope and one-command offline QA reside in
`Core-AI-Foundation/docs/dev/cst-team-onejob-single-batch-closeout.md`.
This document keeps Hub from marking itself PASS before Core/Owner evidence is real.

## Finished offline QA is not operational E2E

The Hub `cst-ai-team/external-reviews` route supports
**operator-collected text observations** and explicitly marks them
`signatureVerified=false`; this is useful QA but is not native
signed independent agent evidence. A passing UI or test result must not
turn that flag into Final ACK authority.

Do not add four new approval screens, additional Owner passwords,
TOTP or a second Owner approval. The *one* human action needed for
the pilot is an actual authenticated Owner/Super Admin confirmation for
a **specific new Company-1 model job**, through the existing DEV session
once the rest of the implementation and tests are prepared.

## Shared, indivisible evidence contract

| Required evidence | Producer | Hub's independent check |
| --- | --- | --- |
| New job request, Company 1, model `qwen2.5:3b`, worker, commit and nonce | Core job engine | Exact source+tenant+one-job match, reject #482 |
| One fresh Owner-session approval | Existing authenticated Owner workflow, signed/attested independently | Verify Owner session, approval freshness, exact job, not merely `approved_by_user_id` |
| One isolated run with bound DB role and broker/ACL | Core one-job candidate | Verify exact SHA, no shared credentials, bounded TTL, network/role proof |
| Atomic `job.completed` + publisher audit | Core job/event engine | Verify event/job/worker/correlation and one source job |
| One persistent signed subscriber ACK | Separately authenticated subscriber and private signer custody | Independent DB readback + pinned public key + duplicate prevention |
| Four actual distinct agent attestations | Four separate authorized agent signers | Four distinct registered public keys, signed nonces, exact same job/event+receipt hashes, no self-attestation |
| Final ACK and rollback | Independent reviewer/QA and cleanup controller | Signed Final ACK on same evidence manifest; relock, no other tenant changes |

**Strict state model:** `NOT_STARTED → PREPARED → OWNER_APPROVED →
ISOLATED_DEV_RUNNING → EVENT_PUBLISHED → SUBSCRIBER_RECEIPT_VERIFIED →
FOUR_AGENT_REVIEWED → FINAL_ACK_VERIFIED → DEV_E2E_PASS`.
Every transition requires the exact predecessor's authenticated, immutable
evidence. Any missing/expired/duplicate evidence yields
`NO_GO`. Neither callback verification nor a synthetic signature
is a substitute for independent signer custody.

## Single run and owner intervention

Build packages A–G in the Core closeout contract and the Hub monitor
evidence consumption **as one integration change**. Run the combined
offline/CI/negative suite once. Run live CST-DEV only after the
Owner genuinely approves the one new job in their existing session.
Then verify one end-to-end evidence bundle and publish **one**
PASS/FAIL decision with all blockers, not successive component
PASS announcements.

All PROD, GPT02 signers, shared Core DEV runtime and historical #482
remain untouched until this evidence is satisfied. Existing monitoring
must continue to return `subscriberDeliveryVerified=false`,
`independentQaVerified=false`, and
`independentFinalAckVerified=false` until authentic proof exists.

**Current outcome:** framework scoped, live one-job E2E and true four-agent
signed Final ACK not available; the release remains NO-GO, despite
successful sandbox tests.

## Single cross-repository cryptographic reconciliation (still NO-GO)

The Hub now has a pure fail-closed checker:
`artifacts/api-server/src/lib/cst-team-onejob-cross-repo-final-ack.ts`.
It REUSES Hub's existing Ed25519 four-agent + separate reviewer verifier,
then independently verifies the Core post-execution reconciliation signature
using the Core `cst-onejob-final-ack/v1` ordered claim contract. It matches
the **same job, event, approval, delivery, source SHA, subscriber and Owner
evidence hashes** against an expected Core ledger readback and insists that
the Core issuer key is distinct from all five Hub signer roots. Rejects
forgery, reused keys, missing agents, mismatched receipts, wrong source,
wrong job/event and time-order mismatch.

This is only a **cryptographic compatibility check**. An expected ledger
object is not authenticated database provenance. Operational release still
requires an independently executed CST-DEV DB readback, reviewed key custody,
real four agent work, actual Owner session and relock/rollback. The checker
always returns `operationalE2EVerified=false` and
`independentFinalAckVerified=false`. No new Owner approval, credentials,
HTTP routes, database writes, dispatch or PROD changes.
