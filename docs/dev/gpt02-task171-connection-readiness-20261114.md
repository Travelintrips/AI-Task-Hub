# GPT02 DEV Task #171 — dedicated preparer readiness, NO DISPATCH

## Current hosted CST-DEV fact snapshot (read-only)

The existing Task #171 has its audited fresh instruction and its original
PIC. Audit #2622 and corrective audit #2623 are preserved, with no new
execution, Core preparation or command-attempt binding.

The scoped database function is deployed and its active SHA256 remains
81a549214cb354283741f51d0411fb646b4bca118876e450c8cb191b41b8ea43.
The restricted preparer login role has NOLOGIN, connection limit 0, an expired
valid-until value, **no SCRAM verifier**, no sessions, no inherited role
memberships, and no authority to sign/dispatch commands. The existing
host-side encrypted, libpq-format credential bundle is not the same as an
authenticated, current PostgreSQL role: it cannot be interpreted as proof
that login is usable. Never use the shared application database password as
a fallback.

## Change in this branch

A Super Admin-only GET readiness now uses server-trusted database catalog
facts to check the **actual** preparer account, not user-supplied booleans.
It distinguishes a locked login, missing verifier, excessive privileges,
multiple sessions and unbounded/expired validity. No password hashes or
credential strings are returned.

Even when feature flag and catalog pass, the preparation button remains
disabled until the server opens a separately scoped, TLS-pinned **READ ONLY**
database session and verifies PostgreSQL current_user=session_user,
least-privilege rights and a 10-minute-or-less login validity window.
A successful preflight is evidence of authentication **only**, never a
signed operator approval, nonce grant, issuer lease or dispatch permission.

The preparer client pool max was lowered from two to one so it cannot
accidentally exceed the separately restricted login connection limit.
The POST prepare-only route retains its own independent role, RLS,
schema and task scope checks and is not weakened by this change.

## Evidence and remaining boundary

All tests use injected offline PostgreSQL clients and synthetic role
metadata. No login, password, database row, issuer, signer, worker or PROD
state was changed. The actual DEV container still has
GPT02_CORE_PREPARATION_ENABLED=false. This branch is a fail-closed
diagnostic; it does not activate the dormant account or dispatch Task #171.

Before a real one-time Core PENDING/Hub prepared reservation, require a
separately approved short-lived dedicated SCRAM credential, pinned CA and
server-side identity proof; then an authenticated Super Admin request.
Never promote chat text or an old PIC audit to signed dispatch consent.


## Review correction: POST cannot bypass the short-lived account gate

Independent PR #182 review identified a direct-POST bypass: an account with
unlimited lifetime was rejected by the diagnostic GET but could have reached
COMMIT inside the preparation POST. Fixed in the actual
Gpt02CoreTaskPreparer.prepare transaction (not only in the UI):

- Verify this exact PostgreSQL client has authenticated, encrypted TLS before
  even starting a transaction.
- Inside the same BEGIN transaction that invokes prepare_core_task, query
  PostgreSQL's authenticated current_user/session_user, restricted role flags
  including NOINHERIT, session connection limit = 1, and server-side
  rolvaliduntil > clock_timestamp() and <= clock_timestamp()+10 minutes.
- Fail closed and ROLLBACK before SECURITY DEFINER invocation on any mismatch,
  even when the caller bypasses the browser and sends a direct POST.
- Preserve all existing direct DML, catalog/schema, Core/Hub, task, and
  no-command / no-dispatch checks.

Injected untrusted synthetic LOGIN, unbounded TTL, wrong role, unverified TLS
and noinherit cases are explicitly tested in
artifacts/api-server/tests/gpt02-core-task-preparation.test.mjs. This is
source-only; it does not create a password, enable LOGIN, connect to PROD,
generate a command, or dispatch a worker.
