---
name: Sprint 9D Quality Gate Engine
description: How the quality gate engine works, what intent codes to use, and which routes are valid.
---

# Sprint 9D Quality Gate Engine

## Core facts
- Engine: `artifacts/api-server/src/lib/quality-gate-engine.ts`
- Routes: `artifacts/api-server/src/routes/quality-gate.ts`
- Frontend: `artifacts/ai-task-center/src/pages/quality-gate.tsx`
- DB tables (Supabase): `quality_gate_suites`, `quality_gate_runs`, `quality_gate_results`
- Widget: added to executive-command.tsx, /quality-gate/report route

## Certified result
- Run #2: 22/22 passed = 100% — CERTIFIED GO

## Intent codes actually in intent_master (Supabase)
Use these exact strings — NOT aliases like "kasbon" or "trucking":
- permintaan_kasbon, trucking_inquiry, air_freight_inquiry, sea_freight_inquiry
- import_inquiry, export_inquiry, ppjk_service, customs_clearance
- permintaan_vendor, fleet_repair, fuel_expense, tire_issue
- damaged_goods_complaint, delivery_delay_complaint, konfirmasi_pembayaran, pertanyaan_tagihan

## Template table
- `data_templates` has `intent_code` column matching intent_master
- Template fields in `data_template_fields` (NOT `template_fields`)

## Routes that are valid (non-404)
- /api/ai-tasks (returns raw array, not wrapped in {data:[]})
- /api/intake-sessions, /api/intake-sessions/stats
- /api/mini-form-config (NOT /api/mini-form-config/analytics)
- /api/documents/audits, /api/documents/rules
- /api/executive/kpis (requires supervisor+ role — staff gets 403)
- /api/dashboard/stats (NOT /api/dashboard)
- /api/team, /api/messages, /api/tasks
- /api/fleet/units, /api/fleet/drivers, /api/fleet/fuel, /api/fleet/tires, /api/fleet/maintenance
- /api/purchasing/requests
- /api/quality-gate/runs

## Routes that return 404 (do NOT use)
- /api/knowledge-base/*, /api/customers, /api/dashboard

**Why:** Run #1 failed 15/22 because intent codes were wrong aliases, routes were 404, and task response was a raw array not {data:[]}.
