---
name: Two databases (Helium vs Supabase)
description: AI Task Center routes read from Supabase but auth/login stays on Helium — never collapse them.
---

The project has **two** Postgres databases with completely different schemas:

- **Helium** (`DATABASE_URL`, also `PGHOST/PGUSER/...`) — used by Drizzle (`@workspace/db`). Holds the auth users table with bcrypt password hashes. Login + session lives here.
- **Supabase** (`SUPABASE_DATABASE_URL`) — a different app's DB (logistics/trading: sales_documents, purchase_documents, wa_incoming_messages, users with text id, ~80 tables). AI Task Center's *display* data is sourced from here via raw `pg.Pool` in `lib/supabase-db.ts`.

**Rule:** never repoint `DATABASE_URL` to Supabase — schemas don't match, Drizzle queries break, login breaks. Auth (`/auth/login`, `/auth/me`, `/auth/password`) stays Drizzle/Helium. List endpoints (`/messages`, `/tasks`, `/documents`, `/team`, `/dashboard/*`, `/ai-tasks`, and `/auth/users` GET) use `supabaseQuery()`.

**Why:** the user expects to see their existing operational data (WhatsApp messages, sales orders, employees) in the AI Task Center UI without re-entering it. But Supabase has no `password_hash`-compatible login flow for this app and its users.id is text not int.

**How to apply:** mutations on the display routes return 501 (read-only). Frontend mutations may surface errors — that's expected until the user asks for write-back. Field mapping pattern: SQL aliases columns → JS object literal renames to existing API shape so the generated React Query hooks keep working without codegen changes.
