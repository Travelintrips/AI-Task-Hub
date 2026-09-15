---
name: Multi-artifact root routing
description: Root-level public routes need explicit artifact routing ownership when a static web artifact also claims "/".
---

In a multi-artifact deployment, a web artifact claiming `/` with a `/*` SPA rewrite can intercept root-level public links before an API artifact sees them. When a backend must return HTTP redirects or 404s for root-level links, give the API artifact root ownership, keep the static artifact scoped to assets, and have the API serve the built frontend bundle.

**Why:** The Express route order can be correct while the deployed artifact router still serves `index.html` before the API process receives `/p/*` or validated root-token paths. Root ownership without frontend serving instead causes the preview to show `Cannot GET /`.

**How to apply:** Inspect deployment logs for static-handler registration and artifact paths before changing application routes. Scope the web artifact to assets, let the API serve the built bundle in production-style runs, and verify both root 200 and invalid root-token 404. `previewPath` controls DEV Preview ownership; production route ownership comes from service `paths`. In imported workspaces, update artifact TOML through `verifyAndReplaceArtifactToml` using an absolute sibling temp file; direct edits are rejected, and preview-path changes must be applied sequentially to avoid duplicate-root validation.

Live child deployments must also be checked on a normal SPA route such as `/login`: a deployment can return root 200 and invalid-token 404 while still returning 404 for frontend routes when the static/API router is serving an older or mismatched build.

**Why:** The child deployment passed root and API routing checks but returned a plain 404 for `/login`, so the live short-link test was stopped before creating a mapping or sending WhatsApp.

**How to apply:** Treat any existing frontend-route 404 as a deployment gate failure; republish or reconcile the artifact router before testing a real short link.