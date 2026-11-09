# One GPT02 text-test draft and retirement of unsafe live credential probe

## User-requested scope

Use existing CST-DEV only. Prepare exactly one NEW text-only task for GPT02 on DELL, with Super Admin approval; no Task #135 replay, no PROD changes, no dispatch before the task-specific checks are satisfied. Stop expanding this into a new database platform project.

## Material incident discovered during this continuation

The preceding temporary-role login probe removed its test passwords and retired pooled backend sessions after checking the two dedicated roles. This was unsafe with a shared session pooler: cached reconnect attempts continued using the retired credentials. PostgreSQL logs show password authentication failures for the two test roles from the same Supavisor IP at 13:22:31.974 UTC and 13:24:16.579/580 UTC on 9 November. Supavisor then logged backend ECONNREFUSED from 13:24:19.895 UTC, including repeated 08006/circuit-breaker failures. The actual Hub SQL connection failed, and the DELL scoped service-auth/health request returned 503, despite both application's shallow health endpoints returning 200.

Read-only Supabase management checks showed the database itself running, 29 connections out of max60 and no database restart. The authenticated existing CST-DEV dashboard showed the pooler's address `2406:da1c:f42:ae01:fcb0:4890:94c9:16e8` in Network bans. An exact-IP unban dialog was opened. Before confirmation could execute, the ban disappeared and the dialog referred to null; the confirmation script correctly refused to act. The stale dialog was canceled. **No successful manual unban is claimed.** No network allowlist or SSL setting was altered.

At 13:53:58 UTC an independent connection from the Hub runtime succeeded again. DELL heartbeat/lease became valid again; a later scoped registry request returned HTTP200 and the DELL worker was eligible/healthy. This is strong evidence of a temporary pooler-IP ban following the diagnostic cleanup, not a missing application password or need for another Supabase project.

## Prevention delivered by this change

`scripts/dev/gpt02-cst-dev-bounded-login-smoke.mjs` is retired. It now exits2 with `LIVE_CREDENTIAL_ROTATION_SMOKE_RETIRED` and contains no database client, network call, credential rotation, grants or backend termination. The previous enable flag cannot reactivate it. Three regression tests execute that refusal and check that only the network-isolated SCRAM fixture is offered as a test replacement. Do not re-run earlier historical versions of the live diagnostic.

This change does not rotate any persistent credentials or change the runtime application connection. The existing locked evidence roles/schema are not activated. No new diagnostic framework is added.

## Actual new task prepared through the existing authenticated application

The existing browser session returned `/api/auth/me` HTTP200 with role super_admin and active=true. The session token was used only inside its own DEV origin and was never printed or fabricated. The active runtime's existing silent INTERNAL-E2E mode was verified before creating the task.

After an exact-title reconciliation showed no existing duplicate, the normal `POST /api/ai-tasks?companyId=default` API returned HTTP201:

- Task ID **136**; task number **WA-2611-4633**.
- Title: `[INTERNAL-E2E] GPT02 DELL - uji teks 20261109`.
- Status `new_inquiry`; category `internal_test` (not automatic ai_chat continuation).
- Expected future response: `GPT02_DEV_TEXT_OK_20261109`.
- Text-only scope, no tools, no file or business-data writes, no PROD, no Task135 replay.
- Explicit administrative note distinguishes preparation consent from command approval.

The reserved INTERNAL-E2E prefix follows the existing notification-suppression path; no WhatsApp send was requested. An independent SQL readback confirms exactly this task and **zero execution rows**. No POST to any execution, dispatch, continue, grant, result or ACK endpoint was performed.

## Native browser preparation and actual remaining task-specific condition

Local worker preclaim returned `CAPTURE_GATE_CLEAR`; its safety guard was NOT changed. Both central and local allowlists pointed to the same GPT02 DELL conversation. The currently open conversation was different, so a separate background tab was opened for the already configured target without closing or navigating the user's existing tab. No message was typed or sent.

The bound tab initially displayed `Could not load this ChatGPT conversation`. One ordinary Try again click was performed; its subsequent conversation requests returned HTTP200 and the expected composer became visible and empty. The scoped Core registry subsequently reported DELL eligible/healthy.

Task136 has no assigned member yet. The logged-in Super Admin account was checked against active same-company team members by exact normalized email; **zero matches** were found. Do not guess a PIC from a display name or forge a team member/approval to make a gate appear green. No PIC assignment or command-specific Super Admin approval was manufactured.

**Outcome:** connectivity restored, dangerous diagnostic retired, exactly one real DEV text-test draft now exists. Task136 has no execution/command/ACK and is not PASS. Its outstanding admission condition is a genuine active PIC assignment and task-specific approval, not another shared-database isolation project. Existing runtime images, Task135 and PROD were not changed.
