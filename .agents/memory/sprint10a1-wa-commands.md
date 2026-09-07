---
name: Sprint 10A-1 WA First Operations
description: WhatsApp command router architecture, known schema gotchas, and integration hook point
---

## Architecture

- Hook point: `processIncomingMessage()` in `routes/whatsapp.ts`, AFTER SSE emit (step 2 of 6), BEFORE attachment save. Return early if `routeWaCommand()` returns true.
- Router is loaded via dynamic import (`await import("../lib/wa-command-router")`) to avoid circular deps.
- Role lookup chain: team_members → fleet_drivers → customers. No "vendor" role in DB — vendor commands rely on entityId being null as the unregistered signal.
- Pending supervisor confirmations: in-memory Map with 5-min TTL (phone → {action, requestId, requestNumber, expiry}).

## Schema

- 3 new Drizzle tables: `whatsappCommandsTable`, `whatsappCommandLogsTable`, `whatsappUsageMetricsTable`
- Migration runs in `app.ts` via `supabasePool.query(...)` (NOT drizzle-kit push — times out)
- Metrics uses insert-only append strategy; aggregated at query time in `/wa-commands/metrics`

## Known Gotchas

**Why:** Learned from compilation failures and migration errors.

- `desc` is a PostgreSQL reserved keyword — use `dsc` as the alias in VALUES clauses.
- `WaRole` union type in `wa-role-resolver.ts` does NOT include `"vendor"` (no vendor role in team_members). Check `user.entityId` instead.
- `whatsappMessagesTable` has no `updatedAt` column — only `processed` and `aiProcessed` can be updated to mark as handled.
- Vendor STATUS/DOKUMEN commands use `user.entityId` (null = not registered) not role comparison.

## Command Registry

18 commands seeded on startup (idempotent): STATUS, DOCS, HELP, MENU (customer), BBM, RUSAK, POSISI, HELP DRIVER (driver), DAFTAR VENDOR, STATUS VENDOR, DOKUMEN VENDOR (vendor), APPROVAL, APPROVE, KONFIRMASI, REJECT (supervisor), DASHBOARD, RISK, BRIEFING (owner/admin).

## Files

- `lib/db/src/schema/whatsapp_commands.ts` — 3 table definitions
- `artifacts/api-server/src/lib/wa-role-resolver.ts` — phone → role lookup
- `artifacts/api-server/src/lib/wa-commands/` — 5 handlers (customer, driver, vendor, supervisor, executive) + types.ts
- `artifacts/api-server/src/lib/wa-command-router.ts` — main parser, dispatcher, audit logger
- `artifacts/api-server/src/routes/wa-commands.ts` — admin API (/logs, /metrics, /test)
- `artifacts/ai-task-center/src/pages/executive-command.tsx` — WaAdoptionWidget at bottom
