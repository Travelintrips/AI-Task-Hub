# Sprint 5D — Recommendation Outcome Engine
## Architecture Design Document

---

## Overview

The Recommendation Outcome Engine closes the feedback loop on Sprint 5C's Cross Memory Matching (CMM) layer. Every vendor recommendation is tracked from the moment it is shown through to final task completion, customer satisfaction, and profit outcome. The resulting signal is fed back into the Vendor Recommendation Engine to improve future scoring, and structured for future Purchasing Intelligence consumption.

The engine is **write-heavy at task completion time** and **read-heavy for analytics**. It deliberately mirrors patterns already established in the codebase: `dispatcher_logs` (suggested vs. actual, wasOverridden), `prediction_logs` (wasCorrected, outcomeDeterminedAt), and `performance_daily` (daily rollup aggregation).

---

## System Context

```
Sprint 5C                Sprint 5D                  Feedback Consumers
─────────────────        ─────────────────────────   ──────────────────────────────
CMM Recommendation  ──►  Outcome Engine              Vendor Recommendation Engine
  (rank 1–3               ├─ Acceptance tracking       (re-weights scoring)
   composite score)        ├─ Override capture        
                           ├─ Completion result       Future Purchasing Intelligence
Task Lifecycle      ──►   ├─ Satisfaction collection   (price benchmarks,
  (status changes)         ├─ Profit outcome            vendor cost profiles)
                           └─ Daily rollup aggregation
Quotations          ──►   
  (totalAmount)
```

---

## The Six Tracked Dimensions

| # | Dimension | Data Source | Captured When |
|---|---|---|---|
| 1 | Recommended vendor | `cmm_recommendations` | At recommendation generation |
| 2 | Selected vendor | `ai_tasks.assignedVendor` | When staff selects a vendor |
| 3 | Override reason | User input (staff/supervisor) | When selected ≠ rank 1 recommended |
| 4 | Completion result | `ai_tasks.status → completed/cancelled` | When task lifecycle ends |
| 5 | Customer satisfaction | Manual entry + `ai_tasks.customerSentiment` | After task completion |
| 6 | Profit outcome | `quotations.totalAmount` + actual cost entry | After invoice settled |

---

## Outcome Classification Rules

When a vendor is selected, the engine classifies the outcome immediately:

```
recommendedVendorIds = [rank1, rank2, rank3] from cmm_recommendations

if selectedVendorId == rank1.vendorId:
  outcomeType = "accepted"          // staff chose the top recommendation

elif selectedVendorId in [rank2, rank3]:
  outcomeType = "accepted_lower"    // staff chose a lower-ranked recommendation
  recommendedRank = 2 or 3

elif selectedVendorId not in recommendedVendorIds:
  outcomeType = "overridden"        // staff chose a vendor not in the top 3
  → overrideReason required

elif no vendor selected within taskSlaHours * 2:
  outcomeType = "rejected_all"      // CMM shown but all recommendations ignored

elif no CMM ran at task creation:
  outcomeType = "no_recommendation"  // baseline row — used for comparison
```

`accepted` + `accepted_lower` together form the **acceptance rate** metric. `overridden` is the override rate. `rejected_all` signals the recommendation was not useful.

---

## Module 1 — Outcome Record Store

**Responsibility:** The single source of truth for what happened with each recommendation. One row per task. Written progressively as the task moves through its lifecycle.

### Data Sources
- `cmm_recommendations` (Sprint 5C): composite score, sub-scores, recommended vendor IDs, confidence score
- `ai_tasks`: `assignedVendor`, `status`, `completedAt`, `customerSentiment`, `quotationAmount`, `customerId`
- `quotations`: `totalAmount`, cost breakdown fields, `status`
- Manual staff input: override reason, satisfaction score, actual cost

### New Table: `recommendation_outcomes`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `companyId` | text | multi-tenancy |
| `taskId` | integer FK → ai_tasks | unique per task |
| `customerId` | integer FK → customers | |
| `cmmRecommendationId` | integer FK → cmm_recommendations | null if no CMM ran |
| **Recommendation snapshot** | | |
| `rank1VendorId` | integer | vendorId at rank 1 when CMM ran |
| `rank2VendorId` | integer | nullable |
| `rank3VendorId` | integer | nullable |
| `cmmCompositeScore` | real | score of rank 1 at recommendation time |
| `cmmConfidenceScore` | real | 0–100 |
| **Selection** | | |
| `selectedVendorId` | integer | actual vendor assigned |
| `selectedVendorName` | text | denormalized for reporting |
| `recommendedRank` | smallint | 1, 2, or 3; null if overridden |
| `outcomeType` | text | accepted \| accepted_lower \| overridden \| rejected_all \| no_recommendation |
| `wasOverridden` | boolean | true if selectedVendor not in top 3 |
| `overrideReason` | text | required when wasOverridden=true |
| `overrideBy` | text FK → users | |
| `overrideAt` | timestamp | |
| **Completion** | | |
| `completionResult` | text | successful \| partial \| failed \| cancelled \| pending |
| `completionNotes` | text | |
| `completedAt` | timestamp | mirrors ai_tasks.completedAt |
| **Customer satisfaction** | | |
| `customerSatisfactionScore` | smallint | 1–5 |
| `customerSatisfactionSource` | text | manual \| ai_sentiment \| whatsapp_survey |
| `customerFeedbackText` | text | |
| `satisfactionRecordedAt` | timestamp | |
| `satisfactionRecordedBy` | text FK → users | null if ai_sentiment |
| **Profit** | | |
| `quotedAmount` | real | from quotations.totalAmount |
| `actualRevenue` | real | manually entered or from invoice |
| `actualCost` | real | what the company actually paid the vendor |
| `actualMargin` | real | actualRevenue - actualCost |
| `profitVariance` | real | actualMargin - (quotedAmount * expectedMarginPct) |
| `profitRecordedAt` | timestamp | |
| `profitRecordedBy` | text FK → users | |
| **Feedback loop** | | |
| `feedbackLoopTriggeredAt` | timestamp | when signal was sent to vendor memory |
| `feedbackLoopVersion` | integer | increments on each re-trigger |
| **Meta** | | |
| `determinedAt` | timestamp | when outcome was considered final (completion + satisfaction both set) |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

**Indexes:**
```
(companyId, taskId)            — unique
(companyId, outcomeType)       — acceptance rate queries
(companyId, selectedVendorId)  — per-vendor analytics
(companyId, completionResult)  — completion analytics
(companyId, determinedAt)      — feedback loop queries
(companyId, createdAt)         — time-series rollups
```

### Write Pattern (progressive)

Outcomes are not written in one shot. The record is built in three phases:

```
Phase 1 — Vendor Selected (immediate)
  INSERT recommendation_outcomes with:
    cmmRecommendationId, rank1–3VendorIds, cmmScores
    selectedVendorId, outcomeType, wasOverridden, overrideReason

Phase 2 — Task Completed
  UPDATE recommendation_outcomes SET:
    completionResult, completedAt, completionNotes

Phase 3 — Satisfaction + Profit Recorded
  UPDATE recommendation_outcomes SET:
    customerSatisfactionScore, customerSatisfactionSource,
    actualRevenue, actualCost, actualMargin, profitVariance
    determinedAt = NOW()    ← triggers feedback loop
```

---

## Module 2 — Acceptance & Override Tracker

**Responsibility:** Real-time capture of the vendor selection decision. Fires the moment a staff member selects or dismisses a vendor recommendation.

### Logic

This module intercepts the existing `PATCH /api/ai-tasks/:id` (assignedVendor update) and the `cmm.vendor.selected` / `cmm.vendor.dismissed` audit events from Sprint 5C.

**Override detection:**
```
onVendorSelected(taskId, selectedVendorId, userId):
  cmmResult = getCmmRecommendation(taskId)          // from cmm_recommendations cache

  if cmmResult is null:
    outcomeType = "no_recommendation"

  elif selectedVendorId == cmmResult.rank1.vendorId:
    outcomeType = "accepted"

  elif selectedVendorId in [rank2, rank3]:
    outcomeType = "accepted_lower"
    recommendedRank = position in list

  else:
    outcomeType = "overridden"
    → require overrideReason before completing the write
      (frontend enforces via modal)
```

**Override reason requirement:**
When `outcomeType = "overridden"`, the frontend blocks the assignment save and shows a modal:

```
"You're selecting a vendor not recommended by AI.
 Please give a brief reason:"
 [ dropdown + optional text ]

Dropdown options (seeded, company-configurable):
  - "Better price negotiated directly"
  - "Existing relationship / preferred vendor"
  - "Recommended vendor unavailable"
  - "Capacity constraint"
  - "Customer requested this vendor specifically"
  - "Other (specify)"
```

The reason is written to `recommendation_outcomes.overrideReason` and to `audit_logs`:
```
action:   "cmm.vendor.overridden"
module:   "cross_memory_matching"
entityId: taskId
after:    { selectedVendorId, rank1VendorId, overrideReason, overrideBy }
```

### RBAC
| Role | Can select recommended vendor | Can override (bypass CMM) | Can skip override reason |
|---|---|---|---|
| `staff` (3) | ✓ | ✓ | ✗ (always required) |
| `supervisor` (4) | ✓ | ✓ | ✗ |
| `company_admin` (5) | ✓ | ✓ | ✓ |
| `super_admin` (6) | ✓ | ✓ | ✓ |

---

## Module 3 — Completion Result Capture

**Responsibility:** Records whether the task outcome was successful after the selected vendor completed the work.

### Trigger
Fires when `ai_tasks.status` transitions to `completed` or `cancelled`. Hooked into the existing `task_timeline` insert pathway — when a `task.completed` event is written to `task_timeline`, the outcome engine updates `recommendation_outcomes.completionResult`.

### Completion Result Values

| Value | Meaning | Condition |
|---|---|---|
| `successful` | Task completed, no issues | status = completed, no complaints |
| `partial` | Task completed with issues | status = completed, `customerComplaintCount` incremented, or staff marks it |
| `failed` | Vendor failed to deliver | status = cancelled due to vendor fault |
| `cancelled` | Cancelled by customer/company | status = cancelled, not vendor fault |
| `pending` | Task not yet resolved | default, until status resolves |

**`partial` detection logic:**
Auto-set to `partial` if `ai_tasks.status = completed` AND any of:
- `vendor_performance_snapshots.customerComplaintCount` was incremented during this task's window
- Staff explicitly marks it via the Outcome Panel
- `ai_tasks.customerSentiment` = "frustrated" or "negative" at completion time

### API Endpoint
```
PATCH /api/recommendation-outcomes/:taskId/completion
  Body: { completionResult, completionNotes }
  Auth: requireAuth + requireRole("staff", "supervisor", "company_admin", "super_admin")
  Writes: recommendation_outcomes + outcome_events + audit_log
```

---

## Module 4 — Customer Satisfaction Collection

**Responsibility:** Captures how satisfied the customer was with the vendor handling of their task. Uses two sources: AI-inferred sentiment (automatic) and manually entered scores (authoritative).

### Source 1: AI Sentiment (automatic, immediate)
- Already exists: `ai_tasks.customerSentiment` = "positive" | "neutral" | "frustrated" | "negative"
- Mapped to satisfaction score at task completion:
  ```
  positive  → 4
  neutral   → 3
  frustrated → 2
  negative  → 1
  ```
- `customerSatisfactionSource = "ai_sentiment"`
- This is the **default** if no manual score is entered

### Source 2: Manual Entry (authoritative, overrides AI)
Staff enter a 1–5 score after speaking with the customer or receiving a WhatsApp reply. Written via the Outcome Panel in Task Detail. Overrides the AI-inferred score. `customerSatisfactionSource = "manual"`.

### Source 3: WhatsApp Survey (future, designed now)
A structured satisfaction survey sent via Fonnte after task completion. Not built in this sprint. Schema accommodates it via `customerSatisfactionSource = "whatsapp_survey"`. The response maps to a 1–5 score and auto-fills the field.

### Satisfaction Score → Vendor Memory Impact
When `customerSatisfactionScore` is written and `completionResult` is set, the satisfaction score is added to `vendor_memory_events` as a `outcome_feedback_received` event with the score as metadata. This allows the next vendor performance snapshot to factor in per-task satisfaction directly.

```
Low satisfaction (1–2) → vendor_memory_events eventType: "customer_complaint_signal"
  metadata: { taskId, satisfactionScore, vendorId, category }
  → vendor_performance_snapshots.customerComplaintCount += 1 on next snapshot
```

### RBAC
| Role | Can enter manual satisfaction | Sees satisfaction in analytics |
|---|---|---|
| `staff` (3) | ✓ | ✓ (aggregated only) |
| `supervisor` (4) | ✓ | ✓ (full) |
| `company_admin` (5) | ✓ | ✓ (full) |
| `super_admin` (6) | ✓ | ✓ (full) |

---

## Module 5 — Profit Outcome Tracker

**Responsibility:** Captures actual financial result and computes variance against what was expected. This is the primary signal for future Purchasing Intelligence.

### Data Sources
- `quotations.totalAmount` (what was quoted to the customer — revenue side)
- `quotations.freightCost + customsCost + truckingCost + handlingCost + otherCharges` (cost breakdown already in quotations)
- `ai_tasks.quotationAmount` (shorthand if no formal quotation)
- Manual actual cost entry (what was actually paid to the selected vendor)

### Profit Fields

```
quotedAmount      = quotations.totalAmount
                    (auto-filled when quotation linked to task)

actualRevenue     = amount customer paid
                    (may differ from quotedAmount if adjustments made)

actualCost        = amount paid to vendor
                    (manually entered by supervisor/admin)

actualMargin      = actualRevenue - actualCost

expectedMargin    = (quotedAmount * companyDefaultMarginPct)
                    companyDefaultMarginPct from company_settings

profitVariance    = actualMargin - expectedMargin
                    negative = worse than expected
                    positive = better than expected
```

### Auto-fill Logic
When a quotation with `status = "accepted"` is linked to the task:
- `quotedAmount` ← `quotations.totalAmount`
- `actualRevenue` ← `quotations.totalAmount` (default, editable)
- Cost breakdown fields from quotations pre-populate a cost estimate field in the UI
- Staff only need to enter `actualCost` (what was actually paid to the vendor)

### Purchasing Intelligence Signal
Every completed profit outcome writes a **purchasing signal** row (table designed below). This is the primary data feed for future Purchasing Intelligence. It is write-once and immutable.

```
Table: purchasing_signals (designed in 5D, built in Purchasing Intelligence sprint)

id              serial PK
companyId       text
taskId          integer
vendorId        integer
serviceType     text         (from vendor_capabilities)
category        text         (from ai_tasks.category)
origin          text         (from intent data)
destination     text
cargoType       text
quotedAmount    real
actualRevenue   real
actualCost      real
actualMargin    real
marginPct       real         (actualMargin / actualRevenue)
satisfactionScore smallint
completionResult text
signalDate      date         (date of task completion)
createdAt       timestamp
```

This table is append-only. Future Purchasing Intelligence reads it to build price benchmarks (median cost by service type + route), margin floor recommendations, and vendor cost predictability scores.

### RBAC
| Role | Can enter actual cost | Sees margin in outcome panel | Sees profit in analytics |
|---|---|---|---|
| `staff` (3) | ✗ | ✗ | ✗ |
| `supervisor` (4) | ✓ | ✓ | ✓ (own division) |
| `company_admin` (5) | ✓ | ✓ | ✓ (all) |
| `super_admin` (6) | ✓ | ✓ | ✓ (all) |

---

## Module 6 — Feedback Loop Engine

**Responsibility:** Translates completed outcome records into actionable signals that improve the Vendor Recommendation Engine on the next run. Two distinct loops.

### Loop A: Vendor Recommendation Engine (CMM) Refinement

**Trigger:** `recommendation_outcomes.determinedAt` is set (completion + satisfaction both recorded).

**Process:**
```
1. Read outcome record:
   - selectedVendorId, completionResult, customerSatisfactionScore, profitVariance

2. Write vendor_memory_events row:
   eventType:  "outcome_feedback_received"
   vendorId:   selectedVendorId
   actorType:  "system"
   metadata: {
     taskId,
     completionResult,
     satisfactionScore,
     profitVariance,
     wasRecommended: (selectedVendorId in rank1–3),
     recommendedRank: 1 | 2 | 3 | null
   }

3. Mark vendor_memory_snapshots.isStale = true
   staleReason: "outcome_feedback_received"
   → forces CMM to regenerate fresh vendor snapshot on next recommendation

4. If completionResult = "failed" OR satisfactionScore <= 2:
   Write vendor_memory_events:
     eventType: "customer_complaint_signal"
   → next vendor_performance_snapshot will decrement onTimeRate / increment complaintCount

5. Write recommendation_outcome_events:
   eventType: "feedback_loop_triggered"
   metadata: { vendorId, snapshotInvalidated: true, signalsSent: [...] }

6. Update recommendation_outcomes:
   feedbackLoopTriggeredAt = NOW()
   feedbackLoopVersion += 1
```

**CMM Score Improvement Path:**
The feedback loop does not directly edit scoring weights. Instead it operates through data:
- Vendor memory snapshot is invalidated → regenerated with fresh `vendor_performance_snapshots`
- `vendor_performance_snapshots` accumulates the complaint/success signals over time
- On next CMM run, Module 4 (Risk Compatibility) picks up the updated `onTimeRate` and `customerComplaintCount`
- Module 2 (Customer-Vendor Fit) picks up the updated co-assignment success rate from `ai_tasks` history
- This means the feedback is gradual and statistically grounded, not sudden weight changes

**Override Pattern Accumulation:**
Override reasons are aggregated weekly (see Module 7 analytics). If a specific vendor is overridden repeatedly with reason "Recommended vendor unavailable," this surfaces as a `capacity_signal` in the vendor memory event stream, and the vendor's `readinessScore` in the performance snapshot is penalized on next generation.

### Loop B: Purchasing Intelligence Data Pipeline

**Trigger:** Same as Loop A — `determinedAt` set.

**Process:**
```
1. If actualRevenue and actualCost are both set:
   INSERT purchasing_signals (write-once, immutable):
     vendorId, serviceType, category, origin, destination,
     quotedAmount, actualRevenue, actualCost, actualMargin, marginPct,
     satisfactionScore, completionResult, signalDate

2. Write recommendation_outcome_events:
   eventType: "purchasing_signal_emitted"
   metadata: { purchasingSignalId }
```

**What Purchasing Intelligence will do with this (designed, not built):**
- Median cost by route + service type → price benchmark table
- Vendor cost predictability score (variance of `actualCost` across signals)
- Margin floor recommendation per category (protect minimum margin)
- Price anomaly detection (signal is 30%+ above benchmark)
- Preferred vendor shortlist per route (highest margin + satisfaction combination)

### Loop Execution
Both loops run **synchronously within the PATCH /api/recommendation-outcomes/:taskId/profit** response — they are lightweight DB writes (no AI calls). If either fails, it is retried via a background job (30-second retry, 3 attempts). Failures are logged to `recommendation_outcome_events` with `eventType: "feedback_loop_failed"`.

---

## Module 7 — Daily Rollup Aggregation

**Responsibility:** Computes daily metrics for the analytics dashboard. Runs as a background job at midnight, same pattern as existing `escalation-scheduler.ts`.

### New Table: `recommendation_performance_daily`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `companyId` | text | |
| `date` | date | one row per company per day |
| `totalRecommendations` | integer | how many CMM runs produced results |
| `acceptedCount` | integer | outcomeType = accepted |
| `acceptedLowerCount` | integer | outcomeType = accepted_lower |
| `overriddenCount` | integer | outcomeType = overridden |
| `rejectedAllCount` | integer | outcomeType = rejected_all |
| `noRecommendationCount` | integer | no CMM ran |
| `acceptanceRate` | real | (accepted + accepted_lower) / totalRecommendations |
| `overrideRate` | real | overridden / totalRecommendations |
| `rank1AcceptanceRate` | real | accepted / totalRecommendations |
| `rank2AcceptanceRate` | real | accepted_lower rank 2 / totalRecommendations |
| `rank3AcceptanceRate` | real | accepted_lower rank 3 / totalRecommendations |
| `avgCmmConfidenceScore` | real | average confidence of CMM at recommendation time |
| `successfulCompletions` | integer | completionResult = successful |
| `partialCompletions` | integer | |
| `failedCompletions` | integer | |
| `avgCustomerSatisfaction` | real | 1.0–5.0 |
| `satisfactionFromManual` | integer | count with source = manual |
| `satisfactionFromAi` | integer | count with source = ai_sentiment |
| `avgActualMargin` | real | |
| `avgProfitVariance` | real | positive = above expected |
| `feedbackLoopTriggerCount` | integer | how many signals sent to vendor memory |
| `purchasingSignalsEmitted` | integer | signals written to purchasing_signals |
| `createdAt` | timestamp | |

### New Table: `recommendation_performance_by_vendor`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `companyId` | text | |
| `vendorId` | integer | |
| `periodStart` | date | |
| `periodEnd` | date | |
| `timesRecommended` | integer | appeared in any rank 1–3 |
| `timesRecommendedRank1` | integer | |
| `timesSelected` | integer | actually assigned |
| `timesOverridden` | integer | appeared rank 1 but not selected |
| `selectionRate` | real | timesSelected / timesRecommended |
| `rank1AcceptanceRate` | real | selected when rank 1 / timesRecommendedRank1 |
| `avgSatisfactionScore` | real | when this vendor was selected |
| `avgActualMargin` | real | when this vendor was selected |
| `successRate` | real | successful / timesSelected |
| `createdAt` | timestamp | |

**Index:** `(companyId, vendorId, periodStart)` — unique

---

## New Table: `recommendation_outcome_events`

Full audit trail of the outcome lifecycle. One row per event per task.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `companyId` | text | |
| `taskId` | integer | |
| `outcomeId` | integer FK → recommendation_outcomes | |
| `eventType` | text | see event catalog below |
| `actorId` | text | userId or "system" |
| `actorType` | text | user \| system \| ai |
| `metadata` | jsonb | event-specific payload |
| `createdAt` | timestamp | |

### Event Catalog

| eventType | Trigger | Key metadata |
|---|---|---|
| `recommendation_viewed` | CMM panel opened by staff | userId, taskId, rank1VendorId |
| `vendor_selected_recommended` | Accepted rank 1 | vendorId, rank, compositeScore |
| `vendor_selected_lower_rank` | Accepted rank 2 or 3 | vendorId, rank, compositeScore |
| `vendor_overridden` | Non-recommended vendor selected | selectedVendorId, rank1VendorId, overrideReason |
| `all_recommendations_rejected` | No vendor selected, CMM shown | taskId, hoursElapsed |
| `completion_recorded` | Task completed/cancelled | completionResult, completedAt |
| `satisfaction_recorded` | Satisfaction score entered | score, source, recordedBy |
| `profit_recorded` | Actual cost/revenue entered | actualMargin, profitVariance |
| `feedback_loop_triggered` | Outcome sent to vendor memory | vendorId, snapshotInvalidated |
| `purchasing_signal_emitted` | Signal written for future PI | purchasingSignalId |
| `feedback_loop_failed` | Loop write failed | error, retryCount |

---

## API Endpoints

```
# Outcome creation (auto-created on vendor selection via ai-tasks PATCH hook)
GET  /api/recommendation-outcomes/:taskId
  Auth: requireAuth + requireRole("staff", ...)
  Returns: full OutcomeRecord

PATCH /api/recommendation-outcomes/:taskId/completion
  Body: { completionResult, completionNotes? }
  Auth: requireRole("staff", "supervisor", "company_admin", "super_admin")
  Side effects: writes outcome_events, checks feedback loop eligibility

PATCH /api/recommendation-outcomes/:taskId/satisfaction
  Body: { customerSatisfactionScore: 1–5, customerFeedbackText? }
  Auth: requireRole("staff", "supervisor", "company_admin", "super_admin")
  Side effects: writes outcome_events, checks feedback loop eligibility

PATCH /api/recommendation-outcomes/:taskId/profit
  Body: { actualRevenue, actualCost }
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Side effects: computes margin+variance, triggers both feedback loops,
                writes purchasing_signal

# Analytics
GET  /api/recommendation-outcomes/analytics/daily?from=&to=&companyId=
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Returns: recommendation_performance_daily[]

GET  /api/recommendation-outcomes/analytics/vendors?from=&to=
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Returns: recommendation_performance_by_vendor[] ordered by selectionRate desc

GET  /api/recommendation-outcomes/analytics/override-reasons?from=&to=
  Auth: requireRole("supervisor", "company_admin", "super_admin")
  Returns: { reason: string, count: number, pct: number }[]

# Manual feedback loop trigger (for backfill or correction)
POST /api/recommendation-outcomes/:taskId/trigger-feedback
  Auth: requireRole("company_admin", "super_admin")
  Body: { force: boolean }
```

---

## Frontend UI

### 1 — Outcome Collection Panel (Task Detail)

Placed below the Vendor Suggestion Panel (Sprint 5C). Appears only when `ai_tasks.assignedVendor` is set.

**State: vendor assigned, task in progress**
```
┌────────────────────────────────────────────────────────┐
│ 📊 Vendor Outcome Tracking                             │
│                                                        │
│  Recommended:  PT Maju Logistics (CMM rank #1, 87/100) │
│  Selected:     PT Maju Logistics  ✓ Accepted           │
│                                                        │
│  Completion result:  [ Pending ▼ ]                     │
│  (editable when task is completed or cancelled)        │
└────────────────────────────────────────────────────────┘
```

**State: vendor was overridden (selected ≠ recommendation)**
```
┌────────────────────────────────────────────────────────┐
│ 📊 Vendor Outcome Tracking           ⚠ Override        │
│                                                        │
│  Recommended:  PT Maju Logistics (rank #1)             │
│  Selected:     CV Cepat Transport   ↩ Overridden       │
│  Reason:       "Existing relationship / preferred"     │
│                                                        │
│  Completion result:  [ Pending ▼ ]                     │
└────────────────────────────────────────────────────────┘
```

**State: task completed — satisfaction + profit entry**
```
┌────────────────────────────────────────────────────────┐
│ 📊 Vendor Outcome Tracking           ✓ Completed       │
│                                                        │
│  Result:  [ Successful ▼ ]                             │
│                                                        │
│  Customer Satisfaction                                 │
│  ★ ★ ★ ★ ☆   (4 / 5)   [Edit]                         │
│  Source: Manual (recorded by Budi, 14 Jun)             │
│                                                        │
│  Profit Outcome             [supervisor+ only]         │
│  Quoted:    IDR 5,200,000                              │
│  Revenue:   IDR 5,200,000                              │
│  Vendor cost: [ ____________ ] IDR  ← enter here       │
│  Margin:    —  (enter cost to calculate)               │
│                                                        │
│  [Save Outcome]                                        │
└────────────────────────────────────────────────────────┘
```

### 2 — Override Reason Modal (fires on vendor selection when not recommended)

```
┌────────────────────────────────────────────────────────┐
│ ⚠ You selected a vendor not in the AI recommendation  │
│                                                        │
│  AI recommended:  PT Maju Logistics (#1, score 87)    │
│  You selected:    CV Cepat Transport                   │
│                                                        │
│  Reason for override:                                  │
│  [ Select reason ▼ ]                                   │
│     • Better price negotiated directly                 │
│     • Existing relationship / preferred vendor         │
│     • Recommended vendor unavailable                   │
│     • Capacity constraint                              │
│     • Customer requested this vendor specifically      │
│     • Other (specify below)                            │
│                                                        │
│  Additional notes (optional):  [________________]      │
│                                                        │
│  [Cancel]                         [Confirm Override]   │
└────────────────────────────────────────────────────────┘
```

### 3 — CMM Analytics Panel (new section in Reports)

Accessible from Reports → AI Performance → Vendor Recommendations tab.

**Metrics shown:**

| Section | Metrics |
|---|---|
| Acceptance | Acceptance rate (%), Override rate (%), Rejection rate (%), Rank 1/2/3 breakdown |
| Completion | Successful %, Partial %, Failed %, Cancelled % (grouped by accepted vs overridden) |
| Satisfaction | Avg score (1–5), Manual vs AI-inferred split, Score over time (line chart) |
| Profit | Avg actual margin (IDR), Avg profit variance, % outcomes above expected margin |
| Override reasons | Reason breakdown (bar chart), Top overridden-from vendors, Top override-to vendors |
| Per-vendor | Table: vendor name, times recommended, selection rate, avg satisfaction, avg margin |

**Key insight cards (always visible at top):**
```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Acceptance Rate  │  │  Avg Satisfaction │  │  Avg Margin      │
│       73%        │  │     4.1 / 5.0    │  │  IDR 1,200,000   │
│  ▲ +8% vs last mo│  │  ▼ -0.3 vs last  │  │  +12% vs target  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

**RBAC — Analytics Panel:**
| Metric | `supervisor` | `company_admin` | `super_admin` |
|---|---|---|---|
| Acceptance / override rates | ✓ | ✓ | ✓ |
| Satisfaction scores | ✓ | ✓ | ✓ |
| Profit / margin data | ✗ | ✓ | ✓ |
| Per-vendor margin breakdown | ✗ | ✓ | ✓ |
| Override reason detail | ✓ (own div) | ✓ (all) | ✓ (all) |

---

## Output Schemas

```typescript
interface RecommendationOutcome {
  id: number;
  taskId: number;
  companyId: string;
  customerId: number | null;
  cmmRecommendationId: number | null;

  // Snapshot at recommendation time
  rank1VendorId: number | null;
  rank2VendorId: number | null;
  rank3VendorId: number | null;
  cmmCompositeScore: number | null;
  cmmConfidenceScore: number | null;

  // Selection
  selectedVendorId: number | null;
  selectedVendorName: string | null;
  recommendedRank: 1 | 2 | 3 | null;
  outcomeType: "accepted" | "accepted_lower" | "overridden" | "rejected_all" | "no_recommendation";
  wasOverridden: boolean;
  overrideReason: string | null;
  overrideBy: string | null;
  overrideAt: string | null;

  // Completion
  completionResult: "successful" | "partial" | "failed" | "cancelled" | "pending";
  completionNotes: string | null;
  completedAt: string | null;

  // Satisfaction
  customerSatisfactionScore: 1 | 2 | 3 | 4 | 5 | null;
  customerSatisfactionSource: "manual" | "ai_sentiment" | "whatsapp_survey" | null;
  customerFeedbackText: string | null;
  satisfactionRecordedAt: string | null;
  satisfactionRecordedBy: string | null;

  // Profit
  quotedAmount: number | null;
  actualRevenue: number | null;
  actualCost: number | null;
  actualMargin: number | null;
  profitVariance: number | null;
  profitRecordedAt: string | null;
  profitRecordedBy: string | null;

  // Feedback loop
  feedbackLoopTriggeredAt: string | null;
  feedbackLoopVersion: number;

  determinedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DailyPerformanceAnalytics {
  date: string;
  totalRecommendations: number;
  acceptanceRate: number;           // 0.0–1.0
  overrideRate: number;
  rank1AcceptanceRate: number;
  rank2AcceptanceRate: number;
  rank3AcceptanceRate: number;
  avgCustomerSatisfaction: number;  // 1.0–5.0
  avgActualMargin: number;
  avgProfitVariance: number;
  feedbackLoopTriggerCount: number;
}

interface VendorPerformanceAnalytics {
  vendorId: number;
  vendorName: string;
  timesRecommended: number;
  timesSelected: number;
  selectionRate: number;
  rank1AcceptanceRate: number;
  avgSatisfactionScore: number;
  avgActualMargin: number;
  successRate: number;
}
```

---

## Audit Log Entries (CMM Outcome module)

| action | trigger | entityId | after fields |
|---|---|---|---|
| `cmm.outcome.created` | Vendor selected | taskId | outcomeType, selectedVendorId, recommendedRank |
| `cmm.vendor.overridden` | Override confirmed | taskId | overrideReason, overrideBy, rank1VendorId |
| `cmm.outcome.completion_set` | Completion recorded | taskId | completionResult, completedAt |
| `cmm.outcome.satisfaction_set` | Satisfaction recorded | taskId | score, source, recordedBy |
| `cmm.outcome.profit_set` | Profit recorded | taskId | actualMargin, profitVariance, recordedBy |
| `cmm.feedback_loop.triggered` | Loop fired | taskId | vendorId, snapshotInvalidated, purchasingSignalId |
| `cmm.feedback_loop.failed` | Loop error | taskId | error, retryCount |

All written to the existing `audit_logs` table via `lib/audit.ts` pattern.

---

## Caching

| Key Pattern | TTL | Invalidated By |
|---|---|---|
| `cmm:outcome:{companyId}:{taskId}` | 5 min | Any PATCH to the outcome record |
| `cmm:analytics:daily:{companyId}:{date}` | 60 min | Daily rollup job completion |
| `cmm:analytics:vendors:{companyId}:{period}` | 60 min | Daily rollup job completion |
| `cmm:override-reasons:{companyId}` | 30 min | New override recorded |

---

## New Tables Summary

| Table | Purpose | Mirrors |
|---|---|---|
| `recommendation_outcomes` | One row per task, progressive outcome | `dispatcher_logs` pattern |
| `recommendation_outcome_events` | Full event timeline | `vendor_memory_events` pattern |
| `recommendation_performance_daily` | Daily rollup | `performance_daily` pattern |
| `recommendation_performance_by_vendor` | Per-vendor accuracy over period | `performance_by_intent` pattern |
| `purchasing_signals` | Immutable cost/margin signals for future PI | New — append-only |

---

## Implementation Order (for next sprint)

1. **Schema + migrations** — 5 new tables
2. **Outcome record creation hook** — intercept `assignedVendor` write in ai-tasks PATCH
3. **Override reason modal** — frontend, fires before vendor write completes
4. **Completion + satisfaction endpoints** — PATCH routes + audit logging
5. **Profit endpoint** — PATCH route, supervisor+ only, triggers feedback loops
6. **Feedback Loop A** — vendor memory invalidation + event writes
7. **Feedback Loop B** — purchasing_signals insert
8. **Daily rollup job** — background scheduler, midnight, mirrors escalation-scheduler pattern
9. **Outcome Collection Panel** — Task Detail UI component
10. **Analytics Panel** — Reports page, new tab

---

## Decisions NOT Made (Deferred)

- **WhatsApp survey automation** — satisfaction source scaffolded but message flow not built; uses Fonnte integration when ready
- **Purchasing Intelligence module** — `purchasing_signals` table is fully designed and will be populated from day one; the module that reads it is a separate sprint
- **Automated score weight adjustment** — feedback improves data inputs, not model weights directly; deliberate choice to keep scoring deterministic and auditable
- **Fleet Memory** — explicitly out of scope per sprint brief
