# Task136: separate a verified delivered result from missing lifecycle records

## Scope and direct findings

Read-only audit of existing CST-DEV task136 / WA-2611-4633, execution `609603dc-b8db-4836-a868-65507820ce94`, command `1c13c0aa-2490-40d0-9d04-559bfde7743e`, completion response `67f139cf-3642-4855-90ec-d73d8c02895a`. No new execution, task, command, signature, nonce or approval is requested by this change. Task135 and PROD are not modified.

The live command is EXTERNAL_AGENT_WORK / chatgpt:wake, created by the authorized direct ChatGPT wake route. That route passes no coding-task identifier; the external dispatch service explicitly stores taskId null when absent. Therefore a missing Core coding task is expected for this direct route, not evidence that its completed native response failed. It does not satisfy the separate full-lifecycle requirement either.

The exact Hub execution/command correlation matches. Its native event and challenge match the stored attestation, bound worker/profile/conversation and response text. The completion's acknowledged_at remains 2026-11-09T15:57:10.594Z. However, an exact tenant/execution/command lookup finds zero rows in both `dev_gpt02_task_attempt_binding_claims` and `dev_gpt02_binding_attestation_nonces`. The native challenge is a distinct piece of evidence; it must not be substituted for a UUID approval nonce or presented as an earlier authorization. No historical backfill is performed.

## Small read-only correction

The existing GET `/ai-tasks/:id/gpt02-lineage` keeps all old fields, strict diagnostic reasons, tenant/Super-Admin checks and always-false authorization flags. `gpt02-lineage-gate.ts` is unchanged. An additive `executionOutcome` object now describes historical delivery independently:

- `verified` / `status=completed_verified` require completed Hub/Core states, all three persisted callback/attestation/final-ACK flags, a pinned direct GPT02 DELL context, exact tenant-derived external ID/correlation, exactly one COMPLETED response, and exactly one response matching event, challenge, worker, profile, conversation, binding and attested response text.
- `responseId` and `acknowledgedAt` are only emitted after those checks pass.
- `route=direct_chatgpt_command` identifies the known wake route; it does not waive Core task or nonce requirements.
- `evidenceSource=persisted_exact_native_receipt`, `signatureReverifiedByThisRead=false`, `grantsAuthority=false`, `readOnly=true`. This GET correlates previously verified evidence; it is not a new cryptographic attestation/signing service.
- Unknown, wrong-context, missing, duplicated or unfinished evidence reports `not_verified` and does not expose a claimed final receipt.

The existing task page displays **Hasil eksekusi** separately from **Pencatatan lifecycle — NO-GO**. It explains that the direct wake route does not create a Core coding task, preserves the original three blocker codes, and explicitly does not grant replay, continuation or business completion. Existing status `new_inquiry` is not changed just because the test execution completed.

## Verification

The exact proposed production SELECT was run in a READ ONLY transaction for task135 and task136. Task136 produced direct_wake_route=true, transport_context_matched=true, total completed responses1, exact responses1 and the exact final receipt/ACK. Task135 still has failed Hub/Core states, zero completed responses, unbound PIC and missing lifecycle evidence.

Nineteen new outcome/route/UI tests plus 23 existing bridge/PIC regressions pass locally (42 total). The old strict lineage gate remains unchanged. A disposable no-network PostgreSQL instance executes the exact SELECT extracted from source against nine synthetic cases: positive, wrong tenant, wrong event, altered signed challenge, wrong worker, absent ACK, wrong correlation, duplicate completion and unrelated-command response. No CST credentials enter the fixture. The initial fixture compiler had a JavaScript replacement-string quoting error; it was corrected to a function replacement and the final full fixture passed. This did not touch a live database.

An exact-baseline overlay builder accepts only the currently deployed API/UI/HTML hashes. It modifies the single read-only GET and its task-page labels, preserving the PIC fix and every dispatch/approval path. A new content-hashed UI filename avoids stale asset caching. The offline candidate serves health200, denies the unauthenticated lineage GET401, and references the new asset. Actual rollout and authenticated readback are recorded separately after successful CI.

## What remains open

This is not completion of full lifecycle provisioning. Creating Core task / immutable pre-dispatch binding / operator-bound nonce for future orchestration needs a reviewed write-path integration and real authorization. The current successful historical test must not be replayed or supplemented with invented approval records to remove its warnings. Existing evidence is retained as-is.
