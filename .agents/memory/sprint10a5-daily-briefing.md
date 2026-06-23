---
name: Sprint 10A-5 Daily Briefing
description: Executive Daily Briefing — daily 07:00 WIB WhatsApp, scheduler, routes, frontend widget
---

## Key decisions

- Scheduler: `executive-daily-briefing` fires at 00:00 UTC (= 07:00 WIB); uses same msUntilNextTime pattern as fleet-scheduler.ts
- Storage: briefing settings stored as raw columns in `company_settings` (not Drizzle typed); settings rows may not exist for all companies — getBriefingSettings() uses DEFAULT fallback
- Log table: `executive_briefing_logs` in Supabase; startup migration in run10A5() in app.ts
- Recipients: resolved from `team_members.name` (NOT `full_name`) WHERE role IN(...) AND phone IS NOT NULL AND is_active = true
- Routes: 4 endpoints under `/executive/briefing/*` (settings GET/PUT, send POST, preview GET, logs GET); all RBAC company_admin+
- BRIEFING WA command: `wa-commands/executive.ts` calls `generateBriefingMessage` (same generator as scheduler, reuse)
- company_settings default: enabled=false, time='07:00', recipients='owner,super_admin,company_admin'

**Why:** Column `name` not `full_name` — team_members schema uses `name`; always check actual column names with information_schema before coding.

## Validation results (10/10 PASS)

I.1 data sources ✅ | I.2 send endpoint RBAC ✅ | I.3 all 4 endpoints 401 ✅ | I.4 recipients resolved ✅ | I.5 no-phone skip ✅ | I.6 company_settings columns ✅ | I.7 scheduler registered ✅ | I.8 log table exists ✅ | I.9 default settings ✅ | I.10 BRIEFING WA command ✅
