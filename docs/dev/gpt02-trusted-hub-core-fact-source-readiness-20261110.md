# GPT02 CST-DEV — audit sumber fakta Hub/Core dari katalog nyata

**Tujuan terbatas:** mempersiapkan pembaca fakta tepercaya untuk `readTrustedFacts` pada `gpt02-prepared-nonce-consumer.mjs`. Ini **bukan** hasil approval, bukan pembacaan dua sesi dedicated, bukan penerbitan nonce maupun izin worker. Task #135/#136 tidak diulang. PROD tidak diubah.

## Hasil katalog CST-DEV 10 November 2026, 16:17 UTC

Pemeriksaan SELECT aktual dengan akun admin baca katalog `postgres` terhadap project `xssrfshdrtdfupgqwfdw`:

- **20/20 kolom dasar Hub/Core cocok** pada `gpt02_stage.core_preparations`, `public.ai_tasks`, `public.ai_execution_jobs`, `public.team_members`, `public.users`, `public.audit_logs`, `ai_platform.ai_coding_tasks`, `ai_platform.ai_coding_runs`, `ai_platform.ai_coding_bridge_commands`, dan `ai_platform.internal_users`.
- Dua role pembaca yang diusulkan untuk pemisahan sumber (`gpt02_hub_evidence_reader`, `gpt02_core_evidence_reader`) **belum tersedia**. Ini nama kandidat, bukan role yang telah diotorisasi.
- `gpt02_stage.core_preparations` belum menyimpan `worker_id`, `accountable_owner_id`, atau `core_operator_user_id` sebagai kolom terpisah. Ketiganya **tidak boleh dianggap benar hanya karena tercantum di klaim bertanda tangan atau metadata pemanggil**. Prosedur lain yang bersifat immutable dan independently verified boleh diusulkan sebagai alternatif, tetapi belum dibuktikan.
- `core_preparations` berisi **0** baris. Tidak ada pasangan Hub/Core baru yang boleh diberi grant, dan login issuer/attestor tetap NOLOGIN. Trust store empat signer asli juga belum terprovisioning.

**Penting:** SELECT untuk audit di atas dilakukan melalui koneksi admin biasa dengan `transaction_read_only='off'`. Query-nya sendiri hanya SELECT, tanpa mutasi. Output itu **tidak** membuktikan sesi pembaca khusus atau transaksi READ ONLY. Jangan mengganti atribut tersebut menjadi TRUE secara manual atau menganggap admin postgres sebagai pembaca terisolasi.

## Kandidat pengaman source

`scripts/dev/gpt02-trusted-fact-reader-readiness.mjs` memiliki satu query katalog yang memeriksa tipe 20 kolom, keberadaan dua role pembaca, tiga field ikatan, dan jumlah persiapan. `auditTrustedFactReaderReadiness` yang dipanggil dengan *client independen* akan menjalankan `BEGIN READ ONLY`, membatasi statement timeout, membaca katalog, dan `ROLLBACK`. Jika sesi tidak benar-benar read-only, evaluasi gagal tertutup.

**Semua hasil**, termasuk mock dengan 20 kolom lengkap, dua role dan tiga field tersedia, tetap `releaseDecision='NO_GO'`, `independentlyAuthenticatedReads=false`, `originalSignerProven=false`, `dispatchPermitted=false`. Audit katalog sendiri tidak mengikat task nyata maupun otorisasi Super Admin.

## Gate berikutnya yang benar

1. Review skema fakta permanen worker, penanggung jawab, operator Core dan pengaitannya dengan PIC/audit — tidak menerima asal dari parameter request atau metadata yang dapat diganti.
2. Design serta uji dua sesi pembaca PostgreSQL restricted yang **berbeda**, dengan koneksi terautentikasi independen, proyek DEV yang dipatok, tanpa `BYPASSRLS`, membership atau DML; jangan menggunakan koneksi bersama postgres untuk mengklaim independensi.
3. Setelah itu baru siapkan `readTrustedFacts` yang mengambil persis satu baris per identitas dan membuktikan immutable Hub job/Core task/attempt, status operator, worker, owner, tenant, serta expiry, tanpa fallback dan tanpa perintah.
4. Jalankan uji negatif termasuk reader role palsu, sesi yang sama, lintas tenant, worker/owner berubah, data task usang, dan dua worker simultan. Semua harus NO-GO bila tidak ada lease/perintah-spesifik yang sah.

Tidak ada persetujuan Super Admin bertanda tangan untuk task baru dan tidak ada lease issuer operasional saat audit ini. Issue #159 tetap OPEN, PR #161 tetap draft, full managed GPT02 lifecycle **NO-GO**.

## Koreksi audit 10 Nov 2026 — sumber ikatan sudah ada pada operator-link

Pemeriksaan yang sebelumnya hanya mencari kolom `worker_id`, `accountable_owner_id`, dan `core_operator_user_id` di `gpt02_stage.core_preparations` **tidak tepat untuk desain yang terpasang**. Tabel persiapan memang tidak mempunyai tiga kolom tersebut, tetapi tabel yang sudah ada, `gpt02_private.operator_links`, menyimpan `accountable_owner_id`, `core_operator_user_id`, dan `claims` yang mencakup `workerId`. Tabel ini mempunyai signed Hub/Core claims, digest, hubungan ke approval dan pre-dispatch Hub/Core IDs, unique constraints, RLS yang dipaksa serta immutable trigger. **Jangan menambah kolom duplikat ke core_preparations.**

Source readiness sekarang memeriksa **enam kolom sidecar** (`accountable_owner_id`, `core_operator_user_id`, `claims`, `hub_signature`, `core_signature`, `link_digest`) yang terbukti ada di hosted CST-DEV. Secara operasional **signed operator_links rows=0**, sehingga belum ada satu pun binding nyata untuk task baru. Audit katalog tidak membuktikan penandatangan, nonce yang telah dikonsumsi atau worker grant.

### Kandidat pembaca dua sesi PostgreSQL terbatas

`artifacts/api-server/src/lib/gpt02-trusted-facts-readonly.mjs` menyediakan kandidat baca-saja dengan dua **login berbeda dan sesi berbeda**: `gpt02_hub_evidence_reader` dan `gpt02_core_evidence_reader`. Kedua sesi wajib `BEGIN READ ONLY`, pemeriksaan `current_user=session_user` tepat, tanpa superuser/CREATEROLE/CREATEDB/BYPASSRLS/replication/inherit, tanpa membership, tanpa global read/write atau CREATE database. Dua query parameterized SELECT mengambil satu persiapan Hub (task, PIC aktif, audit, Hub job dalam status prepared, dan sidecar signed operator_link yang sudah disimpan) dan satu Core task/operator (status pending, akun aktif, tidak ada run/command). Modul menolak hasil nol/duplikat, role palsu, worker/owner tidak cocok, isi signed sidecar diganti, task expired, atau PIC sudah nonaktif. Semua sesi diakhiri `ROLLBACK` dan `release(true)`; tidak ada import rute HTTP atau worker.

**Uji sumber terisolasi:** 34/34 kasus PASS. Kedua SELECT diuji dengan `EXPLAIN` pada katalog CST-DEV asli tanpa menjalankan query untuk mengambil data bisnis, dan keduanya berhasil dikompilasi oleh PostgreSQL. Ini **belum** bukti login independen karena role pembaca belum terprovisikan.

### Pembatasan pembuatan role oleh PostgreSQL

Uji offline menemukan bahwa `CREATEROLE` non-superuser pada PostgreSQL 16 otomatis mendapat membership ADMIN pada role yang baru dibuat. Dokumentasi PostgreSQL 16/17 menyatakan pemberi grant otomatis adalah bootstrap superuser; pembuat non-superuser **tidak dapat mencabut grant tersebut sendiri**. Demi syarat tanpa membership, kandidat `gpt02-two-inert-evidence-readers.sql` beserta tesnya **dicabut dari PR dan tidak pernah diterapkan di hosted DEV**. Dua role pembaca masih belum ada. Jangan memakai migrator aplikasi `postgres` untuk mencoba pembuatan ulang. Diperlukan provisioning oleh DBA/Supabase administrator dengan hak yang tepat, serta read-back dari `pg_auth_members` sebelum koneksi atau izin SELECT disetujui.

Saat ini jalur pembaca dan signer tetap belum aktif; `post_consumption_fences` inert telah terpasang terpisah, sedangkan approvals, nonce, preparations, operator_links, dan Task>136 tetap 0. **Full lifecycle NO-GO**, Task135/136 tidak diulang, dan PROD/DELL tidak diubah.

## Penguatan terakhir: audit PIC dan integritas instruksi (10 Nov 2026)

Pembaca kini memeriksa ulang *audit penugasan terakhir* dengan `action='gpt02_pic_assigned'`, `entity_id`, identitas aktor Super Admin aktif, akun global yang valid, email aktor dan PIC yang benar. Pemeriksaan tersebut mengikuti validasi pada `prepare_core_task_dormant`: perubahan audit PIC, identitas pemilik tugas, atau status akun setelah persiapan akan ditolak.

Status pra-dispatch Hub juga diperiksa ulang secara lengkap: `source='AI_TASK'`, ID eksternal dan kunci idempotensi tepat, tepat satu Hub execution, `progress=0`, callback/attestation/final ACK masih false, `command_id` dan worker belum ada, metadata mode DEV dan penolakan auto-continue/PROD tepat. Core task harus berada di proyek, repository dan branch yang benar, status PENDING dan 0 run/command.

`gpt02_stage.core_preparations.config_sha256` sekarang dicocokkan dengan SHA-256 konfigurasi asli yang dibentuk oleh PostgreSQL dari company, task, PIC, nomor audit, operator Super Admin, proyek, repository, branch dan instruksi, dengan pemisah ASCII Unit Separator (31). Uji silang antara PostgreSQL `extensions.digest` dan Node `crypto.createHash` **cocok**. Dua SQL baru terbukti valid menggunakan `EXPLAIN` hosted CST-DEV tanpa menjalankan bisnis data. Uji terisolasi **57/57 PASS** untuk modul pembaca, termasuk upaya mengubah instruksi Hub+Core secara bersamaan dan audit Super Admin.

**Batasan:** sampai ada dua login reader independen, empat signer publik resmi dan persetujuan task-spesifik, tidak ada jalur pengiriman. Ini masih pemeriksaan sumber kandidat saja, bukan native login/lease PASS. User tidak perlu mengulang Task135/136. PR #161 tetap draft.
