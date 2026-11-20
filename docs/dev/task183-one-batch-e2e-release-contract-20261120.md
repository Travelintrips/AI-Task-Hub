# Task #183 — One integrated CST-DEV release and acceptance contract

**Owner request:** assemble everything required first, then run ONE end-to-end test. No repeated isolated test ceremonies, no rebuilding previously PASS features, and no PROD changes.

**Scope:** Task `183` / `WA-2611-7669`, company `default`, in `Travelintrips/AI-Task-Hub` Draft PR #209 stacked on Draft PR #196. Preparation only, **never** signer/issuer/command dispatch.

## 1. Baseline already independently verified (do not redo)
- Hosted CST-DEV `xssrfshdrtdfupgqwfdw`: Task #183 is `manual`, `new_inquiry`.
- PIC ID **5** is active and matches the task assignment.
- Audit `gpt02_pic_assigned` ID **2636** matches Task ID, company, PIC, verified Super Admin actor identity and contains no operator approval or dispatch.
- Hub `ai_execution_jobs` for Task #183 = **0**. Instruction length is 437 characters; do not print its content into logs.
- Existing Google Super Admin session gating, preparation admission, atomic SQL wrapper, reservation review and UI route are already coded and have prior synthetic CI evidence. Do not replace any existing PASS functionality.
- Historical Core signing/issuer/dispatch remain OFF. Task #171 remains untouched.

## 2. Entire deliverable in ONE DEV-only batch

| Layer | Existing / required | Integrated acceptance |
|---|---|---|
| Browser authorization | Existing Google Super Admin + same origin + explicit `prepare-only` route | One fresh Google verification when needed; no second admin, new password, or TOTP |
| Task admission | Existing real task/PIC/audit/zero-execution checks | Task183, PIC5, audit2636, company default and exact stored instruction all agree |
| API-to-DB runtime bridge | **New opt-in `dev-one-shot-mount`** in existing `createCoreTaskPreparer` factory | Blue/green DEV-only container, nonroot UID, fixed read-only file mount, UID-owned dir 0500/files 0400, no symlinks/hardlinks; strict CA/host/role pinning; no inline DSN |
| Dedicated database principal | Existing dormant role `gpt02_core_prep_login` (NOLOGIN when idle) | Separately authorized temporary SCRAM credential, login TTL no more than 3 minutes, connection limit 1; no privileged role or unrestricted DML |
| Preparation transaction | Existing `gpt02_stage.prepare_core_task` SECURITY DEFINER wrapper | One atomic Core PENDING + Hub `prepared` reservation and audit; idempotent, zero dispatched commands |
| Immediate closure | Database-admin relock protocol and connection disposal | Restore NOLOGIN/connlimit0/verifier NULL, terminate remaining sessions, remove bind mount and verify zero sessions; fail closed on errors |
| Final proof | One **single** E2E evidence set (below) | Mark **PASS only when all conditions simultaneously hold** |

### No mandatory watchdog
The Task183 relock `systemd` service/timer are optional **and remain inactive**. They are not a prerequisite to finish Task183 when a supervised one-time, independently verifiable relock procedure is present. Merely expiring a password **does not terminate an existing PostgreSQL session**. If termination/readback is unavailable, the final verdict is NO-GO.

### One-time mount security contract
The alternate `dev-one-shot-mount` is **OFF by default**, cannot be selected in PROD, and never falls back to a generic Hub credential. The precise container path is `/run/gpt02-preparer-one-shot`; it must be an explicit **read-only bind mount**, not an image layer, writable Docker volume, environment variable, or secret printed in chat. On the container, directory mode must be 0500 and each root-independent UID-owned file `preparer-dsn` and `supabase-root-ca.crt` mode 0400. Mount is absent outside the short-lived DEV test. All database connections are pinned-TLS and limited to the scoped role.

## 3. Perform ONE final DEV E2E only after the bundle is complete

1. **Preflight (read-only):** Confirm exact GitHub source/CI, DEV health, authentic Google session, Task183/PIC/audit, no previous execution, role initially locked, and a rollback operator immediately available.
2. **Open the short window:** The authorized database administrator provisions *only* the isolated preparer machine login through an approved secure workflow. Verify no privilege drift; do not bypass tool safety restrictions or send secrets through chat.
3. **One authentic UI action:** Use the existing Super Admin Task183 page and its `prepare-only` button once. Server authenticates actor and validates persisted data. If a gate fails, **do not reissue** the POST without reconciling DB state.
4. **Readback using independent read-only evidence:** Exactly one new Core task in `PENDING`, exactly one matching Hub execution `prepared`, valid linked UUIDs, expected audit, no duplicate attempts or command issued; issuer grant, signer approval, lease, and dispatch remain false.
5. **Close and prove:** Always NOLOGIN + connlimit0 + verifier NULL + terminate all sessions, remove one-time credential mount and destroy candidate DB client, read back 0 sessions, and verify original DEV/PROD health.
6. **One verdict:** PASS if ALL conditions above are proven; otherwise NO-GO with the one exact unmet gate and rollback proof. No partial or synthetic PASS called an end-to-end PASS.

## 4. What cannot responsibly be prebuilt or falsely reported PASS

The final human Google session and authorized hosted machine credential provisioning are real operational dependencies. They cannot be simulated to claim success, nor can secret provisioning blocked by a security check be rerouted to bypass the restriction. As long as the hosted preparer is NOLOGIN, a genuine hosted Core Preparation is **not completed**.

**Delivery discipline:** Code and docs are prepared as one PR batch, existing synthetic CI is executed once after the batch, and the owner is asked for human interaction only at the final operational test if required. Do not touch production or merge Draft PR #209 until end-to-end criteria pass.
