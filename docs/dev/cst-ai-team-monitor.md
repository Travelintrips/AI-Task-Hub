# CST AI Team Monitor — DEV-only gated canary

Feature location after candidate deployment: /cst-ai-team (existing authenticated super_admin, DEV hostname only).

## Existing components reused
- Existing session JWT and Super Admin role; no new password, service account, OTP, role or approval.
- Existing ai_execution_jobs and ai_execution_events tables; no duplicate task subsystem or new Supabase project.
- Team GET reads Company 1 canary jobs only.
- Team POST accepts only the predefined dev_read_only_canary scenario.

## Four coordinated role executors
- Coding: execution-ledger contract query and deterministic digest.
- Infrastructure: real local HTTP health check.
- Security: DEV-only runtime + existing session-secret guard.
- QA: independent DB readback of the other three persisted results.
- First three checks run concurrently, QA waits and evaluates persisted results.
- Every role result gets timestamp, role-scoped worker label and evidence in ledger.
- Four labels refer to role executors within one API process. They are NOT four independent GPT sessions or autonomous AI coding agents.

## Safety
- Default OFF. Explicit enablement requires CST_AI_TEAM_DEV_ENABLED=true and both NODE_ENV and APP_ENV set to development.
- JWT super_admin and explicit companyId=1 are required.
- Read API does not modify data, write API does not modify historical tasks or launch external workers.
- No GPT02 signing, authorization, dispatch, worker handoff or PROD writes.
- Callback, attestation and Final ACK intentionally remain false and distinct from internal canary completion.
- Existing dirty DEV checkout, deployed containers, DELL and PROD remain unchanged.

## Verification
Run: node --experimental-strip-types --test scripts/dev/cst-ai-team-monitor.test.mjs
Run: pnpm run typecheck
Run: pnpm run build
Do not promote if E2E is unverified or any existing gate fails.

## Next release criterion
Real autonomous AI team would additionally require separate authorized external worker runtimes, a safe task dispatch protocol, verified return receipts, and a nonprivileged task with real external Final ACK. This canary cannot satisfy those criteria.

## DEV-only operator-collected OpenClaw review (unattested)

The optional review intake reuses **existing** `ai_execution_jobs` and
`ai_execution_events` with source `cst-ai-team-dev-external-review`; it does **not**
create a new task engine, workstream, signer, user, approval, or database table.
It is separate from `cst-ai-team-dev-canary` and from operational `AI_TASK` tasks.

- This API is **disabled by default**. Admission requires `NODE_ENV=development`,
  `APP_ENV=development`, `CST_AI_TEAM_DEV_ENABLED=true`, and the additional
  `CST_AI_TEAM_EXTERNAL_EVIDENCE_ENABLED=true` gate, plus the existing JWT
  Super Admin and explicit `companyId=1` scope.
- `POST /api/cst-ai-team/external-reviews?companyId=1` accepts **only** the
  `operator_collected_read_only_review` scenario and creates a scoped run and
  one per-run challenge. It does not invoke or route to an external agent.
- `POST /api/cst-ai-team/external-reviews/:id/observations?companyId=1`
  accepts only one observation per predetermined role/profile/host pair:
  `coding` = Travelintrips/main; `infrastructure` = DELL/dell-recovery;
  `security` = DELL/dell-verifier; `qa` = DELL/dell-browser.
  Observations contain a bounded result code and SHA-256 digests **only**,
  never raw chat, credentials, or bearer/session tokens. Exact role + challenge
  and unique event ID guard replay. QA cannot be recorded before the three
  preceding observations. A completed operator review stays `blocked`.
- `GET /api/cst-ai-team/external-reviews?companyId=1` provides the separate
  read-only display in CST AI Team Monitor, with no assumption that a role
  profile was cryptographically authenticated merely because a Super Admin
  entered its observation. Observations are intentionally marked
  `DEV_OPERATOR_COLLECTED_UNATTESTED`, `signature_verified=false`,
  `operationalVerified=false`, and `independentFinalAckVerified=false`.
- This is a **manual/operator-collected bridge evidence journal**, **not**
  autonomous routing, not four independent authorized coding workers, not
  signed GPT02 attestation, and not approval to deploy or merge to PROD.

Regression: `node --experimental-strip-types --test scripts/dev/cst-ai-team-external-review.test.mjs`
plus the existing synthetic PostgreSQL16 `scripts/dev/cst-ai-team-monitor-e2e.py`.
The test injects only generated, synthetic credentials; no live DEV/PROD
credentials are copied into test logs or fixture data.

### Fail-closed QA-provider failures and stalled reviews

If the fourth OpenClaw profile cannot respond, preserve the first three
observations **without inventing a QA event**. The Super Admin may explicitly
close the unfinished Company-1 review using
`POST /api/cst-ai-team/external-reviews/:id/close?companyId=1` with exactly
`{"reason":"QA_PROVIDER_LIMIT"}`, `{"reason":"QA_PROVIDER_AUTH_UNAVAILABLE"}`,
or `{"reason":"REVIEW_INTERRUPTED"}`. This requires the same DEV-only
admission flags and authenticated Super Admin. There are no free-form error
fields or credentials. A second close or later observation is rejected.

An abandoned `processing` review older than 10 minutes projects as `blocked`
with `OPERATOR_REVIEW_TIMEOUT` in read-only monitoring, and its late writes
are refused; the projection does not silently mutate the ledger. Company
scope, worker identity, idempotency, and the unsigned proof label are retained.
Neither an operator-closed review nor a timed-out review is an autonomous
handoff, agent attestation, or verified GPT02 Final ACK.

The QA role has one explicitly labeled optional **local model** observation:
`DELL / ollama-local-qa`, sourced only from the local Ollama API (currently
`qwen2.5:3b`). It is **not** the `DELL / dell-browser` OpenClaw profile and
must be recorded with `worker_id=ollama-local:DELL:ollama-local-qa`, not an
OpenClaw worker identity. This is an operator-collected diagnostic fallback,
not unattended routing or a verified signed QA receipt. It does not change
provider credentials, the configured OpenClaw profile or AI Core worker
eligibility. Unknown hosts/agents and attempts to use that QA identity for
Coding/Infrastructure/Security are rejected.

A direct native Ollama local QA evaluation returned `QA_BLOCKED` for missing
leases, handoffs and Final ACK. The OpenClaw embedded/isolated QA route still
timed out, so the direct model capability does not imply OpenClaw readiness.

The synthetic PG16 E2E covers one 4/4 complete **unattested** OpenClaw-profile
review, one 4/4 operator-collected review using the clearly labeled local
Ollama QA alternative, one 3/4 review blocked because QA provider is
unavailable, and one stale review.
All remain `operationalVerified=false` and `independentFinalAckVerified=false`.

### Repeatable DELL native Ollama QA preflight (no OpenClaw wrapper)

The bounded, read-only Windows PowerShell collector lives in
`scripts/dev/cst-ai-team-local-ollama-qa.ps1`. The script is intended **only for
DELL**, checks the existing local API `http://127.0.0.1:11434/api/generate`,
and uses the locally installed `qwen2.5:3b` with context 512, generation
24 tokens and an HTTP timeout of 30 seconds. It never reads auth files,
changes OpenClaw settings, invokes tools, calls cloud endpoints, or installs
dependencies. The per-process QA output contains a SHA-256 digest of the exact
model response and a random session marker digest; **neither is a signature**.

Run it on DELL against an explicitly created Company-1 operator-review challenge,
using only bounded, operator-confirmed *finding codes* from the three prior
reviews (replace the UUID with the current one):

```powershell
powershell -NoProfile -File .\scripts\dev\cst-ai-team-local-ollama-qa.ps1 -Challenge 33acb2cd-aee9-4d40-8ee8-a3c51fe173d7 -CodingFinding NO_PERSISTED_HANDOFF -InfrastructureFinding MISSING_WORKER_LEASE -SecurityFinding MISSING_FINAL_ACK
```

The emitted `observation` object is compatible with the existing restricted
operator-collected observation API, but **only Super Admin, Company 1, explicit
DEV feature flags and matching per-run challenge may submit it**. The script
does not submit anything by itself. A short, valid native Ollama response is
required; unavailable/mismatched answers fail closed, and input containing no
known blocker is rejected without invoking the model. Real Coding,
Infrastructure and Security receipts must be collected and validated separately;
preflight success alone never sets any independent-agent or GPT02 `Final ACK`.

Runtime verification on DELL (19 Nov WIB): one positive bounded sample returned
`PASS_LOCAL_DIAGNOSTIC` in about 6.9 seconds, with `QA_BLOCKED` and false
operational/final flags; one all-clear input was denied with
`NO_VERIFIED_BLOCKER_INPUT`. The positive input consisted of operator-supplied
codes, not verified agent-signed receipts.
