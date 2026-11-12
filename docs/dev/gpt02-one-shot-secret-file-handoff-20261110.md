# GPT02 CST-DEV — one-shot protected credential handoff (NO-GO until live proof)

## Scope

PR #156 was merged into `develop` at `a43b0a8067200c5570c8a5eda5e1a81a8f11784c`, with 39/39 successful post-merge CI steps. The real CST-DEV role `gpt02_core_prep_login` is still **NOLOGIN, password NULL, expired**. The user's approval, recorded in [Issue #157](https://github.com/Travelintrips/AI-Task-Hub/issues/157), authorizes only **one short-lived, read-only authenticated session**. It does not authorize a task, function activation, command dispatch or PROD changes.

## Operator-only handoff

The source-only `scripts/dev/gpt02-preparer-credential-file-handoff.mjs` is a wrapper around the merged `gpt02-preparer-dedicated-login-readonly.mjs`. It **does not provision a credential, activate a role, modify tables, or deploy a service**. The appointed security operator is responsible for using their approved secret-management process to provision a time-limited SCRAM password for the dedicated role. The operator must also revoke and read back the role state after a temporary test.

A credential manager may materialize the **password only** into a protected file owned by the UNIX UID executing the probe. The file must be a regular file, not a symbolic or hard link, with no symlink components in its parent path, owner-read permission and no group/world/execute bits (for example mode `0400` or `0600`). It must contain one 43–128-character base64url credential, with one optional final newline. The live CLI additionally requires the file path to be underneath the protected systemd credential namespace `/run/credentials/`; tests use a synthetic scoped directory override. The operator must arrange this mount through their authorized credential manager; **a plain file by itself does not prove a managed secret**. Never put a password or full DSN on the command line, in Git, issue comments, migrations, logs, or the running DEV app's environment.

Required nonsecret process environment: `NODE_ENV=development`, `APP_ENV=development`, `GPT02_CORE_PREP_DEV_PROJECT_REF=xssrfshdrtdfupgqwfdw`, `GPT02_HUB_DEV_PROJECT_REF=xssrfshdrtdfupgqwfdw`, a distinct legitimate `GPT02_PROD_PROJECT_REF`, the authorized `GPT02_CORE_PREP_DEV_POOLER_HOST` and `GPT02_CORE_PREP_SECRET_FILE`. The existing `GPT02_CORE_PREP_DATABASE_URL_DEV` must **not** be present. The wrapper validates project and TLS configuration before reading the secret, builds the dedicated username `gpt02_core_prep_login.xssrfshdrtdfupgqwfdw` for port 5432 in memory, pins the trusted public Supabase CA certificate, and uses exactly one `BEGIN READ ONLY` catalog query through the existing validated probe with rollback and no retry.

After approved provisioning and only within an isolated operator session:

```bash
# File PATH only; do not pass the password or DSN.
GPT02_CORE_PREP_SECRET_FILE=/run/credentials/approved-dev-service/dev-preparer-password \
node scripts/dev/gpt02-preparer-credential-file-handoff.mjs
```

This example does **not** activate PostgreSQL LOGIN or provision credentials. It will return `NO_GO` if the file/configuration is missing, unsafe or invalid, or if authentication is unavailable. Even when authentication succeeds, the readiness output remains `releaseDecision=NO_GO`, `dispatchPermitted=false`. The operator must independently verify and restore `NOLOGIN`, connection limit 0, password NULL and expired validity. No credential or proof of account activation was produced by this source-only change.

## Regression and non-regression

Seven deterministic tests reject missing, malformed or insecure files, symlinks/hardlinks, wrong project/TLS/host, existing shared DSN, errors and retries; they check that no secret appears in output and a synthetic read-only call happens at most once. The existing source `probe` verifies exact account identity, RLS policy hashes and NO direct table permissions or dormant function EXECUTE. These tests run in the DEV CI workflow without using real credentials or hosted PostgreSQL connections. The current DEV runtime is a guarded overlay with unrelated local work; no deployment or reset is part of this PR.

**Hold:** real hosted authentication is NO-GO until an authorized operator supplies one authenticated CST-DEV catalog readback and revocation proof for Issue #157. No Task #135/#136 replay, fresh Hub task, nonce, issuer lease, active preparer function, native DELL command or PROD action.
