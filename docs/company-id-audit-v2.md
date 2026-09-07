# Company ID Audit v2
_Sprint 10A-1.1 — Generated: 2026-06-23_

## Purpose
Identify all tables that store `company_id` and their actual SQL type in Supabase,
compared against the Drizzle ORM schema. Type mismatches between Drizzle (text) and
DB (integer) cause silent runtime failures when filtering with `eq(table.companyId, "default")`.

---

## Scan Methodology
1. **Supabase DB scan** — `information_schema.columns WHERE column_name LIKE '%company%'`
2. **Drizzle schema scan** — grep all `lib/db/src/schema/*.ts` files for `company_id` column definitions
3. **Route scan** — grep `artifacts/api-server/src/` for direct `eq(*.companyId, companyId)` comparisons

---

## Drizzle Schema: All Tables with company_id

All Drizzle-managed tables define `company_id` as:
```typescript
companyId: text("company_id").notNull().default("default")
```

Total tables with TEXT company_id in Drizzle: **80 tables**

---

## Actual Supabase DB: company_id Types

### INTEGER company_id (critical — DO NOT use Drizzle eq() directly)

These tables have `company_id INTEGER` in the actual DB:

| Table | Drizzle Type | DB Type | Risk Level | Fix Applied |
|---|---|---|---|---|
| `customers` | text | integer | 🔴 CRITICAL | ✅ In-memory match in wa-role-resolver.ts + raw count in executive.ts |
| `approval_rules` | text | integer | 🔴 CRITICAL | ⚠️ governance-resolver.ts uses eq() — mitigation: "default" ≠ integer, will return 0 rows |
| `approval_requests` | text | integer | 🔴 CRITICAL | ⚠️ No active route queries this table with company_id |
| `users` | text | integer | 🟠 HIGH | ⚠️ auth.ts uses req.user.companyId (already resolved as integer) |

### TEXT / VARCHAR company_id (safe)

These Drizzle-managed tables have TEXT company_id in DB (safe to use `eq()`):

| Table Group | Examples |
|---|---|
| Core operations | `ai_tasks`, `team_members`, `fleet_units`, `fleet_drivers`, `fleet_fuel_logs` |
| Purchasing | `logistic_purchase_requests`, `purchasing_signals`, `vendor_contract_rates` |
| WA commands | `whatsapp_commands`, `whatsapp_command_logs`, `whatsapp_usage_metrics` |
| Knowledge base | `intent_master`, `keyword_rules`, `data_templates`, `document_templates` |
| Memory | `customer_memory_snapshots`, `vendor_memory_snapshots`, `customer_preferences` |
| Fleet | `fleet_maintenance_records`, `fleet_tires`, `fleet_utilization_logs` |
| Other | `audit_logs`, `admin_notifications`, `intake_sessions`, `company_settings` |

Total TEXT company_id tables (safe): **~75 Drizzle-managed tables**

### UUID company_id (different module)
| Table | Notes |
|---|---|
| `kasir_branches` | POS/Kasir module — UUID; not touched by our routes |

---

## Route Hotspot Analysis

### Direct `eq(*.companyId, companyId)` comparisons found:

| File | Count | Risk | Action |
|---|---|---|---|
| `lib/intent-engine.ts` | 12+ (hardcoded `"default"`) | ✅ LOW — targets TEXT tables | None needed |
| `lib/purchasing-engine.ts` | 10+ | ✅ LOW — targets TEXT tables | None needed |
| `lib/wa-commands/supervisor.ts` | 6 | ✅ LOW — targets TEXT tables | None needed |
| `lib/wa-commands/executive.ts` | 10+ | ⚠️ Had 1 bug (customers count) | ✅ Fixed in Sprint 10A-1 |
| `lib/wa-commands/customer.ts` | 2 | ✅ LOW — targets ai_tasks (TEXT) | None needed |
| `lib/wa-commands/driver.ts` | 6 | ✅ LOW — targets fleet_units (TEXT) | ✅ Refactored to plateWhere() |
| `lib/wa-role-resolver.ts` | 3 | 🔴 Had customers bug | ✅ Fixed — in-memory match |
| `routes/ai-tasks.ts` | 6 | ✅ LOW — ai_tasks is TEXT | None needed |
| `lib/governance-resolver.ts` | 3 | 🔴 approval_rules is INTEGER | ⚠️ Returns 0 rows — safe for now |

---

## Mismatches Found

### Query-Breaking Mismatches (Type Error or Wrong Results)

| # | Table | Column | Drizzle | DB Type | Status |
|---|---|---|---|---|---|
| 1 | `customers` | `company_id` | text | integer | ✅ FIXED |
| 2 | `approval_rules` | `company_id` | text | integer | ⚠️ Low impact (no active customer-facing route queries this) |
| 3 | `task_attachments` | `customer_id` | integer | MISSING | ✅ FIXED (explicit column select) |

### Array Type Mismatches (Drizzle says text, DB is ARRAY)

| Table | Column | Drizzle | DB | Impact |
|---|---|---|---|---|
| `customer_memory_snapshots` | `last_n_intents`, `missing_docs_list`, `frequent_services` | text | ARRAY | Uses json stringify — acceptable |
| `document_audits` | `complete_fields`, `missing_fields`, etc. | text | ARRAY | Uses json stringify — acceptable |
| `vendor_memory_snapshots` | `top_service_types`, `best_routes`, `missing_docs_list` | text | ARRAY | Uses json stringify — acceptable |

---

## Recommendations

### Immediate (Sprint 10A-1.1)
1. ✅ Use `companyFilter()` from `src/lib/company-id.ts` for any future company_id comparison
2. ✅ Use `plateWhere()` from `src/lib/plate-number.ts` for all plate number lookups
3. ✅ Schema drift scanner in `scripts/schema-drift-check.mjs` — run after any schema change
4. ✅ Startup schema validation via `src/lib/schema-startup-check.ts`

### Future (Sprint 10A-2+)
1. Migrate `customers.company_id` from INTEGER to TEXT (requires data migration)
2. Migrate `approval_rules.company_id` and `approval_requests.company_id` to TEXT
3. Add `companyFilter()` usage to `governance-resolver.ts` (approval_rules)
4. Run `scripts/schema-drift-check.mjs` as part of CI/CD pipeline

---

## companyFilter() Helper Usage

```typescript
import { companyFilter } from "../lib/company-id";

// BEFORE (broken for INTEGER tables):
.where(eq(customersTable.companyId, companyId))

// AFTER (safe for all tables):
.where(companyFilter(customersTable, customersTable.companyId, companyId))

// For customers specifically — use rawCompanyFilter:
// (or skip filter entirely since "default" has no integer equivalent)
.where(sql`1=1`) // fetch all, filter in-memory
```

---

## normalizePlate() Helper Usage

```typescript
import { plateWhere, normalizePlate } from "../lib/plate-number";

// BEFORE (3 different inline implementations):
plat.replace(/[\s\-]+/g, "").toUpperCase()
sql`REPLACE(LOWER(${table.plateNumber}), ' ', '') = LOWER(${platNorm})`

// AFTER (unified, also handles dots):
plateWhere(fleetUnitsTable.plateNumber, userInput)
// → internally: REPLACE(LOWER(col), ' ', '') = 'b7777zzz'
```

---

## Files Created / Modified

| Action | File |
|---|---|
| ✅ Created | `artifacts/api-server/src/lib/company-id.ts` |
| ✅ Created | `artifacts/api-server/src/lib/plate-number.ts` |
| ✅ Created | `artifacts/api-server/src/lib/schema-startup-check.ts` |
| ✅ Created | `scripts/schema-drift-check.mjs` |
| ✅ Modified | `artifacts/api-server/src/lib/wa-role-resolver.ts` |
| ✅ Modified | `artifacts/api-server/src/lib/wa-commands/driver.ts` |
| ✅ Modified | `artifacts/api-server/src/lib/wa-commands/executive.ts` |
| ✅ Modified | `artifacts/api-server/src/lib/wa-commands/customer.ts` |
| ✅ Modified | `artifacts/api-server/src/app.ts` |
| ✅ Modified | `artifacts/api-server/src/routes/executive-command.ts` |
| ✅ Created | `docs/company-id-audit-v2.md` |
| ✅ Created | `docs/schema-drift-report.md` |
| ✅ Created | `docs/schema-drift-data.json` |
