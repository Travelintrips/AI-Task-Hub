---
name: Sport center notification dedupe
description: Duplicate WhatsApp group notifications caused by receiver rows across company scopes
---

Sport Center notification routing may query both the default company and a specific company, and the same group JID can exist in both scopes. Receiver rows must be deduplicated by normalized phone/group JID immediately before sending.

**Why:** Production had the same group registered under `company_id=default` and a company-specific ID, causing one form submission to produce two identical messages with the same task number.

**How to apply:** Keep the send-time dedupe even after cleaning existing rows. For private Storage proof links, resolve the persisted public-path URL to a short-lived signed URL before putting it in WhatsApp; anonymous public URLs can return a misleading `NoSuchBucket` response for a private bucket.