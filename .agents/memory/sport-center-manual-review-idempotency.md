---
name: Sport Center manual-review idempotency
description: Rules for the third failed payment-proof OCR submission and safe retries.
---

After the third failed payment-proof OCR attempt, treat the Sport Center submission as a successful manual-review intake: canonical booking status is `waiting_confirmation`, canonical `paid_at` remains NULL, and the public/dashboard payment representation is `waiting_verification`. A retry must reuse the existing intake task/booking and must not create another task or booking.

**Why:** The booking insert can commit before a later bridge, payment, mirror, or notification step fails. Returning HTTP 500 in that state makes the browser retry and can create duplicate operational records. Production also contains older canonical/public bridges without the legacy dashboard mirror.

**How to apply:** Make the manual-review finalization idempotent, tolerate missing payment metadata only for manual review, recreate a missing legacy dashboard mirror with an upsert, and return the state read back from canonical/public rows. Do not backfill or mutate historical rows as part of the submit fix.