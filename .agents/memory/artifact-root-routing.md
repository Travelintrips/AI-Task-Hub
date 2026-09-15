---
name: Multi-artifact root routing
description: Root-level public routes need explicit artifact routing ownership when a static web artifact also claims "/".
---

In a multi-artifact deployment, a web artifact claiming `/` with a `/*` SPA rewrite can intercept root-level public links before an API artifact sees them. When a backend must return HTTP redirects or 404s for root-level links, give the API artifact root ownership, keep the static artifact scoped to assets, and have the API serve the built frontend bundle.

**Why:** The Express route order can be correct while the deployed artifact router still serves `index.html` before the API process receives `/p/*` or validated root-token paths. Root ownership without frontend serving instead causes the preview to show `Cannot GET /`.

**How to apply:** Inspect deployment logs for static-handler registration and artifact paths before changing application routes. Scope the web artifact to assets, let the API serve the built bundle in production-style runs, and verify both root 200 and invalid root-token 404.