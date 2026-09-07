---
name: Sprint 7B Fleet Foundation
description: Fleet module — 8 DB tables, 4 API route groups, 6 frontend pages, maintenance approval flow, AI task integration.
---

## What was built

- **8 tables**: `fleet_units`, `fleet_documents`, `fleet_drivers`, `fleet_driver_performance`, `fleet_maintenance_records`, `fleet_maintenance_schedules`, `fleet_gps_logs`, `fleet_driver_incidents`
- **4 route files**: `fleet-units.ts`, `fleet-drivers.ts`, `fleet-documents.ts`, `fleet-maintenance.ts` (all under `/api/fleet/...`)
- **6 frontend pages**: fleet-units, fleet-unit-detail, fleet-drivers, fleet-driver-detail, fleet-documents, fleet-maintenance
- Sidebar nav entry: `Fleet` at `/fleet/units` with `Truck` icon

## Key design decisions

- Maintenance approval flow: `pending → approve (→ in_progress) → complete`. Reject is also available from `pending`.
- `generatePurchaseRequest: true` on approve creates a **draft** `logistic_purchase_requests` entry — does NOT auto-pay/auto-expense, finance still reviews.
- Auto-creates `ai_tasks` when: (a) maintenance record created (needs human approval), (b) document uploaded with expired/expiring_soon status.
- All `ai_task` auto-creations have `adminNotes` containing `auto_created=true requires_human_review=true`.

**Why:** User specified "no auto-expenses, no auto-assign, AI recommends only."

## Frontend pattern

All fleet pages use direct `apiFetch` (not generated hooks), following the purchasing-intelligence.tsx pattern. `apiFetch` reads `getStoredToken()` for auth.

## Route order caveat

In `fleet-drivers.ts` and `fleet-maintenance.ts`, static routes (`/license-expiring`, `/due`, `/schedules`) MUST be declared **before** the parameterized `/:id` route to avoid Express treating them as an id lookup.

## Pre-existing typecheck errors (not from fleet)

`governance.ts`, `training.ts`, `observability.ts` have pre-existing TS errors (`string | string[]` not assignable to `string`). These existed before Sprint 7B and are unrelated to fleet code.
