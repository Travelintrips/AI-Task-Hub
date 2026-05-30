---
name: Empty/zero data across all pages
description: Why every page suddenly shows 0/empty, and the correct repopulation path
---

# All pages empty / API returns 500

**Most common cause:** Drizzle schema drift. A contributor adds columns to
`lib/db/src/schema/*` (e.g. ai_tasks gained sla_hours, overdue_at, sla_status,
follow_up_count) but the DB was never migrated, so `SELECT *` queries throw
`column "X" does not exist` → route 500 → page shows empty.

**Fix order:**
1. `pnpm --filter @workspace/db run push` to apply schema to the DB.
2. Repopulate from Supabase using the canonical script, NOT ad-hoc node:
   `pnpm --filter @workspace/scripts run sync-from-supabase`
   (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; uses Supabase REST).
3. Restart `Start application` workflow to clear stale HMR
   (e.g. "useAuth must be used inside AuthProvider" is a fast-refresh artifact,
   gone after a clean reload).

**Why:** This is a 2-DB setup — Replit Postgres (DATABASE_URL) is what the app
reads; Supabase is the source of truth, synced one-way via sync-from-supabase.ts.

**Gotchas / coverage gaps in the sync script:**
- It does NOT sync ai_tasks, team_members, quotations, or documents.
- `team_members` can be backfilled from the synced `users` table (staff/admin).
- Endpoint naming: customers list is `/api/crm/customers` (NOT `/api/customers`,
  which is only `/customers/:phone`). dashboard/analytics returns aggregate
  objects, not id-bearing lists — don't count "id" to verify it.
