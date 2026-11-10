# GPT02 DEV — real hosted RLS compatibility gap and scoped policy candidate

**Boundary:** CST-DEV `xssrfshdrtdfupgqwfdw` only. This PR source file is NOT an activated worker, task, signature, nonce, live RLS migration or grant. Task135/136 remain historical. PROD is out of scope.

## Hosted read-only finding (2026-11-10 WIB)

The real shared PostgreSQL17 has RLS on `public.ai_tasks`, `public.team_members`, `public.audit_logs`, `public.ai_execution_jobs`, `public.users`, `ai_platform.ai_coding_tasks`, `ai_platform.ai_coding_runs`, and `ai_platform.ai_coding_bridge_commands`. The first four have **zero** policies; Core coding tasks have policies for `aicore_dev_runtime` only. Thus the earlier isolated Core/Hub atomic preparation fixture with RLS off was incomplete: granting table SELECT/INSERT to `gpt02_core_prep_owner` is not enough to insert rows as that restricted NOLOGIN owner. The live preparer/issuer/attestor stay NOLOGIN with zero prepared tasks, approvals or nonce receipts.

## Candidate improvement

`scripts/dev/gpt02-core-preparer-rls-candidate.sql` adds **10 purpose-limited RLS policies** only `TO gpt02_core_prep_owner`, not PUBLIC, anon, authenticated, Hub runtime or any worker. They restrict Hub tenant/task, active PIC, audited PIC identity, global Super Admin, Core task project/repo/branch/status, and reading only Core runs/commands referenced by immutable staging. Existing unrelated policies are preserved. The INSERT policy mandates `prepared` and rejects populated worker/command, verified callback, automatic continuation or production authorization fields. A Hub SELECT policy intentionally observes ALL statuses for future task ID>136 so a prior failed execution cannot be hidden and prepared twice.

The exact candidate is injected into the existing offline PostgreSQL16 Core/Hub preparation integration fixture after `gpt02_stage.core_preparations` exists and before the restricted function is created. It runs real PostgreSQL RLS as `gpt02_core_prep_owner`, with the independent SCRAM `gpt02_core_prep_login` invoking only the scoped SECURITY DEFINER function. The existing tests must still prove concurrency => one Hub/Core prepared pair, no command, stable retry, wrong task/tenant/audit refusal and rollback. No live preparation function, login, RLS policies or dispatch are activated by these CI tests.

## Release boundary

Before any CST-DEV migration of these policies, the exact source/CI must PASS and a separately reviewed deployment must verify there are no broadened grants, effective owner-login permissions, RLS regressions, or existing task/command changes. The signed Super Admin approval, attestor, issuer nonce and active one-shot lease remain unavailable. Full GPT02 managed lifecycle stays **NO-GO**.
