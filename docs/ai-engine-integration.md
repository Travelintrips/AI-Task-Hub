# AI Task Hub -> AI Engine integration (staged)

This integration is intentionally **off** until the two environment variables below are provided:

- `AI_ENGINE_BASE_URL`: HTTPS origin of the AI Engine API (no path, query, or credentials).
- `AI_ENGINE_SERVICE_TOKEN`: dedicated, least-privilege machine-to-machine credential; never a browser session or human admin token.

Endpoints mounted on AI Task Hub API:
- `GET /integrations/ai-engine/status`: authenticated company administrator; probes Engine bridge runtime readiness (read-only).
- `POST /integrations/ai-engine/dispatch/:taskId`: authenticated company administrator; only tasks with `category=coding`, non-terminal state, and matching tenant. Requires explicit action. Uses `externalCommandId=ai-task:<companyId>:<taskId>` so Engine can deduplicate retries.

## Not yet delivered; block production activation
1. Confirm Engine accepts the scoped service token for these routes. Current Engine API may only accept existing administrator auth; do not substitute that credential.
2. Implement a durable dispatch record containing Engine command UUID, source tenant/task ID, idempotency key, and lifecycle state.
3. Implement a signed callback or tenant-scoped response consumer with replay protection, monotonic event ordering, persistence, and status mapping. Bridge ACK is **not** completion.
4. Run a DEV two-way test: dispatch -> actual execution -> terminal event -> AI Task durable state update. Check unauthorized and cross-company requests, duplicates, timeout recovery, and failure modes.
5. Verify DNS/HTTPS and production infrastructure separately. Do not merge/deploy while these checks are missing.

No automatic deployment, workflow start, or database change is performed by this PR.
