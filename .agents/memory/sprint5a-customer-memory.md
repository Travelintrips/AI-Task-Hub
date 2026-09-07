---
name: Sprint 5A Customer Memory Center
description: Architecture, key decisions, and audit findings for the Customer Memory Center feature
---

## Tables (Sprint 5A)
- `customer_preferences` — status lifecycle: active|inactive|superseded; PUT upserts = supersede old + insert new
- `customer_risk_assessments` — IMMUTABLE: POST creates new row, sets old row isActive=false + archivedByAssessmentId
- `customer_memory_snapshots` — freshnessScore smallint 0-100; isStale flipped when new snapshot generated; validUntil=7 days
- `customer_memory_events` — audit trail; eventTypes: snapshot_generated|preference_inferred|preference_updated|risk_assessed|document_registered
- `customer_document_registry` — isCurrent: POST supersedes previous doc of same documentType; PATCH sets isVerified+verifiedBy+verifiedAt

## customer_aggregates VIEW
Financial aggregates (lifetime_value, avg_order_value, open_tasks, etc.) are in a PostgreSQL VIEW, NOT in any persistent table.
- **CREATED on Supabase** via psql — not in any Drizzle migration file. Must be re-run manually if DB is reset.
- **Type quirk**: `customers.company_id` is `integer` in Supabase but `text` in ai_tasks/quotations/whatsapp_messages. VIEW JOINs use `c.company_id::text` to cast.
- Never add these columns to `customers` table.

## API Routes (all under /api/crm/customers/:id/...)
- GET /memory — full profile: customer + activeRisk + latestSnapshot + aggregates + preferences
- GET /aggregates — customer_aggregates VIEW (financial data only)
- GET /timeline — unified task+message+quotation events, sorted by happenedAt desc
- GET|PUT|DELETE /preferences/:category/:key — CRUD with supersede lifecycle
- GET|POST /risk — GET returns {active, history}; POST creates immutable assessment
- GET /memory/events — audit trail
- GET /ai-context — latest snapshot
- POST /ai-context/refresh — OpenAI-generated snapshot (GPT-4o-mini, ≤450 tokens); calls invalidateCustomerMemoryCache() after insert
- GET /ai-context/history — snapshot version list
- GET|POST /documents — Document Registry CRUD
- PATCH|DELETE /documents/:docId — update/delete individual doc

## IntentEngine Integration
- `loadCustomerMemory(companyId, customerId)` — fetches latest non-stale aiContextBlock, 10-min TTL cache; also checks validUntil (expired = treated as null)
- `invalidateCustomerMemoryCache(companyId, customerId)` — must be called after POST /ai-context/refresh (fixed in audit)
- `resolveIntent()` accepts optional `customerId?: number | null`
- Memory block injected into userContent as `## Customer Memory (from previous interactions)\n{aiContextBlock}`

## Frontend
- Route: `/crm/customers/:id/memory` → `pages/customer-memory.tsx` (6 tabs: Profil, Timeline, Preferensi, Risk, Dokumen, AI Context)
- CRM list (`customers-crm.tsx`): Brain icon "Memory" button on each card
- Task detail (`ai-task-detail.tsx`): `CustomerMemoryPanel` component in sidebar

## Sprint 5A Audit Findings (June 2026) — Fixed
1. **[FIXED]** Cache not invalidated after refresh → `invalidateCustomerMemoryCache()` now called in POST /ai-context/refresh
2. **[FIXED]** `customer_aggregates` VIEW missing → created on Supabase via psql (see type quirk above)
3. **[FIXED]** `validUntil` not checked → `loadCustomerMemory()` now skips expired snapshots

## Known Remaining Gaps (deferred to next sprint)
- AI-inferred preferences: IntentEngine never writes to customer_preferences (manual only)
- missingDocsList never computed in refresh route
- No background freshness degrader / staleness auto-trigger on new task arrival
- No document reuse suggestion in task creation flow

**Why:** Customer memory must survive across sessions and be injected into AI decisions without manual re-entry. Immutable risk assessments preserve audit trail for financial compliance.
