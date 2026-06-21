# Sprint 3A — Governance Engine Design

> **Status:** Design only. No code yet.
> **Goal:** Replace every hardcoded rule array in IntentEngine and the dispatcher
> with four DB-driven matrices. After this sprint, no business rules live in source code.

---

## 0. Problem Statement — What is Hardcoded Today

`artifacts/api-server/src/lib/intent-engine.ts` contains three hardcoded arrays that
encode business policy directly in source code:

```ts
// Line ~610 — these must be deleted after Sprint 3B
const APPROVAL_INTENTS          = ["complaint", "customs_clearance", "payment_confirmation"];
const NEEDS_QUOTATION_INTENTS   = ["quotation_request", "order_shipment", "customs_clearance", "order_product"];
const NEEDS_ADMIN_REVIEW_INTENTS = ["customs_clearance", "invoice_request", "complaint"];
```

Additionally:
- `slaHours` is a single flat field on `intent_master` — no priority/category matrix.
- `routingCode` returns `intentCode` verbatim with no team/division resolution.
- Escalation does not exist at all.
- Approval produces only `"admin_approval"` with no configurable approver, timeout, or action.

The Governance Engine replaces all of this with four tables, a simulator, and a log view
accessible at `/governance`.

---

## 1. Architecture Overview

```
WhatsApp / Manual Create
         │
         ▼
   IntentEngine.resolveIntent()
         │
         ├─► routing_rules      → routeTarget, needsQuotation, needsDocAudit, needsAdminReview
         ├─► sla_matrix         → slaHours (category × priority matrix)
         ├─► approval_rules     → needsApproval, approvalType, approverRole
         │
         ▼
   ai_tasks (INSERT/UPDATE)
         │
         ├─► approval_requests  (if needsApproval)
         │
         └─► EscalationEngine (background scheduler)
                   │
                   └─► escalation_rules → trigger → escalation_logs + notify
```

All rule evaluations write to `audit_logs` (module = `"governance"`).

---

## 2. Module 1 — Routing Matrix

### Purpose
Map `(intentCode, category, priority)` → team/division/member to assign, plus business
flags: `needsQuotation`, `needsDocumentAudit`, `needsAdminReview`, `autoAssign`.

Replaces: `intent_master.suggestedDivision`, `NEEDS_QUOTATION_INTENTS`,
`NEEDS_ADMIN_REVIEW_INTENTS` hardcoded arrays.

### Table: `routing_rules`

```
routing_rules
─────────────────────────────────────────────────────────────────
id                  serial          PK
companyId           text            NOT NULL  default "default"
intentCode          text            nullable  (null = any intent)
category            text            nullable  (null = any category)
priority            text            nullable  (null = any priority)

routeTo             text            NOT NULL  -- "division" | "team_member" | "vendor" | "manager"
routeTarget         text            NOT NULL  -- e.g. "Operations", "Ali Hamdan"
routeTargetId       integer         nullable  FK → team_members.id

needsQuotation      boolean         NOT NULL  default false
needsDocumentAudit  boolean         NOT NULL  default false
needsAdminReview    boolean         NOT NULL  default false
autoAssign          boolean         NOT NULL  default false

sortOrder           integer         NOT NULL  default 100
description         text            nullable
isActive            boolean         NOT NULL  default true

createdAt           timestamptz     NOT NULL  defaultNow()
updatedAt           timestamptz     NOT NULL  defaultNow().$onUpdate()
```

**Indexes:**
- `(companyId, intentCode)` — primary lookup by intent
- `(companyId, category)` — fallback by category
- `(companyId, isActive, sortOrder)` — rule ordering

**Resolution logic (specificity cascade):**
1. Match `companyId + intentCode + category + priority` (most specific)
2. Match `companyId + intentCode + category`
3. Match `companyId + intentCode`
4. Match `companyId + category + priority`
5. Match `companyId + category`
6. Return null (no routing override)

Lower `sortOrder` wins among equal-specificity matches.

**FK relations:**
- Soft-FK `companyId` → `company_settings.companyId`
- Hard-FK `routeTargetId` → `team_members.id` (nullable, only when `routeTo = "team_member"`)

**RBAC:**
| Operation | Minimum Role |
|-----------|-------------|
| GET (list, stats) | `supervisor` |
| POST / PATCH | `company_admin` |
| DELETE | `company_admin` |
| Simulator | `supervisor` |

**API Endpoints:**
```
GET    /api/routing-rules           list, ?category=, ?intentCode=, ?active=
POST   /api/routing-rules           create rule
PATCH  /api/routing-rules/:id       update rule
DELETE /api/routing-rules/:id       delete rule
POST   /api/routing-rules/simulate  test rule match for given {intentCode, category, priority}
```

**IntentEngine integration:**
After Sprint 3B, `resolveIntent()` calls `resolveRouting(companyId, intentCode, category, priority)` instead of reading `intent_master.suggestedDivision` directly. Returns matched rule or null. Fallback to `intent_master.suggestedDivision` if no rule matches (backward compat).

**audit_logs integration:**
Every rule CREATE/UPDATE/DELETE writes:
```json
{ "action": "rule_updated", "module": "routing_rules", "entityId": ruleId,
  "before": <old row JSON>, "after": <new row JSON> }
```
Every IntentEngine evaluation that hits a rule writes:
```json
{ "action": "routing_resolved", "module": "governance",
  "entityId": taskId, "entityType": "ai_task",
  "after": { "ruleId": n, "routeTarget": "...", "autoAssign": true } }
```

**Frontend UI — Routing Matrix tab:**
- Stats bar: total rules / active / by division
- Filter: intentCode, category, priority, active toggle
- Table: sortOrder | intentCode | category | priority | routeTo | routeTarget | flags (icons) | actions
- Inline add/edit form (same pattern as Knowledge Base)
- Simulate panel: enter intentCode + category + priority → show matched rule and resolution

**Test scenarios:**
1. Create rule `intentCode=order_shipment, routeTo=division, routeTarget=Operations, needsQuotation=true` → simulate → verify match
2. Create two rules with same intent different priority → verify higher-specificity wins
3. Set `autoAssign=true` with `routeTargetId` → create task via WhatsApp → verify auto-assignment fires
4. RBAC: supervisor cannot POST → expect 403
5. `category=null, intentCode=null` (catch-all rule) → verify it's matched last

---

## 3. Module 2 — SLA Matrix

### Purpose
Provide a two-dimensional SLA lookup: `category × priority → slaHours`. More specific
`intentCode × priority` overrides the category-level rule. Replaces the flat
`intent_master.slaHours` field for runtime resolution.

### Table: `sla_matrix`

```
sla_matrix
─────────────────────────────────────────────────────────────────
id                      serial        PK
companyId               text          NOT NULL  default "default"
intentCode              text          nullable  (more specific)
category                text          nullable  (less specific)
priority                text          NOT NULL  -- "low"|"medium"|"high"|"urgent"

slaHours                integer       NOT NULL
warningThresholdPct     integer       NOT NULL  default 75
                                               -- warn at 75% elapsed

autoEscalateEnabled     boolean       NOT NULL  default false
autoEscalateAfterHours  integer       nullable  -- hours past slaHours to trigger escalation

description             text          nullable
isActive                boolean       NOT NULL  default true

createdAt               timestamptz   NOT NULL  defaultNow()
updatedAt               timestamptz   NOT NULL  defaultNow().$onUpdate()
```

**Indexes:**
- `(companyId, intentCode, priority)` — specific lookup
- `(companyId, category, priority)` — category fallback
- `(companyId, isActive)` — active filter

**Resolution logic:**
1. Match `intentCode + priority` (exact)
2. Match `category + priority`
3. Match `priority` only (global default for that priority)
4. Fallback: `intent_master.slaHours` then hardcoded default (24h)

**FK relations:**
- None (intentCode is not a hard FK — intents may be deleted without breaking SLA history)

**RBAC:** Same as Routing Matrix — read: `supervisor`, write: `company_admin`.

**API Endpoints:**
```
GET    /api/sla-matrix             list, ?category=, ?intentCode=, ?priority=
POST   /api/sla-matrix             create entry
PATCH  /api/sla-matrix/:id         update entry
DELETE /api/sla-matrix/:id         delete entry
POST   /api/sla-matrix/resolve     test resolution: {intentCode, category, priority} → slaHours
```

**IntentEngine integration:**
After Sprint 3B, `resolveIntent()` calls `resolveSla(companyId, intentCode, category, priority)` to set `slaHours` instead of reading `intent_master.slaHours`. The returned `slaHours` is stored on `ai_tasks.slaHours` and `ai_tasks.overdueAt = now() + slaHours`.

`ai_tasks` SLA refresh scheduler (`sla.ts`) already exists and recalculates `slaStatus` — no change needed there.

**audit_logs integration:**
```json
{ "action": "sla_resolved", "module": "governance", "entityType": "ai_task",
  "after": { "matrixId": n, "slaHours": 8, "source": "sla_matrix" } }
```

**Frontend UI — SLA Matrix tab:**
- Matrix view: rows = categories, columns = priorities (low/medium/high/urgent), cells = slaHours
- Empty cell = using fallback (shown in muted style)
- Click cell → inline edit slaHours + warningThresholdPct + autoEscalate toggle
- Table view toggle: flat list with all fields editable
- Warning: cells with `autoEscalateEnabled` highlighted with badge

**Test scenarios:**
1. Add `category=Pengiriman, priority=high, slaHours=8` → create high priority shipping task → verify `overdueAt = now + 8h`
2. Add `intentCode=customs_clearance, priority=high, slaHours=4` (more specific) → verify it wins over category rule
3. No matrix entry for `priority=low` → verify fallback to `intent_master.slaHours`
4. `warningThresholdPct=75, slaHours=8` → at 6h elapsed → verify `slaStatus = "due_soon"`

---

## 4. Module 3 — Escalation Matrix

### Purpose
Define automated escalation rules: when a task meets trigger conditions (SLA breach,
stuck status, no customer response), escalate to a new assignee/division, change
priority/status, and send notification. Currently zero escalation logic exists.

### Table: `escalation_rules`

```
escalation_rules
─────────────────────────────────────────────────────────────────
id                  serial        PK
companyId           text          NOT NULL  default "default"

triggerType         text          NOT NULL
                                  -- "sla_breach" | "sla_warning" | "no_response"
                                  -- | "status_stuck" | "priority_upgraded"

category            text          nullable  (null = any category)
intentCode          text          nullable  (null = any intent)
priority            text          nullable  (null = any priority)

conditionHours      integer       NOT NULL
                                  -- hours after trigger event before rule fires

conditionStatus     text          nullable
                                  -- only fire if task is in this status

escalateTo          text          NOT NULL
                                  -- "division" | "team_member" | "manager" | "super_admin"
escalateTarget      text          NOT NULL  -- division name or member name
escalateTargetId    integer       nullable  FK → team_members.id

notifyWhatsapp      boolean       NOT NULL  default false
notifyInApp         boolean       NOT NULL  default true
changeStatus        text          nullable  -- optional: override ai_task.status
changePriority      text          nullable  -- optional: override ai_task.priority

isActive            boolean       NOT NULL  default true
sortOrder           integer       NOT NULL  default 100
description         text          nullable

createdAt           timestamptz   NOT NULL  defaultNow()
updatedAt           timestamptz   NOT NULL  defaultNow().$onUpdate()
```

**Indexes:**
- `(companyId, triggerType, isActive)` — scheduler lookup
- `(companyId, category, triggerType)` — category scope
- `(companyId, isActive, sortOrder)` — ordered evaluation

### Table: `escalation_logs`

```
escalation_logs
─────────────────────────────────────────────────────────────────
id                  serial        PK
companyId           text          NOT NULL
taskId              integer       NOT NULL  FK → ai_tasks.id
ruleId              integer       NOT NULL  FK → escalation_rules.id

triggerType         text          NOT NULL
conditionMetAt      timestamptz   NOT NULL
firedAt             timestamptz   NOT NULL  defaultNow()

previousAssignee    text          nullable
newAssignee         text          nullable
previousStatus      text          nullable
newStatus           text          nullable
previousPriority    text          nullable
newPriority         text          nullable

notificationSent    boolean       NOT NULL  default false
notificationDetail  text          nullable  -- JSON of WA message sent

createdAt           timestamptz   NOT NULL  defaultNow()
```

**Indexes:**
- `(companyId, taskId)` — per-task history
- `(companyId, ruleId)` — per-rule stats
- `(companyId, firedAt)` — timeline view

**FK relations:**
- `taskId` → `ai_tasks.id` ON DELETE CASCADE
- `ruleId` → `escalation_rules.id` ON DELETE SET NULL (keep log even if rule deleted)

**RBAC:**
| Operation | Minimum Role |
|-----------|-------------|
| GET rules | `supervisor` |
| POST / PATCH / DELETE rules | `company_admin` |
| GET escalation_logs | `supervisor` |

**API Endpoints:**
```
GET    /api/escalation-rules              list rules
POST   /api/escalation-rules              create
PATCH  /api/escalation-rules/:id          update
DELETE /api/escalation-rules/:id          delete
GET    /api/escalation-logs               log history, ?taskId=, ?ruleId=, ?from=, ?to=
POST   /api/escalation-rules/simulate     test: {taskId, triggerType} → which rules would fire
```

**Background scheduler integration:**
A new `escalation-scheduler.ts` runs every 15 minutes alongside the existing `follow-up-scheduler.ts`. It:
1. Queries all active `escalation_rules`
2. For each `triggerType`, queries `ai_tasks` for matching conditions (e.g. `slaStatus = "overdue"` for `sla_breach`)
3. Checks `escalation_logs` — do not re-fire same rule+task within 24h
4. Fires matching rules: update `ai_tasks`, write `escalation_logs`, write `audit_logs`, optionally send WA notification

**IntentEngine integration:**
No change at resolution time. Escalation is post-creation, not pre-creation.
IntentEngine may flag `needsEscalationWatch = true` on the resolved task.

**audit_logs integration:**
```json
{ "action": "escalation_fired", "module": "governance", "entityId": taskId,
  "entityType": "ai_task",
  "after": { "ruleId": n, "triggerType": "sla_breach", "escalatedTo": "Operations Manager" } }
```

**Frontend UI — Escalation Matrix tab:**
- Stats: total rules / active / by triggerType / escalations fired (30d)
- Rule table: triggerType | conditionHours | category | escalateTo | escalateTarget | notify icons | active
- Add/edit form with triggerType selector
- Recent escalations section: last 20 `escalation_logs` with taskNumber, trigger, fired time

**Test scenarios:**
1. Create rule `triggerType=sla_breach, category=Pengiriman, conditionHours=2, escalateTo=manager` → set task overdue → wait scheduler → verify `escalation_logs` entry + task `assignedTo` updated
2. Create `triggerType=no_response, conditionHours=48` → verify scheduler detects tasks with `lastCustomerReplyAt > 48h`
3. Same rule fires twice in 24h → second should be blocked by dedup check
4. `changeStatus=ready_for_review` on trigger → verify `ai_tasks.status` updated
5. RBAC: supervisor cannot POST → expect 403

---

## 5. Module 4 — Approval Matrix

### Purpose
Replace the hardcoded `APPROVAL_INTENTS` array and `approvalType = "admin_approval"`
string with configurable approval rules per intent/category. Track in-flight approvals
in `approval_requests`.

### Table: `approval_rules`

```
approval_rules
─────────────────────────────────────────────────────────────────
id                  serial        PK
companyId           text          NOT NULL  default "default"

intentCode          text          nullable  (null = any intent)
category            text          nullable  (null = any category)
priority            text          nullable  (null = any priority)

triggerCondition    text          NOT NULL
                                  -- "always" | "high_priority" | "new_customer"
                                  -- | "amount_threshold" | "manual_flag"

thresholdAmount     numeric(15,2) nullable  -- for "amount_threshold"

approvalType        text          NOT NULL
                                  -- "admin_approval" | "manager_approval"
                                  -- | "dual_approval" | "auto_approve" | "auto_reject"

approverRole        text          NOT NULL  -- minimum role to approve
approverMemberId    integer       nullable  FK → team_members.id  (specific person)

timeoutHours        integer       NOT NULL  default 48
onTimeoutAction     text          NOT NULL
                                  -- "auto_reject" | "auto_approve" | "escalate"

notifyWhatsapp      boolean       NOT NULL  default false
notifyInApp         boolean       NOT NULL  default true

isActive            boolean       NOT NULL  default true
sortOrder           integer       NOT NULL  default 100
description         text          nullable

createdAt           timestamptz   NOT NULL  defaultNow()
updatedAt           timestamptz   NOT NULL  defaultNow().$onUpdate()
```

**Indexes:**
- `(companyId, intentCode, isActive)` — intent-specific lookup
- `(companyId, category, isActive)` — category fallback
- `(companyId, isActive, sortOrder)` — ordered evaluation

### Table: `approval_requests`

```
approval_requests
─────────────────────────────────────────────────────────────────
id                  serial        PK
companyId           text          NOT NULL
taskId              integer       NOT NULL  FK → ai_tasks.id
ruleId              integer       NOT NULL  FK → approval_rules.id

approvalType        text          NOT NULL
status              text          NOT NULL  default "pending"
                                  -- "pending" | "approved" | "rejected" | "timed_out"

requestedBy         text          NOT NULL  -- user name who triggered
requestedAt         timestamptz   NOT NULL  defaultNow()
timeoutAt           timestamptz   NOT NULL  -- requestedAt + timeoutHours

respondedBy         text          nullable
respondedAt         timestamptz   nullable
notes               text          nullable

createdAt           timestamptz   NOT NULL  defaultNow()
updatedAt           timestamptz   NOT NULL  defaultNow().$onUpdate()
```

**Indexes:**
- `(companyId, taskId, status)` — pending approvals per task
- `(companyId, status, timeoutAt)` — timeout scanner
- `(companyId, ruleId)` — per-rule stats

**FK relations:**
- `taskId` → `ai_tasks.id` ON DELETE CASCADE
- `ruleId` → `approval_rules.id` ON DELETE SET NULL

**RBAC:**
| Operation | Minimum Role |
|-----------|-------------|
| GET rules | `supervisor` |
| POST / PATCH / DELETE rules | `company_admin` |
| GET approval_requests | `supervisor` |
| POST /approve or /reject | role ≥ `approverRole` on matched rule |

**API Endpoints:**
```
GET    /api/approval-rules                    list rules
POST   /api/approval-rules                    create
PATCH  /api/approval-rules/:id                update
DELETE /api/approval-rules/:id                delete
GET    /api/approval-requests                 list, ?status=, ?taskId=
POST   /api/approval-requests/:id/approve     approve (requires matching role)
POST   /api/approval-requests/:id/reject      reject with notes
POST   /api/approval-rules/simulate           test: {intentCode, category, priority} → matched rule
```

**IntentEngine integration:**
After Sprint 3B, replace:
```ts
// OLD (hardcoded)
const needsApproval = needsAdminReview && APPROVAL_INTENTS.includes(intentCode);
const approvalType  = needsApproval ? "admin_approval" : null;
```
With:
```ts
// NEW (DB-driven)
const approvalRule = await resolveApprovalRule(companyId, intentCode, category, priority);
const needsApproval = approvalRule !== null && approvalRule.approvalType !== "auto_approve";
const approvalType  = approvalRule?.approvalType ?? null;
```
If `needsApproval`, a row is inserted into `approval_requests` at task creation.

**Background scheduler integration:**
Timeout scanner runs alongside escalation scheduler. Queries `approval_requests` where
`status = "pending" AND timeoutAt < now()` and applies `onTimeoutAction`.

**audit_logs integration:**
```json
{ "action": "approval_requested", "module": "governance",
  "entityId": taskId, "entityType": "ai_task",
  "after": { "ruleId": n, "approvalType": "manager_approval", "timeoutAt": "..." } }

{ "action": "approval_resolved", "module": "governance",
  "entityId": requestId, "entityType": "approval_request",
  "after": { "status": "approved", "respondedBy": "Ali", "taskId": n } }
```

**Frontend UI — Approval Matrix tab:**
- Stats: total rules / pending approvals / approved today / rejected today
- Rules table: intentCode | category | triggerCondition | approvalType | approverRole | timeout | active
- Pending approvals section: live list of `approval_requests` where `status=pending`
  - Each row: taskNumber | intentCode | requestedBy | time since request | approve/reject buttons (role-gated)

**Test scenarios:**
1. Create rule `intentCode=complaint, approvalType=manager_approval, timeoutHours=24`
   → send WhatsApp "complaint about late delivery" → verify `approval_requests` row created
2. Approve via `/approve` with `supervisor` role (below required) → expect 403
3. Approve with `company_admin` → verify `ai_tasks.status` updates to `"ready_for_review"`
4. Let timeout expire → verify `onTimeoutAction=auto_reject` updates request status
5. `approvalType=auto_approve` rule → verify no `approval_requests` row is created

---

## 6. Shared: Simulator Tab

A single tab testing all four matrices in sequence for a given input.

**UI:**
- Input: `intentCode` (or free-text message), `category`, `priority`, `companyId` (super_admin only)
- Output panels (collapsible):
  1. **Routing**: matched rule → routeTarget, flags
  2. **SLA**: matched matrix entry → slaHours, warningThreshold
  3. **Approval**: matched rule → approvalType, approverRole
  4. **Escalation**: rules that would eventually fire → triggerType, conditionHours

**RBAC:** `supervisor+`

**API Endpoint:**
```
POST /api/governance/simulate
Body: { intentCode, category, priority, companyId? }
Response: { routing, sla, approval, escalations[] }
```

---

## 7. Shared: Logs Tab

Unified governance activity view — not a new table, queries `audit_logs` and
`escalation_logs` filtered to `module = "governance"`.

**UI:**
- Filter: module (routing/sla/approval/escalation), action, dateRange, taskId
- Table: timestamp | module | action | entityId | detail (before/after diff)
- Click row → expand JSON diff

**API Endpoint:**
```
GET /api/governance/logs?module=&action=&from=&to=&taskId=
```

RBAC: `supervisor+`

---

## 8. Frontend Route: `/governance`

Tab layout identical to `/knowledge-base`.

```
/governance
  ├── Tab: Routing Matrix      (RoutingMatrixTab)
  ├── Tab: SLA Matrix          (SlaMatrixTab)
  ├── Tab: Escalation Matrix   (EscalationMatrixTab)
  ├── Tab: Approval Matrix     (ApprovalMatrixTab)
  ├── Tab: Simulator           (GovernanceSimulatorTab)
  └── Tab: Logs                (GovernanceLogsTab)
```

Nav entry added to `app-layout.tsx` alongside existing Knowledge Base entry.

---

## 9. New Database Objects Summary

| Table | New? | Notes |
|---|---|---|
| `routing_rules` | ✅ New | Sprint 3B |
| `sla_matrix` | ✅ New | Sprint 3B |
| `escalation_rules` | ✅ New | Sprint 3B |
| `escalation_logs` | ✅ New | Sprint 3B |
| `approval_rules` | ✅ New | Sprint 3B |
| `approval_requests` | ✅ New | Sprint 3B |
| `intent_master` | Existing | `slaHours` kept as fallback |
| `ai_tasks` | Existing | No new columns needed |
| `audit_logs` | Existing | Reused with `module="governance"` |
| `team_members` | Existing | FK target for routeTargetId, escalateTargetId, approverMemberId |

---

## 10. IntentEngine Changes (Sprint 3B)

Exact functions to add to `intent-engine.ts` or a new `governance-engine.ts`:

```ts
resolveRouting(companyId, intentCode, category, priority): Promise<RoutingRule | null>
resolveSla(companyId, intentCode, category, priority): Promise<{ slaHours: number; matrixId: number | null }>
resolveApproval(companyId, intentCode, category, priority): Promise<ApprovalRule | null>
```

All three add to the existing TTL cache (5 min) keyed by `companyId`.

**After Sprint 3B, delete from `intent-engine.ts`:**
```ts
const APPROVAL_INTENTS          = [...]   // line ~629
const NEEDS_QUOTATION_INTENTS   = [...]   // line ~610
const NEEDS_ADMIN_REVIEW_INTENTS = [...]  // line ~611
```

---

## 11. Escalation Scheduler

New file: `artifacts/api-server/src/lib/escalation-scheduler.ts`

Called from `app.ts` alongside existing schedulers:
```ts
startEscalationScheduler()  // interval: every 15 minutes
```

Internally deduplicates via `escalation_logs` — same `(taskId, ruleId)` not re-fired
within 24h to prevent spam.

---

## 12. RBAC Matrix — Full Summary

| Feature | supervisor | company_admin | super_admin |
|---|---|---|---|
| Read all matrices | ✅ | ✅ | ✅ |
| Create / Edit / Delete rules | ❌ | ✅ | ✅ |
| Approve / Reject requests | role-gated per rule | ✅ | ✅ |
| Simulator | ✅ | ✅ | ✅ + companyId selector |
| Logs | ✅ | ✅ | ✅ |
| Cache reload | ❌ | ✅ | ✅ |

---

## 13. Implementation Order (Sprint 3B)

1. DB schema — 6 new tables, `drizzle-kit push`
2. Backend routes — 4 route files following `knowledge-base.ts` pattern
3. IntentEngine — add 3 resolver functions + replace hardcoded arrays
4. Escalation + Approval schedulers
5. Frontend — `/governance` page, 6 tabs
6. Typecheck gate — run clean before marking sprint done
7. Simulator tab
8. Logs tab

---

## 14. Out of Scope (Explicitly Deferred)

- Fleet management
- Purchasing / procurement
- AI Training / fine-tuning
- Memory Center / conversation history
- Any changes to WhatsApp webhook handler beyond consuming the new resolver outputs
