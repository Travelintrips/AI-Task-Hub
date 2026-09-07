---
name: Sprint 5E Intel Readiness Layer patterns
description: Key architectural rules for the IRL refresh engine, DB split, and drizzle quirks discovered during Sprint 5E.
---

## DB Split: heliumdb vs Supabase

The API server connects to TWO databases:
- **heliumdb** (`DATABASE_URL` = `postgresql://postgres:password@helium/heliumdb`) — Replit's internal PostgreSQL. This is where drizzle ORM (`db` from `@workspace/db`) writes. Only holds intel_* tables + drizzle-migrated Sprint tables.
- **Supabase** (`SUPABASE_DATABASE_URL`) — holds ALL application source data (ai_tasks, quotations, shipment_trackings, customers, vendor_*, etc.) and legacy Sprint tables.

`lib/db/src/index.ts` uses `DATABASE_URL || SUPABASE_DATABASE_URL` (heliumdb wins). `supabase-db.ts` uses `SUPABASE_DATABASE_URL` directly.

**Why:** Replit provisions its own internal PG as `DATABASE_URL`. Drizzle ORM migrations/push targets this heliumdb. App data was created in Supabase before Replit DB was provisioned.

**How to apply:** When writing new features that need to READ from ai_tasks, quotations, customers, vendor_*, shipment_trackings etc. — use `supabaseQuery()` from `./supabase-db`. When WRITING to new drizzle-schema tables — use `db` (heliumdb). Schema migrations go to heliumdb via raw pg queries against `DATABASE_URL`.

## Drizzle `sql` template + JS Arrays

When you interpolate a JavaScript array in drizzle's `sql` template tag — e.g. `${['a', 'b']}` — drizzle expands it into multiple parameters `($1, $2)` (IN-clause style). This BREAKS INSERT statements for PostgreSQL `text[]` columns.

**Fix:** Use a `pgArr()` helper to serialize `string[]` to a PostgreSQL text-array literal `'{val1,val2}'` before interpolating:

```typescript
function pgArr(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return "{}";
  return "{" + arr.map((s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + "}";
}
// Usage:
await db.execute(sql`INSERT INTO foo (tags) VALUES (${pgArr(myStringArray)})`);
```

This affects: `readiness_flags` (all 5 intel datasets), `service_types`, `cargo_types`, `certifications`, `missing_doc_types` (intel_vendors), `frequent_services`, `typical_routes`, `typical_cargo_types`, `risk_factor_codes` (intel_customers).

## requireRole Import Source

The API server has TWO `requireRole` functions:
- `../middleware/auth` — checks `req.user?.role` (set by `extractUser` / JWT middleware) ✅ USE THIS
- `../middleware/permissions` — checks `req.auth?.role` (never populated by current JWT flow) ❌ WRONG

Always import `requireRole` from `../middleware/auth`, same as `requireAuth` and `getCompanyId`.

## Intel Refresh Engine Architecture

Source reads → `supabaseQuery()` → Supabase  
Result writes → `db.execute(sql`...`)` → heliumdb  
Readiness score aggregation reads → `db.execute(sql`...`)` → heliumdb (intel_* tables already there)

`supabaseQuery()` catches errors and returns `[]` — so missing Sprint 5A tables (customer_memory_snapshots, customer_risk_assessments) fail gracefully without explicit try/catch.

## Schema Migration Pattern

drizzle-kit push always times out on large Supabase schema. For new tables:
1. Write migration SQL to `scripts/migrate-<name>.sql`
2. Run via raw Node.js pg client against `DATABASE_URL` (heliumdb) for drizzle-managed tables
3. For Supabase tables, run against `SUPABASE_DATABASE_URL` with port 5432 (not 6543 pooler)
