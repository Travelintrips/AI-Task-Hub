---
name: Multi-artifact root routing
description: Root-level public routes need explicit artifact routing ownership when a static web artifact also claims "/".
---

In a multi-artifact deployment, a web artifact claiming `/` with a `/*` SPA rewrite can intercept root-level public links before an API artifact sees them. Give the API artifact the specific path (or root ownership) and keep the static artifact scoped to assets when a backend must return HTTP redirects or 404s.

**Why:** The Express route order can be correct while the deployed artifact router still serves `index.html` before the API process receives `/p/*` or validated root-token paths.

**How to apply:** Inspect deployment logs for static-handler registration and artifact paths before changing application routes; verify the published deployment, not only local Express behavior.