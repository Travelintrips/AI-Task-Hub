# AI Task Hub DEV — standalone launcher fail-closed

This is the **versioned copy** of the existing VPS launcher
`/home/githubrunner/.local/bin/ai-task-development-start`. It is not
a replacement for the official, already-running PR196 DEV container or PROD.

## Why it is gated

The old standalone launcher loaded
`/home/githubrunner/.config/ai-task/development.env` and spawned an orphan
Node process, which ran cron-like database jobs with an unverified admin
PostgreSQL connection. On 18 Nov 2026 this caused real DEV authentication
failures (`28P01`) and a shared Supavisor auth circuit breaker.

The revised launcher **refuses to start before the database is contacted**
unless the connection *format* is pinned to project `xssrfshdrtdfupgqwfdw`,
role `ai_task_vps_identity_reader_dev`, transaction pooler port 6543 and
`NODE_ENV=development`. It blocks `postgres` and `ai_task_hostinger`.
The current restricted reader role is **NOLOGIN**, so operational readiness
is still **NO-GO**; never claim that syntactic validation verifies credentials.

Further controls: a launch-only lock prevents concurrent starts; an
unrelated PID-file occupant is never killed; already-running instances are
left intact; background schedulers and startup DDL are OFF; secret/DSN values
must not be passed as command arguments or logged.

The **two existing AI Task PostgreSQL pools** (Drizzle `@workspace/db`
and raw `supabasePool`) use one shared DEV-only fail-closed authentication
scope in `lib/db/src/dev-auth-circuit.ts`. At cold start, **only one initial
authentication handshake across both pools** may be in flight; all other
callback and Promise clients wait without opening other sockets. If either
pool receives `28P01`, `28000`, or a Supavisor `auth_error` breaker,
both locally refuse queued and subsequent connections with fixed, redacted
codes. After the first valid connection, all healthy calls run normally.
A transient network failure retries the next waiting caller; unrelated
breakers do not latch. An idle error on either pool also latches/drains
both pools. Recovery requires an intentional restart after authorized
credential repair, never automatic retry.
When `NODE_ENV=production`, **both Pool objects are left unchanged**.
Their existing SQL, privileges, and transaction semantics are preserved.

This launcher is used only for isolated QA and is not executed automatically
by GitHub CI. CI runs seven offline launcher tests and **sixteen** pool
tests, including the real `pg.Pool.query` callback path and the shared
two-pool cold-start race. In additional disposable PostgreSQL 16 SCRAM tests:

- Twelve concurrent wrong-password queries resulted in **exactly one**
  actual server authentication failure; eleven were refused locally.
- Twelve concurrent correct-password queries succeeded.
- Full built AI Task HTTP API (`GET /api/readyz`), localhost-only, all
  background schedulers/DDL/external integrations OFF, returned **12/12
  HTTP 503** from 12 concurrent invalid-credential requests, with exactly
  one database authentication failure total across BOTH pools. With correct
  fixture credentials and minimal synthetic tables it returned **12/12
  HTTP 200**. No Supabase CST-DEV or PROD connection was used.

Every disposable PostgreSQL container and API listener was cleaned after the
test. The actual VPS launcher has separately been verified to exit 78 with
the old invalid admin configuration **without spawning Node, calling
PostgreSQL, writing its application log, or modifying the stale PID file**.

**Deployment boundary:** On 18 Nov an independently managed systemd unit
`ai-task-development.service` was started with a direct, older Node
checkout, not through the corrected launcher, and its source has NOT been
patched by this PR. Its health was 200, so no speculative stop/restart was
performed. A controlled, credential-authorized DEV deployment gate is needed
to integrate this source patch into that existing unit safely.

## Remaining operational acceptance

An authorized database administrator must provision and verify the
restricted DEV role through an approved credential process. A successful
syntactic check is **not** a TLS login, functional scheduler test or business
E2E PASS. Do not use shared Customer Portal/Finance passwords as a substitute.
Never enable PROD/signer/issuer/dispatch or financial writers through this
launcher. The source of *other* generic Supavisor failed-authentication events
remains under investigation in AI Task Hub issues #203 and #204.
