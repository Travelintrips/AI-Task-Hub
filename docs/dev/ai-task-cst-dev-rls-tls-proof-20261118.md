# CST-DEV AI Task Hub — Role/RLS & TLS verification evidence (18 Nov 2026)

**Project scope:** Supabase CST-DEV `xssrfshdrtdfupgqwfdw`, VPS `srv1792369`, Draft PR #207. **No PROD, signer, issuer, dispatch, approval, migration or business-data write in this audit.**

## 1. Actual database privilege-context test — PASS

The pre-existing staged role `ai_task_operational_dev` remains `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT`. There is one restricted RLS policy on `public.ai_tasks` allowing only `company_id='default' AND id=171`, plus column-level SELECT on `id, company_id, status, task_number, created_at`.

To test SQL privilege enforcement **without generating a password or logging in as the candidate role**, the CST-DEV administrative SQL session performed a single atomic transaction:

1. `BEGIN`; temporarily `GRANT ai_task_operational_dev TO postgres WITH SET TRUE, INHERIT FALSE`
2. `SET LOCAL ROLE ai_task_operational_dev`
3. Under this effective database role, an anonymous DO block asserted the following at execution time:
   - `current_user='ai_task_operational_dev'` and `row_security=on`
   - `SELECT count(id) FROM public.ai_tasks` returns exactly **1**
   - That one row is **Task 171** with `company_id='default'`
   - No visible rows where `company_id='1'`
   - No visible rows for Task IDs 135, 136 or 167
   - No SELECT on `title`, no full-table SELECT, and no INSERT/UPDATE/DELETE table privileges
4. `RESET ROLE; ROLLBACK`, followed by an independent catalog check

The command returned:
- `restored_original_role=true`
- `no_persistent_set_role_access=true`
- `candidate_still_nologin=true`
- `candidate_still_no_bypass=true`
- `persistent_set_grants=0`

Post-test recheck independently confirmed `pg_has_role('postgres','ai_task_operational_dev','SET')=false`, **zero live sessions**, and no persisted role membership with SET. The test did **not** call INSERT/UPDATE/DELETE, nor alter any task row.

**Scope of PASS:** actual PostgreSQL privilege-context + RLS enforcement and transactional rollback. **Not** a client-authenticated role LOGIN, nor service-level E2E.

## 2. Certificate distribution and actual pooler TLS — PASS without credentials

The former public `https://supabase.com/prod-ca-2021.crt` and `https://supabase.com/downloads/prod-ca-2021.crt` paths returned HTTP 404. A public certificate remains available over verified HTTPS from:

`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`

- X.509 subject/issuer: **Supabase Root 2021 CA**
- DER SHA-256: `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`
- Validity: 2021-04-28 to 2031-04-26
- Public reference: https://github.com/supabase/supabase/issues/50862 (claims the same root fingerprint was verified using the dashboard-provided certificate). This public issue is supporting evidence, **not** a direct authenticated download from this project's dashboard.

Using the **existing PR196 container's connection hostname** but without reading or transmitting a PostgreSQL password, OpenSSL `-starttls postgres` performed a TLS handshake to transaction pooler port 6543 using that CA and `-verify_hostname` on the original hostname:
- Successful handshake: **TLS 1.3**, `TLS_AES_256_GCM_SHA384`, **Verification: OK**, exit 0.
- Wrong hostname (same CA, intentionally mismatched identity): `verify error:num=62:hostname mismatch`, exit 1.
- Without this CA, the VPS's default trust store rejected the chain as `self-signed certificate in certificate chain`.

A copy of the validated **public** CA has been placed at `/run/credentials/ai-task-dev/supabase-ca.pem`, owned by `root:root`, mode `0444`, regular file, with its fingerprint checked again after installation. This is an **ephemeral /run staging location**; a reboot requires authorized restaging. No application or service configuration was changed.

**Scope of PASS:** TLS trust-chain and hostname verification to the real shared Supavisor endpoint, with no database StartupMessage or password sent. Does **not** establish backend authentication, exact project authorization, or verify the pooler's upstream Postgres hop. Before operational release, confirm the public CA against the **authenticated CST-DEV Dashboard** where available.

## 3. Runtime safety and NO-GO boundary

- `ai-task-development.service`: inactive/dead, disabled, `RefuseManualStart=yes`, `Restart=no`
- Release marker `/etc/ai-task-dev-authorized-reader-and-release.ready`: **absent**
- Official AI Task PR196 DEV, Customer Portal DEV, and AI Task PROD: previously observed healthy; PR196 `GET /api/readyz` HTTP 200.
- Draft PR #207 contains the candidate-only `resolveAiTaskDbSsl` helper and CI. **Not merged, not deployed** to official PR196 or PROD.
- Role `ai_task_operational_dev`: **NOLOGIN**, no password, no write grants. No client-authenticated transaction or application E2E.
- Do **not** turn on the background scheduler, legacy service, signer/issuer/dispatch, or PROD to satisfy a test.

**Next admission gate:** independently approved secret custody and role LOGIN (no passwords in chat or logs), verified TLS as the actual role, negative tenant and permission E2E using the dedicated credential, staged PR207 artifact deployment with rollback. Only then consider a DEV operational PASS.

Links: [PR #207](https://github.com/Travelintrips/AI-Task-Hub/pull/207), [Issue #203](https://github.com/Travelintrips/AI-Task-Hub/issues/203).


## 4. Hardened release acceptance (further code audit)

- The dedicated candidate SSL helper now pins the independent DER SHA-256
  `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`,
  requires `X509Certificate.ca=true`, and rejects an unrelated *valid* CA.
  The public root certificate (not secret) is checked in as a unit-test fixture.
- Setting `AI_TASK_DEV_ISOLATED_E2E=true` now causes the existing DB pools
  to **fail startup before opening PostgreSQL** unless
  `AI_TASK_DEV_REQUIRE_VERIFIED_TLS=true`,
  `DISABLE_BACKGROUND_SCHEDULERS=true`,
  `RUN_STARTUP_MIGRATIONS=false`,
  `NODE_ENV=development` and `APP_ENV=development`.
  Any missing/wrong CA, pooler target or role also fails closed.
  The official PR196 DEV and PROD, which do **not** set this candidate flag,
  retain their previous connection behavior; they have NOT been redeployed.
- Credential provisioning through the connected remote-command channel was
  blocked by access safety checks. No workaround/alternate privileged secret
  transfer was attempted. **Do not claim a new password or successful LOGIN.**
  An authorized secret-provisioning channel is needed before an actual
  authenticated PostgreSQL E2E.
- Source tests/CI provide *code* evidence only; no new live DB credentials,
  LOGIN rights, business writes, signer/issuer or dispatch changed.
