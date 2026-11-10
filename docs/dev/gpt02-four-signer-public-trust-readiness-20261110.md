# GPT02 CST-DEV — empat penandatangan independen: sumber kunci publik

## Temuan live (10 November 2026)

Scoped preparer authentication & rollback sudah PASS (Issue #157), migrasi `gpt02_private.post_consumption_fences` inert sudah di-hosted DEV dengan FORCE RLS, 0 baris, dan tidak mengaktifkan nonce/issuer functions. Sumber penandatangan real **belum tersedia**: direktori `/run/credentials/gpt02-dev` tidak ada pada host maupun container DEV pengganti yang sehat. Runtime DEV tidak boleh memakai kunci sintetis dari unit test.

## Kontrak keamanan

`artifacts/api-server/src/lib/gpt02-dev-trust-store.mjs` adalah pemuat **kunci publik saja**. Ini bukan pembuat kunci, signer, penerbit approval, issuer, konektor database atau dispatcher. Fungsi `loadGpt02DevTrustStore` membaca empat berkas publik:

| Asal tanda tangan | Nama berkas | Fingerprint manifest |
| --- | --- | --- |
| Super Admin approval | `approval-public.pem` | `approval` |
| Hub operator identity | `hub-identity-public.pem` | `hub` |
| Core operator identity | `core-identity-public.pem` | `core` |
| Issuer evidence | `issuer-public.pem` | `issuer` |

Berkas harus tersedia di bawah `/run/credentials/gpt02-dev` pada runtime yang berwenang dengan direktori milik UID proses (mode 0700/0500), berkas regular milik UID proses (mode 0600/0400), bukan symlink, hardlink atau file lain. Kunci harus tepat satu PEM SPKI berjenis **Ed25519**. Keempat fingerprint SHA-256 dari SPKI DER harus saling berbeda dan sama dengan manifest fingerprint yang ditinjau **secara independen** oleh operator keamanan; **jangan mengambil expected fingerprints dari file PEM yang sama, request HTTP, data task, atau fixture test**.

Contoh output metadata verifier hanya berupa identitas `environment:'DEV'` dan hash fingerprint, bukan private key, token login atau approval. Kunci privat tetap berada pada signer independen sesuai otorisasi. Public key yang terbukti cocok **tidak dengan sendirinya** membuktikan keabsahan sesi Super Admin maupun memberikan izin command. Signing domain, identitas user/role/tenant/task/command/attempt, masa berlaku, nonce satu-kali, issuer/attestor ledger dan worker lease tetap diverifikasi oleh gate terpisah.

### Status blokir yang benar

Pada pemeriksaan VPS dan kontainer pengganti, trust directory tidak ditemukan. Pemuat menghasilkan `TRUST_STORE_DIRECTORY_NOT_FOUND` (NO-GO). Jangan otomatis membuat kunci privat baru, mengaktifkan role issuer, mengubah database `postgres`, atau memasang env secret demi memaksa PASS.

### Pengujian

`gpt02-dev-trust-store.test.mjs`: delapan pengujian terisolasi menggunakan Ed25519 yang dibangkitkan **hanya di memori** untuk file kunci publik sintetis. Meliputi empat fingerprint terpisah, manifest tidak lengkap atau duplikat, key diganti, izin world/group, symlink, file hilang, berkas berisi private key, dan tidak ada fungsi signing/dispatch. Uji lokal 8/8 PASS. Tidak membuat berkas kunci privat.

## Tahap berikutnya

Operator keamanan DEV yang berwenang harus menautkan trust anchor publik dari empat signer nyata ke manifest fingerprint out-of-band, memverifikasi asal signer, lalu menyerahkan file **publik** melalui mount yang dikelola perangkat sesuai prinsip least privilege. Jangan menyalin private key ke Git, VPS umum, SQL, chat, dan jangan mempromosikan approval dari sesi browser.

Baru sesudah readback kunci dan peran benar-benar PASS, layanan attestor serta issuer dapat diuji dengan kredensial khusus dan transaksi nonce terautentikasi yang dibatasi. Tidak ada grant atau dispatch sampai **new Task ID >136** mendapat persetujuan Super Admin task-spesifik, issuer lease terpisah, native DELL ACK. Task135/136 tidak boleh diulang, PROD tidak boleh diubah. **Full lifecycle NO-GO**.
