---
name: GitHub sync reverts Supabase route work
description: Why the AI Task Center display routes keep "losing" their Supabase integration and how to restore it
---

# Symptom

User repeatedly reports dashboard/pages "kosong lagi" (empty again) after a while. The
API route files (`artifacts/api-server/src/routes/*`) revert from Supabase reads back to
the original Drizzle/Helium versions, so the mostly-empty Helium tables show no data.

# Root cause

This repo is synced with an external GitHub repo (Travelintrips/AI-Task-Hub). Merge
commits labeled `latest application updates` (e.g. introduced via a `Merge branch 'main'`)
bring in the upstream Drizzle versions and **overwrite** the local Supabase rewrites of the
display routes. Each upstream sync wipes the integration again.

**Why:** the integration lives only locally; upstream GitHub has the Drizzle versions, so any
pull/merge from GitHub clobbers it.

# How to restore (write file contents from the last good Supabase commits — does NOT touch git history)

The Supabase versions were committed under "Integrate Supabase for displaying operational data".
Restore by writing the good blobs into the working tree:
- `ai-tasks.ts`, `dashboard.ts` ← the "Show all sales documents as AI tasks" commit (has no `ai_generated` filter)
- `messages.ts` ← the "Update message timestamps" commit (timestamp emitted as UNIX seconds string)
- `tasks.ts`, `team.ts`, `documents.ts`, `lib/supabase-db.ts` ← the Supabase integration commit
- `auth.ts` `/auth/users` GET ← patch to use `supabaseQuery` against `users` (keep Helium login intact)

Find them with: `git log --oneline -S "supabaseQuery" -- artifacts/api-server/src/routes/`

# Gotchas

- Build uses esbuild (no typecheck), so `supabaseQuery<T>` constraint errors (TS2344) and
  TS6305 "db not built" do NOT block runtime. Endpoints work despite `tsc` errors.
- curl cannot test authed endpoints over http://localhost: the session cookie is `Secure`,
  so curl never stores it (browser over HTTPS works fine). A bare curl returns 401 — that is
  expected, not a bug. Verify data via direct `psql "$SUPABASE_DATABASE_URL"` instead.
- The legacy `API Server` workflow (from `.replit` Project runButton) duplicates
  `artifacts/api-server: API Server` on port 8080 and shows FAILED with EADDRINUSE — harmless
  noise; the artifact workflow holds the port.

# Durable fix (not yet done)

To stop the recurrence the Supabase route changes must land in the upstream GitHub repo, or the
upstream must stop overwriting these files. Otherwise every GitHub sync reverts them.
