---
name: DB split — executeSql vs Supabase
description: executeSql (code_execution sandbox) hits Replit local DB, NOT Supabase; use Node.js ESM script for DDL against Supabase.
---

# DB Split: executeSql vs Supabase

## The Rule
`executeSql()` in the code_execution sandbox connects to the **Replit-managed local PostgreSQL** (`DATABASE_URL`), NOT to Supabase. The API server (`lib/db/src/index.ts`) always uses `SUPABASE_DATABASE_URL` first. These are two completely separate databases.

**Why:** Replit's code_execution tool injects its own DB connection, independent of the project's env secrets. The API server reads secrets from the Replit secrets manager at runtime.

**How to apply:** Whenever you need to run DDL (CREATE TABLE, ALTER TABLE, DROP TABLE) that the API server will use, you must connect to Supabase directly. Use the pattern from `scripts/migrate-fleet.mjs`:

```js
// scripts/migrate-<sprint>.mjs
import pg from "pg";
const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
await pool.query("CREATE TABLE ...");
await pool.end();
```

Run with: `node scripts/migrate-<sprint>.mjs`

Both `process.env.SUPABASE_DATABASE_URL` in the terminal AND the API server's env point to the same Supabase PostgreSQL. The terminal shell inherits secrets from Replit's secret manager, same as the API server.

## Symptoms of Getting This Wrong
- API returns `relation "table_name" does not exist` even after `executeSql` reported success
- Table exists in `executeSql` queries but is invisible to Drizzle ORM queries

## Additional Note: created_by UUID Incompatibility
Fleet tables define `created_by` as `INTEGER` in the original Drizzle schema, but `req.user?.id` is a UUID string. Always set `createdBy: null` (or change the column to TEXT in the migration). Passing a UUID string to an INTEGER column causes a runtime 500 error from PostgreSQL.
