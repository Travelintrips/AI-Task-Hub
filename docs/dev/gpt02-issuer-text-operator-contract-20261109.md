# GPT02 DEV issuer integration: exact TEXT operator identity

## Concrete integration defect

Read-only inspection of the actual Hub DEV connection confirmed `public.users.id` is PostgreSQL TEXT, `company_id` is INTEGER, and an active Super Admin has a Google-prefixed TEXT ID. The candidate evidence client at PR155 `4733cca` accepted only a positive integer `superAdminId`, and its disposable PostgreSQL fixture stored a BIGINT `approver_id`. That candidate could not represent the observed Hub account identity. A team-member/PIC integer must not be substituted for a human operator account.

No user record, role grant, password, or application DSN was changed by this work. Only schema types and aggregate account shape were read; no real account ID was placed in test fixtures.

## Versioned contract

The undeployed candidate now accepts envelope `v=2` with a signed `operatorNamespace="ai-task-hub.public.users"` and a strictly bounded, nonempty TEXT `superAdminId`. Both preview and transactional issuer use the same field order. The exact ID is retained; it is never cast, trimmed, lowercased, or reconstructed from the Google subject. Signed IDs `"007"` and `"7"` remain distinct. Numeric IDs, wrong namespaces, unknown fields, missing identity, malformed IDs, legacy v1, Task 135 and PROD claims fail closed.

The disposable fixture stores `operator_namespace` and TEXT `approver_id` and independently rejects wrong JSON types/namespaces before insertion. The attestor and issuer log in via separate real SCRAM connections, cannot assume each other's role or directly modify evidence, and expose only the existing narrowly granted routines. The original protections for signature pinning, exact claim matching, atomic uniqueness, rollback, expiry after lock wait, and immutable receipts remain intact.

## Observed isolated tests

The test runner uses two `--network none` containers and one private temporary Unix-socket volume, with newly generated fixture-only credentials. It receives no live database credentials. The existing local Node 24 image was used only as a Node/pg runtime via an entrypoint override; its app server is never started by the test.

The expanded issuer suite passed **26 behavioral scenarios** (Node reports **27 tests** including the parent). Five new scenarios cover canonical byte agreement, actual TEXT identity persistence/consumption, malformed identity denial before connection, equivalent denial by SQL, and exact distinction of similar TEXT IDs. The eight-request concurrency scenario still commits exactly one receipt. The expanded pure signed-preview suite passed **8/8**. Containers, socket volume and temporary authentication files were removed by the runner.

## Integration and limits

PR155 issuer work is integrated into the existing PR156 candidate without removing lineage, tenant/auth, RLS or Pino portability checks. This is not a new live approval service or issuer deployment. `authorizationGranted=false` and `dispatchPermitted=false` remain hardcoded; no route imports the candidate store. Private keys and approvers in these tests are synthetic, not the user's actual consent.

The historical integer-only `gpt02-approval-nonce-isolated.sql` is a separate old fixture, not the v2 store's schema or a migration. Likewise the current hosted Core binding/nonce tables still have their own operator-ID contract; this change does not migrate or silently coerce those tables. Real operator reauthentication, verified mapping into all downstream ledgers, consent bound to a new task, hosted role isolation, grant/lease/fencing, native final ACK and Hub completion remain unproven. No live cutover, real task creation, retry of Task 135, or PROD change is authorized by these tests.
