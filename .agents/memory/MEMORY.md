# Memory Index

- [Empty pages / 0 data](empty-pages-debugging.md) — all pages empty usually = Drizzle schema drift (run db push) + repopulate via sync-from-supabase, not ad-hoc.
- [Order → ai_task auto-sync](order-to-task-autosync.md) — scheduler pulls Supabase logistic_orders into ai_tasks, dedup by task_number=order_number, SSE real-time (~30s).
- [WA notification silent skip](wa-notification-phone.md) — WA ke staff dilewati diam-diam jika team_members.phone NULL; frontend pernah query /team-members (404) bukan /team.
- [Sprint 1A table migrations](sprint1a-table-migrations.md) — activityTable→auditLogsTable, tasksTable→aiTasksTable, customerContextsTable→customersTable; field mappings non-obvious.
