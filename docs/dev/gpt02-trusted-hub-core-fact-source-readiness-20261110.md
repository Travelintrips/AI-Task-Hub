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
