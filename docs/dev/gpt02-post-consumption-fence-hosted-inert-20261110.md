# CST-DEV GPT02 — kandidat tabel fence inert setelah nonce

## Status dan batas otorisasi

Ini adalah *source-only migration candidate*, bukan perintah untuk langsung mengubah hosted CST-DEV, bukan persetujuan Super Admin per-task, dan bukan aktivasi issuer. Project tujuan khusus `xssrfshdrtdfupgqwfdw`, database `postgres`; **PROD tidak boleh disentuh**. Jangan menyalakan `dev_gpt02_issuer_evidence`, `dev_gpt02_attestor_evidence`, `gpt02_core_prep_login`, dan jangan menjalankan fungsi preparer/issuer.

Bukti autentikasi khusus preparer sudah PASS dan dirollback pada Issue #157. Issue #159 tetap OPEN untuk approval, nonce once-only, dan worker lease yang sungguhan. Pengujian nonce dan fence yang lama hanya dilakukan pada PostgreSQL sekali pakai; tidak menjadi otorisasi operasional.

## Perubahan yang diusulkan

`scripts/dev/gpt02-post-consumption-fence-hosted-inert.sql` mengadopsi definisi tabel **byte-identical** dari fixture `scripts/dev/gpt02-post-consumption-fence.fixture.sql`, tetapi sengaja **tidak** membawa fungsi `reserve_post_consumption_fence` dan **tidak** memberi `EXECUTE`.

Tabel `gpt02_private.post_consumption_fences` baru harus:
- Owned by `gpt02_store_owner`, `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`.
- Mempunyai foreign key untuk identity receipt, approval receipt dan operator link, unique claim per receipt, command, link, Hub execution dan attempt; immutable statement trigger mencegah `UPDATE/DELETE/TRUNCATE`.
- Menyimpan `dispatch_allowed=false`, `core_ledger_written=false`, `lease_epoch=1`, rentang expiry tidak lebih dari 15 detik. Field `lease_expires_at` adalah **batas bukti**, bukan lease izin eksekusi.
- Tetap **kosong**, tanpa direct SELECT/DML privilege untuk issuer, attestor, preparer, peran API, atau direct write shared `postgres`. Perlu dicatat `postgres` di hosted DEV memiliki `pg_read_all_data`: global read privilege ini ada sebelumnya dan bukan tambahan yang diberikan migrasi.

### Kondisi pra-migrasi yang dibuktikan secara ketat

Migrasi hanya mengizinkan `session_user=current_user=postgres` pada database `postgres`, migrator bukan superuser tetapi punya `CREATEROLE` dan `BYPASSRLS`; grant membership dua grantor harus tepat, tanpa opsi `SET`/inherit; semua lima role GPT02 harus NOLOGIN limit 0; empat tabel bukti yang ada harus FORCE RLS dengan owner tepat; batas `task_id>136` tervalidasi; `reject_mutation` security invoker tersedia; semua approval/nonce/Hub/Core persiapan kosong; tidak ada issuer, attestor, atau preparer operasional yang telah aktif.

Semua perubahan dijalankan **di dalam satu transaksi yang dimiliki migration runner**. `GRANT ... SET TRUE` pada self-grant `postgres` hanyalah untuk membuat tabel sebagai `gpt02_store_owner`; kemudian `RESET ROLE`, revoke `SET`, dan read-back persis kedua grantor sebelum COMMIT. Jika kondisi atau postcheck meleset, semuanya harus ROLLBACK. Tidak ada `BEGIN`/`COMMIT` dalam candidate agar migration runner yang mengatur transaksinya; **jangan menjalankannya sebagai berkas SQL autocommit**.

### Bukti pengujian

- `scripts/dev/gpt02-hosted-inert-fence.contract.test.mjs`: menguji kemiripan identik dengan fixture dan larangan fungsi/login/issuer grant/insert/DML serta kewajiban rollback/owner guard.
- `scripts/dev/test-gpt02-post-consumption-fence-hosted-inert-pg17.sh`: PostgreSQL Docker **tanpa jaringan** dengan kondisi role graph PG17 hosted, rollback injeksi sesudah pemberian izin sementara, penolakan riwayat non-kosong, CREATE hanya sekali, tiga foreign key dan enam unique constraint, false-only checks, RLS/immutable trigger, tanpa direct DML, penolakan migrasi ulang. CI menggunakan PG17 secara default. Smoke lokal boleh pakai PG16 cached dan harus **dilabel PG16**, tidak boleh disebut bukti PG17.
- Uji ini menggunakan role/UUID sintetis dan tidak menyentuh data produksi atau CST-DEV hosted.

## Gate operasi yang masih NO-GO

Pemeriksa empat tanda tangan di PR #161 merupakan evaluasi bukti murni. **Belum ada sumber data issuer asli** maupun penulis nonce resmi. Terpasangnya tabel ini kelak tidak mengaktifkan dispatch atau memperbolehkan mengonsumsi nonce: `dispatchPermitted=false` sampai ada persetujuan independen, fungsi atomik dan pembuktian runtime lease worker satu-perintah yang diaudit.

**Rollout:** Tunggu CI green pada commit yang persis, review DBA/security atas grantor graph dan constraint, lalu migration DEV terotorisasi dan readback pasca-perubahan; jangan menggabung/deploy otomatis hanya karena CI PASS. Jangan menyentuh Task #135/#136.
