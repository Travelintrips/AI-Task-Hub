# AI Core DEV WhatsApp Job Status Monitor

Operational scope: **DEV only**. This is an independent, read-only monitor for the isolated
CST-DEV Supabase job ledger. It is NOT an AI Task scheduler/dispatcher or GPT02 worker.
It MUST NOT be used to override the AI Task PR156 candidate release decision `NO_GO`.

## Status as of 2026-11-13
- WhatsApp Gateway DEV worker `ai-core-dev-sender-01` paired and ONLINE.
- One direct self-message to the device ending 7596 was `sent`; user confirmed delivery.
- Current AI Task PR156 candidate is `NO_GO`, with legacy AI Task DEV stopped.
- The application's DEV Postgres pooler still returns SQLSTATE 08006 from VPS
  (session 5432 and transaction 6543), although CST-DEV is ACTIVE_HEALTHY.
- The monitor uses **only the official CST-DEV direct PostgreSQL IPv6 hostname**
  with strict TLS certificate and hostname verification (read-only query PASS).
- The public Supabase Root 2021 CA was installed only as this monitor's explicit
  trust anchor at "/etc/ssl/certs/cst-dev-supabase-root.crt" after its DER SHA-256
  fingerprint matched 807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa.
  It was not added to the system global CA store.
- Baseline initialized 347 existing job states, with **zero** historical messages
  replayed. The monitor's systemd service is active; a real new transition is
  still required before declaring end-to-end automated delivery PASS.

## Safeguards
- The script's database client uses `BEGIN TRANSACTION READ ONLY`; no SQL writes.
- It must see the exact DEV Supabase project reference in its DSN.
- It verifies the DEV WA Gateway Docker project, private Docker network,
  sender's actual linked number suffix `7596`, and scoped DEV API credential.
- It refuses to start sending if the GPT02 candidate is no longer `NO_GO`,
  the old AI Task app is running, or the candidate is connected to the WA
  network. It never invokes either AI Task or AI Core APIs.
- It initializes a no-replay baseline on its first successful ledger read.
  Historical notifications (including any for other phone numbers) are never imported.
- Only new rows or job status changes after the baseline are included.
- `completed` without callback, attestation and Final ACK verification is shown
  as `verifying`, never with the green completed check.
- At most 6 changed jobs per message, one message per minute, 40/day,
  120 changed job events/day. Backlog capacity is 120; outbox is root-only.
- The `Idempotency-Key` is stable across retry. HTTP queued does NOT mean delivered.
- It stores no WhatsApp credentials, DB passwords or full phone numbers in state
  or logs, and never automatically enables production resources.
- Root-only systemd service with limited memory, CPU and filesystem writes.

## Controls (VPS, root)
```sh
systemctl status ai-core-job-wa-dev-monitor.service --no-pager
journalctl -u ai-core-job-wa-dev-monitor.service -n 25 --no-pager
node /opt/ai-core-job-wa-dev-monitor/monitor.cjs --self-test
node /opt/ai-core-job-wa-dev-monitor/monitor.cjs --guard-only
node /opt/ai-core-job-wa-dev-monitor/monitor.cjs --verify
systemctl stop ai-core-job-wa-dev-monitor.service
systemctl start ai-core-job-wa-dev-monitor.service
```

`--verify` checks the current database read and WhatsApp status without
enqueuing messages. `--self-test` exercises safe status rendering without
touching external services. `--guard-only` verifies routing and NO_GO safety.

The initial verified database read has initialized
`/var/lib/ai-core-job-wa-dev-monitor/state.json` with 347 observed jobs and sent NO messages.
Subsequent authentic job changes can produce a WhatsApp digest. Never delete
the state file while notifications are active; this is an outbox and
idempotency marker.

## Restoring the Supabase connection
1. The pooler SQLSTATE 08006 remains unresolved. It is NOT used by this monitor.
   Use the CST-DEV project's Pooler Logs when investigating it; never change PROD.
2. The monitor derives the official direct IPv6 URL from the validated CST-DEV
   pooler credentials, uses the direct-login role, and requires the exact pinned
   Supabase Root 2021 CA. TLS verification cannot be disabled.
3. Recheck `--verify` to ensure read-only PostgreSQL access and WA worker online.
   State is rooted at `/var/lib/ai-core-job-wa-dev-monitor/state.json` (mode 600).
4. Do not rerun `--prime` except for a deliberate audit/reset with the service stopped:
   that would redefine the no-replay baseline.
5. Do not declare end-to-end automated notification PASS until a real new
   DEV ledger transition has been observed and its WA message received.

Avoid rebuilding or starting the legacy AI Task DEV or connecting the
PR156 `NO_GO` candidate to WA Gateway merely to enable this monitor.
