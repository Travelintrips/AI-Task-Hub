---
name: Payment proof short-link host
description: DEV ingress behavior for public payment-proof short links
---

Root short-link routes can behave differently through a user-provided `sisko.replit.dev` hostname than through the active local workflow. The ingress may serve the SPA for `/p/:token` while `/api` still reaches the API.

**Why:** The requested DEV hostname did not match the active workspace domain during verification; local `/p` proxying worked, but the external hostname returned the SPA and could not see the local DEV mapping.

**How to apply:** Keep `/p/:token` as the canonical server route, provide an `/api/p/:token` server handoff for ingress fallback, and verify the actual hostname/DB binding separately before calling a live external-link test complete. A submitted task with no matching short-link row is evidence that another runtime handled the form.