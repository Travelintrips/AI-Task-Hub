# GPT02 independent native reader preflight — DEV-only, no dispatch

The CLI reads two pinned local Unix-socket GET /health endpoints:
- /run/gpt02-reader/reader.sock (Hub/Core separate reader identities)
- /run/gpt02-issuer-reader/reader.sock (dedicated issuer evidence read-only identity)

It also reads four role-specific signer readiness.json boolean fields under
/run/gpt02-issue159-signer-*. The files are never printed raw. The CLI never
accesses a private key or credential. Sockets are fixed; no HTTP remote, SQL DML,
approval endpoints or POST requests are possible. There is no retry.

Live issuer health takes 3.7-7.0 seconds on 2026-11-12 UTC, so the request has
a bounded 15-second timeout and a 4096-byte cap. Missing or mismatched proof
is NOT treated as healthy. Every outcome has releaseDecision=NO_GO,
signingPermitted=false, authorizationGranted=false and dispatchPermitted=false,
even if all readers are healthy.

Run on authorized DEV VPS:
NODE_ENV=development APP_ENV=development node scripts/dev/gpt02-native-readonly-health-preflight.mjs 149

Unit tests cover wrong target/task, wrong reader identity, forgery, signer changes
and unavailable sources. This source-only check does not supersede operator
approval, fresh task/command/attempt binding, nonce consumption, issuance of
a lease, attestation or final ACK. Do not add it to a live worker or use
service health as a grant to sign.
