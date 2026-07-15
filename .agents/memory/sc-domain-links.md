---
name: SC customer-facing links must use SC_DOMAIN, not REPLIT_DEV_DOMAIN
description: Why WhatsApp links (bukti transfer / booking status) sent to Sport Center customers can go dead, and the fix.
---

`getScDomain()` in `artifacts/api-server/src/lib/sport-center-availability.ts` builds customer-facing
WA links (`/sc/bukti/:token`, `/sc/status/:token`) with priority:
`SC_DOMAIN` env var → `REPLIT_DEV_DOMAIN` → hardcoded `https://sc.travelintrips.co.id` fallback.

**Why this broke:** `SC_DOMAIN` was never set, so the code fell back to the ephemeral dev workspace
domain (`REPLIT_DEV_DOMAIN`, a `*.replit.dev` URL). That domain is tied to the current dev container
and can differ from what it was when older messages were sent (confirmed: an old message referenced
`730a3d17-...-worf.replit.dev` while the live workspace was `e9f8a839-...-pike.replit.dev`) — any link
sent before a domain change is permanently dead, even though the route/token itself is fine.
The correct stable production domain (`sc.travelintrips.co.id`) was already live and serving the
same routes correctly the whole time; it just wasn't being used because dev domain took priority.

**How to apply:** `SC_DOMAIN` is now set to `https://sc.travelintrips.co.id` (shared env var), so all
new links use the stable domain regardless of dev/session state. If customer links go dead again,
check this env var first before assuming a routing/deploy bug — the frontend routes
(`/sc/bukti/:token`, `/sc/status/:token`) and backend (`/api/public/sc/*`) were correct both times
this was investigated.
