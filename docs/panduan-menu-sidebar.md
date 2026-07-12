# Panduan Menu Sidebar — AI Task Center

Dokumen ini menjelaskan fungsi setiap menu di sidebar aplikasi **AI Task Center**, dan bagaimana menu-menu tersebut saling terhubung dalam satu alur kerja. Tujuannya agar Anda (atau siapa pun yang menggunakan sistem ini) mengerti *kenapa* setiap menu ada, bukan cuma *apa* isinya.

## Gambaran Besar: Bagaimana Sistem Ini Bekerja

Inti dari aplikasi ini adalah mengubah **pesan WhatsApp yang masuk** menjadi **task/tugas terstruktur** secara otomatis menggunakan AI, lalu mengelola task itu sampai selesai. Alurnya secara garis besar:

```
Pesan WA masuk  →  AI membaca & mengklasifikasi  →  Task dibuat otomatis
     ↓                                                      ↓
 (Messages)                                            (AI Tasks)
     ↓                                                      ↓
Jika info kurang        →  AI minta info tambahan     →  Task ditugaskan
lengkap (AI Intake /        via chat WA (Conv Intake)      ke staf/tim
Conv Intake)                                          (AI Dispatcher → Team)
     ↓
Dokumen dikirim customer →  divalidasi otomatis
(Documents)                 (Doc Validation)
```

Menu-menu lain (Knowledge Base, AI Training, Governance, AI Observability, Test Suite AI) adalah **menu "di balik layar"** — tempat Anda mengatur cara AI berpikir, menguji AI sebelum dipakai live, dan mengawasi performanya. Bagian di bawah menjelaskan tiap menu satu per satu, dikelompokkan berdasarkan perannya dalam alur ini.

---

## 1. Operasional Harian — pekerjaan sehari-hari

### Dashboard (`/`)
Halaman ringkasan/monitoring. Menampilkan jumlah task berdasarkan status (New Inquiry, Waiting Documents, Ready for Review, Assigned, In Progress, Completed) dan daftar task terbaru. Ini adalah **halaman pertama** yang dilihat saat login — tempat untuk cek cepat "ada apa hari ini".

**Kegunaan:** Melihat kondisi operasional secara sekilas tanpa harus membuka banyak menu.

### AI Tasks (`/ai-tasks`)
Papan kerja utama berbentuk tabel/kanban, menampilkan **semua task** yang sudah dibuat — baik otomatis oleh AI dari pesan WA, maupun dibuat manual lewat tombol "Tambah Task". Setiap task punya kolom: pelanggan, judul, status, prioritas, kategori, divisi, AI Intent (apa yang dideteksi AI), audit, pesan terakhir, dan siapa yang ditugaskan (assignee).

**Kegunaan:** Ini adalah menu kerja paling penting — di sinilah staf memproses task dari awal sampai selesai, mengubah status, dan menugaskan ke anggota tim.

**Terhubung ke:** Messages (sumber data), AI Dispatcher (penugasan), Team (siapa yang dikerjakan).

### Messages (`/messages`)
Tampilan seperti chat, berisi log mentah semua pesan WhatsApp yang masuk dan keluar. Dari sini staf bisa melihat percakapan asli dengan pelanggan/vendor, dan membalas langsung ke WA dari dalam aplikasi.

**Kegunaan:** Ini adalah **pintu masuk** seluruh data ke sistem — setiap pesan WA yang masuk dicatat di sini sebelum (atau sambil) diklasifikasi AI menjadi task.

### Documents (`/documents`)
Pengelolaan file/dokumen yang dikirim lewat WA atau diunggah manual — misalnya bukti pengiriman (POD), invoice, surat jalan, foto barang, dll.

**Kegunaan:** Menyimpan dan mengorganisir dokumen pendukung tiap task supaya tidak hilang di tumpukan chat WA.

**Terhubung ke:** Doc Validation (dokumen di sini yang divalidasi otomatis).

### Team (`/team`)
Direktori anggota tim/staf — nama, nomor HP, peran (role), dan beban kerja (berapa task yang sedang ditangani).

**Kegunaan:** Sumber data "siapa yang bisa dikasih kerjaan" — dipakai oleh AI Dispatcher untuk menentukan penugasan otomatis.

---

## 2. AI & Otomatisasi Pesan — cara AI menangani pelanggan

### AI Intake (`/intake-sessions`)
Daftar sesi "wawancara" otomatis yang dilakukan AI ke pelanggan/vendor lewat WA, ketika informasi yang diberikan belum lengkap. Contoh: pelanggan bilang "mau kirim barang" tanpa sebut alamat tujuan — AI akan menanyakan detail yang kurang lewat WA secara terstruktur.

**Kegunaan:** Memantau proses AI "mengumpulkan data" dari pelanggan sebelum task dianggap siap diproses.

### Conv. Intake — Conversation Intake (`/conversation-intake`)
Mirip AI Intake, tapi berfokus pada riwayat **percakapan** intake itu sendiri — melihat pertanyaan apa yang ditanyakan AI dan jawaban apa yang diberikan pelanggan, langkah demi langkah.

**Kegunaan:** Untuk mengecek/mengaudit apakah AI menanyakan hal yang tepat dan pelanggan menjawab dengan benar — berguna saat ada task yang datanya salah/tidak lengkap, untuk melihat di mana prosesnya meleset.

### Doc Validation (`/document-intake`)
Tempat mengatur **aturan validasi dokumen** (misalnya: format nomor STNK harus sesuai, invoice harus ada nominal, dsb.) dan melihat riwayat hasil validasi otomatis (lolos/gagal) dari dokumen yang masuk lewat WA.

**Kegunaan:** Memastikan dokumen yang dikirim pelanggan/vendor sudah benar tanpa perlu staf memeriksa satu-satu secara manual.

### Mini Form Config (`/mini-form-config`)
Alat untuk membuat **form isian singkat** (mini form) yang bisa dikirim ke pelanggan lewat link WA, misalnya untuk mengisi detail pengiriman atau data yang butuh input terstruktur (bukan lewat chat bebas).

**Kegunaan:** Alternatif intake percakapan — kadang lebih cepat suruh pelanggan isi form daripada tanya-jawab lewat chat.

### Mini Form Analytics (`/mini-form-analytics`)
Laporan seberapa efektif mini form tersebut — berapa yang dibuka, berapa yang selesai diisi (conversion rate).

**Kegunaan:** Evaluasi apakah form yang dibuat di Mini Form Config benar-benar dipakai/berhasil, supaya bisa diperbaiki kalau banyak yang tidak selesai isi.

---

## 3. Kualitas & Pengujian AI

### Test Suite AI (`/conversation-tests`)
"Ruang uji coba" — Anda bisa mensimulasikan percakapan WA (tanpa mengirim WA asli) untuk mengecek apakah AI mengklasifikasikan pesan dengan benar menjadi intent/kategori yang tepat.

**Kegunaan:** Sebelum mengubah aturan AI di Knowledge Base, tes dulu di sini supaya tidak merusak sistem yang sedang berjalan live. Ini semacam "gerbang kualitas" (quality gate).

---

## 4. Distribusi Kerja

### AI Dispatcher (`/dispatcher`)
Menampilkan antrian task yang perlu ditugaskan, dengan rekomendasi otomatis dari AI tentang siapa staf yang paling cocok/tersedia untuk mengerjakannya (berdasarkan beban kerja dan kategori task).

**Kegunaan:** Mempercepat proses penugasan — daripada manajer memilih manual satu-satu, AI kasih rekomendasi, lalu tinggal konfirmasi.

**Terhubung ke:** AI Tasks (sumber antrian), Team (data staf yang tersedia).

---

## 5. "Otak" AI — konfigurasi kecerdasan sistem

### Knowledge Base (`/knowledge-base`)
Basis pengetahuan AI: daftar **intent** (maksud pesan, misalnya "tanya harga", "komplain", "booking"), **kata kunci** yang dikenali untuk masing-masing intent, dan template balasan/dokumen terkait.

**Kegunaan:** Ini adalah tempat mengajarkan AI istilah-istilah bisnis Anda. Kalau AI sering salah mengklasifikasi pesan, kemungkinan besar perbaikannya dilakukan di sini (menambah/mengubah kata kunci).

### AI Training (`/training`)
Kumpulan data training/contoh yang dipakai untuk melatih atau menyempurnakan model AI dalam mendeteksi intent dan mengisi field task secara otomatis.

**Kegunaan:** Melengkapi Knowledge Base dengan contoh nyata supaya AI makin akurat dari waktu ke waktu.

---

## 6. Pengawasan & Kepatuhan

### Governance (`/governance`)
Aturan tata kelola: matriks SLA (berapa lama target penyelesaian tiap jenis task), aturan approval/persetujuan berjenjang, dan kebijakan lain yang harus dipatuhi sistem.

**Kegunaan:** Memastikan operasional berjalan sesuai kebijakan perusahaan (misalnya task tertentu wajib disetujui atasan dulu, atau harus selesai dalam X jam).

### AI Observability (`/ai-observability`)
Dashboard kesehatan sistem AI — memantau tingkat error, biaya pemakaian AI, waktu respons, dan metrik teknis lainnya.

**Kegunaan:** Untuk tim teknis/manajemen memantau apakah AI berjalan sehat (tidak error terus-terusan, tidak boros biaya) di balik semua otomatisasi yang terjadi di menu-menu lain.

---

## Ringkasan Alur End-to-End

1. **Pelanggan chat via WhatsApp** → tercatat di **Messages**.
2. **AI membaca pesan** menggunakan aturan di **Knowledge Base** (dan hasil **AI Training**) untuk menentukan maksud pesan.
3. Jika info belum lengkap → AI bertanya balik ke pelanggan otomatis (**AI Intake** / **Conv. Intake**), atau mengirim link **Mini Form Config** untuk diisi (dipantau lewat **Mini Form Analytics**).
4. Setelah info cukup → **Task dibuat otomatis** dan muncul di **AI Tasks** (juga terlihat ringkas di **Dashboard**).
5. Jika task butuh dokumen (invoice, POD, dll.) → diunggah/dicek di **Documents**, lalu divalidasi otomatis di **Doc Validation**.
6. Task ditugaskan ke staf lewat rekomendasi **AI Dispatcher**, berdasarkan data staf di **Team**.
7. Selama proses berjalan, aturan kepatuhan (SLA, approval) diatur dan dipantau di **Governance**.
8. Sebelum perubahan aturan AI di-*deploy*, harus lolos uji dulu di **Test Suite AI**.
9. Kesehatan teknis seluruh proses ini dipantau lewat **AI Observability**.

> **Catatan:** Tergantung peran (role) akun Anda, mungkin ada menu tambahan di sidebar yang tidak terlihat di screenshot awal. Menu-menu tersebut dijelaskan lengkap di bagian lanjutan di bawah ini.

---

## 7. CRM & Manajemen Vendor — data pelanggan dan mitra

### CRM (`/crm`)
Direktori pelanggan/klien perusahaan — data perusahaan, PIC (contact person), alamat, NPWP, dan riwayat jumlah task per pelanggan. Ada kartu per pelanggan yang bisa dicari/difilter, dan bisa tambah/edit/hapus data pelanggan.

**Kegunaan:** Menjadi "buku alamat" resmi pelanggan, terpisah dari sekadar chat WA — supaya data pelanggan (NPWP, alamat, dsb.) tidak hilang atau tercecer.

**Terhubung ke:** Bisa membuka **"Customer Memory"** — riwayat & insight AI tentang pelanggan tersebut (misalnya kebiasaan order, riwayat komplain). Juga dipakai sebagai referensi di **Quotation**.

### Vendors (`/vendors`)
Daftar vendor/mitra pihak ketiga (misalnya perusahaan trucking, ekspedisi laut, dll.), lengkap dengan **grade performa (A–F)**, jenis layanan, tingkat risiko, dan skor kesiapan (readiness score).

**Kegunaan:** Memantau kualitas dan keandalan mitra logistik yang diajak kerja sama, supaya perusahaan tidak terus memakai vendor yang bermasalah.

**Terhubung ke:** Detail tiap vendor bisa dibuka untuk melihat "Vendor Memory" (riwayat & catatan AI tentang vendor tsb). Data di sini dipakai juga oleh **Purchasing**.

### Vendor Review (`/admin/vendor-review`)
Halaman admin untuk meninjau pendaftaran vendor baru yang masuk lewat pendaftaran mandiri (self-service). Menampilkan metrik funnel onboarding dan daftar vendor yang menunggu persetujuan, dengan tombol setujui/tolak/minta revisi beserta catatan.

**Kegunaan:** Memastikan setiap vendor baru sudah melengkapi dokumen wajib (NIB, NPWP, dll.) sebelum resmi masuk ke daftar **Vendors** dan bisa diberi pekerjaan.

---

## 8. Fleet — manajemen armada kendaraan

Kelompok menu ini khusus untuk perusahaan yang punya armada kendaraan sendiri (truk, dll.).

### Fleet Dashboard (`/fleet/dashboard`)
Ringkasan kondisi armada: total unit kendaraan, jumlah driver aktif, distribusi risiko, ringkasan biaya per KM, dokumen yang akan kedaluwarsa, dan papan peringkat driver terbaik.

**Kegunaan:** Titik awal untuk manajer armada memantau kesehatan seluruh armada sekilas, sebelum masuk ke detail di menu Fleet lainnya.

### Fleet Risk (`/fleet/risk`)
Tabel skor risiko tiap kendaraan/driver (Tinggi/Sedang/Rendah), daftar insiden keselamatan, dan analitik perilaku berkendara.

**Kegunaan:** Mendeteksi kendaraan atau driver berisiko tinggi lebih awal, supaya bisa dicegah sebelum terjadi kecelakaan atau klaim asuransi membengkak.

### Fleet Cost/KM (`/fleet/cost`)
Tabel dan grafik biaya operasional per kilometer untuk tiap kendaraan, dipecah berdasarkan komponen: BBM, perawatan (maintenance), dan ban.

**Kegunaan:** Mengetahui kendaraan mana yang paling "boros"/mahal dioperasikan, untuk evaluasi apakah perlu diganti atau diperbaiki.

**Terhubung ke:** Data diambil dari **Fleet BBM**, **Fleet Ban**, dan histori perawatan.

### Route Profit — Route Profitability (`/fleet/route-profitability`)
Analisis pendapatan vs biaya operasional per rute pengiriman, termasuk persentase margin dan grafik volume vs profit.

**Kegunaan:** Membantu menentukan rute mana yang menguntungkan dan mana yang justru rugi, untuk dasar penyesuaian tarif atau strategi rute.

**Terhubung ke:** Memakai data dari **Fleet Cost/KM** dan histori perjalanan.

### Fleet Units (`/fleet/units`)
Daftar/grid semua unit kendaraan beserta status (Aktif, Dalam Perawatan), data STNK, dan pembacaan odometer.

**Kegunaan:** Ini adalah menu inti manajemen aset kendaraan — data dasar semua kendaraan yang dimiliki perusahaan.

**Terhubung ke:** Titik masuk utama; menghubungkan ke detail unit, riwayat perawatan, dan dokumen kendaraan.

### Fleet Drivers (`/fleet/drivers`)
Daftar/roster driver: kontak, status aktif, tanggal kedaluwarsa SIM, dan rating performa.

**Kegunaan:** Manajemen data SDM pengemudi.

**Terhubung ke:** Detail driver serta **Driver Admin** untuk urusan kepatuhan dokumen.

### Driver Admin (`/driver-admin`)
Halaman admin untuk menyetujui dokumen yang diunggah driver (SIM, KTP, dll.) dan permintaan pendaftaran driver baru yang masih tertunda.

**Kegunaan:** Memverifikasi driver baru/perpanjangan dokumen sebelum data mereka dianggap valid di **Fleet Drivers** dan dipakai dalam perhitungan **Fleet Risk**.

### Fleet BBM (`/fleet/fuel`)
Log transaksi pengisian BBM, analitik konsumsi (KM per liter), dan deteksi anomali (indikasi kebocoran/pencurian BBM).

**Kegunaan:** Mengontrol biaya bahan bakar dan mencegah kecurangan/pencurian BBM.

**Terhubung ke:** Datanya masuk ke perhitungan **Fleet Cost/KM** dan **Fleet Dashboard**.

### Fleet Ban — Tires (`/fleet/tires`)
Pelacakan siklus hidup ban tiap kendaraan, pemantauan kedalaman tapak (tread depth), dan jadwal penggantian.

**Kegunaan:** Menjaga keselamatan dan mencegah kendaraan mogok mendadak karena ban aus, sekaligus merencanakan anggaran penggantian ban.

**Terhubung ke:** Data perawatan ini masuk ke **Fleet Cost/KM**.

### Utilisasi (`/fleet/utilization`)
Grafik (mirip heatmap/Gantt) yang menunjukkan tingkat penggunaan kendaraan — waktu aktif, waktu menganggur (idle), dan frekuensi perjalanan.

**Kegunaan:** Mengetahui kendaraan mana yang kurang dimanfaatkan (nganggur terlalu lama) supaya alokasi armada lebih efisien.

**Terhubung ke:** Berkorelasi dengan **Fleet Cost/KM** dan **Route Profit**.

---

## 9. Purchasing & Intelijen Eksekutif

### Purchasing (`/purchasing-intelligence`)
Dashboard evaluasi Purchase Request (PR/permintaan pembelian) — mencakup analisis dampak ke anggaran, deteksi duplikasi pengajuan, peringatan proteksi margin, dan perbandingan dengan tarif kontrak vendor.

**Kegunaan:** Mencegah kebocoran biaya pengadaan (procurement leakage) dan memastikan harga beli dari vendor sesuai kontrak yang sudah disepakati atau wajar dibanding pasar.

**Terhubung ke:** Memvalidasi biaya dengan data di **Vendors** dan **Quotation**.

### Exec Intelligence (`/executive-intelligence`)
Scorecard tingkat tinggi untuk pimpinan, berisi indikator "GO/NO-GO" kesiapan AI, kualitas data, estimasi penghematan biaya (ROI), dan distribusi risiko secara keseluruhan.

**Kegunaan:** Membantu manajemen menilai apakah investasi otomatisasi AI ini benar-benar menghasilkan manfaat/efisiensi biaya.

**Terhubung ke:** Merangkum data dari **CRM**, **Vendors**, dan **Purchasing**.

### Command Center (`/executive-command`)
*(Hanya tampil untuk role tertentu — biasanya admin/manajemen)*. Dashboard pemantauan sistem real-time: status "worker" (proses background), antrian task, dan kesehatan mesin intelijen AI.

**Kegunaan:** Pengawasan level teknis/operasional untuk memastikan seluruh proses otomatis (dispatcher, intake, dll.) berjalan lancar tanpa keterlambatan.

### Quotation (`/quotations`)
Halaman untuk membuat penawaran harga pengiriman (freight, bea cukai, trucking, handling), dengan alur status Draft → Terkirim → Diterima.

**Kegunaan:** Alat bantu tim sales membuat & mengirim penawaran harga ke pelanggan, sekaligus melacak berapa banyak penawaran yang berhasil dimenangkan (win rate).

**Terhubung ke:** Mengambil data pelanggan dari **CRM**; hasilnya jadi bahan pertimbangan di **Purchasing** untuk validasi margin.

---

## 10. Laporan, Notifikasi & Data

### Laporan (`/reports`)
Laporan performa menyeluruh — produktivitas tim, efisiensi AI, dan interaksi pelanggan.

**Kegunaan:** Bahan pengambilan keputusan strategis dan evaluasi performa berkala (mingguan/bulanan).

**Terhubung ke:** Merangkum data dari **AI Tasks**, **Messages**, dan **CRM**.

### Notifikasi (`/notifications`)
Pusat notifikasi dalam aplikasi — alert sistem, update task, dan peringatan pelanggaran SLA.

**Kegunaan:** Memberi tahu staf secara real-time soal task mendesak atau kejadian penting, tanpa harus terus-menerus mengecek Dashboard.

**Terhubung ke:** Dipicu otomatis oleh perubahan status di **AI Tasks** dan kejadian dari AI.

### Portal (`/portal`)
Manajemen akses portal eksternal (untuk vendor atau driver) dengan login khusus, terpisah dari akun staf internal.

**Kegunaan:** Memberi akses terbatas ke pihak luar (vendor/driver) agar mereka bisa melihat/update data tertentu tanpa punya akses penuh ke sistem internal.

### Audit Log (`/audit-log`)
Catatan riwayat lengkap semua aksi penting yang terjadi di sistem dan aktivitas pengguna (siapa mengubah apa, kapan).

**Kegunaan:** Untuk kepatuhan (compliance), keamanan, dan penelusuran masalah — misalnya kalau ada data yang berubah tidak semestinya, bisa dilacak dari sini.

### Analitik (`/analytics`)
Dashboard operasional real-time dengan grafik volume task dan tingkat penyelesaian.

**Kegunaan:** Melihat tren operasional (naik/turun volume kerja) secara visual, melengkapi angka-angka di **Dashboard**.

### Notif WA (`/wa-notifications`)
Pelacakan status pengiriman notifikasi WhatsApp — mana yang terkirim, gagal, dan statistiknya.

**Kegunaan:** Memantau keandalan komunikasi otomatis ke pelanggan/staf lewat WA, termasuk untuk fitur kirim ke grup WA yang baru ditambahkan.

**Terhubung ke:** Berhubungan langsung dengan **AI Tasks** (sumber notifikasi) dan **Messages**.

### Penerima Notif — Notification Receivers (`/notification-receivers`)
Pengaturan daftar kontak/grup yang menerima notifikasi otomatis (WhatsApp/email).

**Kegunaan:** Menentukan siapa saja yang harus diberi tahu untuk jenis kejadian tertentu (misalnya siapa yang dikabari kalau ada task yang telat/SLA breach).

**Terhubung ke:** Dipakai oleh mesin notifikasi untuk mengirim ke tujuan yang tepat, termasuk **Notif WA**.

### Export (`/export`)
Alat untuk mengekspor data (task, pesan, statistik notifikasi) ke format file untuk dianalisis di luar sistem (misalnya Excel).

**Kegunaan:** Memudahkan analisis data lanjutan atau pelaporan ke pihak luar yang butuh data mentah.

### Webhook (`/webhook-setup`)
Halaman panduan konfigurasi integrasi WhatsApp (Fonnte/Meta) — menjelaskan URL webhook yang harus didaftarkan di provider WA.

**Kegunaan:** Referensi teknis saat menghubungkan/mengganti nomor WA gateway ke sistem ini.

**Terhubung ke:** Data yang masuk lewat webhook ini akan tampil di **Messages** dan diproses **AI Dispatcher**.

---

## 11. Administrasi Sistem

### Users (`/users`)
Manajemen akun pengguna internal (admin, staf) beserta penetapan peran/role masing-masing.

**Kegunaan:** Mengatur siapa saja yang boleh mengakses sistem dan sebagai apa (admin, supervisor, staf, dsb.) — ini yang menentukan menu apa saja yang tampil untuk tiap orang.

### Pengaturan (`/settings`)
Konfigurasi global sistem — termasuk kunci API, perilaku bot AI, dan koneksi Fonnte.

**Kegunaan:** Pusat pengaturan teknis yang memengaruhi cara AI memproses pesan dan bagaimana sistem terhubung ke layanan luar (WhatsApp gateway, dll.).

---

## 12. Administrasi Multi-Perusahaan (Holding)

Menu-menu berikut biasanya hanya tampil untuk role **super admin** — dipakai jika sistem ini melayani lebih dari satu perusahaan (holding/grup usaha) sekaligus.

### Onboarding Setup (`/onboarding`)
Wizard langkah demi langkah untuk menyiapkan sebuah perusahaan baru di sistem: profil perusahaan, koneksi WhatsApp gateway, data tim, data pelanggan/vendor awal, dan unit armada. Ada juga fitur "Tes AI" untuk mensimulasikan pemrosesan pesan WA sebelum go-live.

**Kegunaan:** Panduan setup awal supaya perusahaan baru bisa mulai memakai sistem tanpa harus mengatur semuanya secara terpisah-pisah.

**Terhubung ke:** Langsung terhubung ke **CRM**, **Vendors**, dan **Fleet Units**.

### Company Governance (`/company-governance`)
Pengawasan teknis dan operasional terhadap **isolasi data antar-perusahaan** (memastikan data satu perusahaan tidak bocor/tercampur ke perusahaan lain), skor kesehatan tiap perusahaan, audit keamanan API, dan pemakaian sumber daya (storage, jumlah task AI, dll.).

**Kegunaan:** Menjamin setiap perusahaan (tenant) dalam sistem multi-perusahaan ini benar-benar terisolasi dan sehat secara teknis.

### Onboarding Factory (`/company-onboarding`)
Alat untuk membuat perusahaan klien baru secara cepat dari template industri, termasuk membuat akun admin pertama dan mengisi data awal secara otomatis (seeding).

**Kegunaan:** Mempercepat proses "buka cabang"/onboarding klien baru dalam skala besar, dibanding mengatur manual satu-satu lewat Onboarding Setup.

### Holding Dashboard (`/holding-dashboard`)
Dashboard gabungan yang merangkum KPI dari **semua perusahaan** dalam grup (total task, status armada, persetujuan PR, dll.), lengkap dengan ringkasan otomatis dari AI ("AI Briefing") yang merangkum kondisi grup jadi catatan yang bisa langsung ditindaklanjuti.

**Kegunaan:** Sudut pandang level direksi/holding untuk melihat performa seluruh anak perusahaan dalam satu layar.

### AI Operations (`/ai-operations`)
Pemantauan dan pemeliharaan mesin AI itu sendiri — daftar semua modul AI yang aktif (Intake, Validasi, Memory), statistik pemakaian, pelacakan kegagalan (error rate), dan metrik kualitas (skor keyakinan/confidence AI).

**Kegunaan:** Untuk tim teknis memastikan "mesin" AI di balik semua otomatisasi ini tetap sehat dan akurat, mirip **AI Observability** tapi dengan fokus lebih ke operasional modul AI-nya secara rinci.

---

## Ringkasan Peran (Role) — menu mana untuk siapa

Tidak semua orang melihat semua menu. Beberapa aturan umum berdasarkan role akun:

| Kelompok Menu | Role yang bisa akses |
|---|---|
| Operasional harian (Dashboard, AI Tasks, Messages, dst.) | Semua role staf ke atas |
| Fleet, CRM, Vendor, Purchasing | Staf/role terkait divisi tersebut, serta admin |
| Onboarding Setup, AI Operations | `super_admin`, `company_admin`, `owner`, `supervisor` |
| Company Governance | `super_admin`, `company_admin` |
| Onboarding Factory, Holding Dashboard, Command Center | `super_admin` saja |

Jadi kalau ada menu yang disebut di dokumen ini tapi tidak muncul di sidebar Anda, kemungkinan besar itu karena akun Anda bukan role yang berwenang untuk mengaksesnya — bukan berarti fiturnya tidak ada.
