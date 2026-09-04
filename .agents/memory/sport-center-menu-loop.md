---
name: Sport Center Menu Loop Fix
description: Why the "Pilih lapangan" menu kept repeating after user typed a digit; how to prevent it.
---

# Root Cause
`processIntakeMessage` had two paths to treat digit "1"–"6" as a lapangan menu reply:
1. `isMenuQuestion`: true if `session.lastQuestion` includes "Pilih lapangan" — works when DB has the last question
2. `isDigitMenuReply`: belt-and-suspenders — but required `!existingCollected.field_type && !existingCollected.field_name`

Bug: OpenAI sometimes extracts a generic value like `"lapangan olahraga"` from the user's initial message. This makes `existingCollected.field_type` truthy, so `isDigitMenuReply = false`. Digit "2" falls through to OpenAI extraction which can't map it → field stays generic → gate resends menu.

# Fix (artifacts/api-server/src/lib/intake-engine.ts ~line 846)
Replaced exact absence check with keyword-contains specificity check:
- Define `SPECIFIC_LAPANGAN_KEYWORDS = ["badminton", "futsal", "tennis", "basketball", "voli", "gym"]`
- `lapanganAlreadySpecific` = true only if existing field_type/field_name CONTAINS a keyword (handles "lapangan futsal", "main futsal", etc.)
- Added `!availAlreadyChecked` guard: once `_avail_status` is set, don't intercept digits (they belong to a later step like confirmation)

**Why:** Generic field values from initial AI extraction must not block the belt-and-suspenders menu detection.
**How to apply:** Any time digit interception logic is extended, use keyword-contains not exact equality for lapangan detection.

# Main Menu Reset Race
The greeting menu and the next numeric reply arrive as separate webhooks. A stale active intake session can still be visible when the user quickly replies with a main-menu digit.

**Why:** Cancelling the old session asynchronously allows the numeric reply to continue the wrong intent instead of selecting the requested top-level service.

**How to apply:** When a greeting shows the main menu, retain short-lived menu context and let digits 1–6 override/cancel stale intake state; do not apply that override to numeric replies during a normal active sport-center flow.
