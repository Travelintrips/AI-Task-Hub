---
name: Sprint 6B Purchasing Intelligence
description: Architecture decisions, gotchas, type patterns, bugs found/fixed, and full validation results for the Purchasing Intelligence module.
---

# Sprint 6B — Purchasing Intelligence

## Tables (all in Replit DB via executeSql)
- logistic_purchase_requests — central purchase request entity; AI fields prefixed with `ai_` (e.g. `ai_risk_tier`, `ai_risk_score`, `ai_duplicate_flag`, `ai_price_deviation_pct`, `ai_budget_impact_pct`)
- purchasing_signals — historical price/cost signals from real transactions
- purchasing_price_benchmarks — computed price benchmark stats (p10/p25/median/p75/p90)
- purchasing_intel_signals — per-request AI scoring signals; column is `purchase_request_id` (NOT `request_id`)
- purchasing_budget_tracker — monthly budget utilization per category/department
- vendor_contract_rates — contracted rates per vendor/category/route

## Critical Bug Found and Fixed (Sprint 6B validation)
All 5 route files registered paths as `"/api/purchasing/..."` but the Express router is mounted at `/api` — so the effective path became `/api/api/purchasing/...`. Fixed all 5 files with sed to use `"/purchasing/..."`.

**Why:** Every other route file in this codebase uses paths WITHOUT the `/api` prefix. The artifact's workflow command doesn't include `fuser -k`, so a custom "API Server (custom)" workflow with port cleanup is needed.

## Route files
- purchasing-requests.ts — CRUD + evaluate + status flow
- purchasing-benchmark.ts — benchmark read + contract rates CRUD
- purchasing-budget.ts — budget tracker + recalculate
- purchasing-margin.ts — margin impact scoring (path: `/purchasing/requests/:id/margin-impact`, NOT `/purchasing/margin/analysis`)
- purchasing-approval.ts — submit for approval + decide (uses Supabase approval_requests)

## Engine (purchasing-engine.ts)
- 5 scoring modules: scorePriceBenchmark, scoreDuplicate, scoreVendorRisk, scoreBudgetImpact, scoreMarginImpact
- evaluatePurchaseRequest() calls all 5 in Promise.all then computeCompositeScore()
- scorePriceBenchmark() takes `proposedAmount` (not `estimatedAmount`) — map when calling from evaluatePurchaseRequest

## Approval Flow
- Decision endpoint accepts `"approved"` or `"rejected"` (NOT `"approve"`/`"reject"`)
- submit-for-approval is idempotent — second call returns existing approvalId
- approval_requests Replit DB table has NO `module` column (old schema); purchasing approvals stored via Supabase side

## Port Management
- `artifacts/api-server: API Server` is artifact-managed and CANNOT be reconfigured
- Ghost processes accumulate on port 8080 — find via `ls /proc/*/cmdline | while read f; do cat "$f" | tr '\0' ' ' | grep "dist/index" && echo "$f"; done`, kill by PID
- `"API Server (custom)"` workflow with `fuser -k 8080/tcp 2>/dev/null; sleep 2 && pnpm --filter @workspace/api-server run dev` is the working pattern

## Key TypeScript gotchas
- **req.params.id needs `as string` cast** in Express 5
- **Duplicate property TS1117** — caused by writing same key twice in object literal
- **req.query string | string[]** — explicit `as string` on usage points is safer
- **Pre-existing errors** in training.ts, governance.ts, observability.ts — not Sprint 6B

**Why:** Express 5 tightened param types vs Express 4.
