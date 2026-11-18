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

The **existing PostgreSQL pool**, rather than each scheduler separately, now
has a small DEV-only fail-closed authentication circuit in
`lib/db/src/dev-auth-circuit.ts`. If pg.Pool.connect or the callback form
used by pg.Pool.query receives `28P01`, `28000` or a Supavisor
`auth_error` breaker, that process locally refuses subsequent connection
attempts with a fixed, redacted code. A transient network failure or a
non-authentication breaker does not latch. Restart must be deliberate after
the authorized credential is corrected; there is no automatic reset/retry.
When `NODE_ENV=production`, the Pool method is **unchanged**, not wrapped.
An idle Pool client error also triggers the same DEV-only latch.

This launcher is used only for isolated QA and is not executed automatically
by the GitHub CI. CI runs seven offline identity parser fixtures and eleven
offline tests of the DEV pool circuit (including actual pg.Pool.query
callback plumbing without a network connection). The actual VPS script has
separately been verified to exit 78 with current invalid admin credentials
**without spawning Node, calling PostgreSQL, writing its application log or
modifying the stale PID file**.

## Remaining operational acceptance

An authorized database administrator must provision and verify the
restricted DEV role through an approved credential process. A successful
syntactic check is **not** a TLS login, functional scheduler test or business
E2E PASS. Do not use shared Customer Portal/Finance passwords as a substitute.
Never enable PROD/signer/issuer/dispatch or financial writers through this
launcher. The source of *other* generic Supavisor failed-authentication events
remains under investigation in AI Task Hub issues #203 and #204.
