# Memory Index

- [Empty pages / 0 data](empty-pages-debugging.md) — all pages empty usually = Drizzle schema drift (run db push) + repopulate via sync-from-supabase, not ad-hoc.
- [Order → ai_task auto-sync](order-to-task-autosync.md) — scheduler pulls Supabase logistic_orders into ai_tasks, dedup by task_number=order_number, SSE real-time (~30s).
- [WA notification silent skip](wa-notification-phone.md) — WA ke staff dilewati diam-diam jika team_members.phone NULL; frontend pernah query /team-members (404) bukan /team.
- [Sprint 1A table migrations](sprint1a-table-migrations.md) — activityTable→auditLogsTable, tasksTable→aiTasksTable, customerContextsTable→customersTable; field mappings non-obvious.
- [Sprint 2A IntentEngine](sprint2a-intent-engine.md) — KB-driven intent resolution: intent-engine.ts (5-layer, 5-min TTL cache), whatsapp-ai.ts thin adapter, task-service.ts additive; drizzle-kit push always times out — use executeSql for schema changes instead.
- [Sprint 5A Customer Memory](sprint5a-customer-memory.md) — Memory Center: 5 tables, customer_aggregates VIEW (no persistent financials), immutable risk, snapshot inject into resolveIntent via customerId param.
- [Sprint 5B Vendor Memory](sprint5b-vendor-memory.md) — 7 tables (vendor_preferences, risk_assessments, performance_snapshots, capabilities, document_registry, memory_snapshots, memory_events); req.user?.id must be String()-wrapped; sql.raw() takes 1 arg only, use sql`` tagged template for dynamic queries.
- [Sprint 5E DB split + intel patterns](sprint5e-intel-patterns.md) — heliumdb vs Supabase split, drizzle array serialization bug, pgArr helper, requireRole import source.
- [Sprint 6B Purchasing Intelligence](sprint6b-purchasing-intel.md) — 6 tables in Replit DB, 5 route files, purchasing-engine.ts; req.params.id needs `as string` cast in Express 5; duplicate object literal property causes TS1117; scorePriceBenchmark takes proposedAmount not estimatedAmount.
- [Sprint 6C Purchasing Refinement](sprint6c-purchasing-refinement.md) — purchasingIntelSignalsTable.purchaseRequestId is notNull — cannot use for signals without a request (use purchasingSignalsTable instead); vendorContractRatesTable.vendorId is notNull (use 0 as fallback); approval decide uses notes||note alias; WA notif via sendFonnte with ilike name lookup.
- [Sprint 6E productionization](sprint6e-productionization.md) — db.execute() pattern, customers.company_id is INTEGER, intel_readiness_scores column names, admin user creation.
- [Sprint 7B Fleet Foundation](sprint7b-fleet-foundation.md) — 8 fleet tables, 4 route files, 6 frontend pages; pre-existing TS errors in governance/training/observability (not fleet); all tables created via executeSql.
