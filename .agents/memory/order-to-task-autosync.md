---
name: Auto-import logistic orders into ai_tasks (real-time)
description: How transactions/orders flow from Supabase into ai_tasks and surface real-time
---

# Order → ai_task auto-sync

A background scheduler in the API server polls Supabase `logistic_orders` (via
PostgREST) and creates/updates rows in local `ai_tasks`, pushing live updates to
the board via SSE. Started from app.ts alongside the follow-up scheduler.

**Dedup identity:** `ai_tasks.task_number` == `logistic_orders.order_number`
(format `LOG-YYMMDD-NNNNN`). There is NO DB unique constraint on task_number —
dedup is enforced in-process (lock + map), so do not run two importers at once.

**Status mapping** logistic_orders.status → ai_task status:
Order Received→new_inquiry, Admin Review→ready_for_review,
Vendor Confirmed→assigned, In Progress→in_progress, Completed→completed.

**Real-time path:** scheduler emits SSE `new_task` / `task_updated`
(companyId "default"); frontend ai-task-board listens via useServerEvents and
invalidates the `ai-tasks` query. Polling is ~30s, so "real-time" = within ~30s,
not instant. For instant, Supabase Realtime websockets would be needed.

**PostgREST gotcha:** when filtering by timestamp (`updated_at.gte.X`), the ISO
value must be URL-encoded (`+00:00` → `%2B00:00`) or the `+` is parsed as space.

**Why polling, not webhooks:** the logistics app writes orders to Supabase
directly; we don't control it, so we pull. Full pagination on startup imports
all historical orders not yet present; incremental polls use a time cursor.
