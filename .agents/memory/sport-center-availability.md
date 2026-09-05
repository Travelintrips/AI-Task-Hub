---
name: Sport Center Availability Check
description: Availability behavior for booking_lapangan intents, including the mini-form flow and table details.
---

## What was built
For sport center booking intents (booking_lapangan, sport_center_booking, field_booking), the WA AI now:
1. Shows the active facility menu.
2. Sends the field-booking mini-form immediately after a numbered/named facility is selected.
3. Hydrates the form's `Jenis Lapangan` field from the exact selected facility name.
4. The public form performs the availability check while the customer chooses a date/time.

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
- No DB connection/query failure → fail closed; never present a slot as available when occupancy cannot be verified.
- Invalid date/time format → returns error message to user
- Slot outside operating hours (07:00-22:00) → rejects with message
- Field matching: strips generic words ("lapangan", "court") before ILIKE

## Mini-form availability source
For the public field-booking mini-form, the development source of truth is
`sport_center.sport_bookings` in CST-DEV. Its date column is `booking_date` (text),
and facility matching comes from active rows in `sport_center.sport_facilities`.
For WhatsApp/category-level checks with multiple facilities (such as Badminton),
a start time stays available when at least one matching facility is free.
The public mini-form is stricter: it requires an exact active facility name so
availability is evaluated against one `facility_id`, not another free facility
in the same category. Reservations with statuses
`cancelled`, `rejected`, `expired`, or `refunded` do not block a slot; all other
statuses block overlapping intervals. Explicit `sport_center.blocked_schedules`
rows also block by `facility_id`, `date`, `start_time`, and `end_time`.
Start-time availability is generated per facility from `open_time` through
`close_time`; requested duration must fit before `close_time`, without extending
legacy hours to midnight or using a global latest start time.
The frontend should identify the dynamic start-time field by both canonical name
and visible label, because imported/custom field definitions can retain an older
field name while still rendering as “Jam Mulai”.
Jenis Lapangan pada mini-form berasal dari nama unik fasilitas aktif di
`sport_center.sport_facilities`, bukan daftar olahraga statis dari konfigurasi;
nama yang dipilih dicocokkan ke `facility_id` spesifik sebelum availability dibaca.

Payment-proof files use the separate Supabase Storage bucket `payment-proofs`, while
other uploaded documents use `ai-task-center-documents`. Any helper that converts a
public Storage URL to a signed URL must detect the bucket from the URL and sign
against that same bucket.

**Why:** Fonnte downloads attachments without the application's Supabase service
credentials. Signing a payment-proof path against the general document bucket
produces an unusable URL, so the form can succeed while WhatsApp document delivery
fails.

**How to apply:** Keep bucket detection and signed-URL generation together in the
Storage helper; do not assume every `/object/public/...` URL belongs to the default
document bucket.

**Why:** The public form must not show stale static times, and the imported project
has separate development and production Supabase connections.

**How to apply:** Keep development reads on `SUPABASE_DATABASE_URL_DEV`; validate
the selected start time again on submit because availability can change after the
form loads.

Public mini-form responses must send `Cache-Control: no-store`, and the frontend
must refetch the form on mount. A previously opened WhatsApp link can otherwise
keep rendering the old static sport categories even after the database-backed
facility list is fixed.

**Why:** The public link is reused across sessions and stale API/browser data can
mask a correct server response.

**How to apply:** When changing server-owned form options, invalidate both the
HTTP response cache and the client query cache; never use the old category list
as a fallback.

Availability requests in the public form bypass HTTP cache and refresh while the
form remains open, so a newly created booking can remove a slot without requiring
a new link. A booking is blocked when its interval overlaps the requested
duration, including `pending_payment` and `waiting_admin_approval` statuses.

**Why:** A slot can become occupied after the customer first loads the form;
excluding only approved bookings would allow duplicate reservations.

**How to apply:** Keep the availability query no-store with periodic refresh, and
reset a selected start time when the refreshed slot list no longer contains it.

Availability reads must compare the first 10 characters of `booking_date` and normalize status case/whitespace. Ignore only `cancelled`, `expired`, `rejected`, and `refunded`; all other statuses block overlapping intervals.

**Why:** Development and production `sport_center.sport_bookings` schemas can contain either date-like text or date values, and older rows may retain an ISO timestamp string. Exact equality or case-sensitive status checks can show already-booked hours as available.

**How to apply:** Keep the same query behavior in both environments; the selected Supabase connection is controlled by `NODE_ENV` (`SUPABASE_DATABASE_URL_DEV` in development, production URL in production).

Legacy mini-form sessions can contain stale duration values or cached field definitions. The client must normalize field-booking duration options and use no-store form reads so old session/template data cannot restore `1,5 jam`.

**Why:** The availability API can be correct while an already-open public form continues rendering options from an older response or collected field state.

**How to apply:** Keep the duration allowlist enforced at render and prefill time, and bypass HTTP cache for both the form definition and availability requests.

When availability refresh removes a previously collected `start_time`, skip that stale value during prefill; otherwise merging `collectedFields` can reinsert the unavailable time after the UI clears it.

**Why:** React state can be cleared correctly while the later `{...prefilled, ...values}` merge restores the old session value.

**How to apply:** Treat `availableSlots` as the authority for both select options and prefilled start-time values.

Notifikasi group setelah mini-form booking lapangan harus memakai urutan eksplisit:
Nama Pemesan, Jenis Lapangan, Tanggal Main, Durasi Sewa, Jam Mulai, Jam Selesai,
Metode Pembayaran, Catatan. Gunakan `field_type` sebagai sumber utama dan jangan
tampilkan alias `field_name` sebagai baris kedua.

**Why:** Properti `merged` mengikuti urutan data masuk, bukan urutan form, dan
session lama dapat menyimpan kedua alias lapangan sekaligus.

**How to apply:** Bangun ringkasan booking dari daftar field terurut, bukan langsung
dari `Object.entries(merged)`.

**Why:** The customer selects a concrete facility first; the form owns the remaining booking details and availability check, so WhatsApp no longer asks for those fields before showing the form.

## Fix: wait-message ordering + booker name in confirmation (2026-07-06)
- Bug: the "Mohon ditunggu, kami cek dulu..." text was returned as `preReply` alongside `replyToUser` in the SAME IntakeResult, so it was only ever displayed by the caller AFTER the (already-completed) availability check — never truly sent first.
- Fix: inside the availability-check branch of `runSportCenterAvailabilityGate` (intake-engine.ts), now `await sendFonnte(session.phone, waitMsg, fonnteDevice)` directly BEFORE calling `checkSportCenterAvailability()`, then return only `replyToUser` (no `preReply`). This required threading `fonnteDevice` as a new param through `processIntakeMessage()` → `runSportCenterAvailabilityGate()`, and both call sites in `whatsapp.ts` (main flow + guard re-check flow) now pass `fonnteDevice` through.
- `buildAvailableMessage()` in sport-center-availability.ts already had a Durasi line; added an optional `bookerName` param that renders a "👤 Nama Pemesan" line when present — threaded through all 3 return branches inside `checkSportCenterAvailability()`.
- The `preReply` field on `IntakeResult` still exists and is still consumed by whatsapp.ts for other flows, but is no longer used by the sport-center availability Case A branch — don't reintroduce it there, since synchronous send-before-check is the correct fix, not a "send both, hope for ordering" pattern.
- Mini-form-after-"ya"-confirmation behavior did NOT need a code change — Case B/C in the gate already only fall through (allowing the form to be sent) after `isAvailabilityConfirmation(message)` is true.
