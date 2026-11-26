# Task 189 · rilis persiapan CST-DEV

Target rilis ini adalah proyek Supabase `xssrfshdrtdfupgqwfdw` dan timer auditor yang sudah berjalan pada `srv1792369`. Supervisor berasal dari PR #211, commit `39cccf963f85810d8ac46f7296fccc0c905efd3a`. Jalankan workflow DEV Verify dan gunakan artefak dari commit yang lulus.

| Artefak | SHA-256 berkas |
| --- | --- |
| Supervisor sebelum rilis | `e04306720002dd13797d566487df238998b9791e45a378271e6a81814d9f8e70` |
| Supervisor transisi | `621d5bf19538a602ea52685df9515b5a5aa5e1b277aa6e90c4cfe745a52d8880` |
| Supervisor akhir | `80647d0b3ff713df717fe5e420780364177592d58ab648fc9718de3a23741852` |

1. Cocokkan SHA supervisor aktif dan cadangkan berkas asli. Catat pengaturan akses `public.ai_tasks`, status akun persiapan, jumlah sesi, persiapan, job dan Final ACK. Akun harus terkunci dan tidak memiliki sesi aktif.
2. Hasilkan supervisor transisi dengan `python3 render.py transition-supervisor`. Pasang secara atomik pada jalur service yang sama. Supervisor ini mengenali tepat dua versi fungsi relock selama pergantian. Tunggu siklus baru dari timer, lalu periksa status akun dan hasil kedua jalur cleanup.
3. Terapkan hasil `python3 render.py install` sebagai satu migrasi. Cocokkan kedua hash fungsi dan periksa siklus timer sesudah commit database.
4. Pasang `gpt02_issue159_relock_catalog_supervisor.mjs` secara atomik. Versi ini hanya mengenali fungsi relock yang baru. Periksa hash berkas, beberapa siklus timer baru, status akun, izin tabel dan ledger Task 189.

Untuk rollback dari rilis akhir, pasang kembali supervisor transisi terlebih dahulu. Setelah timer lulus, terapkan `python3 render.py rollback`, tunggu siklus sehat, lalu pulihkan supervisor asli dengan checksum di atas. Jika pemasangan belum melewati langkah 2, pulihkan supervisor asli setelah memastikan kedua fungsi masih pada versi sebelumnya. Timer dan kredensial auditor tetap digunakan sepanjang pergantian.
