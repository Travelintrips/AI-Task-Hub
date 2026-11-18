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
by GitHub CI. CI runs twelve offline launcher tests and **sixteen** pool
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
checkout, not through the corrected launcher. Its source has NOT been
patched by this PR. The later database readiness HTTP 503 and recurring
Supavisor 28P01 errors justified targeted isolation of that unused legacy
unit, as detailed below. A credential-authorized DEV release gate is still
required before restoring or replacing its runtime.

## Legacy systemd runtime reactivation: permanently fail closed until authorized

On 18 Nov 2026, the old `ai-task-development.service` was re-started via
a direct systemd action at 14:12:11 UTC **despite already being disabled**
from boot. Its old Node checkout reported PostgreSQL readiness HTTP 503;
Supavisor had six bad-password events in the same minute and three
`ai-task-hub` events at 14:15 UTC from the same VPS egress.

The only affected, non-public legacy unit was stopped and protected with
the versioned `scripts/ops/systemd/99-fail-closed-stale-credentials.conf`
drop-in, installed at
`/etc/systemd/system/ai-task-development.service.d/`. This uses
`RefuseManualStart=yes`, an absent authorized-release condition marker and
`Restart=no`. Unit file/source remain retained, but manual systemctl start
returns nonzero and no old Node listener is created. No Nginx route to
port 18081 and no connected client were present when this isolation was made;
the official PR196 DEV container and AI Task PROD continued running.

**To restore this legacy service in the future:** the approved operator
must first confirm the exact pinned DEV release, verify the designated
operational DEV database identity has the minimal company-scoped permissions
its workload actually needs, prove TLS authentication/RLS, and only then
explicitly remove the temporary blocking drop-in,
call `systemctl daemon-reload`, and enable/start only after its own
independent DEV rollout checks are PASS. Do not create the marker or
remove the guard simply to retry the stale `postgres` admin DSN.

Three offline CI checks verify the systemd guard. This is a reversible
temporary stop on one unhealthy private DEV unit, not an action on PR196,
PROD, signer, dispatch, Customer Portal, or Payroll.

## Remaining operational acceptance

**Important capability audit, 18 Nov 2026 (Supabase CST-DEV, read-only):**
The existing `ai_task_vps_identity_reader_dev` role is `NOLOGIN`,
`NOBYPASSRLS`, has **column-scoped SELECT on only six `public.users` identity columns**
(`id`, `email`, `role`, `company_id`, `is_active`, `status`) but has no
SELECT on `public.ai_tasks`, `public.task_assignments` or business tables, and can SELECT only two PostgreSQL extension statistics
views. Therefore merely changing it to `LOGIN` would **not** produce a
working AI Task application or E2E. The standalone launcher intentionally
accepts only its syntactic identity for a restricted diagnostic/QA path,
not a fully capable operational runtime.

The other existing `ai_task_hostinger` role has `BYPASSRLS` and broad
access to hundreds of relations, so **must not be substituted** for an
isolated DEV operational runtime. An authorized database administrator must
first approve a genuinely scoped DEV service identity with exactly the
needed company-limited read/write permissions, RLS, TLS verification and
no default superuser/BYPASSRLS rights. Reuse existing role/policy facilities
rather than rebuilding data models; do not reuse Customer Portal/Finance
credentials.

Until approved credentials and an independently tested DEV release are
ready, keep the legacy systemd guard in place and PR196 untouched.
A syntactic connection-string check is **not** authenticated PostgreSQL
readiness, functional scheduler coverage, or business E2E PASS. Never
enable PROD/signer/issuer/dispatch or financial writers through this
launcher. Other Supavisor failed-auth events are tracked separately in
AI Task Hub issues #203 and #204.


## Official PR196 container identity audit — isolated E2E gate

Independent read-only VPS inspection on 18 Nov 2026 confirmed the official,
healthy PR196 DEV container uses Supabase CST-DEV as `postgres.<project>`
over the **5432 session pooler**, with `DISABLE_BACKGROUND_SCHEDULERS=false`
and `RUN_STARTUP_MIGRATIONS=false`. The actual `GET /api/readyz`
responds HTTP 200 with `database: ok`. This is a successful current privileged
DEV DB readiness check, **not** proof of least-privilege role authentication or
tenant-scoped E2E. This container was deliberately left unchanged.

`scripts/ops/ai-task-dev-runtime-identity-gate.mjs` adds an **offline,
source-only**, fail-closed release preflight specifically for a proposed
**isolated** DEV E2E candidate. It requires a distinct,
independently provisioned `ai_task_operational_dev` role on the CST-DEV 6543
transaction pooler, `development` env, schedulers and startup migrations off,
and no explicit TLS disable. The existing identity-reader `NOLOGIN` and
the legacy `ai_task_hostinger` BYPASSRLS role are explicitly rejected.

This candidate role **does not yet exist**. The checker does not create
accounts, grant access, test a password, verify TLS certificates, change
live runtime, or issue any authorization. Even a format PASS leaves
`tlsAuthenticated=false`, `rlsIsolationProven=false`, and
`e2eAuthorized=false`. CI tests all refusal cases using only fictional
credentials, with no database connection or secret output.

**Required independent gates before an actual DEV deployment:** approve
per-company least-privilege role/RLS grants and separate secret custody,
verify actual TLS certificate chain (not merely URL syntax), run a strictly
bounded live authenticated SELECT/negative tenant test, check application
writer operations under isolated reversible QA, verify rollback, then choose
a release. Do not remove the legacy systemd block merely because the syntax
checker passes. Do not copy PR196's current privileged credential to the new
candidate. DEV source checks must not be conflated with a live E2E PASS.


## 18 Nov — direct launcher URL-override bypass and release marker

The previously versioned standalone launcher inspected the URL authority,
but `pg-connection-string` may honor query overrides such as `?user=`,
`?host=` or `?port=`. The launcher now refuses **all URL parameters and
fragments**, requires the exact `/postgres` database path and literal
port 6543, and requires `APP_ENV=development`. An independent,
root-controlled `/etc/ai-task-dev-authorized-reader-and-release.ready`
marker must exist **before** the launcher even reads the credential file;
symlinked or missing markers are refused. This is independent of systemd's
`RefuseManualStart=yes` because @reboot/direct invocations bypass systemd.

As of the latest audit the marker is absent and the old service must
remain off. Reader-role syntax alone cannot authorize execution while its
database role remains `NOLOGIN`. The protected original launcher remains
available as a rollback backup. Source-unit tests now include positive
syntactic validation and actual query-override rejection.

The isolated candidate gate also rejects all URL query parameters,
fragments, and non-`/postgres` database names. These are **format-only**
controls: they cannot establish real credential validity, TLS certificate
validation, RLS tenant isolation or E2E execution rights.
