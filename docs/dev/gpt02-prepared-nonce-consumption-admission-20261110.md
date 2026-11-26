# GPT02 CST-DEV — konsumsi nonce hanya setelah bukti Hub/Core tepercaya

## Ruang lingkup

Source-only guard `artifacts/api-server/src/lib/gpt02-prepared-nonce-consumer.mjs` adalah kandidat terpisah, **tidak diimpor** rute HTTP atau worker dan **tidak dijalankan** di hosted CST-DEV. Tidak membuat task/command, mengubah akun, menandatangani approval, menerbitkan runtime issuer lease, atau dispatch DELL.

Sumber bukti satu-satunya tetap tiga penandatangan Ed25519 yang berbeda (Super Admin approval, Hub, Core), dan *fact reader* yang disediakan server untuk pembacaan record immutable dari koneksi Hub/Core yang **terautentikasi secara independen**. Caller tidak boleh mengirim public key, snapshot Hub/Core, clock, atau objek issuer store.

### Urutan pengamanan sumber

1. Periksa envelope tepat dua field `approval` dan `operatorLink`; batasi `environment='DEV'`, `companyId='default'`, `taskId>136`. Task135 dan Task136 tidak bisa diproses.
2. Validasi struktur canonical, digest, hubungan antar identifier dan **ketiga Ed25519 signature sebelum pembacaan database apa pun**. Penandatangan dipatok saat factory diciptakan di server; tidak menerima kunci lewat request.
3. Baca Hub/Core prepared task, Hub prepared job, Core operator dan Hub Super Admin melalui fungsi server-owned `readTrustedFacts`. Reader **wajib** mengembalikan record dari sumber berotoritas dan snapshot berusia maksimal dua detik. Nilai `observedAt` sendiri bukan tanda tangan: integrasi runtime harus memastikan kredibilitas transport dan account reader.
4. Jalankan lagi `inspectPreparedSignedLink` terhadap snapshot dengan tiga key yang dipatok; tolak jika tenant, task, attempt, worker, akun Hub/Core aktif, identitas PIC/owner, expiry atau status prepared tidak cocok. Boolean request tidak pernah memberikan otoritas.
5. Baru panggil satu kali `issuerStore.consumeLinkedApproval`. Ini connector yang sudah tersedia sebagai sumber, tetapi **hosted function `consume_linked_approval` dan issuer LOGIN belum diaktifkan**. Jika DB pernah diaktifkan secara resmi, transaksi restricted issuer harus mengunci approval dan hanya satu receipt dari `UNIQUE(command_id,nonce)`, lalu menambah Core identity receipt secara atomik. Pengaman lokal `inflight` bukan mekanisme konkurensi antar-proses; DB lock dan constraint tetap wajib.
6. Respon keberhasilan hanya berarti bukti konsumsi berhasil **jika** returned receipt benar-benar berasal dari issuer DB yang berotoritas. Respon selalu `issuerLeaseGranted=false`, `dispatchPermitted=false`, `completionPermitted=false`, `releaseDecision='NO_GO'`; fungsi tidak memanggil DELL.

### Bukti pengujian

`artifacts/api-server/tests/gpt02-prepared-nonce-consumer.test.mjs` menguji dengan Ed25519 ephemeral, API issuer palsu yang tidak terhubung database, dan snapshot sintetis: tanda tangan palsu tidak menyentuh reader, task 135/136 ditolak sebelum reader/issuer, revoke/mismatch/expired gagal sebelum konsumsi, respons issuer dengan authority palsu atau receipt invalid ditolak, error disanitasi, dan delapan konsumsi dalam satu proses memanggil mock issuer sekali. Uji ini adalah **pengujian logika**, bukan bukti grant atau nonce hosted. Uji PostgreSQL sekali-pakai pada `test-gpt02-issuer-store-isolated.sh` sudah membuktikan atomisitas DB dan delapan permintaan bersamaan dengan satu receipt pada fixture terpisah.

**Jangan merge/deploy/aktifkan issuer role/EXECUTE hanya berdasar hasil unit atau CI.** Masih diperlukan persetujuan Super Admin per-task bertanda tangan dan tiga key independen yang dipatok dari trust store, operasi ledger nonce terautentikasi, bukti lease worker terpisah, peninjauan owner/DBA atas pembatasan hak akses, lalu satu task baru >136 yang disetujui secara spesifik. Chat “lanjut” bukan tanda tangan approval.

Status hosted: tabel `post_consumption_fences` sudah inert dan PASS, sedangkan approval/receipts/fence rows tetap 0, issuer/attestor NOLOGIN, belum ada fungsi consume atau reserve operational; full lifecycle **NO-GO**. PROD tidak diubah.
