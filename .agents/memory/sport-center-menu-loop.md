---
name: Sport Center Menu Loop Fix
description: Why the lapangan menu keeps repeating when user replies with a number, and the 3-layer fix applied.
---

## The Bug
After showing the "Pilih lapangan" numbered menu, bot sends the SAME menu again when user replies "2" (or any digit).

## Root Causes (all 3 must be addressed)

### 1. Phone number format mismatch (PRIMARY)
- Fonnte can send `from = "6289999888777@s.whatsapp.net"` for some messages and `"6289999888777"` for others.
- Session is stored with the clean number. Follow-up message with `@s.whatsapp.net` suffix → `findActiveIntakeSession` returns null → falls through to AI detection.

**Fix**: In `processIncomingMessage` (whatsapp.ts), wrap `from` extraction with `normalizePhone(rawFrom) ?? rawFrom`. `normalizePhone` already exists in fonnte.ts and strips `@s.whatsapp.net` via `/\D/g` replacement.

### 2. AI detection of "2" re-triggers sport_center_booking (SECONDARY)
- When session not found, `detectWhatsAppIntent("2")` + GPT context might classify "2" as sport_center_booking.
- `startIntakeSession` is called → CANCELS existing session → creates new session with no `lastQuestion` → `isMenuQuestion = false` → sends menu again.

**Fix**: Belt-and-suspenders in `processIntakeMessage` (intake-engine.ts): if `isSportCenterBookingIntent(session.intentCode)` AND message matches `/^[1-6]$/` AND no `field_type`/`field_name` collected → resolve as menu selection even when `isMenuQuestion = false`.

### 3. Race condition in sport center special path (TERTIARY)
- The sport center path in `runAiDetection` (whatsapp.ts line ~1001) only reached if `!activeSession`.
- But a timing/DB error could cause `findActiveIntakeSession` to return null even though session exists.

**Fix**: Re-check `findActiveIntakeSession` inside the sport center path BEFORE calling `startIntakeSession`. If session found on re-check → route to `processIntakeMessage` directly and return.

## Key files
- `artifacts/api-server/src/routes/whatsapp.ts` — phone normalization (processIncomingMessage), session guard (sport center path)
- `artifacts/api-server/src/lib/intake-engine.ts` — belt-and-suspenders `isDigitMenuReply` check

## Supabase connection
Confirmed: `SUPABASE_DATABASE_URL_DEV` is set, pool connects successfully at startup. All sessions stored correctly in `conversation_intake_sessions` table with `company_id = "default"`.

**Why**: The `quick=true` echo filter works correctly. The loop is caused by two separate issues: (1) session lookup failure (phone format), (2) OpenAI failing to extract booking_date/start_time from Indonesian date strings like "6 juli jam 16:00" — regex fallback solves #2 reliably.

## Second loop: date/time not extracted

When user provides "6 juli jam 16:00" after selecting a field:
- `extractFieldsFromMessage` calls OpenAI with 7 required fields
- OpenAI fails to return `booking_date`/`start_time` (wrong key name or silent error)
- Gate sees `missingSlot = true` → repeats date/time question

**Fix**: `extractDateTimeRegex(msg)` function added to `intake-engine.ts` — pure regex, no network call. Fires as fallback ONLY when: (a) sport_center_booking session, (b) `lastQuestion` contains "tanggal"/"jam"/"mulai", (c) OpenAI didn't populate the field. Supports formats: "6 juli jam 16:00", "pukul 14.00", "tanggal 10 agustus jam 09.30", etc.
