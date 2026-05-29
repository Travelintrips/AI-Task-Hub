---
name: Routes migrated from supabaseQuery to Drizzle
description: messages, documents, team routes were reading from Supabase (supabaseQuery) which is not configured — all migrated to Drizzle (Replit Postgres).
---

## Rule
Routes `/messages`, `/documents`, and `/team` previously used `supabaseQuery` → would crash with 500 when Supabase DB is not configured. All three migrated to Drizzle ORM with `requireAuth` added.

**Why:** Supabase is only used for file storage (via service role key), not as the primary DB. Primary DB is Replit Postgres via Drizzle. Using `supabaseQuery` without Supabase configured causes runtime 500 errors.

**How to apply:** Any new data route must use `db.select().from(someTable)` from `@workspace/db`, not `supabaseQuery`. Always add `requireAuth` to protect routes.

## Other fixes done in same session
- `company_settings` table was missing from DB — fixed with `pnpm --filter @workspace/db run push`
- `activityTable` schema: columns are `type`, `description`, `entityId` (NOT `taskId` or `companyId`)
- `POST /ai-tasks` route was missing — added manual task creation with auto-generated `taskNumber` format `WA-YYMM-XXXX`
- `notifyTaskCompleted` added to `notifications.ts` — triggered when status changes to "completed"/"Completed" (not `notifyStatusChanged`)
- Valid roles for `requireRole()`: `super_admin`, `company_admin`, `supervisor`, `staff`, `vendor`, `customer` (NOT "admin")
