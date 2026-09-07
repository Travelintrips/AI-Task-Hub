---
name: Sport Center booking prod schema drift
description: sport_center_bookings table in production Supabase was missing payment/pricing columns that exist in dev, causing silent booking-save failures after "Ya" confirmation.
---

Two separate Supabase projects back this app: dev (SUPABASE_DATABASE_URL_DEV, project xssrfshdrtdfupgqwfdw) and production (SUPABASE_DATABASE_URL, project nzdweipzckfszczzqtuw). `src/lib/supabase-db.ts` prefers SUPABASE_DATABASE_URL over the _DEV fallback, so any process that has the production secret in scope talks to the production project even though the dev workspace shell only ever exposes the _DEV one.

`sport_center_bookings` in production was missing: payment_status, booking_number, facility_name, price_per_hour, total_price, payment_proof_url, payment_proof_token, payment_deadline, admin_notes, customer_phone — all present in the dev copy. `saveSportCenterBooking()` (sport-center-availability.ts) wraps its INSERT in try/catch and returns `null` on any DB error, so the caller (`finalizeSportCenterBooking` in intake-engine.ts) silently falls back to a generic "booking confirmed" WA reply even though nothing was written. The customer sees a confirmation; no row exists.

**Why:** there is no automatic schema sync between dev and prod Supabase for this project (Supabase is external, not Replit-managed, so Replit's publish-time dev→prod schema diff does not apply). A column added only in dev during development silently breaks prod until someone notices bookings aren't appearing.

**How to apply:** when a customer reports "it said confirmed but I don't see it," or booking/order data seems to vanish, always check for schema drift between the two Supabase projects (`\d <table>` on both) before assuming an application-logic bug — the INSERT may be failing in production alone. Prefer surfacing DB errors (or at least logging table name + error code at `error` level, not `warn`) instead of swallowing them into a generic fallback message.

## Payment metadata and final status

Manual payment proofs still require a non-null `sport_center.sport_payments.provider_order_id`; setting only `provider_id` is insufficient. Use a stable booking-scoped value such as `mini-form:<booking_number>` for both fields. After a valid proof upload, the booking status is `confirmed` (with payment status `paid`) across the Sport Center booking representations; `waiting_admin_approval` is not the final state for this flow.

**Why:** a real mini-form submission reached the bridge successfully but payment insert failed on the provider-order constraint, leaving the booking in an intermediate approval state.

**How to apply:** whenever adding or changing manual-payment inserts, satisfy every NOT NULL provider metadata field before updating booking status, and keep the proof-upload finalization idempotent.

## Strict payment-proof OCR

Payment proofs are OCR-validated before the field-booking task/payment is created: the document must be recognized as a payment proof, confidence must be at least 0.65, the amount must be readable, and it must match the booking total. Valid OCR is persisted to the nullable `ocr_name`, `ocr_amount`, `ocr_date`, `ocr_raw`, and `ocr_data` columns.

**Why:** the owner selected strict validation so unreadable or invalid receipts cannot auto-confirm a booking.

**How to apply:** keep OCR failure user-visible and leave the session retryable; do not mark payment or booking confirmed until the OCR gate passes. Scanned PDFs without selectable text require a clearer image or a future PDF-rendering fallback.

The OCR service depends on a valid `OPENAI_API_KEY` in Replit Secrets. An invalid key must be reported as OCR service unavailable (not as an invalid customer document), while the form remains retryable.

**Why:** a rejected OpenAI credential previously surfaced to customers as an unhelpful generic HTTP 422.

**How to apply:** keep API errors detailed in the UI without exposing credentials, and return a service-unavailable response for provider authentication failures.
