# GPT02 DEV — operator handoff untuk dua reader + empat trust-root

Dokumen ini hanya menjelaskan **input eksternal yang wajib tersedia** sebelum Issue #159 dapat bergerak dari source/CI PASS ke native operational proof. Tidak ada secret, private key, credential, task, nonce, issuer activation, DELL dispatch, atau PROD change di dokumen ini.

## A. Dua reader PostgreSQL native

Role hosted yang sudah ada dan tetap locked:

- `gpt02_hub_evidence_reader`
- `gpt02_core_evidence_reader`

Kondisi baseline yang wajib dipertahankan sebelum provisioning:
- NOLOGIN
- connection limit 0
- NOINHERIT
- non-superuser
- no CREATEROLE / CREATEDB / BYPASSRLS / replication
- outbound membership 0
- exact management member: hanya `postgres`, `ADMIN=true`, `INHERIT=false`, `SET=false`, grantor `supabase_admin`
- active session 0
- no global read/write
- no database CREATE dan no schema CREATE
- owned database objects: 0
- no predefined admin roles: `pg_read_server_files`, `pg_write_server_files`, `pg_execute_server_program`, `pg_signal_backend`, `pg_monitor`, `pg_checkpoint`
- hanya SELECT kolom minimum + RLS policy yang sudah diverifikasi
- exact column grants: 86/86, no drift, termasuk regular/partitioned/foreign/view/materialized view
- mutating relation privilege: 0 untuk INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN
- exact schema USAGE: 5/5, no drift
- sequence USAGE/SELECT/UPDATE: 0
- foreign-server USAGE: 0
- foreign-table SELECT: 0
- view/materialized-view SELECT: 0
- effective RLS: tepat 12 policy, 0 policy PUBLIC, fingerprint `77029cdaf9f9079cce23260e703090bc904c515c91bb9708309fd2e84af99338`
- default ACL leak ke reader langsung atau PUBLIC pada schema accessible: 0
- callable non-trigger routine tepat satu: `public.assert_portal_profile_complete(p_customer_id integer)`, SECURITY INVOKER, owner `postgres`
- callable routine inventory fingerprint: `41044abceb9e079b0940fbcb5d0e16caea327b261feddec274044d06b4f9bbba`
- callable routine source SHA-256: `046a0d067d2b632d0e17af5c6f433bea63794d90c67c55a6475e6fe6b34916c8`
- callable mutating routine: 0
- callable SECURITY DEFINER routine: 0
- role defaults: default_transaction_read_only=on, search_path=pg_catalog, statement_timeout=5s, lock_timeout=1s, idle_in_transaction_session_timeout=10s

### Input yang harus disediakan oleh operator keamanan/DBA

Dua credential **berbeda**, masing-masing untuk role yang tepat, melalui kanal secret manager / credential mount yang dikelola operator. Jangan kirim password melalui Git, issue, chat, SQL migration, atau environment file yang masuk repository.

### Kanal secret DEV yang sudah resmi dipakai deployment

Audit host membuktikan deployment DEV saat ini memakai jalur berikut:

- `/etc/ai-task/compose.development.env` memilih `APP_ENV_FILE=/etc/ai-task/development.env`;
- `deploy/hostinger/docker-compose.yml` memuat `env_file: ${APP_ENV_FILE}`;
- `deploy/hostinger/deploy.sh development` memakai `/etc/ai-task/compose.development.env`;
- `/etc/ai-task/development.env` saat audit adalah `root:root` mode `0600` dan berada di luar repository.

Karena itu, **kanal credential reader resmi yang sudah ada adalah `/etc/ai-task/development.env`**, bukan membuat file secret ad-hoc baru. Tambahkan hanya melalui proses operator/root yang menjaga owner/mode tersebut. Nilai credential tidak boleh dipindahkan ke `compose.development.env`, GitHub, issue, chat, migration SQL, log, atau dokumentasi.

Runtime nanti hanya boleh menerima:
- `GPT02_HUB_READER_DATABASE_URL_DEV`
- `GPT02_CORE_READER_DATABASE_URL_DEV`
- `GPT02_READER_DEV_CA` — tepat satu PEM CA publik Supabase yang fingerprint SHA-256-nya harus `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`. Bundle ganda, CA lain, atau `NODE_TLS_REJECT_UNAUTHORIZED=0` harus ditolak.

Keduanya wajib menunjuk ke:
- project ref `xssrfshdrtdfupgqwfdw`
- host `aws-1-ap-southeast-2.pooler.supabase.com`
- port `5432`
- database `postgres`
- username sesuai role masing-masing + project suffix
- tanpa query string / fragment
- TLS certificate verification aktif dengan CA fingerprint yang dipatok

### Bukti native yang wajib PASS

Jalankan `scripts/dev/gpt02-two-reader-native-readonly.mjs` dari deployment DEV dengan kedua credential tersedia.

PASS hanya jika:
- dua login native berhasil;
- current_user = session_user tepat untuk masing-masing role;
- transaction_read_only=on;
- dua pg_backend_pid berbeda;
- client Node TLSSocket ke Supabase pooler harus `encrypted=true` dan `authorized=true` dengan CA pinned; `pg_stat_ssl` pada backend di belakang session pooler hanya informational dan bukan authority TLS;
- connection limit bounded;
- outbound membership 0 dan exact management member tetap sesuai baseline;
- no global read/write;
- no database/schema CREATE;
- no owned object;
- no predefined admin role;
- no sequence privilege;
- no foreign server/table access;
- no view/materialized-view SELECT;
- no mutating relation privilege;
- effective RLS fingerprint tetap tepat;
- default ACL direct/PUBLIC tetap 0;
- exact callable routine identity + source hash tetap cocok;
- no callable mutating/SECURITY DEFINER routine;
- kelima role defaults di atas tetap aktif.

### Bukti native aktual 11 Nov 2026

One-shot proof sudah dijalankan nyata dengan credential ephemeral yang dibuat lokal dan tidak disimpan:
- Hub authenticated: true
- Core authenticated: true
- dua backend PID berbeda: true
- semua privilege gate: true
- client-to-pooler TLS pinned/authorized: true
- `reason=TWO_NATIVE_READERS_PASS_NO_AUTHORITY`
- `dispatchPermitted=false`
- `issuerLeaseGranted=false`
- `releaseDecision=NO_GO`

Setelah proof, kedua role langsung dikembalikan ke `NOLOGIN` / connection limit 0, semua backend reader diterminasi, active session 0/0, file secret temporary 0, dan credential proof tidak ditulis ke `/etc/ai-task/development.env`.

Bahkan pada PASS, output harus tetap:
- `dispatchPermitted=false`
- `issuerLeaseGranted=false`
- `taskCreated=false`
- `commandCreated=false`
- `releaseDecision=NO_GO`

Setelah pembuktian, credential dapat kembali di-lock sampai tahap wiring yang secara terpisah disetujui.

## B. Empat public trust-root signer

### Hasil audit provenance signer existing

Source/runtime existing **tidak boleh dipromosikan otomatis** menjadi empat trust-root hanya karena memakai Ed25519:

- `/opt/ai-coding-standalone-dev/approval_api.py` memverifikasi identitas admin/Super Admin (Supabase AAL2) dan menyimpan audit keputusan, tetapi **tidak menandatangani approval dengan Ed25519**. Ini sumber identity/audit yang berguna, bukan approval trust-root signer dalam bentuk sekarang.
- Core-AI `devSopCheckpointIssuer.ts` menandatangani domain `ai-core-dev-checkpoint/v1` memakai `AI_CORE_DEV_CHECKPOINT_PRIVATE_KEY_PKCS8_DER_B64`. Domainnya adalah checkpoint receipt dan **bukan** issuer evidence Issue #159.
- `dev-chatgpt-wake-once.py` dan `register-dev-chatgpt-session.py` memakai Ed25519 untuk domain assistant-attestation / session-registration. Keduanya **bukan** approval, Hub operator, Core operator, atau issuer evidence.
- `dev_gpt02_recovery_fence.py` secara eksplisit menyatakan pinned server issuer key diperlukan tetapi **issuer/key provisioning/transport belum diimplementasikan**.
- `gpt02NativeRecoveryFenceProofContract.ts` juga menyatakan bahwa signer server berikutnya masih harus dibuat setelah verifikasi lease/lineage/authorization.

Dengan demikian, empat signer Issue #159 masih memerlukan **provenance dan custody terpisah**. Existing checkpoint/wake/session keys tidak boleh direuse untuk mengisi manifest empat trust-root.

Diperlukan **empat public key Ed25519 SPKI** yang benar-benar berasal dari signer independen:

1. Super Admin approval → `approval-public.pem`
2. Hub operator identity → `hub-identity-public.pem`
3. Core operator identity → `core-identity-public.pem`
4. Issuer evidence → `issuer-public.pem`

Private key **tidak boleh** berada pada Hub runtime, repo, database, issue, atau chat.

### Manifest out-of-band

Operator keamanan membuat manifest root-owned:

`/etc/gpt02-dev/trust-fingerprints.json`

dengan tepat empat fingerprint SHA-256 SPKI DER:
- approval
- hub
- core
- issuer

Keempat fingerprint harus berbeda dan berasal dari review independen terhadap public key signer yang benar.

Public key runtime dimount ke:

`/run/credentials/gpt02-dev/`

Permission/ownership wajib mengikuti kontrak `gpt02-dev-trust-store.mjs`.

### Bukti trust-root yang wajib PASS

Jalankan:

`NODE_ENV=development APP_ENV=development node scripts/dev/gpt02-four-signer-trust-readiness.mjs`

PASS hanya jika:
- manifest fixed root-owned valid;
- empat public PEM valid Ed25519;
- fingerprint masing-masing cocok manifest;
- empat fingerprint berbeda;
- tidak ada private key;
- file/dir ownership dan mode aman.

Hasil PASS tetap:
- `issuerLeaseGranted=false`
- `dispatchPermitted=false`
- `releaseDecision=NO_GO`

## C. Yang tetap dilarang sebelum kedua bagian PASS

Jangan:
- membuka issuer/attestor;
- membuat task baru untuk memaksa lifecycle hijau;
- mengulang Task135/136;
- membuat synthetic signer menjadi signer resmi;
- memakai `AI_CORE_DEV_CHECKPOINT_PUBLIC_KEY_DER_B64` sebagai salah satu empat trust-root;
- mount private key ke aplikasi;
- merge/deploy PR #161 untuk lifecycle operasional;
- menyentuh PROD atau DELL.

Setelah A dan B PASS dengan bukti native, barulah wiring `createGpt02ReaderPools -> createGpt02TrustedFactReader -> createPreparedNonceConsumer` dapat direview sebagai tahap berikutnya. Itu masih belum sama dengan izin dispatch.


## Addendum 11 Nov 2026 — isolated long-lived reader sidecar (not API/worker mount)

The operator approved long-lived DEV-only Hub/Core reader runtime credentials, one connection per role, least-privilege SELECT/RLS only, no PROD. To prevent these passwords from being inherited by the shared AI Task application container, the deployment path is now a dedicated systemd sidecar rather than /etc/ai-task/development.env.

- Source entrypoint: scripts/dev/gpt02-reader-runtime.mjs
- Systemd unit: deploy/hostinger/gpt02-issue159-reader.service
- Credential files (encrypted at rest, root:root 0600):
  - /etc/credstore.encrypted/gpt02-hub-evidence-reader-dsn
  - /etc/credstore.encrypted/gpt02-core-evidence-reader-dsn
- The unit uses LoadCredentialEncrypted; plaintext DSNs exist only in systemd's per-service /run/credentials/ mount while the service runs. The process reads them into memory and never writes them to environment files, logs, the API container, Git, or database rows.
- Runtime identity is DynamicUser=yes, NoNewPrivileges=yes, CapabilityBoundingSet=, read-only system, private tmp/devices, no home, bounded memory/tasks, and AF_UNIX + outbound AF_INET/AF_INET6 only. It has no TCP listener; it exposes a root-only Unix socket at /run/gpt02-reader/reader.sock, mode 0600.
- GET /health verifies two separate TLS-authenticated restricted sessions inside read-only transactions. POST /trusted-facts accepts only the exact task-bound read query consumed by createGpt02TrustedFactReader. Invalid input fails closed. No dispatch, signing, task creation, command creation, nonce consumption, or lease grant exists in this service.
- This sidecar is not imported by live API routes/workers and is not a replacement for the later signer integration. The four signer services remain separate, private-networked, and unchanged.
- Credential encryption uses systemd host-key mode because this VPS reports no TPM2 support. This protects credential files from casual plaintext exposure but is not TPM-sealed and does not protect against root compromise of the host.

The sidecar must be enabled only after its source/test/unit checks pass and both dedicated DB roles are explicitly LOGIN, connection limit 1, NOINHERIT, no membership, no bypassrls/superuser, and exact SELECT/RLS posture. The shared application env file must not receive reader DSNs. If the sidecar is stopped for an extended period, lock both reader roles back to NOLOGIN/limit 0 and remove encrypted DSNs.


## Addendum 11 Nov 2026 — read-only signer access boundary

The Hub/Core reader remains a separate service. To allow the four isolated signer processes to request read-only facts without joining the database directly:
- A dedicated static group `gpt02-issue159-signers` is used only for the local reader socket.
- Reader runtime directory is owned by the DynamicUser with the static signer group as primary group, setgid mode 2750; socket is group mode 0660.
- The four signer template services receive only that supplementary group and a read-only bind mount of `/run/gpt02-reader`.
- Signer services retain `PrivateNetwork=yes` and `RestrictAddressFamilies=AF_UNIX`; no TCP/network path is opened.
- The reader endpoint still exposes only bounded `POST /trusted-facts` and health. Both responses keep signing and dispatch false.
- This grants read-only access to the prepared Hub/Core evidence reader, not signing authority. Issuer-ledger read remains a separate credential/read path and is not enabled by this change.
