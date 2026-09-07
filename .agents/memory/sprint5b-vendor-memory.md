---
name: Sprint 5B Vendor Memory
description: Vendor Memory Center implementation — 7 tables, key type-safety lessons.
---

## Tables
- `vendor_preferences` — category/key/value store, versioned (status: active/superseded/inactive)
- `vendor_risk_assessments` — manual or AI risk scoring, archived on new assessment
- `vendor_performance_snapshots` — per-period KPIs, auto-computed readiness score
- `vendor_capabilities` — service types, routes, cargo constraints per vendor
- `vendor_document_registry` — isCurrent pattern (old docs set isCurrent=false on upsert)
- `vendor_memory_snapshots` — 7-day TTL full memory export (JSON blob)
- `vendor_memory_events` — append-only audit log

## Key lesson: req.user?.id type
`req.user?.id` may be `number` (not `string`). Pattern `req.user?.email ?? req.user?.id` produces `string | number`, which breaks any DB column typed as `text`. Always wrap: `String(req.user?.email ?? req.user?.id ?? "unknown")`.

**Why:** Express's `req.user` is typed as `Express.User` which has `id?: string | number` depending on Passport strategy.

## Key lesson: sql.raw() vs sql`` template
`sql.raw(str, params)` — `sql.raw` only takes 1 argument (the raw string, no params). For dynamic parameterized queries use the tagged template: `sql\`SELECT ... WHERE x = ${param}\`` which handles params safely.

**Why:** Caused a TS2554 error (Expected 1 argument, got 2).

## Key lesson: Express req.params type
`req.params.someKey` is typed as `string | string[]` in Express. When passing to Drizzle `eq()` which expects `string`, wrap: `const category = String(req.params.category)`.

## Integration points
- Routes registered in `artifacts/api-server/src/routes/index.ts` via `vendorMemoryRouter`
- Re-exports in `intent-engine.ts`: `export { loadVendorMemory, invalidateVendorMemoryCache } from "./vendor-memory"`
- Frontend: `/vendors` (list) + `/vendors/:id/memory` (8-tab detail)
- Sidebar nav entry in `app-layout.tsx`
