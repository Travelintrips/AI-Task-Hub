> **Retired after incident:** the live temporary-credential probe described below must not be rerun. Its cleanup was followed by cached pooler reconnect failures and a CST-DEV IP ban. See `gpt02-text-test-136-and-pooler-incident-20261109.md`; the entry point now refuses execution. Earlier connection-proof results do not imply operational safety of the diagnostic lifecycle.

# CST-DEV: dedicated session-pooler login proof

## Scope

Continuation of the user's instruction to use the existing CST-DEV project only. No project/branch creation, no PROD deployment, no Task #135 retry and no native dispatch. The general Hub connection, PR #156 image and passwordless DEV dashboard are not changed.

## Connectivity issue and source fix

The active Hub uses the existing CST-DEV shared session pooler on port 5432. The direct endpoint resolved only to IPv6 and was not reachable from the tested runtime (`ENOTFOUND` during the connection attempt). The earlier direct-only candidate configuration therefore did not cover the actual usable path.

`issuerPoolConfig` now supports **explicitly configured** `session_pooler` mode as well as the existing default direct mode. Session mode requires an exact server-pinned Supabase pooler hostname, port 5432, the dedicated role username suffixed by the existing DEV project ref, the postgres database, and an explicit CA. It rejects transaction mode/port 6543, missing or wrong project suffix, administrative usernames, startup/SSL URL options and lookalike hosts. There is no automatic fallback and no change to the Hub DSN.

TLS certificate and hostname verification remain enabled. A read-only connection without the Supabase CA failed with SELF_SIGNED_CERT_IN_CHAIN. Two legacy public certificate URLs returned 404; neither was trusted or used. The current URL was traced to Supabase's own Studio source (`apps/studio/hooks/custom-content/custom-content.json`, upstream commit `4c686101671fa512225575b44a7b08ff66538780`):

`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`

The downloaded public root was checked as a CA, in-date, and pinned by DER SHA-256 `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`. The `prod` portion names Supabase's public provider certificate, not this application's production database. The subsequent connection verified the remote certificate and negotiated TLS 1.3. No application TLS configuration or project SSL setting was changed.

## Bounded live credential test

The operator-only runner `scripts/dev/gpt02-cst-dev-bounded-login-smoke.mjs` requires an explicit enable flag, exact DEV runtime/host/project, inactive role preconditions, zero candidate sessions, empty evidence tables, and no operational record/consume functions. It creates random **memory-only** passwords for the two existing candidate roles, enables login for a 120-second credential-validity window with connection limit 2, and adds **no table, schema or function grants**.

Each role opens a genuinely separate hosted PostgreSQL connection using the same candidate session-mode configuration. Tests run inside `BEGIN READ ONLY`. Actual results for attestor and issuer:

- `current_user` and `session_user` both match the respective dedicated role.
- No elevated attributes or role memberships; no schema CREATE or evidence-schema USAGE.
- Zero effectively accessible application relations and zero accessible non-system SECURITY DEFINER routines. Public invoker/trigger routines remain part of the shared database's baseline; this is not a claim that no function whatsoever can be called.
- Seven live denial checks per role: task/user/evidence reads and SET ROLE to owner, postgres, or the other role all return SQLSTATE 42501.
- Client-to-pooler TLS verified, TLSv1.3. The pooled backend reports `pg_stat_ssl.ssl=false`; **do not claim end-to-end TLS to PostgreSQL** from the client result. The shared project's SSL enforcement was not changed because that requires a separately controlled rollout and can affect other modules.

The cleanup always attempts to close clients, remove the test passwords, restore NOLOGIN and CONNECTION LIMIT 0, expire the credential timestamp, verify zero approval/receipt rows, and terminate only candidate-role pooled backend sessions created in the bounded test window. The first run left two idle Supavisor backend sessions after client close; those exact sessions were separately retired. The runner was then amended to include this retirement automatically. An interrupted process is not a deployment: its short password lifetime is a backstop, and any cleanup failure is reported as CRITICAL_RELOCK_REVIEW, never PASS.

## Remaining operational gates

This is a real restricted **connection/denial** test, not approval/nonce issuance. It does not install operational record/consume functions or grant dispatch. No synthetic approval rows are written to CST-DEV. The two roles are locked again, not permanently activated or injected into the application.

The Hub's general database login still has administrative privileges and ADMIN OPTION over evidence roles. This test does not close that escalation path. Shared-database application isolation, complete callable-routine review, actual Super Admin consent and typed Core/Hub actor binding, signing-key ownership, grant/lease fencing and the DELL final ACK remain independent requirements. Existing numeric Core IDs and text Hub IDs are not modified by this change.

**Result: dedicated hosted role login + bounded denial tests proven; operational issuer cutover and native E2E remain NO_GO.**

## Primary references

- Supabase direct/session/transaction connection modes: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase SSL configuration: https://supabase.com/docs/guides/platform/ssl-enforcement
- Official certificate URL source: https://github.com/supabase/supabase/blob/4c686101671fa512225575b44a7b08ff66538780/apps/studio/hooks/custom-content/custom-content.json
