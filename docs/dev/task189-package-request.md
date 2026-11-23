# Permintaan paket persiapan Task 189 di CST-DEV

Layanan VPS menyimpan satu ID permintaan untuk Task 189, tenant `default`, proyek Supabase `xssrfshdrtdfupgqwfdw`. Saat penerbit tersedia, layanan meminta kredensial sementara, mengenkripsi paket dengan nama `gpt02-task189-preparer`, lalu menerbitkannya ke inbox yang sudah dipakai API persiapan. Persetujuan perintah dan eksekusi worker mengikuti alur AI Task yang terpisah.

## Supabase langsung untuk #189

VPS memakai permintaan yang sudah tersimpan. Pengelola menjalankan `supabase-exchange.py request` pada VPS untuk memilih Supabase langsung. Hasilnya berisi ID permintaan, tujuan dan kunci publik. Kunci privat tetap di direktori khusus milik root. Sesudah pemilihan ini, requester lama mengabaikan socket penerbit untuk permintaan yang sama.

Di CST-DEV, simpan deskriptor publik sebagai entri Supabase Vault bernama `gpt02-task189-prepare-request-<requestId>`. Pada 23 November 2026, deskriptor untuk permintaan `1bdbed20-ac8d-4e63-898e-6a94b729c018` sudah terdaftar dan diuji menggunakan tantangan acak dari PostgreSQL. Sidik jari penerima adalah `FA20AA396CFA6885F58CB0F222C90A3543B078E9`.

Setelah akses persiapan yang dibatasi untuk #189 diterbitkan di database, penerbit menyimpan paket untuk permintaan ini di entri Vault `gpt02-task189-prepare-grant-<requestId>`. Isinya menggunakan kolom `requestId`, `scope`, `kind=lease`, `role`, `password` dan `expiresAt` (detik Unix UTC). Melalui sesi pengelola Supabase yang sah, jalankan [pengambilan paket terenkripsi](../../scripts/dev/gpt02-task189-supabase-response.sql). Kueri mengembalikan nol baris saat paket atau login sementara belum tersedia. Teruskan satu baris ciphertext melalui stdin ke `/usr/local/libexec/ai-task189-dev/supabase-exchange.py receive` pada VPS lewat jalur admin tepercaya. Kunci penerima menjamin kerahasiaan. Asal respons dijamin oleh sesi pengelola terautentikasi dan kanal admin ke VPS. Simpan akses baca Vault pada pengelola.

Penerima mencocokkan scope, ID, role dan waktu kedaluwarsa sebelum menyerahkan paket kepada layanan pemasangan systemd yang sudah ada. Uji tantangan menggunakan aksi `verify` dan hanya menghasilkan SHA-256. Hasil uji ini membuktikan pengiriman enkripsi dari Supabase sampai VPS. Bukti eksekusi task tetap berasal dari job dan Final ACK.

## Sambungan penerbit melalui proxy (opsional)

Pengelola kredensial mendaftarkan sekali identitas layanan yang berwenang menerbitkan akses persiapan #189. Sambungan lokal memakai Unix socket `/run/cst-dev-task189-issuer/agent.sock`, mode 0600 milik root. Untuk proxy systemd, atur `UMask=0177` dan periksa mode socket yang benar-benar terpasang. Direktori induknya milik root dan hanya root yang boleh menulis. Identitas pengakses database tetap dikelola penerbit. Rahasia tidak dikirim melalui tiket atau variabel aplikasi.

Penerbit menerima HTTP GET pada `/v1/database/creds/gpt02-task189-preparer`. Kontrak ini kompatibel dengan Database Secrets API dan auto-auth proxy. Header `X-CST-Request-ID` membawa ID permintaan untuk audit. Pengelola harus mengikat identitas ke kebijakan khusus role ini, sumber database CST-DEV, masa akses paling lama 180 detik dan relock yang sudah terpasang. Scope harus ditegakkan oleh penerbit. API aplikasi juga memeriksa identitas dan masa login database ketika menyiapkan task.

Sambungan mengharapkan HTTP 200 dengan `lease_id` berawalan `database/creds/gpt02-task189-preparer/`, `lease_duration` dalam detik, serta `data.username` persis `gpt02_core_prep_login` dan `data.password` dari penerbit. Koneksi berlaku untuk satu database dan satu role yang telah disetujui. Instalasi standar yang menghasilkan username acak memerlukan pemetaan role oleh pengelola sebelum enrollment. Proxy hanya boleh menggunakan identitas layanan khusus ini dan harus meneruskan permintaan penerbitan langsung tanpa cache. [API database](https://developer.hashicorp.com/vault/api-docs/secret/databases) · [API proxy](https://developer.hashicorp.com/vault/docs/agent-and-proxy/proxy/apiproxy)

## Status dan pemulihan

Unit `gpt02-task189-request.path` memulai pemeriksaan saat boot dan saat socket muncul. `/var/lib/gpt02-task189-request/request.json` berisi ID, scope dan status tanpa kredensial. `waiting_for_issuer` berarti permintaan tersimpan lokal. `published` berarti paket terenkripsi telah diserahkan ke inbox. Bukti pemasangan ada pada delivery service, sedangkan hasil eksekusi tersimpan pada job #189.

Respons 401 atau 403 menghasilkan `issuer_denied`. Jika koneksi putus sesudah pengiriman, layanan menahan permintaan di `reconciliation_required`. Cocokkan ID dengan audit penerbit sebelum ada percobaan lain. Pengiriman ulang otomatis dapat membuat lease kedua. Publikasi lokal yang terputus dapat dilanjutkan dengan menjalankan unit yang sama selama lease masih berlaku. Jika paket sudah diterima atau dipasang lewat jalur manual, permintaan tidak meminta lease kedua. Untuk menghentikan jalur otomatis, nonaktifkan `gpt02-task189-request.path` dan hentikan `gpt02-task189-request.service`.
