# GPT02 Task #183 — satu gerbang rilis CST-DEV

**DEV ONLY / TIDAK ADA PROD / TIDAK ADA DISPATCH SEBELUM OWNER SAH.**
Dokumen ini menyederhanakan proses rilis; tidak mengubah SQL, hak akses, atau pengaman.
Target hanya Supabase `xssrfshdrtdfupgqwfdw` dan VPS `srv1792369`.
Gunakan satu bukti hasil akhir, bukan persetujuan/review manusia berulang.

## Bukti yang sudah diterima — jangan diuji ulang tanpa perubahan

- Kandidat SQL berasal dari PR #211. Cocokkan SHA commit dan checksum SQL **pada saat eksekusi**, karena PR masih dapat berubah.
- Tes disposable PostgreSQL 16/17, kegagalan relock, terminasi sesi aktif,
  pembatasan ACL, serta negatif replay/drift telah PASS **secara terisolasi**.
  Itu bukan pengganti pengujian sesi aktif pada database hosted.
- Dua hash badan fungsi preparer di CST-DEV harus tetap persis:
  - `prepare_core_task`: `a759ab94ab38e0f0fcf0b42bc14dbbf30308274344a14ade666e1bae38a1c456`
  - `prepare_core_task_v1_internal`: `b18275516add255e76f31414a28732bdd900b556b10f38d42e2e4bdf9f7415d4`
- Task #183 = `WA-2611-7669`, perusahaan `default`, PIC ID 5.
  Gunakan task ini, jangan buat task pengganti atau Command/Attempt ID palsu.
- Watchdog utama GPT02 yang sudah aktif tetap dipakai; jangan menambah watchdog baru.

## Satu gerbang teknis dan satu paket perubahan DEV

**Tidak diwajibkan auditor eksternal, reviewer independen formal, atau
persetujuan terpisah untuk setiap pengujian.** Pelaksana teknis yang berwenang
cukup memeriksa bukti dan menjalankan *satu* paket release gate berikut.
Pemasangan role/DDL tetap harus melalui mekanisme administrator yang
diizinkan oleh Supabase dan persetujuan perubahan khusus CST-DEV;
tidak boleh memintas pembatasan platform.

1. **Preflight sekali.** Pin SHA GitHub + checksum migrasi; periksa Task #183,
   PostgreSQL 17, RLS delapan tabel, hash fungsi, no-direct-DML/ACL, role preparer
   `NOLOGIN` + password NULL + connlimit 0, nol job/preparation/approval, dan
   watchdog aktif dengan cleanup tertunda nol. Bila drift: **STOP / NO-GO**.
2. **Pasang relock dahulu.** Dalam transaksi DDL yang sudah disetujui untuk DEV,
   pasang hanya role relock terkunci, schema privat dan fungsi `relock_task183_preparer`.
   Jangan buka preparer LOGIN, jangan buat command, jangan mengubah fungsi
   preparer yang sudah PASS. Verifikasi ACL `PUBLIC`/`anon`/`authenticated`
   ditolak, owner dan hash tidak berubah, serta role relock masih terkunci.
3. **Provisioning sekali.** Administrator/custodian yang berwenang menempatkan
   kredensial relock *terpisah* melalui `systemd-creds` terenkripsi.
   Pasang kandidat runtime yang sama persis dengan SHA terverifikasi, uji TLS
   `verify-full`, identitas role/host/proyek dan satu timer relock yang ditetapkan;
   tanpa mencetak DSN/password/token. Tidak boleh gunakan kredensial DBA
   maupun aplikasi umum untuk menggantikan role khusus.
4. **Satu rangkaian tes hosted.** Gunakan role sementara berhak minimum dan
   mekanisme PostgreSQL yang disetujui platform; buktikan login asli,
   sesi `pg_sleep` masih aktif, relock `NOLOGIN` + password NULL,
   pemutusan paksa sesi, nol koneksi/ACL sisa, penolakan login ulang,
   penolakan replay dan rollback. Jika ada langkah gagal, langsung jalankan
   cleanup yang tersedia; **jangan buka akses preparation**.
5. **Persiapan dan E2E satu kali.** Hanya setelah gate 1–4 PASS,
   jendela preparer boleh dibuka singkat sesuai kebijakan TTL maksimal 3 menit
   melalui sesi Google Super Admin asli untuk *prepare-only*, menggunakan wrapper
   `gpt02_stage.prepare_core_task`. Command ID dan Attempt ID harus berasal dari
   hasil resmi Hub/Core. **Satu persetujuan Owner asli yang terikat ke
   task/command/attempt diperlukan sebelum dispatch**, diikuti broker/issuer
   asli, satu DELL receiver-owned Final ACK, replay denial dan final relock.
   Persetujuan chat “lanjut” bukan tanda tangan untuk perintah.

## Rollback fail-closed — bagian dari paket yang sama

- Bekukan preparation/dispatch; pertahankan watchdog utama dan jalur relock
  sampai semua sesi ditutup.
- Relock preparer ke `NOLOGIN`, `PASSWORD NULL`, connlimit 0 dan expiry lampau.
  Pastikan `pg_stat_activity` nol untuk role tersebut. Jika terminasi belum
  lengkap, laporkan **NO-GO**, ulangi cleanup terotorisasi; jangan klaim PASS.
- Jangan hapus fungsi/timer/kredensial relock ketika masih diperlukan untuk
  menutup sesi. Jangan merestorasi password atau memperluas `EXECUTE`.
- Pastikan tidak ada job/preparation/approval/ACK ganda, hash/ACL tetap cocok,
  tidak ada perubahan PROD, dan status watcher kembali sehat.
- Simpan **satu laporan** berisi SHA, checksum, hasil tes, snapshot metadata
  (tanpa verifier/password), persetujuan perubahan DEV, bukti persetujuan Owner,
  Final ACK dan hasil rollback bila diperlukan.

## Keputusan

- **Relock hosted PASS:** preflight, pemasangan, tes sesi aktif, rollback,
  dan zero-residual-state semuanya terverifikasi di CST-DEV.
- **E2E Task #183 PASS:** hanya bila ditambah satu persetujuan Owner sah,
  Command/Attempt resmi, Final ACK dari DELL, replay denial dan final relock.
- Jika ada butir belum terverifikasi: **NO-GO**. Tidak boleh menyimpulkan
  GO hanya dari CI, test sintetis, atau keberadaan file runtime.
