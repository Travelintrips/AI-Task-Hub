---
name: Sprint 8D Hardening & Backfill
description: Critical patterns from Sprint 8D pre-hardening — route mounting, PG arrays, script imports
---

## Route Path Prefix Rule

`app.ts` mounts the main router at `/api`: `app.use("/api", router)`.

Sub-routers added with `router.use(subRouter)` define paths **without** `/api`:
- ✅ `router.get("/readiness/memory", ...)` → final URL: `/api/readiness/memory`
- ❌ `router.get("/api/readiness/memory", ...)` → would resolve to `/api/api/readiness/memory`

**How to apply:** When adding a new route file, always define paths relative to `/api`.
Reference: `intel.ts` uses `"/intel/health"` → final URL is `/api/intel/health`.

## PostgreSQL Native Arrays in Scripts

When inserting into ARRAY columns from Node.js scripts, pass native JS arrays — never `JSON.stringify()`:
- ✅ `[arrEl1, arrEl2]` (native JS array) → PostgreSQL accepts this
- ❌ `JSON.stringify([arrEl1, arrEl2])` → Error: `malformed array literal: "[]"` (code 22P02)

## scripts/ Package — pg Import

`scripts/` has its own `package.json` with `pg` as a dependency.
Inside `.mjs` files in scripts/, import pg as:
```javascript
import pkg from 'pg';
const { Pool } = pkg;
```
(Default import because pg uses CommonJS default export)

## company_id Type Conflict (Critical)

- `logistic_orders.company_id` = **INTEGER** (Supabase legacy table)
- All Drizzle ORM tables = **TEXT** (default "default")
- `intel_refresh.ts` does cross-table JOINs on `company_id` — these silently return 0 rows due to type mismatch
- Fix: use `CAST(company_id AS TEXT) = $1` in cross-table raw SQL queries
- Full analysis: `docs/company-id-standardization-report.md`

## Sprint 8D Data State (post-backfill)

After Sprint 8D backfill scripts ran:
- customer_memory_snapshots: 12/12 (100%)
- vendor_memory_snapshots: 28/28 (100%)
- customer_memory_events: 11
- vendor_memory_events: 27
- purchasing_budget_tracker: 6 rows (estimated)
- vendor_contract_rates: 12 rows (placeholder)

Reports generated in `docs/`:
- `company-id-standardization-report.md`
- `service-coverage-audit.md`
- `PRE-SPRINT-9-READINESS.md` (verdict: CONDITIONAL GO)

Service coverage: 23% overall — 12 of 22 services have zero intent coverage.
