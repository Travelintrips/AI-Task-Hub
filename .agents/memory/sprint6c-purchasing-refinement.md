---
name: Sprint 6C Purchasing Refinement
description: Key constraints and gotchas when working with the Purchasing Intelligence tables and approval flow
---

## Schema constraints

- `purchasingIntelSignalsTable.purchaseRequestId` is `integer("purchase_request_id").notNull()` — you CANNOT write to this table without a valid request ID. For signals that don't belong to a specific request (e.g. contract_rate_change), use `purchasingSignalsTable` instead which has nullable `purchaseRequestId`.
- `vendorContractRatesTable.vendorId` is `integer("vendor_id").notNull()` — UI may not always have a Supabase vendor ID. Use `vendorId ?? 0` as fallback (0 = no specific vendor).
- `purchasingSignalsTable.actualAmount`, `.sourceTable`, `.sourceId`, `.recordedAt` are all required (not null, no default).

## Approval flow (decide endpoint)

- Body accepts both `note` and `notes` — use `notes ?? note` to support both.
- WA notification uses `sendFonnte` with an `ilike` name lookup against `teamMembersTable.name` — first word match only (split on space).
- Response includes `waNotified: boolean` field.
- Feedback loop: writes to `purchasingSignalsTable` with `signalType = "approval_granted" | "approval_rejected"` after successful decision.

## Benchmark isStale

- `isStale` is computed at query time: `(Date.now() - createdAt) / (1000*60*60*24) > 7`
- Benchmark list response includes `hasStale: boolean` and `oldestRefresh: Date | null`.
- Refresh endpoint returns detailed log: `{ refreshedAt, elapsedMs, refreshed, categoriesUpdated, totalSamples, entries[] }`.

## Frontend purchasing-intelligence.tsx

- Tab "Kontrak" = contract rates CRUD with `ContractRateDialog` (create/edit) and deactivate button.
- `ApprovalStatusTracker` shows 3-step flow with approver name/date/rejection reason.
- `ApproveRejectPanel` renders inside both the Approval tab list AND the RequestDetailPanel approval sub-tab.
- `ScoreGauge` shows composite AI score with color-coded Progress bar.
- `PriceDeviationBar` shows % deviation with p25/median/p75 range.
- Floating detail modal when `selectedRequestId` is set and `activeTab !== "requests"`.

**Why:**
These were discovered during Sprint 6C implementation when smoke tests revealed null-constraint violations and missing required fields. The approval-signals table separation is a hard constraint from the Drizzle schema.
