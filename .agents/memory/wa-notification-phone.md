---
name: WA Notification Silent Skip
description: Why WhatsApp notification to staff doesn't fire — phone lookup and wrong API endpoint.
---

## The Rule
WA notification to assigned staff only fires if `team_members.phone` is NOT NULL. Missing phone = silent skip, no error shown.

**Why:** `notifyTaskAssigned(ctx, member?.phone ?? null)` in `ai-tasks.ts` — null phone → fonnte not called.

**How to apply:** When debugging "staff didn't receive WA after assignment", check:
1. Does the staff member have a phone number in `team_members`?
2. Log will show: `"Notifikasi WA dilewati — anggota tim tidak memiliki nomor HP"`
3. Fix: add phone number via Team page → Edit member.

## Dispatcher assign path missing notification (fixed)
`POST /dispatcher/assign` (Smart AI Dispatcher) updated ai_tasks but **never called notifyTaskAssigned**. Notification only existed in `PATCH /ai-tasks/:id`. Fixed by adding the full notification block (member phone lookup + notifyTaskAssigned call) to dispatcher.ts.

## Frontend API Endpoint Bug (fixed)
`ai-task-detail.tsx` was querying `/api/team-members` (404) instead of `/api/team`. This caused the assignee dropdown to be empty (no team members loaded). Fixed to use `/api/team`.

## Fixes Applied
- Backend: added `logger.warn` when member not found or phone is null
- Frontend (ai-task-detail): fixed endpoint `/team-members` → `/team`; added `PhoneOff` warning badge and toast when assignee has no phone
- Frontend (team page): added "No HP — WA nonaktif" amber badge on member cards without phone numbers
