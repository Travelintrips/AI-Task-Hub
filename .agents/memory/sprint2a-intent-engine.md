---
name: Sprint 2A IntentEngine
description: KB-driven intent detection replacing hardcoded whatsapp-ai.ts logic; architecture decisions, column additions, and environment quirks.
---

## What was built
- NEW `artifacts/api-server/src/lib/intent-engine.ts` — 5-layer KB service
- MODIFIED `artifacts/api-server/src/lib/whatsapp-ai.ts` — thin adapter (all exports preserved, signature unchanged)
- MODIFIED `artifacts/api-server/src/lib/task-service.ts` — optional `resolution?: IntentResolution` in CreateTaskInput
- MODIFIED `artifacts/api-server/src/routes/whatsapp.ts` — passes savedMsgId as 3rd arg to detectWhatsAppIntent, passes result._resolution to createTaskFromWhatsAppMessage
- MODIFIED `lib/db/src/schema/data_templates.ts` — added intentCode column
- MODIFIED `lib/db/src/schema/document_templates.ts` — added intentCode column

## Key architecture decisions
- `detectWhatsAppIntent()` signature is UNCHANGED (backward compat); adds optional 3rd param `messageId?: number`
- `IntentResolution` is exported from intent-engine.ts AND re-exported from whatsapp-ai.ts as `{ IntentResolution }`
- `WhatsAppIntentResult` carries `_resolution?: IntentResolution` for passthrough to task-service
- Cache: 5-min TTL in-memory Maps per companyId; keys like `companyId:dt:intentCode:category`
- Lookup order: intentCode exact match first, then category fallback
- Fallback is always `general_inquiry` (seeded in Sprint 1B) — never throws
- Every intent decision → INSERT INTO audit_logs (action='intent_detected', module='intent_engine')
- `slaHours` from intent_master → set on ai_tasks.sla_hours + overdueAt computed as now + slaHours*3600s

## Environment quirk
- `drizzle-kit push` always times out waiting for interactive confirmation in this container
- **Must use `executeSql()` in code_execution for all ALTER TABLE and schema changes**

## Seed data counts
- intent_master: 12 (Sprint 1B)
- keyword_rules: 47 (M3.4)
- service_catalog: 13 (M3.5)
- data_templates: 5 (1 Import + 4 others)
- data_template_fields: 41 (16 Import + 25 others)
- document_templates: 5
- document_template_fields: 20

## IntentResolution fields added (vs design)
- `routingCode: string | null` — mirrors intentCode when matched
- `needsApproval: boolean` — true for complaint/customs/payment_confirmation that also needsAdminReview
- `approvalType: string | null` — "admin_approval" when needsApproval

**Why:** User requested these fields in Sprint 2A revisions to support future routing/approval workflow.
