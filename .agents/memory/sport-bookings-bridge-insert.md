---
name: sport_bookings bridge insert failures
description: bridgeToSportBookings() Step 2 (public.sport_bookings) was silently failing; root causes documented with fixes applied.
---

# bridgeToSportBookings Insert Failures

## Root Causes Found (July 2026)

### 1. supabaseQuery swallows all errors
`supabaseQuery()` catches exceptions and returns `[]` silently. This means `bridgeToSportBookings` catch blocks NEVER fired. The error was only visible deep in the `supabaseQuery` logger. Fix: added `supabaseQueryStrict()` in `supabase-db.ts` that throws instead of catching — use this for bridge INSERTs.

### 2. booking_date stored as ISO timestamp, not YYYY-MM-DD
`sport_center_bookings.booking_date` stores the value as a full ISO timestamp string (`2026-07-18T00:00:00.000Z`). When bridged to `public.sport_bookings.booking_date` (which is `date` type), the implicit coercion may fail depending on Supabase/PgBouncer config. Fix: normalize with `.split("T")[0]` before inserting.

### 3. `::` type cast syntax with PgBouncer transaction mode (port 6543)
`$7::date`, `$8::time` syntax in parameterized queries fails with "syntax error at or near "::"" on Supabase Pooler (port 6543, PgBouncer transaction mode). Fix: pre-normalize data to correct types in JS, remove `::` SQL casts. Use `CAST($n AS type)` standard SQL if SQL-side casting is needed.

## Schema Reference

### sport_center.sport_bookings
- `booking_date`, `start_time`, `end_time` are all **TEXT** columns → no casting needed
- `duration_hours` is **INTEGER** → pass JS number directly, no `::integer` cast
- `status` enum: valid value is `'waiting_admin_approval'` ✅
- Facility IDs: 1=Multiguna, 2=Badminton B, 4=Tennis, 5=Badminton A, 6=Gym, 7=Billiard

### public.sport_bookings  
- `booking_date` is **DATE** → needs `YYYY-MM-DD` string
- `start_time`, `end_time` are **TIME WITHOUT TIME ZONE** → needs `HH:MM` string
- `facility_id` has FK to `public.sport_facilities` (nullable) → can be null
- `company_id = 1` hardcoded (correct for prod)
- Facility IDs: 1=Gym, 2=Multiguna, 3=Badminton B, 4=Tennis, 5=Badminton A, 6=Billiard
- UNIQUE constraint on `booking_number` ✅

## Fix Applied
- `supabase-db.ts`: added `supabaseQueryStrict()` 
- `sport-center-availability.ts` `bridgeToSportBookings()`: 
  - Uses `supabaseQueryStrict` for both INSERTs
  - Normalizes `bookingDate` to `YYYY-MM-DD` (strips ISO timestamp T-suffix)
  - Normalizes `startTime`/`endTime` to `HH:MM` (first 5 chars)
  - Removed all `::date`, `::time`, `::integer` SQL cast syntax
