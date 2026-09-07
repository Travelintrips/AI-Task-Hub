---
name: Sprint 8E Service Coverage
description: KB state after Sprint 8E — 24 target services, 90% overall coverage, idempotent seed script
---

## Post-Sprint 8E KB State

| Table                   | Before | After |
|-------------------------|--------|-------|
| intent_master           | 30     | 48    |
| keyword_rules           | 220    | 503   |
| service_catalog         | 14     | 24    |
| data_templates          | 6      | 32    |
| data_template_fields    | 35     | 303   |
| document_templates      | 5      | 21    |
| document_template_fields| 18     | 83    |

## Coverage Result

**90% overall** (was 23%, target ≥80%) — TARGET MET.

- 🟢 100% (intent + data_tmpl + doc_tmpl): Air Freight, Sea Freight, Customs, Warehousing, Import, Export, DG Cargo, Live Animal, Cold Chain, Project Cargo, Fleet Repair, Fuel Expense, Tire Issue, Damaged Goods, Delivery Delay, Payment Confirm, Vendor Reg
- 🟡 67% (intent + data_tmpl, no doc_tmpl): Trucking, PPJK, Cash Advance, Invoice Request, Customer Update, Tenant Rental, Sport Booking

## 18 New Intents Added

trucking_inquiry, air_freight_inquiry, sea_freight_inquiry, customs_clearance, ppjk_service, warehousing_request, import_inquiry, export_inquiry, dg_cargo, live_animal_cargo, cold_chain, project_cargo, fleet_repair, fuel_expense, tire_issue, damaged_goods_complaint, delivery_delay_complaint, customer_data_update

## Seed Script

`scripts/seed-sprint8e-service-coverage.mjs` — fully idempotent, runs against SUPABASE_DATABASE_URL.

**Why idempotent:** intent_master and keyword_rules have no unique constraints, so use DELETE WHERE intent_code=X + INSERT. data_templates/document_templates: check for existing intent_code before inserting (SELECT then conditional INSERT). data_template_fields/document_template_fields: DELETE by template_id then re-insert.

**Script timeout note:** Script times out in 120s bash runner. Split Phase E separately if re-running — the main script does all phases, but doc templates (Phase E) may need a separate run if timeout occurs.

## Intake Modes

All 26+ data_templates use `intake_mode = 'conversation'` (AI collects fields via WA conversation). No mini_form configured yet — can be added in Sprint 9B if needed.
