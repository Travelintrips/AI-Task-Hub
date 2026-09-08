---
name: Sport center pricing names
description: Naming normalization for sport-center facility pricing
---

The sport-center facility catalog is database-driven and may return either “Lapangan Multi Guna” or “Lapangan Multiguna”. Both names represent the same multi-purpose facility and must use the Rp350,000 per-hour rate.

**Why:** Exact substring matching for only “multi guna” misses the production spelling “multiguna” and falls through to the default Rp100,000 rate.

**How to apply:** When adding or changing facility-price rules, support both spellings in the mini-form display, backend booking calculation, and WhatsApp price responses. Prefer a shared normalized pricing helper when the pricing code is next refactored.