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
- membership 0
- active session 0
- no global read/write
- hanya SELECT kolom minimum + RLS policy yang sudah diverifikasi

### Input yang harus disediakan oleh operator keamanan/DBA

Dua credential **berbeda**, masing-masing untuk role yang tepat, melalui kanal secret manager / credential mount yang dikelola operator. Jangan kirim password melalui Git, issue, chat, SQL migration, atau environment file yang masuk repository.

Runtime nanti hanya boleh menerima dua DSN:
- `GPT02_HUB_READER_DATABASE_URL_DEV`
- `GPT02_CORE_READER_DATABASE_URL_DEV`

Keduanya wajib menunjuk ke:
- project ref `xssrfshdrtdfupgqwfdw`
- host `aws-1-ap-southeast-2.pooler.supabase.com`
- port `5432`
- database `postgres`
- username sesuai role masing-masing + project suffix
- tanpa query string / fragment
- TLS certificate verification aktif

### Bukti native yang wajib PASS

Jalankan `scripts/dev/gpt02-two-reader-native-readonly.mjs` dari deployment DEV dengan kedua credential tersedia.

PASS hanya jika:
- dua login native berhasil;
- current_user = session_user tepat untuk masing-masing role;
- transaction_read_only=on;
- dua pg_backend_pid berbeda;
- pg_stat_ssl.ssl=true;
- connection limit bounded;
- membership 0;
- no global read/write;
- no database CREATE.

Bahkan pada PASS, output harus tetap:
- `dispatchPermitted=false`
- `issuerLeaseGranted=false`
- `taskCreated=false`
- `commandCreated=false`
- `releaseDecision=NO_GO`

Setelah pembuktian, credential dapat kembali di-lock sampai tahap wiring yang secara terpisah disetujui.

## B. Empat public trust-root signer

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
