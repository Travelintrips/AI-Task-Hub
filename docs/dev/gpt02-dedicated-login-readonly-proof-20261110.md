# GPT02 CST-DEV — autentikasi preparer khusus, bukti sesi baca-saja

## Batas pekerjaan

CST-DEV Supabase project `xssrfshdrtdfupgqwfdw`, PostgreSQL 17. Tahap migrasi hak minimum pemilik fungsi sudah terpasang sebelumnya: `gpt02_dev_inert_preparer_owner_parent_grants_20261110` (version `20261109210332`), 8 parent SELECT / 2 parent INSERT untuk `gpt02_core_prep_owner`, **NOLOGIN**, bukan untuk akun login.

Audit langsung baru membuktikan `gpt02_core_prep_login` masih `NOLOGIN`, `rolconnlimit=0`, `rolpassword IS NULL`, `rolvaliduntil` kedaluwarsa dan tidak menjadi anggota role lain. Tidak ada variabel `GPT02_CORE_PREP_...` pada lingkungan aktif VPS DEV. Ini berarti tidak tersedia bukti autentikasi tersendiri dan **tidak boleh dianggap PASS** hanya dari uji SCRAM sintetis. Tidak ada percobaan autentikasi yang sengaja gagal pada pooler sebenarnya; diagnosis sejenis sebelumnya pernah mengakibatkan pembatasan IP.

## Pemeriksa baru, hanya katalog PostgreSQL

`scripts/dev/gpt02-preparer-dedicated-login-readonly.mjs` memakai validator koneksi yang sudah diuji, `corePreparationPoolConfig()`, dari paket API. Akses hanya mungkin bila konfigurasi berisi lingkungan DEVELOPMENT, project CST-DEV yang dipatok tepat, akun `gpt02_core_prep_login.<project-ref>`, **session pooler 5432**, sertifikat Root Supabase 2021 satu lembar dengan sidik jari SHA-256 tepat `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`, dan TLS `rejectUnauthorized=true`. Tidak ada fallback ke aplikasi `postgres` atau transaksi-pooler 6543.

Jika *dan hanya jika* kredensial yang disetujui sudah tersedia dari pengelola rahasia, pemeriksa melakukan satu percobaan sambungan saja dengan `BEGIN READ ONLY`, batas waktu perintah 5 detik, satu agregasi katalog dan `ROLLBACK`. Dibutuhkan `current_user=session_user=gpt02_core_prep_login`, tanpa SUPERUSER, CREATEROLE, BYPASSRLS, membership atau kemampuan membuat database object; `CONNECTION LIMIT` hanya 1–2 dan masa berlaku kredensial wajib lebih pendek dari satu hari. Hak langsung pada delapan tabel Hub/Core tidak boleh ada. Fungsi dormant harus tetap non-eksekutabel, fungsi operasional harus absen, pemilik fungsi memiliki tepat 8 SELECT dan 2 INSERT, sepuluh kebijakan RLS harus cocok dengan sidik jari yang dipatok, dan issuer/attestor/owner tetap NOLOGIN. Hak TEMP yang muncul dari PUBLIC pada database sekarang dilaporkan sebagai metadata saja; itu tidak boleh dianggap hak CREATE atau otorisasi perintah.

Tidak ada SQL `CREATE`, `ALTER`, `GRANT`, `UPDATE`, `INSERT`, `DELETE`, pemanggilan `prepare_core_task_dormant`, pembacaan task bisnis, nonce/lease/signature, atau dispatch. Kesalahan atau kekurangan konfigurasi menghasilkan `NO_GO` tanpa membocorkan string koneksi atau kata sandi, tanpa retry dan tanpa memalsukan sukses. Bahkan bukti login positif tetap mengembalikan `releaseDecision=NO_GO`, `dispatchPermitted=false`.

## Pengujian dan tindakan lanjutan

`scripts/dev/gpt02-preparer-dedicated-login-readonly.test.mjs` mencakup tujuh skenario deterministik: kredensial/TLS/proyek yang hilang atau salah tidak boleh mencoba koneksi, bukti identitas sintetis tetap non-authorizing, pengguna DB yang salah/role eskalasi/ACL bocor ditolak, hasil katalog kosong atau ganda ditolak, kegagalan disanitasi serta rollback tanpa retry, SQL hanya berisi SELECT katalog, dan hak TEMP bukan kewenangan membuat command. Uji ini masuk ke langkah CI DEV yang telah ada, tanpa perubahan pada jalur worker atau otorisasi.

**Gate belum terpenuhi di lingkungan asli:** akun khusus wajib diprovisikan dengan rahasia acak dari penyimpanan rahasia terkelola melalui proses terpisah yang disetujui, disertai rollback/rotasi dan uji satu kali login asli dalam transaksi baca-saja di CST-DEV. Jangan menulis kata sandi dalam Git, migrasi SQL tercatat, log terminal atau jawaban ChatGPT. Jangan mencoba kata sandi sintetis melalui pooler. Jangan mengubah kredensial bersama `postgres`. Jangan membuka `EXECUTE` fungsi dormant atau mengaktifkan issuer/attestor/DELL ketika approval Super Admin, binding, nonce dan lease belum tersedia.

**Status:** sintaks, uji sumber, dan CI dapat PASS; autentikasi dedicated login CST-DEV **NO-GO sampai bukti langsung**. Task #135/#136 dan PROD tidak berubah, PR #156 tetap draft.

## Bukti PostgreSQL17 sungguhan tanpa akses CST-DEV

CI juga menjalankan `scripts/dev/gpt02-preparer-auth-catalog-integrated-fixture.sh` hanya setelah migrasi hak minimum dan **sepuluh kebijakan RLS yang identik** dipasang pada kontainer PostgreSQL17 dengan `--network none`. Admin sintetis `fixture_root` sementara mengaktifkan akun `gpt02_core_prep_login` dengan verifikator SCRAM dan masa berlaku 30 menit. Sambungan `psql` lewat TCP lokal menolak kata sandi salah, sedangkan kata sandi sintetis yang benar menjalankan **QUERY yang sama persis** dari pemeriksa sumber di dalam `BEGIN READ ONLY` dan `ROLLBACK`. Hasil harus menunjukkan identitas `current_user=session_user` tepat, masa berlaku dan batas koneksi pendek, tanpa membership atau DML langsung, tanpa EXECUTE fungsi dormant, dengan 8 SELECT/2 INSERT di pemilik serta 10 RLS persis. Setelah pembacaan, akun kembali `NOLOGIN`, kata sandi dihapus, dan percobaan login baru harus ditolak. Seluruh task, approval, nonce, Core coding task dan Hub execution sintetis tetap kosong. **Ini adalah pembuktian terisolasi, bukan bukti berhasil login ke Supabase CST-DEV.**
