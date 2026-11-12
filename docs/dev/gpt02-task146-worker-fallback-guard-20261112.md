# GPT02 DEV — Task #146 worker/GPT01 fallback incident

Date: 12 November 2026. Scope: AI Task Hub DEV only.

## Read-only incident findings
- Task #146 exists in `public.ai_tasks` in tenant `default`, with active PIC ID 5.
- `gpt02_pic_assigned` audit is recorded by the authenticated Super Admin, and task assignment is retained.
- One execution exists: `failed`, error `AI_CORE_CHATGPT_COMMAND_HTTP_403`.
- The failed execution metadata pins `accountAlias=GPT01`, `reasoningHandoff=true` and `autoContinue=false`.
- `command_id`, worker, callback verification, attestation and final ACK are absent.
- There is **no** `gpt02_stage.core_preparations` row for Task #146.
- Logs show AI Core DEV rejected the ChatGPT dispatch route with HTTP 403. No native worker acceptance is proven.
- The GPT02 detail page shows the designated executor as GPT02, but its still-enabled `Run Worker` button used `{mode:"worker"}`, which could enter the generic reasoning handoff and fall back to the default alias GPT01. This did not constitute GPT02 operator approval or an issued lease.

## Narrow corrective guard
In `artifacts/api-server/src/routes/executions.ts`, for DEV only:

- Check whether the exact tenant/task has a persisted `gpt02_pic_assigned` audit before reserving or retrying a generic worker execution.
- If so, reject any mode/alias other than explicit `mode=chatgpt, accountAlias=GPT02` with HTTP 409 and `GPT02_PIC_AUDITED_WORKER_FALLBACK_FORBIDDEN`. No command, execution, continuation or dispatch is started.
- Preserve existing GPT02 pre-dispatch hold when `lifecycleStart=true` and retain the separately proven one-shot GPT02 text contract when `lifecycleStart=false`.
- Re-read the GPT02 PIC audit under the same cross-instance task advisory lock used by official PIC assignment before inserting a new execution. This prevents a concurrent PIC assignment from committing between the early audit read and initial reservation.
- Keep failed execution and its historical evidence unchanged; never reset, resubmit, delete, complete or relabel Task #146.

In `ai-task-detail.tsx`, disable `Run Worker` for an audited GPT02 task for a Super Admin and explain why. Generic non-GPT02 worker routes remain available.

## Verification / release gate
- Offline build from existing local DEV runtime image, with only an isolated compiled API overlay and private PostgreSQL 16 network: PASS. Four forbidden fallback inputs rejected, no unapproved execution created, explicit GPT02 one-shot remains eligible, no auto-continue.
- Existing GPT02 lifecycle-start rejection and cross-tenant checks remain PASS.
- New static-source contract checks guard the route order, presence of the transaction recheck, and the UI disablement.
- TypeScript typecheck PASS for API, UI and scripts in a separate Git worktree.
- Nothing deployed to the active Hub DEV or PROD as part of this patch.
- No signing, real Super Admin signer approval, nonce consumption, issuer lease, or final ACK was created. Lifecycle E2E remains NO-GO.
