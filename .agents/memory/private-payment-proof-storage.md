---
name: Private payment-proof storage
description: Storage access rule for payment-proof OCR across DEV and production Supabase projects
---

Payment proofs may be stored in a private `payment-proofs` bucket in production while the DEV bucket is public. OCR must read the object through the server-side Supabase client with the environment-appropriate service role, using the storage path extracted from the persisted URL.

**Why:** An anonymous fetch of the `getPublicUrl()` result fails for a private bucket (observed as HTTP 400), while the upload itself still succeeds. Making production payment proofs public would expose sensitive financial documents.

**How to apply:** Preserve the private bucket setting. Keep service-role access server-side only; if users need to view proofs, add a short-lived signed URL or authenticated proxy rather than exposing the service key or storing a permanent signed URL.