---
name: Sprint 1A table migrations
description: Field mapping rules for the three deprecated-table replacements done in Sprint 1A. Use whenever writing new inserts/selects touching audit logs, tasks, or customers.
---

## activityTable → auditLogsTable

Insert mapping:
- `type` → `action` (notNull)
- `description` → `before`
- `entityId` → `entityId`
- Add required: `module` (notNull) — derive from action:
  - `task_*`, `document_*` → "tasks" / "documents"
  - `message_*` → "messages"
  - `customer_*` → "customers"
  - `shipment_*` → "shipments"
  - `follow_up_*` → "follow_up"
  - `quotation_*` → "quotations"
  - default → "system"
- `companyId` defaults to "default" in the schema; usually omit unless company-scoped.

Select mapping:
- `r.type` → `r.action`
- `r.description` → `r.before`

**Why:** `activityTable` was deprecated in favour of the richer `auditLogsTable` which adds `module`, `entityType`, `after`, `userId`, etc.

## tasksTable → aiTasksTable

Key schema differences:
- `assigneeId` (integer FK) → `assignedTo` (text name) — must look up `teamMembersTable` by id, then pass `.name`
- `tags` → **dropped** (no equivalent in aiTasksTable)
- `sourceMessageId` → **dropped**
- `dueDate` (text) → `dueDate` (timestamp) — parse with `new Date(dueDate)`
- `status` values differ; pass through from caller

GET response: `assigneeName` now comes directly from `assignedTo` — no second DB lookup needed.

**Why:** `tasksTable` was the original simple tasks table; `aiTasksTable` is the canonical task table with WhatsApp/AI provenance, SLA tracking, and Supabase sync.

## customerContextsTable → customersTable

Field mapping:
- `phone` (lookup key) → `whatsapp`
- `name` → `picName`
- `companyName` → `companyName` (notNull — use `name ?? phone` as fallback when creating)
- `specialNotes` → `notes`
- `totalTasks` → `totalTasks`
- `lastSeenAt` / `lastActiveTaskId` → **dropped** (use `lastTaskAt` for recency)
- `previousIntents` → **dropped** (no field in customersTable; pass `null` where required)
- `frequentService` → **dropped**

WhatsApp route: `customerCtx?.name` → `customerCtx?.picName`, `customerCtx?.previousIntents` → `null`.

**Why:** `customerContextsTable` was a narrow conversation-context table; `customersTable` is the full CRM record used across orders, tasks, and CRM views.
