---
name: Public link environment split
description: Durable rule for resolving customer-facing links across Replit development and production.
---

Development public links must resolve from the active `REPLIT_DEV_DOMAIN` or `REPLIT_DOMAINS` runtime value before considering any configured base URL. Production public links must resolve only to the canonical public domain.

**Why:** Replit development domains are workspace/runtime-specific and can change; a persisted development base URL makes WhatsApp links point to an old preview host, while production must never emit a `replit.dev` host.

**How to apply:** Keep one shared public URL resolver for mini-forms and other customer-facing links. Use runtime-domain-first ordering in development, preserve a local fallback for non-Replit runs, and enforce the canonical production origin.