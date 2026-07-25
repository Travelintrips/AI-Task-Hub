---
name: Intake Form Notification Routing
description: Category routing logic for mini-form WA notifications — intentCode priority vs DB category union bug and fix.
---

# Intake Form Notification Category Routing

## The Bug (Fixed)
`intake-form.ts` built `aliasSet` as a UNION of all category sources:
- `resolvedCategory` from DB (`intent_master.category`) — could be stale/wrong
- `session.category`
- `inferCategoryFromIntentCode(session.intentCode)`

Result: PPJK/freight forms with DB category "Logistik" AND intentCode "ppjk_..." → aliasSet included BOTH "Trucking" (from Logistik aliases) AND "PPJK" (from intentCode). Both groups received the notification.

## The Fix
`intentCode inference takes PRIORITY over DB category`.

```
if (intentCodeCategory) {
  use ONLY intentCodeCategory aliases
  only add DB/session aliases if they MATCH intentCodeCategory
} else {
  fall back to DB/session categories
}
```

**Why:** intentCode is system-defined and most specific. DB `intent_master.category` can have stale data (e.g., "Logistik" for a PPJK form). When intentCode says "Customs" (because it contains "ppjk"), that wins over the DB.

**How to apply:** If a form is going to the wrong group, check:
1. What is `session.intentCode`?
2. What does `inferCategoryFromIntentCode(intentCode)` return?
3. What is `intent_master.category` in Supabase for that intent code?
4. Priority: intentCode inference > DB category

## INTENT_CODE_CATEGORY Map (in intake-form.ts)
- `ppjk`, `customs`, `bea_cukai` → "Customs"
- `trucking`, `freight`, `import`, `export`, `ekspor`, `logistik` → "Logistik"
- `booking_lapangan`, `sport` → "Sport Center"
- `fleet`, `armada` → "Fleet"
- `tenant`, `sewa` → "Tenant"
- `kasbon`, `cash_advance`, `finance` → "Finance"

## CATEGORY_ALIASES (in intake-form.ts)
- "Logistik" → ["Logistik", "Trucking", "Freight", "Pengiriman", "Sea Freight", "Air Freight"]
- "Customs" → ["Customs", "PPJK", "Bea Cukai", "PPJK/Customs"]
- "Sport Center" → ["Sport Center", "Lapangan", "Olahraga", "Booking Lapangan"]

## Logging Added
`intake-form: final category routing list` log shows `{ intentCodeCategory, resolvedCategory, sessionCategory, categoryList }` — use this to debug future routing issues.
