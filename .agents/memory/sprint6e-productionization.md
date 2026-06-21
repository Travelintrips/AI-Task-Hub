---
name: Sprint 6E Productionization
description: Key lessons from making the intelligence stack operational against real Supabase data.
---

# Sprint 6E Productionization Lessons

## db.execute() returns QueryResult, NOT an array

`const [x] = await db.execute(sql`...`)` causes `(intermediate value) is not iterable` when the query SUCCEEDS (Drizzle returns a single QueryResult object). This bug was hidden before because all queries failed on the empty Replit DB.

**Fix**: Use helper functions:
```ts
async function row0<T>(query): Promise<T | undefined> {
  const result = await db.execute(query);
  return result.rows[0] as T | undefined;
}
async function rows<T>(query): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}
```

**Why**: `db.execute()` in drizzle-orm@0.45.2 with NodePg returns `QueryResult`, not `T[]`.

## customers.company_id is INTEGER in Supabase

The `customers` table in Supabase has `company_id` as INTEGER. Passing `"default"` (string) causes `invalid input syntax for type integer`. Never filter `customers` by `company_id = ${companyId}` with a string value.

**Fix**: Omit `company_id` filter for `customers` table, or derive customer counts via a subquery + CROSS JOIN with a TEXT-company_id table (e.g. `customer_memory_snapshots`).

## intel_readiness_scores column names

Actual columns: `dataset_name` (not `dataset`) and `overall_readiness_score` (not `readiness_score`). Always verify column names before writing raw SQL against the intel tables.

## Admin user creation

`users.company_id` is also INTEGER — insert without `company_id` or use NULL. To create the AI Task Center admin user:
```js
// Run from artifacts/api-server (bcryptjs available)
const hash = await bcrypt.hash("admin123", 12);
await pool.query(`INSERT INTO users (email, name, role, password_hash, is_active, created_at, updated_at)
  VALUES ($1,'Admin','super_admin',$2,TRUE,NOW(),NOW())`, ["diva@admin.com", hash]);
```

## Migration approach (drizzle-kit push times out)

Always use direct `pg` Pool connection for DDL (CREATE TABLE, etc.) — never drizzle-kit push. See `scripts/sprint6e-migrate.js` for the pattern.

## vendor_profiles vs suppliers

`vendor_profiles` is a legacy table with different columns (id, customer_id, company_name, nib, npwp, service_type). The 28-row `suppliers` table is the source of truth for vendor IDs in memory tables.

## Executive Intelligence endpoint path

`GET /api/executive/intelligence` (not `/api/executive-intelligence/overview`). Route registered without prefix in `routes/index.ts` via `router.use(executiveIntelligenceRouter)`.
