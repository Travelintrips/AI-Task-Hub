---
name: Sport Center Availability Check
description: Pre-form availability check for booking_lapangan intents; table, gate logic, and flow details.
---

## What was built
For sport center booking intents (booking_lapangan, sport_center_booking, field_booking), the WA AI now:
1. Asks for field_type + booking_date + start_time (normal intake flow)
2. Runs `checkSportCenterAvailability()` once all three are present
3. Replies with ✅ available (asks "balas ya") OR ❌ unavailable (shows free slots)
4. Waits for user confirmation ("ya"/"oke"/etc.) before sending form link
5. If user changes date/time at any point → re-runs availability check (resets `_avail_confirmed`)

## New table: sport_center_bookings
Created via `runCoreMigrations()` in `artifacts/api-server/src/app.ts`:
- columns: company_id, ai_task_id, intake_session_id, field_type, booking_date, start_time, end_time, duration_hours, booker_name, phone, status, notes
- indexes: `sc_bookings_date_idx`, `sc_bookings_field_idx`
- Written via `saveSportCenterBooking()` in `artifacts/api-server/src/lib/sport-center-availability.ts`
- Called from `artifacts/api-server/src/routes/intake-form.ts` after task creation (non-fatal)

## Key files
- `artifacts/api-server/src/lib/sport-center-availability.ts` — NEW: all availability logic
- `artifacts/api-server/src/lib/intake-engine.ts` — gate injected before `isComplete` check; imports from sport-center-availability
- `artifacts/api-server/src/routes/intake-form.ts` — saves booking record after form submit

## Session state keys (stored in intake_sessions.collected_fields)
Private keys managed by the gate (prefixed `_`, excluded from form/task):
- `_avail_status`: "available" | "unavailable" — result of last check
- `_avail_checked`: true — whether a check was run
- `_avail_confirmed`: true — user confirmed the slot; gate passes through

## Edge cases handled
- User changes date/time → ALL three keys cleared → re-check runs (even if previously confirmed)
- No DB connection → assumes available, warns in log
- Invalid date/time format → returns error message to user
- Slot outside operating hours (07:00-22:00) → rejects with message
- Field matching: strips generic words ("lapangan", "court") before ILIKE

**Why:** User requirement: AI should check availability before sending form, not immediately send form link when "Booking Lapangan Olahraga" is received.
