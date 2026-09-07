---
name: Fonnte Echo Loop Root Cause
description: Why WA messages loop and how to prevent it — all 4 root causes + fixes
---

## The Problem
Fonnte webhooks echo ALL outgoing messages back to the webhook URL with `quick=true`.
Any bot reply → Fonnte echoes it → processed as new message → another reply → infinite loop.

## 4 Root Causes (all must be addressed)

### 1. Fonnte `quick=true` echo (PRIMARY — FIXED)
- Outgoing echo: `quick=true` in payload
- Real incoming: `quick=false` or `quick` absent
- **Fix**: In webhook handler, skip if `rawPayload?.quick === true` before any processing
- Location: `artifacts/api-server/src/routes/whatsapp.ts` (Fonnte gateway handler block)

### 2. Double `_notifyForTask` call (FIXED)
- Lines 883-884 called `_notifyForTask` twice with different `suggestedReply` sources
- For `action=appended`, each call sends a WA message → 2 echoes → 2 loop triggers
- **Fix**: Merge into single call: `result._resolution?.suggestedReply ?? result.suggested_reply ?? null`

### 3. Auto-greeting in `suggestedReply` (context)
- `intent-engine.ts` auto-builds "Halo *Name*! Terima kasih..." as `finalSuggestedReply` when fields missing
- This is sent via `_notifyForTask` (action=appended) — creates confusing repeat greetings
- Not fixed in code but contained by fix #1 and #2

### 4. MiniFormRouter session dedup (already in place)
- Existing sessions with `form_sent` status are reused — does NOT re-send form link
- Location: `artifacts/api-server/src/lib/mini-form-router.ts`

## How to verify loop stopped
```sql
SELECT id, "from", body, raw_payload->>'quick' as quick, created_at
FROM whatsapp_messages ORDER BY id DESC LIMIT 10;
```
After fix: only `quick=false` or `quick=null` entries should appear in DB.

## Secondary content filter (belt-and-suspenders)
Still in place: skip if body contains `/mini-form/` — catches any edge case where `quick` is absent on an echo.

**Why:** Fonnte is the WA gateway — its echo behavior is not configurable. The only defense is server-side filtering.
