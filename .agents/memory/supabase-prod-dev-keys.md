---
name: Supabase PROD vs DEV project keys mismatch
description: Why Supabase Storage fails with "signature verification failed" while DB works fine
---

# Two Supabase projects

- PROD project ref: `nzdweipzckfszczzqtuw` — this is where the real DB data lives
  (`SUPABASE_DATABASE_URL` pooler user `postgres.nzdweipzckfszczzqtuw`; `SUPABASE_ANON_KEY`
  and `VITE_SUPABASE_ANON_KEY` carry ref=nzdweipzckfszczzqtuw).
- DEV project ref: `xssrfshdrtdfupgqwfdw` — `*_DEV` secrets point here.

# The bug

`SUPABASE_SERVICE_ROLE_KEY` carries ref=`xssrfshdrtdfupgqwfdw` (DEV), but storage code targets
the PROD project URL (`config.ts` `SUPABASE_PROJECT_REF = nzdweipzckfszczzqtuw`). A service_role
JWT signed by the DEV project fails signature verification on the PROD storage endpoint →
HTTP 400/403 "signature verification failed". **There is no PROD service_role key anywhere** —
both `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY_DEV` decode to the DEV ref.

**Why it matters:** DB reads (raw pg via SUPABASE_DATABASE_URL) work fine, so the app looks
connected, but Storage (document uploads/bucket creation in `lib/supabase.ts`) silently fails.

# How to verify a key's project without leaking it

Decode the JWT payload's `ref` claim (not secret): `ref` and `role` claims tell you which
project + privilege the key is for. The DB pooler username's second dotted segment is the
project ref.

# Fix

User must supply the PROD project's service_role key (from the nzdweipzckfszczzqtuw Supabase
dashboard) into `SUPABASE_SERVICE_ROLE_KEY`. Cannot be derived locally.
