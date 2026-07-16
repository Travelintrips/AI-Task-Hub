---
name: Supabase Pooler Advisory Lock Incompatibility
description: pg_advisory_xact_lock fails silently on Supabase Pooler (port 6543, PgBouncer transaction mode) — causes saveSportCenterBooking and reserveBookingCode to always return null.
---

# Supabase Pooler vs Advisory Locks

## The Rule
Never use `pg_advisory_lock` or `pg_advisory_xact_lock` when connecting via Supabase Pooler (port 6543, PgBouncer transaction mode). These functions throw an error, which is caught silently and causes the parent function to return null.

**Why:** Supabase Pooler at port 6543 uses PgBouncer in transaction mode, which does NOT support advisory locks of any kind. The Node.js `pg` Pool catches this error in try-catch and silently returns null, causing downstream code to fall back to generic messages.

**Symptom:** WA bot shows "Baik, booking Anda sudah kami konfirmasi..." (generic fallback) instead of the full confirmation with facility name + booking code. No Kode Booking shown in "Jadwal Tersedia!" message.

**How to apply:** When generating sequential IDs with concurrency control against Supabase Pooler:
- Use `supabaseQuery()` directly (no transaction) for read-only number generation
- Rely on UNIQUE constraint + retry loop (up to 3 times) for conflict resolution
- Never use `pg_advisory_xact_lock` or `pg_advisory_lock`

## The Fix (applied in sport-center-availability.ts)
- `reserveBookingCode`: Removed transaction + advisory lock; now uses `supabaseQuery()` directly for SELECT MAX
- `generateBookingNumber`: Removed `SELECT pg_advisory_xact_lock($1)` line
- `saveSportCenterBooking`: Added retry loop (up to 3 attempts) on UNIQUE constraint violation (pg error code 23505) for booking_number

## Connection String Note
- `SUPABASE_DATABASE_URL` / `SUPABASE_DATABASE_URL_DEV`: both point to Supabase Pooler at `aws-1-ap-southeast-2.pooler.supabase.com:6543` (transaction mode)
- `DATABASE_URL`: local Replit heliumdb (does NOT have sport_center_bookings table)
- Both `supabase-db.ts` and `lib/db/src/index.ts` prioritize `SUPABASE_DATABASE_URL` → `SUPABASE_DATABASE_URL_DEV` → `DATABASE_URL`
- If `SUPABASE_DATABASE_URL` is unset in dev, server falls back to heliumdb → all booking DB ops silently fail
