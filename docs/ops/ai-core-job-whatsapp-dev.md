# AI Core DEV → WhatsApp Self-Number: Job Monitor

## Status / safety
- This module is **DEV-only** and **disabled by default**.
- It uses only the isolated CST WA Gateway DEV service, never PROD or Fonnte.
- No sending happens until every required configuration is explicitly set.
- An online WhatsApp worker is mandatory. A `/health = 200` without a worker is NOT proof of message delivery.
- The result from `POST /v1/messages` means **queued**, not **delivered**. Delivery requires gateway status/webhook confirmation.
- Keep credentials in the DEV secret manager/environment, never in source, logs, or ChatGPT messages.

## Runtime configuration (AI Task DEV only)
```dotenv
AI_CORE_JOB_WA_ENABLED=false
AI_CORE_JOB_WA_PHONE=
AI_CORE_JOB_WA_GATEWAY_URL=http://cst-wa-gateway-dev-api-dev-1:8080
AI_CORE_JOB_WA_API_TOKEN=
```
- `AI_CORE_JOB_WA_PHONE` is the existing linked DEV sender's own phone number (digits only), verified against its device credentials before activation. Admin group delivery remains disabled until a verified group is explicitly authorized.
- `AI_CORE_JOB_WA_API_TOKEN` is a dedicated DEV tenant API client with `messages:send` and `messages:read`, scoped to device `ai-core-dev-sender-01`; it is not a PROD token.
- AI Task DEV and CST WA API DEV are connected by an internal-only private network (`cst-wa-ai-core-dev-private`), with no production services or WA Redis attached. Link script and optional isolated sender profile are in CST WA Gateway PR #123. Rerun the link helper after replacement of either DEV container.
- The DEV sender was paired and is ONLINE (`ai-core-dev-sender-01`). A one-time, idempotent send-to-self test to the same linked phone returned HTTP 202/queued, and its worker-reported message state became `sent`. The provider has not reported `delivered` or `read` yet.
- The URL allowlist is intentionally limited to `cst-wa-gateway-dev-api-dev-1:8080`.

## Behavior
- New AI Core bridge job or AI Task execution: update digest for `queued`.
- Verified complete, failed, blocked, cancelled: update digest only on a real state transition.
- Status `verifying` is **not** reported as completed.
- Repeat/callback replay is deduplicated using the unique execution ID, correlation ID, and state.
- Audit trail: `ai_execution_events` (`WA_DIGEST`) plus `whatsapp_notifications`. Failed gateway/worker attempts are kept pending with bounded exponential retries (at most 12 attempts) after service recovery.
- Summaries show up to 12 recent jobs, newest first, one short line per job, with truncated task title, short agent name, status emoji, and duration. The format test asserts narrow-screen job lines.
- Reconciliation polls delivery status once a minute *only when fully enabled*. Gateway queued is not delivery; sent/delivered/read receipts update the outbox.
- Reconciliation skips pending messages if the configured phone recipient changes, rather than send to an obsolete destination.

## Read-only tests
1. `node artifacts/api-server/tests/ai-job-whatsapp-format.test.mjs`
2. `pnpm exec tsc -b lib/db lib/api-zod && pnpm --filter @workspace/api-server typecheck`
3. `GET /api/bridge/jobs/whatsapp-preview` with existing DEV `AI_TASK_BRIDGE_TOKEN` bearer auth.
4. `GET /api/executions/whatsapp-digest/preview` with normal AI Task user authentication.
5. Check `GET /v1/status` on the **DEV** WA gateway. Online sender must be greater than zero.
6. After confirming the **linked sender's own number**, scoped DEV API token, and worker ONLINE state, set `AI_CORE_JOB_WA_ENABLED=true` and test a tagged DEV job. Do not add any Admin group destination without separate authorization.
7. Confirm queued message ID and its actual terminal gateway delivery status; never report queued as delivered.
8. Check `whatsapp_notifications.status`: `pending` (retry needed), `queued`, `sent`, `delivered`, `read` or `failed`.
9. Deploy only to isolated DEV with reversible runtime changes; VPS disk usage was 96% at inspection. Never use the PROD WhatsApp session or gateway.

## Do not
- Copy PROD device WhatsApp sessions, API tokens, group bindings, database or Redis into DEV.
- Change PROD infrastructure or send a test message to an unknown group.
- Declare E2E PASS solely from an ACK, preview, HTTP 200 or queue acceptance.
