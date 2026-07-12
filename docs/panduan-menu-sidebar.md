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

> **Catatan:** Tergantung peran (role) akun Anda, mungkin ada menu tambahan di sidebar yang tidak terlihat di screenshot (misalnya menu untuk Fleet, CRM, Vendor, Purchasing, Laporan, Notifikasi WA, Pengaturan, dll.) — ini karena aplikasi digunakan lintas divisi dan sebagian menu hanya muncul untuk role tertentu (misalnya admin atau super admin).
