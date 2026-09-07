---
name: AI Intake Flow
description: Conversational field collection before ai_task creation — architecture, hook points, and gotchas.
---

# AI Intake Flow

## Architecture
- Table: `conversation_intake_sessions` in Supabase (migrated via `scripts/migrate-intake-sessions.mjs`)
- Engine: `artifacts/api-server/src/lib/intake-engine.ts`
- Hook point: top of `runAiDetection()` in `artifacts/api-server/src/routes/whatsapp.ts`
- Frontend: `artifacts/ai-task-center/src/pages/intake-sessions.tsx` at route `/intake-sessions`

## Flow
1. Incoming WA message → `runAiDetection()`
2. **Check active session first** (`findActiveIntakeSession(phone, companyId)`)
   - If found → `processIntakeMessage()` → send reply, no task yet
   - If `ready_for_task` → create task, `markIntakeSubmitted()`
3. **No session** → normal intent detection
   - If `result.missing_data.length > 0` AND not `general_inquiry` → `startIntakeSession()` — NO task created
   - If complete or no template → create task immediately (old path)

## Key rules
- `missing_data` on `WhatsAppIntentResult` = `missingDataKeys` from resolution (already mapped in whatsapp-ai.ts)
- General inquiry (`general_inquiry`) bypasses intake — task created immediately
- Cancellation keywords: batal, cancel, tidak jadi, ga jadi, stop
- Sessions expire 24h after last activity; hourly scheduler in `app.ts` cleans them up

## Gotchas
- `apiFetch` is defined locally per frontend page — there is NO shared `@/lib/api-fetch` module
- `expireOldIntakeSessions` uses `lte(expiresAt, now)` + `isNotNull(expiresAt)` — both conditions required
- Template fields: loaded from `data_templates` + `data_template_fields` by `intent_code` first, then `category` as fallback

**Why:** Task creation from short/incomplete messages was causing noise. Intake gate ensures minimum data before task exists.
