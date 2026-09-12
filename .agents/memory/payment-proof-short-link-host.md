---
name: Payment proof short-link host
description: DEV ingress behavior for public payment-proof short links
---

Root short-link routes can behave differently through a user-provided `sisko.replit.dev` hostname than through the active local workflow. The ingress may serve the SPA for `/p/:token` while `/api` still reaches the API.

**Why:** The requested DEV hostname did not match the active workspace domain during verification; local `/p` proxying worked, but the external hostname returned the SPA and could not see the local DEV mapping.

**How to apply:** Keep `/p/:token` as the canonical server route, provide an `/api/p/:token` server handoff for ingress fallback, and verify the actual hostname/DB binding separately before calling a live external-link test complete. A submitted task with no matching short-link row is evidence that another runtime handled the form.

Short-link generation must resolve its base URL from an explicit `PAYMENT_PROOF_SHORT_LINK_BASE_URL` override, then the current `REPLIT_DOMAINS`/`REPLIT_DEV_DOMAIN`; never retain a workspace-specific hostname as a fallback.

**Why:** Replit DEV hostnames can change between runtimes. A stale embedded hostname can make WhatsApp links reach a different app even when the route and private Storage object are correct.

**How to apply:** WhatsApp should use the URL returned by the backend short-link creator. In DEV, that URL should be based on the runtime domain exposed to the API process; validate the public route and the final signed Storage fetch together.

For verification, compare `URL.hostname` exactly against the active runtime hostname; do not classify a host as stale by substring matching because the current DEV hostname itself may contain `sisko.replit.dev`.

**Why:** A substring check falsely reported the successful current-domain payload as stale during the normal-flow test.

**How to apply:** Extract the hostname from each emitted short-link URL and require exact equality with the `REPLIT_DOMAINS` hostname.