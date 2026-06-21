# Sprint 5E — Intelligence Readiness Layer
## Architecture Design Document

---

## Overview

The Intelligence Readiness Layer (IRL) is a **pre-computed, periodically refreshed data foundation** that consolidates every signal from Sprints 5A–5D into five queryable intelligence datasets. No AI inference happens here. The IRL answers the question: *"Is the data good enough, fresh enough, and complete enough to power AI decisions later?"*

Each dataset is a materialized table written by a scheduled refresh job, with a per-dataset **Readiness Score** (0–100) that quantifies data quality before any downstream consumer (Purchasing Intelligence, CMM, or future AI decisions) relies on it.

---

## Architecture Overview

```
INPUT LAYER                    REFRESH ENGINE             INTELLIGENCE DATASETS
──────────────────────         ──────────────────         ──────────────────────────────
Sprint 5A Customer Memory  ──►                        ──► intel_customers
Sprint 5B Vendor Memory    ──►  IRL Refresh Jobs      ──► intel_vendors
Sprint 5C CMM              ──►  (scheduled + trigger) ──► intel_routes
Sprint 5D Outcomes         ──►                        ──► intel_profit
Existing: ai_tasks,        ──►                        ──► intel_quotations
  quotations, shipment_
  trackings, service_
  catalog, dispatcher_logs
                                                       ──► intel_readiness_scores
                                                           (per dataset, per period)

                                                       API Layer
                                                       GET /api/intel/*
                                                       Observability: /api/intel/health
```

All five datasets are **tables, not views**. Writing to tables instead of computing on-read means:
- API responses are single-table selects — no complex joins at query time
- Readiness scores can be computed incrementally as source data arrives
- Stale data is detectable before a downstream consumer queries it
- No new cache infrastructure needed — same in-memory TTL cache already used in `intent-engine.ts`

---

## Source Map: Inputs → Datasets

| Source Table | Customer Intel | Vendor Intel | Route Intel | Profit Intel | Quotation Intel |
|---|:---:|:---:|:---:|:---:|:---:|
| `customers` | ✓ | | | | |
| `customer_preferences` | ✓ | | | | |
| `customer_risk_assessments` | ✓ | | | ✓ | |
| `customer_memory_snapshots` | ✓ | | | | |
| `vendor_capabilities` | | ✓ | ✓ | | |
| `vendor_performance_snapshots` | | ✓ | ✓ | ✓ | |
| `vendor_risk_assessments` | | ✓ | | | |
| `vendor_document_registry` | | ✓ | | | |
| `vendor_memory_snapshots` | | ✓ | | | |
| `cmm_recommendations` (5C) | | ✓ | | | |
| `recommendation_outcomes` (5D) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `purchasing_signals` (5D) | | ✓ | ✓ | ✓ | ✓ |
| `recommendation_perf_by_vendor` (5D) | | ✓ | | | |
| `ai_tasks` | ✓ | | ✓ | ✓ | ✓ |
| `quotations` | | | | ✓ | ✓ |
| `shipment_trackings` | | | ✓ | | |
| `service_catalog` | | | ✓ | ✓ | ✓ |
| `dispatcher_logs` | | ✓ | | | |
| `prediction_logs` | | | | | ✓ |

---

## Dataset 1 — Route Intelligence (`intel_routes`)

**What it answers:** For a given origin → destination + service category, what does the business know about demand, timing, cost, and vendor fit?

### Data Sources
- `shipment_trackings`: `portOfLoading`, `portOfDischarge`, `eta`, `ata`, `etd`, `atd` — actual vs. estimated timing
- `ai_tasks`: `category`, `division`, count of tasks per route, `slaStatus` distribution
- `purchasing_signals` (5D): `actualCost`, `actualMargin`, `marginPct` per route
- `vendor_capabilities`: `originCities`, `destinationCities`, `serviceType` — which vendors cover this route
- `recommendation_outcomes` (5D): `completionResult`, `customerSatisfactionScore` per route
- `service_catalog`: `basePrice`, `estimatedDays`, `slaHours` — catalog benchmark per category
- `customers`: `typicalRoutes`, `typicalCargoTypes` — demand signal

### Schema: `intel_routes`

| Column | Type | Derivation |
|---|---|---|
| `id` | serial PK | |
| `companyId` | text | |
| `origin` | text | `shipment_trackings.portOfLoading` or parsed from task |
| `destination` | text | `shipment_trackings.portOfDischarge` or parsed from task |
| `serviceCategory` | text | `ai_tasks.category` |
| `periodStart` | date | rolling 90-day window |
| `periodEnd` | date | |
| **Demand signals** | | |
| `taskCount` | integer | count of `ai_tasks` on this route+category |
| `uniqueCustomers` | integer | distinct `customerId` on this route |
| `repeatCustomerRate` | real | customers with >1 task / uniqueCustomers |
| `avgTasksPerMonth` | real | taskCount / months in period |
| **Timing** | | |
| `avgEtaDays` | real | mean of (eta - etd) across `shipment_trackings` |
| `avgActualDays` | real | mean of (ata - atd) where both present |
| `onTimeDeliveryRate` | real | tasks where ata ≤ eta / total with tracking |
| `catalogEstimatedDays` | text | from `service_catalog.estimatedDays` |
| **Cost benchmarks** | | |
| `catalogBasePrice` | real | `service_catalog.basePrice` (cast to real) |
| `avgQuotedAmount` | real | mean of `quotations.totalAmount` on this route |
| `avgActualCost` | real | mean of `purchasing_signals.actualCost` |
| `avgActualRevenue` | real | mean of `purchasing_signals.actualRevenue` |
| `avgMarginPct` | real | mean of `purchasing_signals.marginPct` |
| `costVariancePct` | real | (avgActualCost - catalogBasePrice) / catalogBasePrice |
| `priceSignalCount` | integer | rows in `purchasing_signals` for this route — sample size |
| **Vendor coverage** | | |
| `vendorCount` | integer | distinct vendors with capability on this route |
| `avgVendorSelectionRate` | real | from `recommendation_perf_by_vendor` |
| `topVendorIds` | integer[] | top 3 vendors by `selectionRate` + `avgActualMargin` |
| **Quality** | | |
| `avgCustomerSatisfaction` | real | from `recommendation_outcomes` |
| `successRate` | real | completionResult = successful / total |
| **Readiness** | | |
| `readinessScore` | smallint | 0–100, see Readiness Scoring section |
| `readinessFlags` | text[] | list of gap reasons |
| `refreshedAt` | timestamp | last IRL refresh |
| `isStale` | boolean | staleness flag |
| `createdAt` | timestamp | |

**Indexes:**
```
(companyId, origin, destination, serviceCategory, periodStart) — unique
(companyId, serviceCategory)
(companyId, readinessScore)
(companyId, isStale)
```

### Dataset Rows
One row per `(companyId, origin, destination, serviceCategory, periodStart)`. A new period row is created each time the nightly job runs if ≥3 tasks exist for that combination. This keeps historical trend data queryable.

---

## Dataset 2 — Vendor Intelligence (`intel_vendors`)

**What it answers:** For a given vendor, what is their consolidated capability, performance, risk, document status, and CMM recommendation track record?

### Data Sources
- `vendor_capabilities`: serviceTypes, cargoTypes, certifications, coverage areas
- `vendor_performance_snapshots`: onTimeRate, responseRate, documentAccuracy, totalRevenue, totalMargin, cancelRate, performanceScore, performanceGrade
- `vendor_risk_assessments`: riskScore, tier, factors
- `vendor_document_registry`: document completeness, expired documents
- `vendor_memory_snapshots`: aiContextBlock (injected), complianceStatus, readinessScore
- `recommendation_performance_by_vendor` (5D): timesRecommended, selectionRate, rank1AcceptanceRate
- `purchasing_signals` (5D): avgActualCost, marginPct distribution, costPredictability
- `dispatcher_logs`: wasOverridden (for internal team recommendations — cross-reference baseline)
- `cmm_recommendations` (5C): avg composite score, confidence score trend

### Schema: `intel_vendors`

| Column | Type | Derivation |
|---|---|---|
| `id` | serial PK | |
| `companyId` | text | |
| `vendorId` | integer | |
| `vendorName` | text | denormalized |
| `periodStart` | date | |
| `periodEnd` | date | |
| **Capability** | | |
| `serviceTypes` | text[] | from `vendor_capabilities` |
| `cargoTypes` | text[] | |
| `coverageOrigins` | text[] | |
| `coverageDestinations` | text[] | |
| `certifications` | text[] | |
| `hasHazmat` | boolean | |
| `hasColdChain` | boolean | |
| **Performance** | | |
| `onTimeRate` | real | from latest `vendor_performance_snapshots` |
| `responseRate` | real | |
| `documentAccuracy` | real | |
| `cancelRate` | real | |
| `performanceScore` | real | 0–100 |
| `performanceGrade` | text | A–F |
| `avgResponseHours` | real | |
| `jobsTotal` | integer | period total |
| `jobsCompleted` | integer | |
| **Risk** | | |
| `riskScore` | integer | from active `vendor_risk_assessments` |
| `riskTier` | text | low/medium/high/blacklisted |
| `riskFactorCodes` | text[] | |
| `riskAssessmentAge` | integer | days since last assessment |
| **Document status** | | |
| `documentCompleteness` | real | 0.0–1.0 (docs present+valid / expected) |
| `expiredDocCount` | integer | |
| `missingDocTypes` | text[] | |
| `criticalDocsMissing` | boolean | any doc with riskLevel = 'high' missing |
| **CMM track record** | | |
| `timesRecommended` | integer | across any rank |
| `timesRecommendedRank1` | integer | |
| `timesSelected` | integer | |
| `selectionRate` | real | |
| `rank1AcceptanceRate` | real | |
| `avgCmmCompositeScore` | real | mean of compositeScore when recommended |
| **Purchasing signals** | | |
| `purchasingSignalCount` | integer | sample size |
| `avgActualCost` | real | mean of `purchasing_signals.actualCost` |
| `avgMarginPct` | real | mean of `purchasing_signals.marginPct` |
| `costStdDev` | real | standard deviation of actualCost — predictability |
| `costPredictabilityTier` | text | high/medium/low based on costStdDev/avgActualCost |
| **Satisfaction** | | |
| `avgCustomerSatisfaction` | real | from `recommendation_outcomes` |
| `satisfactionSampleCount` | integer | |
| **Readiness** | | |
| `readinessScore` | smallint | 0–100 |
| `readinessFlags` | text[] | |
| `refreshedAt` | timestamp | |
| `isStale` | boolean | |
| `createdAt` | timestamp | |

**Indexes:**
```
(companyId, vendorId, periodStart) — unique
(companyId, riskTier)
(companyId, performanceGrade)
(companyId, readinessScore)
(companyId, isStale)
```

---

## Dataset 3 — Customer Intelligence (`intel_customers`)

**What it answers:** For a given customer, what are their behavioral patterns, service preferences, risk profile, satisfaction history, and task demand?

### Data Sources
- `customers`: tier, industry, typicalRoutes, typicalCargoTypes, totalTasks, riskScore
- `customer_preferences`: learned preferences (channel, language, cargo sensitivity, contact time)
- `customer_risk_assessments`: riskScore history, tier, factors, creditLimit
- `customer_memory_snapshots`: sentimentTrend, frequentServices, openTasksCount, missingDocsList
- `ai_tasks`: task volume, category distribution, slaStatus, customerSentiment, completedAt patterns
- `recommendation_outcomes` (5D): satisfactionScore per task for this customer, completionResult pattern

### Schema: `intel_customers`

| Column | Type | Derivation |
|---|---|---|
| `id` | serial PK | |
| `companyId` | text | |
| `customerId` | integer | |
| `customerName` | text | denormalized |
| `periodStart` | date | |
| `periodEnd` | date | |
| **Profile** | | |
| `tier` | text | from `customers.tier` |
| `industry` | text | |
| `preferredChannel` | text | from active `customer_preferences` |
| `preferredLanguage` | text | |
| **Behavioral patterns** | | |
| `frequentServices` | text[] | top 3 categories by task count |
| `typicalRoutes` | text[] | from `customers` + `ai_tasks` |
| `typicalCargoTypes` | text[] | |
| `avgTasksPerMonth` | real | |
| `taskCount` | integer | total in period |
| `lastTaskAt` | timestamp | |
| `daysSinceLastTask` | integer | |
| **Task outcomes** | | |
| `completionRate` | real | completed / total tasks |
| `onTrackRate` | real | tasks with slaStatus = on_track / total |
| `slaBreachRate` | real | tasks with slaStatus = overdue / total |
| `avgFollowUpCount` | real | from `ai_tasks.followUpCount` |
| **Sentiment** | | |
| `sentimentTrend` | text | from `customer_memory_snapshots` |
| `avgSentimentScore` | real | mapped from `customerSentiment` across tasks |
| `positiveSentimentPct` | real | |
| **Risk** | | |
| `riskScore` | integer | from active `customer_risk_assessments` |
| `riskTier` | text | |
| `creditLimit` | real | |
| `riskFactorCodes` | text[] | |
| `riskAssessmentAge` | integer | days since last assessment |
| **Satisfaction** | | |
| `avgCustomerSatisfaction` | real | from `recommendation_outcomes` |
| `satisfactionSampleCount` | integer | tasks with manual satisfaction entered |
| `satisfactionTrend` | text | improving/stable/declining (last 3 periods) |
| **Document behavior** | | |
| `missingDocFrequency` | real | tasks with missingData / total tasks |
| `typicalMissingDocs` | text[] | most common missing doc types |
| **Readiness** | | |
| `readinessScore` | smallint | 0–100 |
| `readinessFlags` | text[] | |
| `refreshedAt` | timestamp | |
| `isStale` | boolean | |
| `createdAt` | timestamp | |

**Indexes:**
```
(companyId, customerId, periodStart) — unique
(companyId, tier)
(companyId, riskTier)
(companyId, sentimentTrend)
(companyId, readinessScore)
```

---

## Dataset 4 — Profit Intelligence (`intel_profit`)

**What it answers:** What is the business's financial performance by category, by vendor, by customer, and by route — and how does it compare to catalog benchmarks?

This dataset has a **dimension** column, making it a multi-dimensional fact table. One row = one dimension combination + period. This allows the analytics API to slice profit by any dimension without separate tables.

### Data Sources
- `quotations`: totalAmount, freightCost, customsCost, truckingCost, status, respondedAt
- `purchasing_signals` (5D): actualRevenue, actualCost, actualMargin, marginPct (primary financial truth)
- `recommendation_outcomes` (5D): profitVariance, quotedAmount, actualMargin
- `ai_tasks`: category, division, assignedVendor, completedAt
- `service_catalog`: basePrice (benchmark for margin floor)
- `customer_risk_assessments`: creditLimit (for receivable risk)

### Schema: `intel_profit`

| Column | Type | Derivation |
|---|---|---|
| `id` | serial PK | |
| `companyId` | text | |
| `dimension` | text | `total` \| `by_category` \| `by_vendor` \| `by_customer` \| `by_route` |
| `dimensionValue` | text | the category name, vendorId, customerId, or route string; null for `total` |
| `periodStart` | date | |
| `periodEnd` | date | |
| **Volume** | | |
| `signalCount` | integer | rows in `purchasing_signals` — sample size |
| `taskCount` | integer | `ai_tasks` count in period+dimension |
| `quotationCount` | integer | quotations issued |
| `quotationAcceptedCount` | integer | quotations with status = accepted |
| `quotationWinRate` | real | accepted / issued |
| **Revenue** | | |
| `totalQuotedAmount` | real | sum of `quotations.totalAmount` (accepted) |
| `totalActualRevenue` | real | sum of `purchasing_signals.actualRevenue` |
| `avgRevenuePerTask` | real | |
| **Cost** | | |
| `totalActualCost` | real | sum of `purchasing_signals.actualCost` |
| `avgCostPerTask` | real | |
| `catalogBasePrice` | real | from `service_catalog` (for by_category dimension) |
| `costVsCatalogPct` | real | (avgCostPerTask - catalogBasePrice) / catalogBasePrice |
| **Margin** | | |
| `totalActualMargin` | real | totalActualRevenue - totalActualCost |
| `avgMarginPct` | real | mean of `purchasing_signals.marginPct` |
| `medianMarginPct` | real | P50 of marginPct — outlier-resistant |
| `p10MarginPct` | real | P10 — floor detection |
| `p90MarginPct` | real | P90 — ceiling detection |
| `marginStdDev` | real | volatility |
| `belowFloorCount` | integer | signals where marginPct < 0 (loss-making) |
| `belowFloorPct` | real | |
| **Variance** | | |
| `avgProfitVariance` | real | from `recommendation_outcomes.profitVariance` |
| `positiveProfitVariancePct` | real | outcomes above expected / total |
| **Trend** | | |
| `revenueGrowthPct` | real | vs previous period |
| `marginGrowthPct` | real | vs previous period |
| `prevPeriodAvgMarginPct` | real | stored for trend computation |
| **Readiness** | | |
| `readinessScore` | smallint | 0–100 |
| `readinessFlags` | text[] | |
| `refreshedAt` | timestamp | |
| `isStale` | boolean | |
| `createdAt` | timestamp | |

**Indexes:**
```
(companyId, dimension, dimensionValue, periodStart) — unique
(companyId, dimension, periodStart)
(companyId, belowFloorPct)   — surface loss-making combinations fast
(companyId, readinessScore)
```

---

## Dataset 5 — Quotation Intelligence (`intel_quotations`)

**What it answers:** How accurately does the company quote? What is the win rate by category? How long does quoting take? How does AI-generated vs. manual quoting compare? What are the price distribution patterns the system can use as a future benchmark?

### Data Sources
- `quotations`: all cost fields, status, sentAt, respondedAt, aiGenerated flag
- `ai_tasks`: source, category, status, completedAt
- `service_catalog`: basePrice, estimatedDays (benchmark reference)
- `purchasing_signals` (5D): actualCost (ground truth for whether quote was accurate)
- `prediction_logs`: AI confidence at intent resolution (correlates with quote accuracy)
- `recommendation_outcomes` (5D): profitVariance (proxy for quote accuracy)

### Schema: `intel_quotations`

| Column | Type | Derivation |
|---|---|---|
| `id` | serial PK | |
| `companyId` | text | |
| `serviceCategory` | text | `ai_tasks.category` |
| `periodStart` | date | |
| `periodEnd` | date | |
| **Volume** | | |
| `quotationsIssued` | integer | total quotations created |
| `quotationsSent` | integer | status >= sent |
| `quotationsAccepted` | integer | status = accepted |
| `quotationsRejected` | integer | status = rejected |
| `winRate` | real | accepted / sent |
| `aiGeneratedCount` | integer | where `aiGenerated` not null |
| `manualCount` | integer | |
| **Pricing** | | |
| `avgTotalAmount` | real | mean totalAmount (accepted) |
| `medianTotalAmount` | real | P50 |
| `p10TotalAmount` | real | lower price bound |
| `p90TotalAmount` | real | upper price bound |
| `catalogBasePrice` | real | from `service_catalog.basePrice` |
| `avgPremiumOverCatalog` | real | (avgTotalAmount - catalogBasePrice) / catalogBasePrice |
| **Accuracy** | | |
| `avgProfitVariance` | real | from `recommendation_outcomes.profitVariance` — how accurate was the quote |
| `quotesTooLow` | integer | accepted quotes where actualMargin < 0 |
| `quotesTooLowPct` | real | |
| `quotesTooHigh` | integer | rejected quotes where amount was >P90 for category |
| **Speed** | | |
| `avgHoursToSend` | real | sentAt - ai_tasks.createdAt |
| `avgHoursToRespond` | real | respondedAt - sentAt |
| `avgTotalCycleDays` | real | respondedAt - ai_tasks.createdAt (in days) |
| **AI vs Manual** | | |
| `aiWinRate` | real | accepted / sent for aiGenerated quotes |
| `manualWinRate` | real | accepted / sent for manual quotes |
| `aiAvgAmount` | real | |
| `manualAvgAmount` | real | |
| `aiAvgHoursToSend` | real | AI is expected to be faster |
| `manualAvgHoursToSend` | real | |
| **Intent confidence correlation** | | |
| `avgIntentConfidenceAtQuote` | real | from `prediction_logs` — tasks that generated a quotation |
| `highConfidenceWinRate` | real | win rate when intentConfidence was high |
| `lowConfidenceWinRate` | real | win rate when intentConfidence was low |
| **Readiness** | | |
| `readinessScore` | smallint | 0–100 |
| `readinessFlags` | text[] | |
| `refreshedAt` | timestamp | |
| `isStale` | boolean | |
| `createdAt` | timestamp | |

**Indexes:**
```
(companyId, serviceCategory, periodStart) — unique
(companyId, winRate)
(companyId, quotesTooLowPct)
(companyId, readinessScore)
```

---

## Readiness Score System

Every dataset row carries a `readinessScore` (0–100) computed at refresh time. This is the mechanism that answers *"Is this data reliable enough to use?"* without making AI decisions about it yet.

### Readiness Score Formula

The score is a weighted sum of four dimensions:

```
readinessScore =
  completeness × 0.35 +
  freshness    × 0.30 +
  coverage     × 0.20 +
  volume       × 0.15
```

Each sub-score is 0–100:

#### Completeness (35%)
Measures what fraction of the expected fields are populated.

```
For each dataset, a field manifest defines which columns are:
  - "critical"  (missing = high penalty: field contributes 0 pts, flags raised)
  - "important" (missing = medium penalty)
  - "optional"  (missing = minor penalty)

completeness = (Σ critical_filled × 3 + Σ important_filled × 2 + Σ optional_filled × 1)
             / (Σ critical_total × 3 + Σ important_total × 2 + Σ optional_total × 1)
             × 100
```

**Critical fields by dataset:**

| Dataset | Critical Fields |
|---|---|
| `intel_routes` | `taskCount`, `avgActualCost`, `vendorCount`, `onTimeDeliveryRate` |
| `intel_vendors` | `onTimeRate`, `riskScore`, `documentCompleteness`, `selectionRate` |
| `intel_customers` | `riskScore`, `sentimentTrend`, `frequentServices`, `completionRate` |
| `intel_profit` | `totalActualRevenue`, `totalActualCost`, `avgMarginPct`, `signalCount` |
| `intel_quotations` | `winRate`, `avgTotalAmount`, `quotationsIssued`, `avgHoursToSend` |

#### Freshness (30%)
Measures how recently the underlying source data was updated.

```
For each source table contributing to this dataset row:
  ageDays = (NOW - sourceTable.updatedAt or snapshotDate) in days

  sourceScore = max(0, 100 - (ageDays × stalePenaltyRate))

  stalePenaltyRates:
    purchasing_signals      → 3 pts/day  (fast-changing financial data)
    vendor_performance_*    → 2 pts/day
    recommendation_outcomes → 2 pts/day
    vendor_risk_*           → 1 pt/day   (risk changes slowly)
    customer_risk_*         → 1 pt/day
    vendor_capabilities     → 0.5 pts/day

freshness = weighted mean of sourceScores (weighted by that source's contribution weight)
```

#### Coverage (20%)
Measures whether enough of the relevant entities have data.

```
For intel_vendors:
  coverage = (vendors with ≥1 purchasing_signal / total active vendors) × 100

For intel_customers:
  coverage = (customers with ≥1 recommendation_outcome / total active customers) × 100

For intel_routes:
  coverage = (routes with ≥3 tasks / total observed routes in period) × 100

For intel_profit (by_vendor):
  coverage = (vendors with ≥5 purchasing_signals / total vendors selected) × 100

For intel_quotations:
  coverage = (categories with ≥10 quotations / total active service categories) × 100
```

#### Volume (15%)
Measures whether there are enough samples for statistical reliability.

```
For datasets that compute averages, rates, or percentages:
  volume = min(100, sampleCount / minimumReliableSample × 100)

minimumReliableSample thresholds:
  intel_routes.priceSignalCount   → 10
  intel_vendors.purchasingSignalCount → 5
  intel_customers (satisfaction)  → 3
  intel_profit.signalCount        → 10
  intel_quotations.quotationsIssued → 20
```

### Readiness Flags

When a sub-score causes a significant deduction, a plain-text flag is appended to `readinessFlags[]`:

| Flag | Trigger Condition |
|---|---|
| `no_purchasing_signals` | `priceSignalCount = 0` |
| `insufficient_price_data` | `priceSignalCount < 5` |
| `vendor_risk_stale` | risk assessment age > 90 days |
| `customer_risk_stale` | risk assessment age > 90 days |
| `document_registry_incomplete` | `criticalDocsMissing = true` |
| `no_satisfaction_data` | `satisfactionSampleCount = 0` |
| `low_task_volume` | `taskCount < 3` for route/category |
| `no_vendor_performance_snapshot` | vendor has no performance row in period |
| `margin_below_floor` | `belowFloorPct > 0.1` (>10% of tasks losing money) |
| `quotation_win_rate_low` | `winRate < 0.3` |
| `high_cost_variance` | `costStdDev / avgActualCost > 0.4` |

### `intel_readiness_scores` — Aggregated Summary Table

One row per dataset per period — a health dashboard for the IRL itself.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `companyId` | text | |
| `datasetName` | text | `routes` \| `vendors` \| `customers` \| `profit` \| `quotations` |
| `periodStart` | date | |
| `periodEnd` | date | |
| `overallReadinessScore` | smallint | mean of all rows in dataset for this period |
| `rowCount` | integer | total rows in dataset for period |
| `rowsAbove80` | integer | rows with readinessScore ≥ 80 |
| `rowsAbove60` | integer | rows with readinessScore ≥ 60 |
| `rowsBelow40` | integer | rows with readinessScore < 40 |
| `topFlags` | text[] | most common readinessFlags across all rows |
| `avgCompleteness` | real | |
| `avgFreshness` | real | |
| `avgCoverage` | real | |
| `avgVolume` | real | |
| `computedAt` | timestamp | |
| `createdAt` | timestamp | |

**Index:** `(companyId, datasetName, periodStart)` — unique

---

## Refresh Strategy

### Three Refresh Triggers

```
Trigger 1 — Scheduled (nightly, 00:30 local time)
  • Full refresh of all 5 datasets for the rolling 90-day period
  • Recalculates all readiness scores
  • Writes intel_readiness_scores summary
  • Runs after performance_daily job (which runs at 00:00)

Trigger 2 — Staleness signal (event-driven, lightweight)
  • Fires when specific source events occur:
      purchasing_signals INSERT         → mark intel_profit, intel_routes, intel_vendors stale
      recommendation_outcomes UPDATE    → mark intel_customers, intel_vendors, intel_profit stale
      vendor_performance_snapshots      → mark intel_vendors, intel_routes stale
      customer_risk_assessments INSERT  → mark intel_customers stale
      vendor_risk_assessments INSERT    → mark intel_vendors stale
      quotations UPDATE (status change) → mark intel_quotations stale
  • Only sets isStale = true — does NOT re-compute immediately
  • Stale flag is returned in API responses so consumers know to handle accordingly

Trigger 3 — Manual refresh (on demand)
  • POST /api/intel/refresh { dataset?, force? }
  • Available to supervisor+ roles
  • Queues a refresh job; does not block the HTTP response
  • Returns jobId for polling
```

### Refresh Job Behavior

```
refreshDataset(datasetName, companyId, periodStart, periodEnd):

  1. Read all source tables for the period (batch queries, no loops per entity)

  2. Compute all rows as in-memory JS objects

  3. Write computed rows to intel_* table using INSERT ... ON CONFLICT DO UPDATE
     (upsert by unique index — idempotent, safe to re-run)

  4. Compute readiness score per row (pure function, no DB calls needed)

  5. Upsert intel_readiness_scores summary row

  6. Write intel_refresh_log row (see Observability section)

  7. Clear in-memory cache for affected cache keys

Total expected runtime per dataset per company:
  intel_routes:     < 2s   (shipment_trackings + purchasing_signals join)
  intel_vendors:    < 3s   (most complex — joins 8 source tables)
  intel_customers:  < 2s
  intel_profit:     < 1s   (purchasing_signals + quotations aggregation)
  intel_quotations: < 1s
```

### Refresh Ordering

Datasets must refresh in this order (dependency chain):

```
1. intel_vendors      (no IRL dependency)
2. intel_customers    (no IRL dependency)
3. intel_routes       (reads intel_vendors.selectionRate)
4. intel_profit       (reads intel_vendors.avgActualCost for cost benchmarking)
5. intel_quotations   (reads intel_profit for margin context)
6. intel_readiness_scores  (reads all 5 datasets)
```

---

## API Endpoints

All endpoints require `requireAuth`. Role restrictions per endpoint:

```
GET /api/intel/routes
  ?periodStart=  &periodEnd=  &origin=  &destination=  &category=
  Auth: requireRole("staff", "supervisor", "company_admin", "super_admin")
  Returns: IntelRoute[]

GET /api/intel/vendors
  ?periodStart=  &periodEnd=  &riskTier=  &minReadiness=  &serviceType=
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Returns: IntelVendor[]

GET /api/intel/vendors/:vendorId
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Returns: IntelVendor (latest period)

GET /api/intel/customers
  ?periodStart=  &periodEnd=  &tier=  &riskTier=  &minReadiness=
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Returns: IntelCustomer[]

GET /api/intel/customers/:customerId
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Returns: IntelCustomer (latest period)

GET /api/intel/profit
  ?dimension=  &dimensionValue=  &periodStart=  &periodEnd=
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Returns: IntelProfit[]
  Note: marginPct, actualCost fields hidden for role = "supervisor" (see RBAC)

GET /api/intel/quotations
  ?serviceCategory=  &periodStart=  &periodEnd=
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Returns: IntelQuotation[]

GET /api/intel/readiness
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Returns: IntelReadinessScore[] (one per dataset, latest period)

GET /api/intel/health
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Returns: IrlHealthStatus (see Observability section)

POST /api/intel/refresh
  Body: { dataset?: "routes"|"vendors"|"customers"|"profit"|"quotations"|"all", force?: boolean }
  Auth: requireRole("company_admin", "super_admin")
  Returns: { jobId, estimatedSeconds, datasetsQueued }

GET /api/intel/refresh/:jobId
  Auth: requireRole("company_admin", "super_admin")
  Returns: RefreshJobStatus
```

### Cache Strategy

All GET endpoints cache using the existing in-memory TTL Map:

| Cache Key | TTL | Invalidated By |
|---|---|---|
| `intel:routes:{companyId}:{period}` | 30 min | intel_routes refresh |
| `intel:vendors:{companyId}:{period}` | 30 min | intel_vendors refresh |
| `intel:customers:{companyId}:{period}` | 30 min | intel_customers refresh |
| `intel:profit:{companyId}:{dimension}:{period}` | 30 min | intel_profit refresh |
| `intel:quotations:{companyId}:{category}:{period}` | 30 min | intel_quotations refresh |
| `intel:readiness:{companyId}` | 15 min | any dataset refresh |
| `intel:health:{companyId}` | 5 min | refresh job completion |

`isStale = true` rows are returned with a response header `X-Intel-Stale: true` so API consumers can decide whether to wait for a refresh or use cached data.

---

## Observability

### `intel_refresh_log` Table

One row written per dataset per refresh run.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `companyId` | text | |
| `jobId` | text | UUID assigned at job start |
| `datasetName` | text | which dataset was refreshed |
| `trigger` | text | `scheduled` \| `stale_signal` \| `manual` |
| `triggeredBy` | text | `system` or userId |
| `periodStart` | date | |
| `periodEnd` | date | |
| `status` | text | `running` \| `completed` \| `failed` \| `partial` |
| `rowsWritten` | integer | rows upserted |
| `rowsStaleCleared` | integer | rows with isStale set to false |
| `sourceRowCounts` | jsonb | `{ ai_tasks: 1203, purchasing_signals: 45, ... }` |
| `readinessScoreAvg` | real | mean readiness score of written rows |
| `durationMs` | integer | total job runtime |
| `errorMessage` | text | null on success |
| `startedAt` | timestamp | |
| `completedAt` | timestamp | |
| `createdAt` | timestamp | |

**Indexes:**
```
(companyId, datasetName, startedAt)
(companyId, status)
(jobId) — for polling
```

### `GET /api/intel/health` Response Schema

```typescript
interface IrlHealthStatus {
  asOf: string;                        // ISO timestamp
  overallStatus: "healthy" | "degraded" | "stale" | "error";
  datasets: {
    [datasetName: string]: {
      readinessScore: number;          // 0–100
      rowCount: number;
      rowsStale: number;
      lastRefreshedAt: string | null;
      lastRefreshStatus: "completed" | "failed" | "partial" | "never";
      lastRefreshDurationMs: number | null;
      topFlags: string[];
      nextScheduledRefresh: string;    // ISO timestamp
    };
  };
  sourceHealth: {
    [sourceName: string]: {
      lastUpdated: string | null;      // newest row in source table
      rowCount: number;                // total rows in period
      isExpected: boolean;             // is this source expected to have data?
    };
  };
}
```

**`overallStatus` logic:**
```
"healthy"  → all dataset readinessScore ≥ 70, no datasets stale > 25h
"degraded" → ≥1 dataset readinessScore < 70 OR ≥1 dataset lastRefreshStatus = partial
"stale"    → ≥1 dataset has isStale rows and lastRefreshedAt > 26h ago
"error"    → ≥1 dataset lastRefreshStatus = failed
```

---

## RBAC Summary

| Endpoint / Data | `staff` (3) | `supervisor` (4) | `company_admin` (5) | `super_admin` (6) |
|---|:---:|:---:|:---:|:---:|
| `GET /api/intel/routes` | ✓ (read-only) | ✓ | ✓ | ✓ |
| `GET /api/intel/vendors` | ✗ | ✓ | ✓ | ✓ |
| `GET /api/intel/customers` | ✗ | ✓ (own division) | ✓ | ✓ |
| `GET /api/intel/profit` | ✗ | ✓ (no margin detail) | ✓ | ✓ |
| `GET /api/intel/quotations` | ✗ | ✓ | ✓ | ✓ |
| `GET /api/intel/readiness` | ✗ | ✓ | ✓ | ✓ |
| `GET /api/intel/health` | ✗ | ✓ | ✓ | ✓ |
| `POST /api/intel/refresh` | ✗ | ✗ | ✓ | ✓ |
| Margin / cost data | ✗ | Summary only | ✓ Full | ✓ Full |
| Readiness flags detail | ✗ | ✓ | ✓ | ✓ |

---

## New Tables Summary

| Table | Purpose | Rows Per Period |
|---|---|---|
| `intel_routes` | Route demand, cost, timing, vendor coverage | 1 per origin+destination+category |
| `intel_vendors` | Consolidated vendor profile + CMM + purchasing signals | 1 per vendor |
| `intel_customers` | Consolidated customer profile + behavior + risk | 1 per customer |
| `intel_profit` | Financial performance by dimension | 5 dimensions × N dimension values |
| `intel_quotations` | Quoting accuracy and speed by category | 1 per service category |
| `intel_readiness_scores` | Aggregated health per dataset | 1 per dataset |
| `intel_refresh_log` | Full observability for every refresh run | 1 per dataset per run |

---

## Implementation Order (for next sprint)

1. **Schema + migrations** — 7 new tables
2. **Readiness score engine** — pure function, independently testable
3. **Refresh job framework** — base class shared by all 5 datasets; handles upsert, logging, cache invalidation
4. **Dataset refresh jobs** — one per dataset, in dependency order
5. **Staleness signal hooks** — lightweight writes triggered by purchasing_signals, recommendation_outcomes, vendor/customer snapshot events
6. **Scheduler registration** — add to existing scheduler (mirrors escalation-scheduler pattern)
7. **API routes** — 8 endpoints, with cache middleware
8. **Health endpoint** — aggregates intel_refresh_log + intel_readiness_scores
9. **Manual refresh endpoint + polling** — POST + GET /refresh/:jobId

---

## Decisions NOT Made (Deferred)

- **Materialized views** — using tables instead; views were evaluated but app-layer refresh gives more control over staleness signals and partial refresh
- **AI recommendations** — IRL is purely a data foundation; no inference, ranking, or suggestion happens here
- **Cross-company benchmarking** — datasets are strictly scoped to `companyId`; industry benchmarks require opt-in data sharing, deferred
- **Fleet Memory** — explicitly excluded from this sprint
- **Real-time streaming refresh** — scheduled + staleness-flag approach is sufficient; event streaming would require additional infrastructure
- **Purchasing Intelligence module** — `purchasing_signals` are populated by 5D and read here by `intel_profit`; the full PI decision engine is a separate sprint
