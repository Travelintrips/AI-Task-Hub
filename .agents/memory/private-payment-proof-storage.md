---
name: Private payment-proof storage
description: Storage access rule for payment-proof OCR across DEV and production Supabase projects
---

Payment proofs may be stored in a private `payment-proofs` bucket in production while the DEV bucket is public. OCR must read the object through the server-side Supabase client with the environment-appropriate service role, using the storage path extracted from the persisted URL.

**Why:** An anonymous fetch of the `getPublicUrl()` result fails for a private bucket (observed as HTTP 400), while the upload itself still succeeds. Making production payment proofs public would expose sensitive financial documents.

**How to apply:** Preserve the private bucket setting. Keep service-role access server-side only; if users need to view proofs, add a short-lived signed URL or authenticated proxy rather than exposing the service key or storing a permanent signed URL.

Payment-proof amount validation must prefer a labeled currency value extracted from OCR `raw_text` (for example, `Total Transaksi Rp 30.000`) over the model's bare numeric `amount` field. The latter can incorrectly return `30` for Indonesian thousands notation.

**Why:** The receipt image visibly showed `Rp 30.000`, but the model response produced `30`; comparing that value directly caused a false amount mismatch.

**How to apply:** Ask OCR for both numeric and original amount text, normalize dots as Indonesian thousands separators, and use deterministic extraction from labeled raw text as the first validation source.

The booking form can preview a newly uploaded proof from a browser-local object URL, so users can inspect the image/PDF before submitting without requiring a public Storage URL.

**Why:** The production bucket is private; rendering the persisted `getPublicUrl()` directly in the browser would fail or require exposing the payment proof publicly.

**How to apply:** Revoke object URLs on replacement, deletion, and component unmount. For proof viewing after page reload or from booking history, use a short-lived signed URL or authenticated proxy.