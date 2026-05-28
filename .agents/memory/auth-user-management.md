---
name: Auth & User Management
description: JWT auth setup, frontend auth flow, and User Management UI decisions.
---

## JWT Auth (API Server)
- Uses `bcryptjs` + `jsonwebtoken` (installed in api-server devDependencies)
- Secret: `process.env.SESSION_SECRET` (already set as Replit secret)
- Token stored client-side in localStorage under key `ai_task_center_token`
- `setAuthTokenGetter` from `@workspace/api-client-react` injects Bearer token into all generated API hooks automatically

## Frontend Auth Flow
- `AuthProvider` in `src/contexts/auth-context.tsx` wraps entire app
- On mount: calls `GET /api/auth/me` to validate stored token; clears if 401
- Unauthenticated users see Login page; no redirect needed (conditional render)
- Public routes (mini-task, customer-data) bypass auth check — handled before AuthProvider

## Auth API calls (src/lib/auth-api.ts)
- Direct `fetch` calls (NOT generated Orval hooks) since auth endpoints are not in OpenAPI spec
- `initAuthTokenGetter()` must be called once on app init to inject token into generated hooks

## User Management page (/users)
- Only visible in sidebar for `super_admin` and `company_admin` roles
- Stats cards: total, active, inactive, admin count
- Create/Edit/Toggle active/Delete actions
- Delete only available to `super_admin`

## Frontend Workflow
- Name: "Frontend"
- Command: `PORT=5000 BASE_PATH=/ai-task-center pnpm --filter @workspace/ai-task-center run dev`
- Port: 5000, outputType: webview
- **Why BASE_PATH matters:** Vite config reads `process.env.BASE_PATH` and will throw if missing

## First-time setup
- `POST /api/auth/setup` creates first super_admin (409 if users already exist)
- Test credentials created: admin@ai-task-center.com (super_admin, companyId: default)
