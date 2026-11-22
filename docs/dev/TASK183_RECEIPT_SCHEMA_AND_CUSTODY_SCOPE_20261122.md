# CST-DEV Task #183 — scope schema dan custody receipt (review, bukan izin rilis)

Tanggal: 22 November 2026. Status: **dua temuan P1 PR #223 masih terbuka**. Dokumen ini tidak mengubah kebijakan organisasi, GRANT, RLS, aplikasi aktif, atau PROD.

## Batas domain: Sport Center ≠ GPT02

`AGENTS.md` berisi bagian **Sport Center Jakarta** yang mensyaratkan schema `sport_center` (`scSchema`) untuk tabel **Sport Center**. Repo ini juga berisi AI Task Hub/GPT02, dan di project Supabase **CST-DEV** `xssrfshdrtdfupgqwfdw` sudah ada objek GPT02 terpisah:

- `gpt02_stage.core_preparations` (immutable; trigger `gpt02_preparation_immutable` aktif),
- `gpt02_private.approvals` dan identitas/issuer terkait,
- `gpt02_stage.task183_verified_recovery_receipts` dan `gpt02_stage.task183_recovery_attempts` (FORCE RLS, scoped FK, satu percobaan pemulihan).

Memindahkan dua tabel recovery ke `sport_center` hanya untuk memenuhi aturan lintas-produk tidak aman: FK, wrapper, ledger, ACL, penguncian dan audit yang telah ada harus dimigrasikan bersama. **Tidak ada pemindahan atau DDL baru di PR ini.** Batas schema GPT02 perlu dikonfirmasi secara eksplisit oleh pemilik kebijakan repo; jangan menganggap reviewer P1 sudah terselesaikan.

## Batas mekanisme custody

`AGENTS.md` juga memiliki aturan umum bahwa persistensi aplikasi memakai Supabase client. Jalur `scripts/dev/task183-read-issuer-receipt.py --record` menggunakan PostgreSQL native `psycopg` **ke Supabase PostgreSQL yang sama**, tetapi *hanya* sebagai helper privileged **one-shot** pada host DEV, bukan SDK/persistensi alternatif aplikasi.

Jalur ini diperlukan oleh desain saat ini untuk memverifikasi secara langsung, dalam sesi yang sama, `session_user`, `current_user`, `SET LOCAL ROLE`, dan RLS. Mengganti penulisan dengan Supabase HTTP/service-role tanpa desain ulang dapat kehilangan pembuktian role PostgreSQL dan berisiko melebarkan otoritas. Jika arsitektur hanya mengizinkan Supabase HTTP client, jalur ini **harus tetap NO-GO** sampai alternatif dengan jaminan setara dirancang dan disetujui; jangan sekadar menambah `service_role` atau mengekspos schema privat ke Data API.

Pengaman yang dapat diverifikasi secara baca-saja di CST-DEV pada 22 November:

| Objek/pemeriksaan | Kondisi |
| --- | --- |
| `gpt02_task183_verifier_login` | `NOLOGIN` saat diam, connection limit 1, tanpa superuser/BYPASSRLS |
| `gpt02_task183_receipt_verifier` | `NOLOGIN`, tidak punya table-wide INSERT, tanpa superuser/BYPASSRLS |
| Keanggotaan `verifier_login` → role receipt | `SET TRUE`, `INHERIT FALSE` |
| `gpt02_stage.task183_verified_recovery_receipts` | RLS + FORCE RLS |
| GRANT | INSERT **hanya** lima kolom: `request_id`, `approval_sha256`, `predecessor_attempt_id`, `signed_at`, `expires_at` |
| Akses user `anon`/`authenticated` | Tidak memiliki hak INSERT |
| Receipt terverifikasi Task183 | 0 |

Kode PR #223 sekarang memeriksa identitas login, satu koneksi, kemampuan `SET ROLE`, lima hak INSERT tingkat kolom serta larangan table-wide INSERT **sebelum** eksekusi INSERT. Kekeliruan menguji hanya `has_table_privilege('INSERT')` sudah diperbaiki; hak per-kolom yang benar tidak boleh ditingkatkan menjadi hak table-wide.

## Bukti yang sudah PASS dan yang belum

- Unit negative/fail-closed receipt registration: 6/6 PASS pada GitHub Actions.
- UI Owner receipt status: 8/8 PASS; pesan sukses wajib `receiptRegistered=true` dan `manualReviewRequired=false`.
- PostgreSQL 17 sintetis tanpa network/port: tepat lima kolom boleh di-INSERT, kolom ekstra ditolak, FORCE RLS aktif, transaksi uji rollback, 0 baris.
- **Bukan** bukti persetujuan Owner sebenarnya, penulisan receipt hosted, atau Final ACK.

Task #183 tetap satu preparation lama yang expired (21 November 2026 pukul 18:25 WIB), satu Hub `prepared` tanpa command, Core `PENDING`, zero receipt/recovery attempt/approval/issuer/dispatch. Fungsi `gpt02_stage.prepare_task183_recovery` tetap dormant; jangan memperpanjang TTL atau membuat ulang Task #183.

## Keputusan kebijakan yang belum boleh diasumsikan

1. P1 namespace: tetapkan secara eksplisit bahwa tabel GPT02 operasional di `gpt02_stage`/ `gpt02_private`, sedangkan `sport_center` untuk Sport Center; atau jalankan review migrasi lintas-schema terpisah sebelum mengubah data.
2. P1 client: setujui pengecualian **DBA-owned, satu transaksi, satu role, Supabase DEV-only** untuk helper receipt, dengan perizinan kolom, TLS verifikasi, root-only encrypted credential, audit serta relock; atau sediakan desain Supabase-client-native yang masih membuktikan identitas/role per-sesi dan tidak membuka schema privat. **Tidak ada pengecualian umum untuk aplikasi.**

Sampai keputusan review arsitektur tersedia, PR #223 tidak layak di-merge/deploy dan helper tidak boleh mendaftarkan receipt secara live. Jangan menggunakan tanda tangan buatan, menganggap pesan chat `lanjut` sebagai persetujuan bertanda tangan, mengubah PROD, atau mengaktifkan issuer/dispatch.

Sumber terkait: [PR #223](https://github.com/Travelintrips/AI-Task-Hub/pull/223), [Issue #208](https://github.com/Travelintrips/AI-Task-Hub/issues/208), [Issue #203](https://github.com/Travelintrips/AI-Task-Hub/issues/203).
