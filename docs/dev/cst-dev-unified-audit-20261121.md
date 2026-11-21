# CST-DEV AI Task + AI Core — consolidated operational audit

Scope: VPS srv1792369, CST-DEV only (Supabase xssrfshdrtdfupgqwfdw). This is a read-only report of the checks conducted on 21 November 2026; not a declaration that Task #183 E2E completed.

## Confirmed conditions
- AI Task main API, Google login API, document audit Task #183, and preparation-only API are healthy, use native PostgreSQL with TLS verification, and are routed to distinct fixed localhost ports.
- Authenticated API responses cannot be validated with anonymous HTTP checks; negative checks correctly return 401 with JSON. Browser login was observed separately, but command-bound signed approval was **not** observed.
- Audit Task #183 had no document audit. PR #212 fixes the UI's repeated HTTP 404 from an unconditional stub, returning JSON null with HTTP 200 only after checking task existence and tenant scope. Exact-head CI succeeded; a surgical image was deployed only behind the Task #183 audit route, with Nginx rollback retained.
- Preparer and relock PostgreSQL roles were read back as NOLOGIN, connection limit zero; preparer sessions zero and Task #183 jobs zero.
- The existing Issue #159 watchdog relock timer remained active.
- Two unreferenced, no-restart pooler QA containers were stopped, not deleted: gpt02-task183-dev-hostnet-direct-qa and gpt02-task183-idle-pooler-qa-39cccf9. Active AI Task, preparation API and AI Core remained healthy.
- Core AI DEV uses Supabase **Transaction Pooler port 6543** with dedicated `aicore_dev_runtime` role and `AI_DISPATCHER_ENABLED=true`. An actual read-only query on the running Core container PASS (38 existing AI jobs). Thus there is no evidence to justify replacing its database connection merely because it uses a pooler. Container health alone remains insufficient for full E2E proof.
- Preparation, owner command-bound approval, DELL final ACK, and post-action relock for Task #183 have NOT completed as one authorized E2E run.

## Remaining gates
1. Preserve Core AI transaction-pooler role and the verified working query. Do not migrate its database configuration without a demonstrated current failure; keep the live dispatcher unchanged.
2. Use a genuinely authenticated current Super Admin session to read GPT02 operator-session readiness (its signed Google proof is deliberately time-bounded). Do not fabricate JWT claims, approvals, or bypass the verification.
3. Only after authenticated readiness PASS, open one bounded preparation window using the already-installed one-shot runner and existing relock watchdog; verify one official Core/Hub preparation, no duplicate, and final NOLOGIN/zero sessions.
4. Complete command/attempt binding, a legitimate Owner approval, issuer/nonce/fence checks, DELL receiver ACK, replay denial, and final relock. Keep PROD and live dispatch OFF until evidence is complete.

## Repeatable audit
On the authorized VPS run:

`python3 /opt/ai-coding-standalone-dev/qa/cst-dev-unified-readiness-20261121.py`

The audit is read-only and intentionally exits 2 while critical operational gates remain unfinished. It prints no database DSNs, passwords or tokens. Its HTML-vs-JSON checks and nested Nginx location parsing prevent false PASS/FAIL from superficial health checks.
