# PR196 - Isolated GPT02 Prepared Reservation HTTP E2E

Evidence date: 19 November 2026 (WIB).
Target: Travelintrips/AI-Task-Hub Draft PR196, CST-DEV only.
Source code tested: 9713d371941dd5b12e2809992bf5680f315095e0.
Status: Synthetic backend read-only E2E PASS; live Task 171 execution NO-GO.

## Isolation and actual HTTP evidence

The exact source was compiled on the authorized VPS using a constrained Node
heap. An isolated API ran the new dist from a read-only bind mount over
the prior PR196 base image. It connected only to a fresh synthetic PostgreSQL
17 fixture on a Docker internal network, both with zero published ports.
No real Supabase or PROD URI, account password, Google identity token,
service-role key, signer, issuer, dispatch or real data changes were used.
Schedulers, migrations, Core preparation and WhatsApp sending were OFF.

Source-compiled server SHA-256:
239ff0d13ecf685020e07c79b919742d8dc13e6a6584c7d3076e103b9ccf4a45.

API HTTP results:
- Readiness 200 on synthetic PostgreSQL.
- No JWT 401; synthetic staff 403.
- Synthetic Super Admin Task171 200.
- Wrong tenant or task 404.
- Unverified DEV email-only login 403.

The task 171 review was EXPIRED_PREPARED_RESERVATION_REQUIRES_INDEPENDENT_REVIEW.
It returned readOnly=true, independentReviewRequired=true,
coreStatus=PENDING and dispatchPermitted=false, resumePermitted=false,
operatorApprovalGranted=false and statusChanged=false.

When a fake approval or fake Core command was inserted in the disposable
fixture only, the HTTP result switched to PREPARED_RESERVATION_CONFLICTING_EVIDENCE
and still denied authorization. The fake rows were undone and the business
data digest was identical before and after. Test containers, internal Docker
network and temporary source files were removed. Existing DEV and PROD
containers remained healthy and the old systemd service remained locked.

## Reproducible CI regression

Prior GitHub CI verified source commit 9713d371:
- DEV Verify run 44375484518: SUCCESS.
- Docker smoke run 44375484756: SUCCESS.

The exact OCI image plus PostgreSQL 17 integration is now codified by:
- scripts/dev/fixtures/pr196-gpt02-prepared-review.sql
- scripts/dev/test-pr196-synthetic-prepared-review-http.sh
- .github/workflows/pr196-isolated-docker-smoke.yml

These fixtures contain only synthetic identities and SQL. They must never
be pointed at live Supabase or production systems.

## Separate DEV handoff gates

The DEV WhatsApp Gateway returned HTTP 200, one online worker and operational.
At the read-only snapshot, aged pending WA_DIGEST was zero and pending
ai_core_job_digest outbox rows were zero. This is a point-in-time snapshot
rather than permission to start two workers. The active backend has schedulers
enabled, so a new worker cannot run in parallel with it.

Real Super Admin Google session verification, independently reviewed
expired-reservation recovery, signed command-bound approval, issuer fencing,
safe single-worker handoff and rollback still must pass independently.
Do not prepare, resume, dispatch or mark Task171 complete from these tests.

Issue audit:
https://github.com/Travelintrips/AI-Task-Hub/issues/203#issuecomment-6989266598
