---
name: Sprint 10A-1.2 Onboarding Hardening
description: Key schema drift discoveries and architectural decisions from Sprint 10A-1.2 onboarding readiness hardening.
---

## customers table schema drift (critical)

The `customers` table has `name NOT NULL` (no default) in the DB but this column is NOT in the Drizzle schema (`lib/db/src/schema/customers.ts`). The Drizzle schema only has `companyName: text("company_name")`.

**Also**: `company_id` is INTEGER in DB (nullable) but Drizzle schema declares it `text("company_id").notNull().default("default")`. Passing `"default"` to an INTEGER column causes PG error.

**How to apply**: Any INSERT into `customers` via raw SQL must include both `name` and `company_name`. Do NOT pass `"default"` for `company_id` — either pass NULL or a real integer.

```sql
INSERT INTO customers (name, company_name, pic_name, whatsapp, ...)
VALUES ($1, $1, $2, $3, ...)  -- name = company_name as fallback
```

## Fleet canonical table

`fleet_units` = canonical table (Drizzle schema, Sprint 7B, has `unit_number` + `plate_number`).
`fleet_vehicles` = legacy Supabase table (different schema: `plate` not `plate_number`, no `unit_number`) — NOT used by the app.

All fleet routes import `fleetUnitsTable` from Drizzle — this is correct. Do not query `fleet_vehicles`.

## Vendor master: OPTION A confirmed

`suppliers` table (28 records, INTEGER id) = single source of truth for vendors.
`vendor_*` tables (34 tables) = behavioral intelligence layer, all empty.

`vendor-memory.ts` already implements `GET /api/vendors` that queries suppliers table. The `vendors.ts` router only adds WRITE operations (POST, PATCH) and must NOT duplicate GET /vendors — Express route ordering means vendor-memory.ts wins anyway.

## db.execute() pattern

`db.execute(sql\`...\`)` returns `{ rows: [...] }` (pg QueryResult). Access results via `.rows`:

```ts
const result = await db.execute(sql`SELECT ...`);
const row = (result.rows as Record<string, unknown>[])[0];
```

NOT `(result as unknown as Record<string, unknown>[])[0]`.

The `.catch(() => [] as unknown[])` pattern breaks this — use `{ rows: [] }` or wrap correctly.

## New endpoints (Sprint 10A-1.2)

- `GET /api/system/whatsapp-health` — Fonnte + Meta token check, last message, issues[]
- `GET /api/system/onboarding-status` — 7-step checklist, overallPct, readyForProduction
- `POST /api/vendors` — inserts into suppliers table
- `PATCH /api/vendors/:id` — updates suppliers table
- `GET /api/settings` — now includes profileCompletionPct (0-100) + profileMissingFields
- `POST /api/crm/customers` — now requires whatsapp field, normalizes to E.164 format
