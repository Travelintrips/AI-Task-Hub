---
name: Sprint 6B Purchasing Intelligence
description: Architecture decisions, gotchas, and type patterns for the Purchasing Intelligence module.
---

# Sprint 6B — Purchasing Intelligence

## Tables (all in Replit DB via executeSql)
- logistic_purchase_requests — central purchase request entity
- purchasing_signals — historical price/cost signals from real transactions
- purchasing_price_benchmarks — computed price benchmark stats (p10/p25/median/p75/p90)
- purchasing_intel_signals — per-request AI scoring signals with severity/score
- purchasing_budget_tracker — monthly budget utilization per category/department
- vendor_contract_rates — contracted rates per vendor/category/route

## Route files
- purchasing-requests.ts — CRUD + evaluate + status flow
- purchasing-benchmark.ts — benchmark read + contract rates CRUD
- purchasing-budget.ts — budget tracker + recalculate
- purchasing-margin.ts — margin impact scoring
- purchasing-approval.ts — submit for approval + decide (Supabase approval_requests table)

## Engine (purchasing-engine.ts)
- 5 scoring modules: scorePriceBenchmark, scoreDuplicate, scoreVendorRisk, scoreBudgetImpact, scoreMarginImpact
- evaluatePurchaseRequest() calls all 5 in Promise.all then computeCompositeScore()
- scorePriceBenchmark() takes `proposedAmount` (not `estimatedAmount`) — map when calling from evaluatePurchaseRequest

## Key TypeScript gotchas
- **req.params.id needs `as string` cast** in Express 5 — `req.params` is typed as `{ [key: string]: string | string[] }`, so `parseInt(req.params.id as string)` is required
- **Duplicate property TS1117** — caused by writing `belowFloor` twice in an object literal; easy to miss in multi-line objects
- **req.query string | string[]** — `as Record<string, string>` cast on destructuring doesn't always silence TypeScript; explicit `as string` on usage points is safer
- **Pre-existing errors** in training.ts, governance.ts, customer-memory.ts, observability.ts, escalation-scheduler.ts — not introduced by Sprint 6B

**Why:** Express 5 tightened param types vs Express 4.

**How to apply:** Always cast req.params.* as string when passing to parseInt/parseFloat, and cast req.query.* values explicitly at point of use.
