---
name: Sprint 10A-1.1 Data Standardization Hardening
description: company_id type map, plate normalization helpers, schema drift scanner, ECC Data Health widget
---

## Company ID Type Reality (Supabase DB)

**INTEGER company_id** — Drizzle schema says `text`, actual DB is `integer`:
- `customers`, `approval_rules`, `approval_requests`, `users`
- Also many non-app tables: accounting_*, bank_*, finance_*, fleet_accounting*, etc.

**Safe TEXT company_id** (Drizzle eq() is safe):
- `ai_tasks`, `team_members`, `fleet_units`, `fleet_drivers`, `fleet_fuel_logs`
- `fleet_maintenance_records`, `fleet_tires`, `fleet_utilization_logs`, `fleet_risk_scores`
- `logistic_purchase_requests`, `purchasing_signals`, `vendor_contract_rates`
- `whatsapp_commands`, `whatsapp_command_logs`, `whatsapp_usage_metrics`
- `intent_master`, `keyword_rules`, `data_templates`, `document_templates`
- `customer_memory_snapshots`, `vendor_memory_snapshots`, `customer_preferences`

**Why:** `customers` was built before Drizzle migration, inherits INTEGER company_id from legacy ERP schema.

## Helpers Created (Sprint 10A-1.1)

- `src/lib/company-id.ts` — `normalizeCompanyId()`, `safeCompanyMatch()`, `companyFilter()`, `companyFilterByName()`, `rawCompanyFilter()`
- `src/lib/plate-number.ts` — `normalizePlate(raw)` → UPPERCASE, no spaces/dashes/dots; `plateWhere(col, input)` → Drizzle SQL condition
- `src/lib/schema-startup-check.ts` — reads `docs/schema-drift-data.json`, logs SCHEMA OK or SCHEMA DRIFT DETECTED at startup
- `scripts/schema-drift-check.mjs` — full drift scanner, writes `docs/schema-drift-data.json` + `docs/schema-drift-report.md`

## Schema Drift Summary (as of 2026-06-23)

- Tables missing in DB: 16 (routing_rules, sla_matrix, training/ML tables — not active routes)
- Columns missing in DB: 22 (task_attachments.customer_id ← fixed; approval_rules.*; prompt_versions.*)
- Type mismatches: 26 (4 company_id, rest are text/ARRAY mismatches in memory snapshots)
- Extra cols in DB: 548 (normal — DB has more than Drizzle tracks)

## Plate Normalization

`plateWhere(col, input)` handles: no-spaces ("B7777ZZZ"), dashes ("B-7777-ZZZ"), lowercase ("b7777zzz"), spaces ("B 7777 ZZZ") — ALL match DB stored format "B 7777 ZZZ".

**How to apply:** Import from `src/lib/plate-number.ts`, replace inline `sql\`REPLACE(LOWER(...))\`` patterns.

## ECC Data Health Widget

- API: `GET /api/executive/data-health` — reads drift JSON, returns `{status, typeMismatches, missingColumns, missingTables, criticalCompanyIdMismatches}`
- Frontend: `DataHealthWidget` component in `executive-command.tsx` with 3-stat grid + critical company_id alert
- Requires `company_admin` role

## Pre-existing TypeCheck Errors (NOT from 10A-1.1)

conversation-intake-engine.ts, intake-engine.ts, intake-sessions.ts, intake-form.ts: auditLogs entityId string vs integer, needsAdminReview column drift. Conversation-tests.ts: TS7030 missing returns. These predated Sprint 10A-1.1.
