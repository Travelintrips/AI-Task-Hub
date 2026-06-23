---
name: Sprint 10A-2 Guided Onboarding Wizard
description: 8-step onboarding wizard, dashboard banner, AI simulator, empty state improvements.
---

# Sprint 10A-2 — Guided Onboarding Wizard

## Files created/modified
- `artifacts/api-server/src/routes/system.ts` — added POST /api/system/ai-test (keyword match, no task creation, no WA)
- `artifacts/ai-task-center/src/pages/onboarding.tsx` — 8-step wizard (single file, all steps)
- `artifacts/ai-task-center/src/components/onboarding-banner.tsx` — dashboard banner
- `artifacts/ai-task-center/src/App.tsx` — added /onboarding and /onboarding/:step routes
- `artifacts/ai-task-center/src/pages/dashboard.tsx` — OnboardingBanner inserted above header
- `artifacts/ai-task-center/src/components/layout/app-layout.tsx` — Onboarding Setup nav item (mgmt+supervisor roles)
- Empty states improved: team.tsx, fleet-units.tsx, messages.tsx

## Wizard step routing
Single component `onboarding.tsx` handles all steps via `/onboarding/:step` param.
Steps: company → whatsapp → team → customer → vendor → fleet → test → done

## RBAC
- super_admin / owner / company_admin: full edit
- supervisor: view-only (no edit)
- staff/others: blocked (Lock screen shown)

## API endpoints in use
- GET /api/settings → PUT /api/settings (company profile)
- GET /api/system/whatsapp-health (WA health)
- GET /api/team → POST /api/team (team members, POST requires company_admin)
- GET /api/vendors (vendor list)
- GET /api/fleet/units (fleet units)
- GET /api/system/onboarding-status (overall progress)
- POST /api/system/ai-test (AI simulator — NEW in this sprint)

## AI test endpoint
- Uses keyword_rules JOIN intent_master for keyword matching
- Falls back to hardcoded word list for 16 scenario intents
- Checks data_templates for intakeMode and required fields
- Returns: detectedIntent, intentCode, category, confidence, intakeMode, missingFields, wouldCreateTask, wouldSendMiniForm
- NO task creation, NO WhatsApp sent

## Banner
- Queries GET /api/system/onboarding-status
- Visible only to mgmt roles when overallPct < 80
- Dismissed with "X" → 24h localStorage skip
- "Lanjutkan Setup" → navigate to /onboarding

**Why:** Banner is auto-dismissible via localStorage (key: onboarding_banner_skipped_at) with 24h TTL.
