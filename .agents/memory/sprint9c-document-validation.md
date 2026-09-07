---
name: Sprint 9C Document Validation
description: Document Intake & Validation AI system — tables, engine, routes, frontend, WA replies
---

# Sprint 9C — Document Intake & Validation AI

## Tables
- `document_intake_audits` — per-document AI validation result (linked to task/session/customer/vendor/fleet)
- `document_validation_rules` — per-document-type field rules + OpenAI Vision prompt
- Both migrated via `scripts/src/migrate-document-validation.mjs` (Node ESM + pg Pool against SUPABASE_DATABASE_URL)

## Key decisions
- `is_active` in `document_validation_rules` is TEXT "true"/"false", not boolean — matches pattern used in other tables
- `document_intake_audits.confidence_score` is NUMERIC(5,4) stored as string in Drizzle (use parseFloat() on frontend)
- `missing_fields` is a TEXT[] column (native Postgres array)
- OpenAI Vision model: `gpt-4o-mini` with `response_format: { type: "json_object" }` + `image_url` content part
- Rule cache: 5-min TTL in-memory Map in document-validation-engine.ts; invalidate via `invalidateRuleCache()`

## 11 document types seeded
commercial_invoice, packing_list, bl_awb, hs_code, coa, msds, damage_photo, stnk_kir_insurance, fuel_receipt, maintenance_invoice, cash_advance_receipt

## API routes (all under /api)
- POST /documents/validate — ad-hoc validation
- GET /documents/audits — list with filters (status, documentType, taskId, sessionId)
- GET /documents/audits/:id — single audit
- PATCH /documents/audits/:id/review — admin override
- GET /documents/rules — list all rules
- POST /documents/rules — create rule
- PATCH /documents/rules/:id — update rule
- POST /intake-sessions/:id/documents — validate + update session + WA reply
- POST /tasks/:id/documents/validate — validate linked to task

**Why:** WA replies use sendFonnte; the route fetches session.phone then calls sendFonnte after validation.

## Frontend
- `/document-intake` page — 4 tabs: Antrian, Valid, Ada Masalah, Aturan Validasi
- `DocumentValidationPanel` component inline in ai-task-detail.tsx — shows audits for task, trigger validation form
- Navigation entry: "Doc Validation" with FileCheck icon

## Gotchas
- `db.update().set()` with spread `{...(condition ? {field} : {})}` pattern works for optional updates
- `required_fields` and `optional_fields` in rules table are TEXT[] — Drizzle returns them as string[]
- Frontend query for task audits: `/documents/audits?taskId=X` (not a dedicated endpoint)
