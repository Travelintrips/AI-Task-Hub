# Sprint 5C — Cross Memory Matching Layer
## Architecture Design Document

---

## Overview

The Cross Memory Matching (CMM) layer activates when a task or inquiry is created. It queries Customer Memory, Vendor Memory, the Intent Engine output, the Service Catalog, and the Governance Rules Engine simultaneously, then produces a ranked list of up to 3 vendor recommendations — each with a reason, risk warning, missing-document checklist, estimated price range, and confidence score.

CMM is a **read-only orchestration layer**. It does not write to any memory table directly. All writes happen through their owning modules (Customer Memory, Vendor Memory). CMM only emits audit log entries and caches its own recommendation results.

---

## System Context

```
Task Created / Inquiry Received
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│              Cross Memory Matching Orchestrator          │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Customer    │  │  Vendor      │  │   Intent     │  │
│  │  Memory      │  │  Memory      │  │   Engine     │  │
│  │  Reader      │  │  Reader      │  │   Output     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                  │          │
│         └─────────────────┴──────────────────┘          │
│                           │                             │
│              ┌────────────▼──────────────┐              │
│              │    Scoring Pipeline       │              │
│              │  1. Vendor Recommend.     │              │
│              │  2. Customer-Vendor Fit   │              │
│              │  3. Route-Service Match   │              │
│              │  4. Risk Compatibility    │              │
│              │  5. Price/Perf Ranking    │              │
│              └────────────┬──────────────┘              │
│                           │                             │
│              ┌────────────▼──────────────┐              │
│              │   Recommendation Output   │              │
│              │  Top 3 vendors + reasons  │              │
│              │  risk warnings            │              │
│              │  missing docs             │              │
│              │  price range              │              │
│              │  confidence score         │              │
│              └───────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
         │
         ▼
 Vendor Suggestion Panel (Task Detail UI)
```

---

## Data Flow: Input Sources

| Source | Data Consumed | Where It Lives |
|---|---|---|
| Customer Memory | `customer_memory_snapshots`, `customer_risk_assessments`, `customer_preferences` | `lib/db/src/schema/customer_memory.ts` |
| Vendor Memory | `vendor_capabilities`, `vendor_performance_snapshots`, `vendor_risk_assessments`, `vendor_preferences` | `lib/db/src/schema/vendor_memory.ts` |
| Intent Engine | `aiIntent`, `aiCategory`, resolved `data_templates`, `document_templates` | Output of `intent-engine.ts`, stored on `ai_tasks` |
| Service Catalog | `serviceCode`, `category`, `basePrice`, `estimatedDays`, `slaHours` | `lib/db/src/schema/service_catalog.ts` |
| Governance Rules | Routing targets, `needsQuotation`, risk flags, approval requirements | `governance-resolver.ts` → `governance_routing_rules` |
| AI Tasks | `assignedVendor` history, task volume per vendor | `lib/db/src/schema/ai_tasks.ts` |

---

## Module 1 — Vendor Recommendation Engine

**Responsibility:** Orchestrates all sub-modules, assembles the final ranked list of up to 3 vendors.

### Data Sources
- All five input sources listed above
- `vendor_capabilities.serviceTypes[]` and `vendor_capabilities.cargoTypes[]`
- Historical `ai_tasks.assignedVendor` records (last 90 days, per `companyId`)

### Scoring Formula
The engine runs sub-scores from Modules 2–5 and computes a **weighted composite score (0–100)**:

```
compositeScore =
  (customerVendorFitScore  × 0.30) +   // Module 2
  (routeServiceMatchScore  × 0.25) +   // Module 3
  (riskCompatibilityScore  × 0.25) +   // Module 4
  (pricePerformanceScore   × 0.20)     // Module 5
```

Vendors with `riskCompatibilityScore < 20` are **excluded entirely** (hard floor) regardless of other scores, and a risk warning is appended to the output.

**Confidence score** is derived from data completeness:
```
confidenceScore = (fieldsPresent / totalExpectedFields) × 100
```
where `totalExpectedFields` = 12 (vendor capability fields + performance snapshot age + customer risk score + price data).

If `confidenceScore < 40`, the recommendation is flagged as `LOW_CONFIDENCE` and the reason string includes a note about missing data.

### AI Narrative
After scoring, a single GPT-4o-mini call generates:
- A 1–2 sentence reason per recommended vendor (in the UI language, defaulting to Bahasa Indonesia)
- A unified risk summary
- Missing document list per vendor

Prompt is constructed from:
1. Customer memory snapshot (injected as-is from `customer_memory_snapshots.contextBlock`)
2. Top-3 vendor performance snapshots
3. Task intent + category + governance flags

### API Endpoints

```
POST /api/cmm/recommend
  Body: { taskId: string }
  Auth: requireAuth + requireRole("staff", "supervisor", "company_admin", "super_admin")
  Response: CmmRecommendationResult

GET /api/cmm/recommend/:taskId
  Auth: requireAuth + requireRole("staff", "supervisor", "company_admin", "super_admin")
  Response: CmmRecommendationResult (from cache or regenerated)

POST /api/cmm/recommend/:taskId/refresh
  Auth: requireAuth + requireRole("supervisor", "company_admin", "super_admin")
  Response: CmmRecommendationResult (forces cache invalidation)
```

### Caching Strategy
- **Cache key:** `cmm:recommend:{companyId}:{taskId}`
- **TTL:** 10 minutes (matches vendor/customer memory snapshot TTL)
- **Implementation:** Same in-memory `Map<string, CacheEntry<T>>` pattern already used in `intent-engine.ts`
- **Invalidation triggers:** New vendor memory snapshot written, new customer risk assessment, manual refresh call

### Fallback Behavior
1. If vendor memory is empty → score from service catalog + intent only; confidence ≤ 30
2. If customer memory is empty → skip Module 2; weight redistributed: Route-Service 35%, Risk 35%, Price 30%
3. If AI narrative call fails → return structured scores only, no natural-language reason; `narrationFailed: true` in response
4. If no vendors pass the hard floor → return empty array with `noViableVendors: true` and the reason (all vendors below risk threshold)

### RBAC
| Role | Can Request | Can Refresh | Sees Price Data | Sees Risk Details |
|---|---|---|---|---|
| `staff` (3) | ✓ | ✗ | ✓ | Summary only |
| `supervisor` (4) | ✓ | ✓ | ✓ | Full |
| `company_admin` (5) | ✓ | ✓ | ✓ | Full |
| `super_admin` (6) | ✓ | ✓ | ✓ | Full |
| `vendor` (2) | ✗ | ✗ | ✗ | ✗ |
| `customer` (1) | ✗ | ✗ | ✗ | ✗ |

### Audit Logging
Every recommendation generation writes one `audit_logs` row:
```
action:    "cmm.recommend.generated"
module:    "cross_memory_matching"
entityId:  taskId
before:    null
after:     { vendorIds: [...], scores: [...], confidenceScore, dataSnapshot }
actorId:   requesting userId
companyId: from getCompanyId(req)
```

---

## Module 2 — Customer-Vendor Fit Score (0–100)

**Responsibility:** Measures how well a vendor historically matches this specific customer's preferences and risk tolerance.

### Data Sources
- `customer_preferences` (key-value store): preferred communication channel, preferred service tier, language preference, cargo sensitivity flags
- `customer_risk_assessments.score` (0–100, immutable after creation)
- `vendor_preferences` (key-value store): accepted customer tiers, preferred cargo types, minimum order values
- `vendor_risk_assessments.score` (0–100)
- Historical `ai_tasks` where both `customerId` = current customer AND `assignedVendor` = this vendor (last 180 days)

### Scoring Formula

```
fitScore = 0

// 1. Mutual tier compatibility (0–30 pts)
//    Does vendor's accepted tier list include this customer's tier?
tierMatch = vendor.acceptedTiers.includes(customer.tier) ? 30 : 0

// 2. Prior co-assignment success rate (0–40 pts)
//    Historical tasks: customer + this vendor, ratio of completed vs total
priorTasks = count(ai_tasks where customerId=X, assignedVendor=Y, last 180d)
completedTasks = count(... where status="completed")
priorScore = priorTasks > 0
  ? (completedTasks / priorTasks) * 40
  : 20   // neutral score if no history

// 3. Communication channel match (0–15 pts)
//    customer_preferences["preferredChannel"] matches vendor's capability
channelMatch = match ? 15 : 0

// 4. Cargo sensitivity alignment (0–15 pts)
//    customer has sensitive cargo flag AND vendor has matching capability
sensitivityMatch = aligned ? 15 : 7   // partial credit if unknown

fitScore = tierMatch + priorScore + channelMatch + sensitivityMatch
```

### Fallback
- No prior co-assignment history → `priorScore = 20` (neutral)
- Missing customer preferences → skip channel/sensitivity checks; max possible score = 70; confidence penalty applied

---

## Module 3 — Route-Service Matching Score (0–100)

**Responsibility:** Measures how closely the vendor's declared service capabilities match the task's resolved intent, category, and service catalog entry.

### Data Sources
- `ai_tasks.aiIntent` (resolved by Intent Engine)
- `ai_tasks.aiCategory` (trucking, sea_freight, customs, etc.)
- `vendor_capabilities.serviceTypes[]` (array: `["sea_freight", "customs_clearance"]`)
- `vendor_capabilities.cargoTypes[]` (array: `["general", "dangerous_goods"]`)
- `service_catalog` row matched by `category` = task category
- Governance routing output: `suggestedDivision`, `needsQuotation` flag

### Scoring Formula

```
routeScore = 0

// 1. Exact service type match (0–50 pts)
exactServiceMatch = vendor.serviceTypes.includes(taskCategory) ? 50 : 0

// 2. Cargo type compatibility (0–25 pts)
//    task's cargo type (from intent data fields) vs vendor.cargoTypes
cargoMatch = vendor.cargoTypes.includes(taskCargoType)
  ? 25
  : vendor.cargoTypes.includes("general") ? 10 : 0

// 3. Governance routing alignment (0–15 pts)
//    Does governance suggestedDivision match vendor's division capability?
divisionMatch = aligned ? 15 : 0

// 4. SLA capability (0–10 pts)
//    vendor.preferredLeadDays ≤ service_catalog.estimatedDays
slaCapable = vendorLeadDays <= catalogEstimatedDays ? 10 : 0

routeScore = exactServiceMatch + cargoMatch + divisionMatch + slaCapable
```

### Fallback
- Missing `vendor_capabilities` → `routeScore = 0`; vendor is excluded unless no other vendors exist
- Missing `service_catalog` match → skip SLA check; max score = 90

---

## Module 4 — Risk Compatibility Check (0–100)

**Responsibility:** Ensures the vendor's risk profile is compatible with the customer's risk assessment. Outputs a score AND a boolean `riskWarning` flag if the pairing is risky.

### Data Sources
- `customer_risk_assessments.score` (0–100; higher = higher risk customer)
- `customer_risk_assessments.riskFactors[]` (array of named factors)
- `vendor_risk_assessments.score` (0–100; higher = higher vendor risk)
- `vendor_risk_assessments.riskFactors[]`
- `vendor_performance_snapshots.onTimeRate` (0.0–1.0)
- `vendor_performance_snapshots.responseRate` (0.0–1.0)
- `vendor_performance_snapshots.documentAccuracy` (0.0–1.0)
- Governance flag: `needsAdminReview` (if true, risk score is penalised)

### Scoring Formula

```
riskScore = 0

// 1. Vendor risk level inverse (0–40 pts)
//    Lower vendor risk = more compatible with any customer
vendorRiskInverse = ((100 - vendor.riskScore) / 100) * 40

// 2. Customer-Vendor risk delta (0–30 pts)
//    High-risk customers should NOT be paired with high-risk vendors
delta = Math.abs(customer.riskScore - vendor.riskScore)
deltaScore = delta < 20 ? 30 : delta < 40 ? 20 : delta < 60 ? 10 : 0

// 3. Performance reliability (0–20 pts)
//    Combined on-time + documentAccuracy
perfScore = ((onTimeRate + documentAccuracy) / 2) * 20

// 4. Governance penalty (0–10 pts)
govScore = needsAdminReview ? 0 : 10

riskScore = vendorRiskInverse + deltaScore + perfScore + govScore

// Hard exclusion rule
if (riskScore < 20) → vendor EXCLUDED, riskWarning = true
```

### Risk Warning Output
When `riskScore < 50` (but ≥ 20), the vendor is still included but a `riskWarning` string is generated:
```
{
  level: "MEDIUM" | "HIGH",
  factors: ["vendor_high_risk_score", "low_document_accuracy", ...],
  recommendation: "Require performance bond or additional document review"
}
```

Overlapping risk factors between customer and vendor (same string in both `riskFactors[]` arrays) are surfaced as `sharedRiskFactors[]` in the warning.

### Fallback
- No `vendor_risk_assessments` row → `riskScore = 40` (cautious neutral); `riskWarning = { level: "MEDIUM", factors: ["no_vendor_risk_data"] }`
- No `vendor_performance_snapshots` → `perfScore = 0`; confidence penalty applied

---

## Module 5 — Price / Performance Ranking (0–100)

**Responsibility:** Ranks vendors by the value they deliver relative to their price, using service catalog base prices and vendor performance history.

### Data Sources
- `service_catalog.basePrice` and `service_catalog.currency` (matched by task category)
- `vendor_preferences["typicalMarginPercent"]` (optional vendor-declared margin over base price)
- `vendor_performance_snapshots.onTimeRate`
- `vendor_performance_snapshots.responseRate`
- Historical `ai_tasks` count per vendor (last 90 days) — used as a volume proxy for reliability

### Scoring Formula

```
ppScore = 0

// 1. Estimated price competitiveness (0–40 pts)
//    estimatedPrice = basePrice * (1 + margin/100)
//    Compare each vendor's estimatedPrice against cheapest vendor in this set
lowestPrice = min(allVendors.estimatedPrice)
priceRatio = lowestPrice / vendor.estimatedPrice    // 1.0 = cheapest, <1 = more expensive
priceScore = priceRatio * 40

// 2. On-time performance (0–35 pts)
onTimeScore = vendor.onTimeRate * 35

// 3. Response rate (0–15 pts)
responseScore = vendor.responseRate * 15

// 4. Volume confidence bonus (0–10 pts)
//    More historical tasks = more predictable behaviour
taskCount = count(ai_tasks where assignedVendor = Y, last 90d)
volumeScore = taskCount >= 10 ? 10 : taskCount >= 5 ? 7 : taskCount >= 1 ? 4 : 0

ppScore = priceScore + onTimeScore + responseScore + volumeScore
```

### Estimated Price Range Output
```
{
  currency: "IDR",
  low: basePrice * 1.0,       // if vendor charges no margin above base
  mid: basePrice * (1 + typicalMargin/100),
  high: basePrice * 1.35,     // conservative upper bound
  confidence: "HIGH" | "MEDIUM" | "LOW"
    // HIGH: vendor has declared margin + ≥5 historical tasks
    // MEDIUM: one of the two
    // LOW: no margin data, no history
}
```

If `service_catalog.basePrice` is null or zero, the price range is omitted and `priceScore = 20` (neutral).

### Fallback
- No `typicalMarginPercent` → assume 15% margin; confidence = LOW
- No performance snapshot → `onTimeScore = 0`, `responseScore = 0`; confidence = LOW
- No historical tasks → `volumeScore = 0`

---

## Module 6 — Vendor Suggestion Panel (Task Detail UI)

**Responsibility:** Renders the CMM output inside the Task Detail view. Visible only to users with role ≥ `staff` (level 3).

### Panel Location
Placed in the Task Detail side panel, below the Dispatcher Suggestion section (which handles internal team assignment). The CMM panel handles **external vendor** assignment.

### UI States

| State | Trigger | Display |
|---|---|---|
| `idle` | Task created, CMM not yet run | "Analyze vendors" button |
| `loading` | POST /api/cmm/recommend in flight | Skeleton cards × 3 with spinner |
| `loaded` | Recommendations available | Vendor cards (see below) |
| `empty` | `noViableVendors: true` | Warning banner explaining why |
| `low_confidence` | `confidenceScore < 40` | Cards shown with amber badge "Low confidence — incomplete vendor data" |
| `error` | Network/AI failure | Error state with retry button |
| `stale` | Cache > 10 min old | Cards shown with "Results may be outdated" chip + Refresh button |

### Vendor Recommendation Card (per vendor, up to 3)

```
┌───────────────────────────────────────────────────────┐
│ [Rank badge: #1]  [Vendor name]         [Score: 87/100]│
│                                                        │
│ ✓ Reason: "Vendor X has a 94% on-time rate for sea    │
│   freight and has previously handled 12 shipments for  │
│   this customer successfully."                         │
│                                                        │
│ ── Scores ─────────────────────────────────────────── │
│  Customer Fit     ████████░░  78     Price/Perf  ████  │
│  Route Match      █████████░  91     Risk        ████  │
│                                                        │
│ ── Estimated Price ────────────────────────────────── │
│  IDR 4,500,000 – 6,100,000   [Confidence: MEDIUM]     │
│                                                        │
│ ── Risk ───────────────────────────────────────────── │
│  ⚠ MEDIUM RISK — "Vendor has no document accuracy     │
│    data. Require double-check on HS Code documents."   │
│                                                        │
│ ── Missing Documents ──────────────────────────────── │
│  ✗ Vendor License (expired 3 months ago)              │
│  ✗ ISO Certification not on file                      │
│                                                        │
│  [Select Vendor]  [View Full Profile]  [Dismiss]       │
└───────────────────────────────────────────────────────┘
```

### RBAC — UI Visibility Rules
| Element | staff (3) | supervisor (4) | company_admin (5) |
|---|---|---|---|
| Panel visible | ✓ | ✓ | ✓ |
| Composite score | ✓ | ✓ | ✓ |
| Sub-scores breakdown | ✗ | ✓ | ✓ |
| Price range | ✓ | ✓ | ✓ |
| Risk details (full) | ✗ | ✓ | ✓ |
| Risk summary only | ✓ | — | — |
| Missing documents | ✓ | ✓ | ✓ |
| Refresh button | ✗ | ✓ | ✓ |
| "Select Vendor" action | ✓ | ✓ | ✓ |

### "Select Vendor" Action
Clicking **Select Vendor** does not immediately assign. It:
1. Sets `ai_tasks.assignedVendor = vendorId` (PATCH `/api/ai-tasks/:id`)
2. Writes audit log: `action: "vendor.selected_from_cmm"`, recording which rank was chosen and the full recommendation snapshot
3. Emits an SSE event `task.updated` so all open sessions see the change
4. Shows a confirmation toast

If `needsAdminReview` governance flag is `true`, the button is replaced by **"Request Approval"** — which creates an approval record instead of directly assigning.

---

## Output Schema

```typescript
interface CmmRecommendationResult {
  taskId: string;
  companyId: string;
  generatedAt: string;            // ISO timestamp
  confidenceScore: number;        // 0–100
  lowConfidence: boolean;
  noViableVendors: boolean;
  narrationFailed: boolean;
  recommendations: VendorRecommendation[];   // up to 3
}

interface VendorRecommendation {
  rank: 1 | 2 | 3;
  vendorId: string;
  vendorName: string;
  compositeScore: number;         // 0–100
  subScores: {
    customerVendorFit: number;
    routeServiceMatch: number;
    riskCompatibility: number;
    pricePerformance: number;
  };
  reason: string;                 // AI-generated narrative
  riskWarning: RiskWarning | null;
  missingDocuments: MissingDocument[];
  estimatedPriceRange: PriceRange | null;
  confidenceScore: number;        // per-vendor confidence
}

interface RiskWarning {
  level: "MEDIUM" | "HIGH";
  factors: string[];
  sharedRiskFactors: string[];
  recommendation: string;
}

interface MissingDocument {
  documentType: string;
  reason: "missing" | "expired" | "not_verified";
  expiredAt?: string;
}

interface PriceRange {
  currency: string;
  low: number;
  mid: number;
  high: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}
```

---

## Audit Log Schema (CMM-specific entries)

| action | trigger | entityId | after fields |
|---|---|---|---|
| `cmm.recommend.generated` | POST /recommend | taskId | vendorIds[], scores[], confidence, dataSnapshot |
| `cmm.recommend.refreshed` | POST /recommend/:id/refresh | taskId | same as above + refreshedBy |
| `cmm.vendor.selected` | "Select Vendor" clicked | taskId | vendorId, rank, compositeScore, selectedBy |
| `cmm.vendor.dismissed` | "Dismiss" clicked | taskId | vendorId, rank, dismissedBy |
| `cmm.recommend.excluded` | Hard-floor exclusion | taskId | vendorId, reason: "risk_floor", riskScore |

All entries use the existing `audit_logs` table and `lib/audit.ts` insert pattern.

---

## Caching Architecture Summary

| Cache Key Pattern | TTL | Invalidated By |
|---|---|---|
| `cmm:recommend:{companyId}:{taskId}` | 10 min | Manual refresh, new vendor memory snapshot |
| `cmm:vendor-caps:{companyId}` | 5 min | Vendor capability update |
| `cmm:customer-risk:{companyId}:{customerId}` | 10 min | New risk assessment created |
| `cmm:service-catalog:{companyId}` | 5 min | Service catalog entry change (reuse existing) |

All implemented using the existing in-memory `Map<string, CacheEntry<T>>` with `expiresAt` timestamps. No new cache infrastructure needed.

---

## New Database Tables Required

### `cmm_recommendations` (persisted result store)
Cached results are also written to the DB so they survive server restarts and can be retrieved without regeneration.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `companyId` | text | multi-tenancy |
| `taskId` | text FK → ai_tasks | |
| `result` | jsonb | full `CmmRecommendationResult` |
| `generatedAt` | timestamp | |
| `generatedBy` | text FK → users | |
| `isStale` | boolean | set true when vendor/customer memory updated |
| `createdAt` | timestamp | |

### `vendor_documents` (missing document tracking)
Tracks vendor document status for the Missing Documents output.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `companyId` | text | |
| `vendorId` | text | FK to supplier |
| `documentType` | text | "vendor_license", "iso_cert", etc. |
| `status` | text | "valid", "expired", "missing", "pending" |
| `expiresAt` | timestamp | nullable |
| `verifiedAt` | timestamp | nullable |
| `verifiedBy` | text | FK to users |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

---

## Implementation Order (for next sprint)

1. **`vendor_documents` schema + migration** — prerequisite for missing-document output
2. **`cmm_recommendations` schema + migration** — persistence layer
3. **Scoring engine** — Modules 2–5 as pure functions (easily unit-testable)
4. **Orchestrator** — Module 1, wires scoring pipeline + GPT-4o-mini call
5. **API routes** — three endpoints with auth + audit middleware
6. **Frontend panel** — Module 6 UI component, wired to new endpoints
7. **SSE integration** — emit `cmm.updated` event when refresh occurs

---

## Decisions NOT Made (Deferred)

- **Fleet Memory integration** — deferred per sprint scope
- **Purchasing Intelligence** — deferred per sprint scope
- **Vendor self-service portal** — vendors cannot see their own scores or ranking reasons in this sprint
- **Multi-vendor comparison table** — potential follow-up UI feature
- **Webhook notification to vendor on selection** — can use existing Fonnte/WhatsApp integration, deferred
