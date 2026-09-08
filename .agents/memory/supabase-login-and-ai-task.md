---
name: Supabase login and AI Task databases
description: Dev and production use separate Supabase projects; REST service key can work while the PostgreSQL connection string is invalid.
---

The custom JWT login reads public.users through Drizzle/PostgreSQL, while storage and selected integrations use the environment-specific Supabase service key. Both projects currently contain the AI Task core tables.

**Why:** A valid Supabase REST/service-role credential does not prove that the PostgreSQL pooler password is valid; production can therefore return login 500/503 while REST table checks succeed.

**How to apply:** Validate both channels separately before diagnosing login: connect with the environment-specific PostgreSQL URL, then check REST access and table presence with the matching service key. Never fall back from production to the development database.

For AI Task listing, `getCompanyId()` returning null means an unfiltered `super_admin` scope; do not replace it with the user's numeric `company_id`, because legacy `ai_tasks` rows may use the `"default"` tenant.