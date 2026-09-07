---
name: Sprint 7C Fleet Intelligence
description: Fuel Intelligence, Tire Lifecycle, Utilization & Availability — 5 tables, 3 route files, 3 frontend pages.
---

## Tables
5 new tables in `lib/db/src/schema/fleet.ts`:
- fleet_fuel_benchmarks, fleet_fuel_logs, fleet_tires, fleet_tire_rotations, fleet_utilization_logs

Migration via `scripts/migrate-sprint-7c.mjs` (Node.js ESM + pg Pool against Supabase).

## Routes
- `artifacts/api-server/src/routes/fleet-fuel.ts` → `/api/fleet/fuel*`
- `artifacts/api-server/src/routes/fleet-tires.ts` → `/api/fleet/tires*`
- `artifacts/api-server/src/routes/fleet-utilization.ts` → `/api/fleet/utilization*`

## Frontend pages
- `artifacts/ai-task-center/src/pages/fleet-fuel.tsx` → `/fleet/fuel`
- `artifacts/ai-task-center/src/pages/fleet-tires.tsx` → `/fleet/tires`
- `artifacts/ai-task-center/src/pages/fleet-utilization.tsx` → `/fleet/utilization`

## Key lesson
Pages use local `apiFetch` helper (NOT `apiRequest` from `@/lib/queryClient`). `apiFetch` returns parsed JSON directly — no `.json()` call needed in `onSuccess`. Pattern from fleet-maintenance.tsx is canonical.

**Why:** `@/lib/queryClient` does not export `apiRequest`; it's an old pattern. All new fleet pages must use `getStoredToken` + local `apiFetch`.

## Sidebar
Icons: `Droplets` (BBM), `Package` (Ban), `Navigation` (Utilisasi) in `app-layout.tsx`.

## FleetTire interface
Must include `sizeName?: string` — used in table display rows.
