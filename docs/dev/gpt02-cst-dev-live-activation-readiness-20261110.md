# GPT02 CST-DEV — evidence-grounded activation readiness, no dispatch

## Scope

This step does **not** run a new task, migrate a database, activate issuer credentials, sign an approval or dispatch to DELL. Previous Task136 (`WA-2611-4633`) completed a one-shot native response with final ACK; Task135 failed in an earlier unrelated attempt. Neither may be replayed/backfilled. The DEV lifecycle API and `prepared` Hub/Core job still reject dispatch/automatic tracking. The current source branch has already passed isolated atomic Hub/Core reservation, Ed25519 triple-signer checks, one-time nonce and short-lived non-authorizing evidence-fence tests. Those are **synthetic fixtures**, not live lifecycle authorization.

## Actual CST-DEV blockers verified by a read-only database session

Read-only query through the current Hub DEV application database URL on the existing CST-DEV Supabase project, at **2026-11-09 18:30:08 UTC**, showed:

- `current_user=postgres`; the Hub application login has `CREATEROLE` and `BYPASSRLS`. This is not a restricted, independently scoped GPT02 admission account. There are ~831 `public` and ~234 `ai_platform` tables in the shared project. An untested global role/privilege switch would risk breaking unrelated working DEV services.
- A dedicated `gpt02_core_prep_login` is absent/not enabled and its own actual direct DML privileges have not been verified from an independently authenticated session. The synthetic `gpt02_stage` Core/Hub preparation table and function are not deployed.
- The independent `dev_gpt02_issuer_evidence` and `dev_gpt02_attestor_evidence` identities are **NOLOGIN**, and the linked approval/nonce operational functions are absent. The existing `gpt02_private.approvals` and `.receipts` tables are empty and FORCE RLS is enabled; the private roles have no direct CRUD privilege.
- No new Hub execution in `prepared` status exists. The `ai_platform.internal_users` catalog has two active `owner`/`admin` entries with password-change flags cleared; this aggregate is **not proof that either is the currently authenticated, independently signing Core operator for a future command**.
- No fresh **per-command** Super Admin signature, consumed nonce or independently issued worker dispatch lease exists for a new task. No new command may be authorized based on an old browser session or the completed Task136 final ACK.

The complete bounded output is `GPT02_LIFECYCLE_NO_GO` with exact reasons. No secrets, email addresses, DSNs, tokens, role passwords or private table rows are printed.

## New reusable tool and tests

`scripts/dev/gpt02-lifecycle-live-preflight.cjs` is a self-contained **read-only** tool, not imported into any HTTP route/worker. It pins CST-DEV project reference `xssrfshdrtdfupgqwfdw` and rejects wrong project, production app mode, insecure TLS setting, foreign pooler endpoints, malformed DSNs and credentials in output. The connection requires a pinned, verified public Supabase Root 2021 CA certificate (official source, SHA-256 fingerprint `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`) and explicit TLS peer verification; missing/changed CA fails closed. A successful connection starts `BEGIN READ ONLY`, performs a single bounded catalog/aggregate SELECT, and rolls back. It reports role state, whether preparer/issuer functions exist, counts of approvals/receipts/prepared tasks and exact blockers. It does **not** probe credentials, temporarily enable roles or reuse the retired login-rotation diagnostic that previously caused a pooler IP ban.

**Important:** Even if simulated inputs are all `true`, `releaseDecision=NO_GO`, `approvalGranted=false`, `issuerGrantReady=false`, `dispatchPermitted=false`, `autoContinuePermitted=false`. Static role catalog checks cannot prove a separate preparer's effective access or authenticate signed operator consent. The tool deliberately cannot promote an HTTP request to issuer authority.

Seven deterministic unit/security tests passed: DEV-only targeting, wrong-project/role/TLS refusal, no authorization with forged green flags, Core operator not mistaken for signature, exact previously observed live blockers, SQL read-only/secret-avoidance, and fail-closed behavior on unreadable DB. The live run against CST-DEV returned a single JSON report with `connected=true`, `readonly=true`, 10 missing proof/activation blockers and NO_GO. CI runs these tests inside an existing verified workflow step, without adding extra GitHub job steps.

## Operational decision

**Do not directly alter the shared Hub `postgres` permissions or activate the issuer/attestor roles to force PASS.** A safe next rollout must be a bounded, independently authenticated identity/permission cutover for the GPT02-specific preparer and signer, with fresh operator approval bound to a *new* Hub/Core prepared pair. Existing app modules should continue using the current working DB connection until their own least-privilege regression is complete. The nonce evidence fence remains non-authorizing and is not a true lease. Once valid independent signed approval, real issued one-shot lease, runtime dispatch and final native ACK are demonstrated for a separately approved new DEV test, lifecycle E2E can be assessed. Until then **full lifecycle remains NO_GO**. PROD untouched.
