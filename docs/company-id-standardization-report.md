# Company ID Standardization Report
**Sprint 8D — Phase 4 — Pre-Sprint 9 Hardening**
**Generated:** 2026-06-22

---

## Executive Summary

Audit menemukan **konflik kritis** antara dua representasi `company_id` di sistem:

| Layer | Tipe | Nilai Contoh |
|---|---|---|
| Drizzle ORM tables (heliumdb) | `TEXT` | `"default"` |
| Supabase legacy tables | `INTEGER` | `1`, `2`, `3` |
| Express middleware / JWT | `STRING` | `"default"` |
| Intent Engine | `STRING` | `"default"` |

---

## Current State

### Tables yang menggunakan INTEGER company_id (Supabase legacy)

| Table | Type | Impact |
|---|---|---|
| `logistic_orders` | INTEGER | Digunakan oleh intel_refresh.ts (JOIN dengan company_id text) |
| `expense_budgets` | INTEGER | Join target untuk purchasing_budget_tracker |
| `logistic_vendor_fulfillments` | INTEGER | Data source untuk purchasing engine |
| `logistic_purchase_requests` | **TEXT** via Drizzle | OK — sudah di Drizzle layer |
| `quotations` | Perlu verifikasi | — |
| `shipments` | Perlu verifikasi | — |

### Tables yang menggunakan TEXT company_id (Drizzle ORM)

Seluruh tabel yang dibuat via Drizzle ORM di `lib/db/src/schema/` menggunakan:
```typescript
companyId: text("company_id").notNull().default("default")
```

Meliputi:
- `ai_tasks`, `audit_logs`, `intent_master`, `keyword_rules`
- `data_templates`, `document_templates`, `service_catalog`
- `customer_memory_snapshots`, `customer_memory_events`, `customer_preferences`, `customer_risk_assessments`
- `vendor_memory_snapshots`, `vendor_performance_snapshots`, `vendor_memory_events`, `vendor_preferences`
- `intel_routes`, `intel_vendors`, `intel_customers`, `intel_profit`, `intel_quotations`, `intel_readiness_scores`
- `purchasing_price_benchmarks`, `purchasing_budget_tracker`, `purchasing_signals`, `purchasing_intel_signals`
- `vendor_contract_rates`, `fleet_units`, `fleet_drivers`, dan seluruh fleet_* tables
- `conversation_intake_sessions`, `document_intake_audits`, `document_validation_rules`

---

## Conflict Locations

### Backend — Potensial Type Mismatch

| File | Baris Kritis | Issue |
|---|---|---|
| `lib/intel-refresh.ts` | ~166-175 | `JOIN ai_tasks at ON at.company_id = st.company_id` — `shipment_trackings.company_id` bisa INTEGER |
| `lib/purchasing-engine.ts` | ~450 | `WHERE company_id = ${companyId}` — raw SQL dengan string companyId |
| `lib/intel-refresh.ts` | ~168 | `WHERE st.company_id = $1` — parameter `[companyId]` adalah string "default" |
| `middleware/auth.ts` | L102-117 | `companyId` selalu return STRING dari JWT |
| `scripts/sync-from-supabase.ts` | sync logic | References Supabase company_id INTEGER |

### Specific Cast Problems

```sql
-- intel_refresh.ts melakukan JOIN cross-database:
LEFT JOIN ai_tasks at ON at.id = st.task_id AND at.company_id = st.company_id
-- ai_tasks.company_id = TEXT "default"
-- shipment_trackings.company_id = INTEGER (jika dari Supabase)
-- → Akan gagal atau tidak ada hasil karena type mismatch
```

### Frontend

Frontend tidak langsung menyentuh `company_id` — semua dihandle di backend JWT. Tidak ada issue di frontend.

---

## Conflicts Summary

| Konflik | Severity | Impact |
|---|---|---|
| `logistic_orders.company_id` INTEGER vs Drizzle tables TEXT | **HIGH** | Intel refresh JOIN akan silent fail atau return 0 rows |
| `expense_budgets.company_id` INTEGER vs `purchasing_budget_tracker.company_id` TEXT | **HIGH** | Budget import tidak bisa JOIN langsung |
| `intel_refresh.ts` JOIN cross company_id types | **HIGH** | Intel data mungkin selalu kosong untuk "default" company |
| `purchasing_engine.ts` string companyId dalam WHERE INTEGER column | **MEDIUM** | Budget queries return 0 |

---

## Recommended Target Format

**Target: Semua `company_id` sebaiknya TEXT.**

Alasan:
1. Drizzle ORM sudah menggunakan TEXT di semua tabel baru
2. String "default" lebih eksplisit untuk single-tenant
3. Multi-tenant expansion lebih mudah dengan UUID/slug daripada integer
4. Express middleware + JWT sudah return string

### Migration Plan (JANGAN eksekusi sekarang — untuk Sprint X)

```sql
-- STEP 1: Add TEXT column alongside INTEGER in legacy tables
ALTER TABLE logistic_orders ADD COLUMN company_id_text TEXT;
UPDATE logistic_orders SET company_id_text = CAST(company_id AS TEXT);

-- STEP 2: Update application to write to both during transition
-- STEP 3: Switch reads to company_id_text
-- STEP 4: Drop old INTEGER column and rename

-- Affected tables: logistic_orders, expense_budgets, logistic_vendor_fulfillments
-- Estimated effort: 2-3 hari development + testing
```

### Immediate Workaround (SAFE — apply now)

Di `intel_refresh.ts` dan `purchasing_engine.ts`, ganti:
```typescript
WHERE company_id = $1  // fails if INTEGER vs TEXT
```
Dengan:
```typescript
WHERE CAST(company_id AS TEXT) = $1  // safe cross-type comparison
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Priority |
|---|---|---|---|
| Intel refresh tidak dapat data dari logistic_orders | HIGH | Medium — intel data kosong | Fix sebelum Sprint 9D |
| Budget import gagal silent | HIGH | High — purchasing scores selalu 0 | Fix sebelum Sprint 9A |
| Multi-tenant isolation error | LOW | Critical | Tackle sebelum multi-company |

---

## Verdict

**JANGAN migrate sekarang.** Terapkan workaround CAST() di query kritis. Rencanakan full migration sebagai Sprint tersendiri setelah Sprint 9 selesai.

**Immediate action required:**
1. Tambah `CAST(company_id AS TEXT)` di cross-table queries di `intel_refresh.ts`
2. Verifikasi `purchasing_engine.ts` queries tidak JOIN ke INTEGER company_id tables secara langsung
