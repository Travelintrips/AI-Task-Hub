# Task136 PIC: Google principal / legacy integer audit compatibility

The user answered “lanjut” to using the already logged-in Super Admin as PIC of the existing DEV text-test task136 (WA-2611-4633). No new task is authorized by this change, and no Task135 recovery or PROD change is included.

## Actual task preparation

The existing browser session was read through the normal DEV `/api/auth/me` endpoint. It returned an active Super Admin and the existing federated text subject. Task136 is the previously created INTERNAL-E2E text-only draft in company `default`, with no execution. The same authenticated name/email were used through the normal `/api/team` POST after checking for exact-email duplicates. Team member **5** was created; this is a team/PIC record, not a new login or privilege change.

The first normal `/api/ai-tasks/136/gpt02-assign-pic?companyId=default` request returned 503. The database catalog explains the mismatch: public.users.id is TEXT while public.audit_logs.user_id is INTEGER. Runtime logs contained “invalid input syntax for type integer”. The existing assignment/audit transaction rolled back rather than leaving an un-audited PIC.

## Narrow compatibility fix

`gpt02-pic-audit-actor.ts` serializes the verified server principal into `after.actorIdentity` with an explicit version, exact subject, normalized email and role. A numeric identity that fits the legacy INT column still uses that column. A Google/UUID/text identity is never cast, truncated or assigned a fictional numeric ID: legacy user_id remains null, while the actual identity is preserved in the existing audit JSON alongside server-written user_email/user_name.

The PIC audit reader and execution-admission check use one verifier. It rejects malformed/contradictory identities and email mismatches; malformed new metadata does not fall back to the old numeric field. Old numeric audits and their numeric public actorId response stay compatible. Identity values originate from req.user, never request-body actor metadata. Task company, active PIC, transaction fence, no-existing-execution rule and atomic audit checks remain in place. This proves PIC assignment, not command approval or native authorization.

No schema migration, auth-user change, password requirement, database role activation, live credential rotation or task retry is needed.

## Verification before deployment

Seven helper/integration-contract tests and 23 existing bridge/PIC regressions passed locally (30 total). A disposable no-network PostgreSQL test proved that a null legacy INT column plus the exact text identity persists successfully, and that a failed audit insert rolls the task update back. An offline copy of the candidate API returned health200 and denied both unauthenticated PIC endpoints with401. No real user tokens or live database connection were supplied to those isolated tests.

The deployed DEV runtime already includes PR156 and is not equivalent to the PR155 source branch. To avoid replacing unrelated features, `build-gpt02-pic-runtime-overlay.cjs` accepts only the exact baseline bundle SHA256 `dc4ccc9f018651b4894894f7f1f395232b8bb8e3d8bec6c70da864fd758656a3`, then alters only PIC assignment, PIC audit readback and its execution admission predicate, plus the same compiled helper. Other bundle bytes remain unchanged; the obsolete source-map reference is removed. This is a build-only tool and performs no deployment.

The candidate image layers that API bundle over the existing `ai-task-hub:dev-pr156-exact-lineage-fixed-20261109` image. Runtime deployment/readback is recorded separately after CI and the controlled cutover. The old image must remain available for rollback. No execution/command/result/ACK endpoint is part of this change.
