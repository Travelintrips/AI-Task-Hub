---
name: Sprint 8B Executive Command Center
description: Architecture decisions and gotchas for the Executive Command Center module
---

## Files
- Route: `artifacts/api-server/src/routes/executive-command.ts` (5 endpoints)
- Page: `artifacts/ai-task-center/src/pages/executive-command.tsx` (5 panels)
- Migration: `scripts/migrate-sprint-8b.mjs` → `executive_refresh_logs` table
- Registered in: `artifacts/api-server/src/routes/index.ts`, `App.tsx`, `app-layout.tsx`

## RBAC
- `requireRole("company_admin")` — covers company_admin AND super_admin (role hierarchy ≥5)
- Sidebar entry guarded by `user?.role === "super_admin" || user?.role === "company_admin"`

## Error Resilience Pattern
All queries wrapped in `safeCount/safeRow/safeRows` helpers that return 0/undefined/[] on any error.
This prevents a missing column (e.g. `is_active` on fleet_documents) from breaking the entire endpoint.

**Why:** fleet_documents.is_active column missing in production caused fleet-doc-expiry-check scheduler errors. Defensive pattern lets executive endpoints survive schema drift.

## training.ts req.params Fix
- `req.params.id` errors were at column 25 (`const id = parseInt(`)
- `req.params.taskId` error was at column 29 (`const taskId = parseInt(`) — separate replace needed
- Fix: `firstParam(req.params["key"]) ?? ""` helper added after `const router: IRouter = Router();`

**How to apply:** Any future route file with `req.params.X` in Express 5 needs this helper.

## executive_refresh_logs Table
Logs external refresh jobs for each section. Populated by future scheduled jobs.
Until jobs run, all sections show `status: "unknown"` — this is expected and handled in the UI.
