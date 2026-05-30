---
name: 11 Fitur Roadmap AI Task Center
description: Detail implementasi 11 fitur roadmap — SLA, Checklist, Quotation, Reports, AuditLog, Shipment, CRM, Portal, Scheduler, Notifikasi
---

## Fitur yang diimplementasikan

### DB Schema (lib/db/src/schema/)
- `customers.ts` — CRM customer table
- `operational_checklists.ts` — checklist per task; kolom `taskType` (string), `taskId`, `isDone`, `doneAt`, `doneBy`
- `quotations.ts` — quotation module dengan breakdown biaya
- `audit_logs.ts` — audit trail seluruh aktivitas
- `shipment_trackings.ts` + `shipment_events.ts` — tracking container/AWB
- `follow_up_logs.ts` — log follow-up otomatis WhatsApp
- `ai_tasks` extended: `slaHours`, `overdueAt`, `completedAt`, `slaStatus`, `lastCustomerReplyAt`, `followUpCount`

### API Routes (artifacts/api-server/src/routes/)
- `checklists.ts` — CRUD checklist + init dari template
- `quotations.ts` — CRUD quotation + status workflow (draft/sent/accepted/rejected)
- `reports.ts` — 4 endpoints: /reports/overview, /reports/team, /reports/ai, /reports/customers
- `audit-log.ts` — GET + POST audit logs
- `shipment.ts` — tracking + events
- `customers-crm.ts` — CRUD customer CRM
- `portal.ts` — portal customer: login via phone+taskNumber, view tasks/tracking/quotation

### Libs (artifacts/api-server/src/lib/)
- `sla.ts` — getSlaHours, calcOverdueAt, calcSlaStatus, refreshSlaStatuses
- `follow-up-scheduler.ts` — scheduler 1 jam, kirim WA Fonnte di 24j/72j/168j

### Frontend (artifacts/ai-task-center/src/)
- pages: notifications, customers-crm, reports, quotations, portal, audit-log
- components: sla-badge.tsx, operational-checklist.tsx, shipment-tracking.tsx
- App.tsx + app-layout.tsx diupdate dengan routes + nav baru

## Gotcha penting
- `taskCommentsTable` gunakan field `comment` (bukan `content`), `senderName` (bukan `author`), `senderType` (bukan `type`)
- `req.params.taskType` perlu di-cast dengan `String()` sebelum dipakai di Drizzle `eq()`
- SLA hours: Import=72j, Export/Customs=48j, Trucking=24j, default=48j
- Follow-up scheduler distart dari `app.ts` menggunakan `startFollowUpScheduler()`
- SLA status di-refresh setiap 15 menit via `setInterval` di `app.ts`
