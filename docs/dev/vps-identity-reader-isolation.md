# DEV VPS inventory identity readback: source-only least-privilege plan

## Verified source drift
The actual CST-DEV project is xssrfshdrtdfupgqwfdw; the session pooler
host seen on the live DEV canary is aws-1-ap-southeast-2.pooler.supabase.com:5432.
The actual public.users table uses id TEXT, company_id INTEGER NULLABLE,
email TEXT NULLABLE, is_active BOOLEAN NULLABLE, and status TEXT.
The Drizzle model is different (SERIAL id and TEXT company_id).
Do NOT modify the shared table merely to match the stale code model.
The running DEV app uses postgres.<project> with BYPASSRLS; this existing
credential must not be reused for a candidate read-only identity check.

## Reader
- Manual-only SQL: scripts/dev/vps-identity-reader-prepare.sql
- New role: ai_task_vps_identity_reader_dev, created with NOLOGIN.
- Grants: public schema USAGE plus column SELECT on
  id, email, company_id, role, is_active and status; no password_hash.
- RLS: active Super Admin row must exactly match the id, normalized email
  and numeric/null company context provided by the server in a read-only
  transaction. This app-provided context is NOT independent identity proof.
- Runtime helper connects through a separate max-one-connection pool.
  It does not use @workspace/db, the postgres login or a PROD fallback.
- TLS CA verification is mandatory, and all errors fail closed.
- The recent verified Google OAuth claim and separate host-controlled
  Supabase Auth UUID allowlist from PR #185 remain mandatory.

## Required deployment settings, currently all NOT activated
NODE_ENV=development
APP_ENV=development
VPS_STORAGE_INVENTORY_READONLY_ENABLED=true
AI_TASK_DEV_EXPECTED_PROJECT_ID=xssrfshdrtdfupgqwfdw
VPS_STORAGE_IDENTITY_READER_URL_DEV=(password-bearing DEV-only session pooler URL)
VPS_STORAGE_IDENTITY_READER_CA_FILE=(absolute mounted DEV CA certificate file)
VPS_STORAGE_TRUSTED_GOOGLE_AUTH_USER_IDS=(owner-approved Supabase Auth UUIDs)
VPS_STORAGE_INVENTORY_PATH=(absolute read-only JSON inventory fixture)

For the shared session pooler the username must be
ai_task_vps_identity_reader_dev.<project-ref> and port 5432.
Use the exact Connect dialog endpoint and TLS root certificate.
Do not paste credentials, JWTs, user IDs or session material into chat or GitHub.

## Independent future gates
1. Exact-head CI and security review PASS for source-only PR.
2. Owner separately authorizes NOLOGIN role creation in CST-DEV (never PROD).
3. Explicit later approval to enable a scoped login with password/expiry,
   session limit one and verified TLS. No plaintext secrets in migration SQL.
4. Verify role has no BYPASSRLS, broad table privileges, DML, CREATEROLE
   or read-all membership; check RLS for wrong company, absent context,
   inactive and wrong identity.
5. Candidate may only connect to CST-DEV through read-only access while
   schedulers, migrations, WA, issuer, signer, GPT02 preparation/dispatch OFF.
6. Real owner independently signs in with Google OAuth and provides no
   raw token or password to chat; readback tests are conducted only under
   an approved secure authenticated session.
7. Do not change Nginx or live DEV traffic until E2E proves equivalence.
   PROD never included.

## Tests
- node --experimental-strip-types --test scripts/dev/vps-identity-reader-contract.test.mjs
- node --experimental-strip-types --test scripts/dev/vps-storage-google-session-contract.test.mjs
- node --test scripts/dev/vps-storage-readonly.test.mjs
- bash scripts/dev/test-vps-identity-reader-postgres16.sh
  (offline Docker PostgreSQL 16 temporary synthetic DB, always cleaned)
- pnpm run typecheck
- pnpm --filter @workspace/api-server run build

NO GO: This PR must not automatically run SQL, enable DB LOGIN, configure
secrets or inventory flag, restart live services, modify PROD, or dispatch GPT02.
