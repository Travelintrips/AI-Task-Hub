# Task #183 — one-click bounded preparation (CST-DEV only)

Existing DEV implementation:
- The actual signed Super Admin Google session sends one explicit POST to /api/ai-tasks/183/gpt02-prepare?companyId=default with body {"prepareOnly":true} and header X-GPT02-Intent: prepare-only, retaining same-origin CSRF protections.
- A strictly localhost root-held broker on port 18509 validates the signed app JWT, Google identity, role, tenant, method, host, origin, exact body, and task-specific path. It obtains the existing exclusive host/advisory locks and reuses custody credentials and the independently audited Issue159 relock watchdog.
- The broker unlocks the least-privilege gpt02_core_prep_login for at most 45 seconds, verifies its read-only pinned-TLS identity, and forwards the single authenticated request to the existing DEV API isolated on localhost 18503.
- The original preparation API independently verifies task/PIC/audit eligibility, same-origin, company, and explicit intent. Its only permitted effect is one pending Core preparation plus one prepared Hub job, with NO signer approval, nonce, issuer lease, worker run, WA, or dispatch.
- The broker relocks and terminates remaining preparer sessions in finally BEFORE returning any response, even if the API call fails. The independent watchdog is still mandatory.
- Fail-closed: wrong identity, tenant, origin, method, body, endpoint, expired or tampered JWT, duplicate task attempt, readiness proof failure, or unexpected counts are rejected. The bearer token and database DSNs are never logged.
- The React UI enables one-click preparation only for Task #183 when the backend returns GPT02_PREPARER_LOGIN_LOCKED with separate eligible task admission and the feature flag active, while preserving normal backend readiness requirements for all other tasks. The UI does not directly unlock a database role.

QA already performed in isolation:
- Broker anonymous/fake signed session, wrong origin, wrong task URL, company role, expiry and tampered JWT — denials PASS.
- Unit-test positive response uses a MOCKED prepare_bounded and never writes to the real database.
- The signed real-user click, Core/Hub preparation writes, native signer Owner command consent, DELL ACK and final E2E verification remain untested. Do not call E2E PASS prematurely.
- Ensure VPS has the trusted custody scripts, root-only 0400 and watchdog timer active.

Target: VPS srv1792369, Supabase xssrfshdrtdfupgqwfdw, not PROD.

## Super Admin NULL company claim hotfix (21 November 2026)

Actual AI Task Super Admin Google profile on CST-DEV legitimately has company_id = NULL because it is a cross-company administrator. The existing signed Google app token carries this null claim, and getCompanyIdForWrite() on the original API resolves authenticated Super Admin NULL scope to default. Initial broker implementation required the literal string default, causing browser HTTP 403 before any preparation was attempted. Broker now allows a **present, signed** companyId claim equal to null or default, only together with a valid signed Google Super Admin token; absent companyId, any other tenant, non-Super Admin, fake or expired JWT still fail closed. Task path and original preparation API enforce companyId=default.

Unit coverage: signed null company accepted, signed default accepted, absent claim denied, foreign company denied, expired and tampered token denied, mock positive POST and mock failure relock PASS. Broker systemd service restarted healthy and unauthenticated public POST still HTTP 401. Real successful preparation/E2E not claimed.

## Post-preparation release gate (21 Nov 2026)

The genuine Super Admin one-click preparation succeeded and generated exactly one Hub job and one Core task, both PENDING/prepared, with the preparer relocked (NOLOGIN, NULL verifier, zero sessions). Task #183 is **not** ready for issuer/dispatch: the Core Task exists, but there is no matching official bridge command, command-bound approval, or immutable attempt binding.

Do not attempt to use the Issue159 approval-intent API as authority for Task #183 merely because it exists on the same VPS. Issue159 intent is independently scoped and not equivalent to command-bound approval for the new Core Task.

Read-only VPS verification:
python3 /opt/ai-coding-standalone-dev/qa/task183-postprepare-readiness.py

The script reads CST-DEV facts under an explicit PostgreSQL READ ONLY transaction, verifies exact Core/Hub lineage, strict single-count cardinality, expiry, preparer relock, command presence, immutable attempt binding and a valid command-bound approval. It intentionally returns NO-GO while evidence is incomplete. The terminal READY_FOR_INDEPENDENT_ISSUER_CHECK_ONLY state still does not grant dispatch.

Synthetic fail-closed suite:
python3 /opt/ai-coding-standalone-dev/qa/task183-postprepare-readiness.test.py

12/12 cases PASS: missing command, approval, binding; expired reservation; duplicate Hub/Core; unlocked preparer; leaked sessions; invalid/unavailable readback, etc. No task, database, or role writes. Reservation originally expired 2026-11-21 11:25:28.870Z (18:25:28 WIB); do not extend/replay it outside the official independently authorized flow.

## Expired reservation read-only visibility (21 Nov 2026)
A genuine prepared Task #183 reservation expired on 2026-11-21T11:25:28.870Z before any official command, independent attempt binding, or Owner approval was produced. No repeat preparation or lease extension is authorized. The existing root-held broker provides an exact scoped, signed Super Admin GET: /api/ai-tasks/183/gpt02-postprepare-readiness?companyId=default. It uses the already-tested read-only release gate and returns HTTP 200 with status NO_GO_RESERVATION_EXPIRED, original expiry and evidence counts (NO command, approval or binding), without any signer or dispatch authority.

The Task #183 frontend displays the result as informational status (not an approval control), and all other task routes remain unchanged. Anonymous requests receive 401, malformed signed sessions 403, and synthetic verified read-only status contract tests PASS; database writes remain OFF.
