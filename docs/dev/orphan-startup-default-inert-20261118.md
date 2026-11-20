# AI Task DEV: orphan API startup is inert without explicit APP_ENV

Status: Draft source-only. No active DEV deployment or PROD change.

## Incident and reproducible evidence, 18 November 2026 WIB

An unexpected AI Task API process PID 970512 (previous occurrence PID
4009589), started through a Remote Desktop Commander terminal, became an
orphan with PPID=1 inside the Desktop Commander service cgroup. It listened
on unused loopback port 18081, inherited an obsolete Supavisor pooler URL,
and did not declare APP_ENV or DISABLE_BACKGROUND_SCHEDULERS. The original
app.ts started follow-up, order sync, escalation, intelligence, Fleet and
executive schedules, plus its SLA 15-minute setInterval, by default. The
startup migration default also ran when NODE_ENV=development and
RUN_STARTUP_MIGRATIONS was absent. Auth failures on the shared Supavisor
egress were observed and the Customer Portal DEV temporarily became 503.
This is NOT a defect of Customer Invoice PR #206 and does not authorize
changing its database credentials.

That exact orphan PID was stopped with graceful SIGTERM **only after**
confirming its source/cwd, PPID1, unrelated Desktop Commander MainPID,
no reverse-proxy route and no active clients on port18081. The official
AI Task PR196 DEV container remained healthy, Desktop Commander remained
active, and Customer Portal DEV returned 200 again. PROD unaffected.

## Narrow prevention in the existing source

Both artifacts/api-server/src/app.ts and src/index.ts now require explicit
APP_ENV=development or APP_ENV=production before starting autonomous
background timers and reconciliation workers. With APP_ENV missing or
invalid, no background timers are started even if NODE_ENV=development
and DISABLE_BACKGROUND_SCHEDULERS is unset/false. With APP_ENV missing
or invalid, no automatic migration or Storage bucket/schema checks start
from app.ts. Existing explicit opt-outs remain valid.

Official DEV and PROD APP_ENV are explicitly set, therefore their
previous scheduler behavior and configured migration opt-out remain
unchanged. No global timers were removed, WA gateway/messaging code was
not rewritten, and no Core/GPT02 signer/issuer/dispatch changed.

## Tests and activation boundaries

A focused Node/TypeScript AST test executes the existing index and app
scheduler blocks with a synthetic environment and records scheduler
calls and setInterval registration. Conditions include unset APP_ENV,
invalid preview, explicit normal DEV, explicit PROD, explicit opt-out,
and developer-requested migration opt-in. No DB, WA, or external account
is accessed by this test.

Critical limitation: the currently deployed PR196 API dist has NOT been
replaced with the guarded candidate. A separate remote terminal could
still launch OLD dist code and create another orphan until launchers
stop doing that or a reviewed DEV update installs the guard. As a
belt-and-suspenders operational rule, any DEV QA/API preview launched
from Desktop Commander must use a private QA database, explicitly set
APP_ENV=development, DISABLE_BACKGROUND_SCHEDULERS=true and
RUN_STARTUP_MIGRATIONS=false, and perform guaranteed cleanup. Never use
the inherited Desktop Commander postgres pooler URL for synthetic QA.

Do not kill or restart the Desktop Commander main service. Do not modify
official AI Task PROD, the live PR196 Docker container, Supabase passwords
or RLS. Review and test before a DEV cutover of this source-only Draft.
The repeating incident remains open until no new orphan is created and
two 15-minute intervals stay free of ai-task-hub auth errors.
