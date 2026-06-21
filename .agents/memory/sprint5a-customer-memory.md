---
name: Sprint 5A Customer Memory Center
description: Architecture and key decisions for the Customer Memory Center feature
---

## Tables (Sprint 5A)
- `customer_preferences` — status lifecycle: active|inactive|superseded; PUT upserts = supersede old + insert new
- `customer_risk_assessments` — IMMUTABLE: POST creates new row, sets old row isActive=false + archivedByAssessmentId
- `customer_memory_snapshots` — freshnessScore smallint 0-100; isStale flipped when new snapshot generated
- `customer_memory_events` — audit trail; eventTypes: snapshot_generated|preference_inferred|preference_updated|risk_assessed|document_registered
- `customer_document_registry` — isCurrent: POST supersedes previous doc of same documentType; PATCH sets isVerified+verifiedBy+verifiedAt

## customer_aggregates VIEW
Financial aggregates (lifetime_value, avg_order_value, open_tasks, etc.) are in a PostgreSQL VIEW, NOT in any persistent table. Never add these columns to `customers` table.

## API Routes (all under /api/crm/customers/:id/...)
- GET /memory — full profile: customer + activeRisk + latestSnapshot + aggregates + preferences
- GET /aggregates — customer_aggregates VIEW (financial data only)
- GET /timeline — unified task+message+quotation events, sorted by happenedAt desc
- GET|PUT|DELETE /preferences/:category/:key — CRUD with supersede lifecycle
- GET|POST /risk — GET returns {active, history}; POST creates immutable assessment
- GET /memory/events — audit trail
- GET /ai-context — latest snapshot
- POST /ai-context/refresh — OpenAI-generated snapshot (GPT-4o-mini, ≤450 tokens)
- GET /ai-context/history — snapshot version list
- GET|POST /documents — Document Registry CRUD
- PATCH|DELETE /documents/:docId — update/delete individual doc

## IntentEngine Integration
- `loadCustomerMemory(companyId, customerId)` — fetches latest non-stale aiContextBlock, 10-min TTL cache
- `resolveIntent()` now accepts optional `customerId?: number | null`
- Memory block injected into userContent as `## Customer Memory (from previous interactions)\n{aiContextBlock}`

## Frontend
- Route: `/crm/customers/:id/memory` → `pages/customer-memory.tsx` (6 tabs)
- CRM list (`customers-crm.tsx`): Brain icon "Memory" button on each card
- Task detail (`ai-task-detail.tsx`): `CustomerMemoryPanel` component in sidebar (shows risk + freshness + last intents)

**Why:** Customer memory must survive across sessions and be injected into AI decisions without manual re-entry. Immutable risk assessments preserve audit trail for financial compliance.
