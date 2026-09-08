# Dokumentasi Lengkap AI Task Center

**Bahasa:** Indonesia  
**Produk:** AI Task Center  
**Jenis dokumen:** Panduan pengguna, arsitektur proses, database, AI pipeline, API, dan operasional  
**Sumber kebenaran teknis:** kode yang sedang berjalan di `artifacts/ai-task-center`, `artifacts/api-server`, `lib/db`, dan `scripts`

> Dokumen ini menjelaskan implementasi aktual yang ditemukan di repository. Beberapa dokumen lama masih menyebut model awal aplikasi (`tasks`, `activity`, atau webhook lama); bagian **Catatan penting dan perbedaan dokumentasi** di akhir menjelaskan perbedaannya.

---

## 1. Ringkasan Produk

AI Task Center adalah platform operasional yang mengubah komunikasi WhatsApp menjadi pekerjaan terstruktur. Sistem menerima pesan customer, vendor, driver, atau staf; menyimpan pesan tersebut; membaca intent menggunakan AI dan knowledge base; mengumpulkan data yang belum lengkap; membuat task; mengirim task ke tim/divisi yang sesuai; memvalidasi dokumen; serta memberikan monitoring, notifikasi, audit, dan analitik.

### Tujuan utama

1. **Tidak ada pesan customer yang hilang** karena semua pesan inbound tersimpan di database.
2. **Pesan bebas di WhatsApp menjadi data operasional** seperti intent, customer, kategori, divisi, prioritas, SLA, dan task.
3. **AI tidak langsung memaksa membuat task** jika data belum cukup. Sistem dapat menjalankan conversation intake atau mengirim mini form.
4. **Task dapat ditelusuri end-to-end** dari pesan, session intake, dokumen, audit, assignment, komentar, timeline, hingga notifikasi.
5. **Keputusan AI dapat diawasi dan diperbaiki** melalui Knowledge Base, AI Training, Test Suite, Governance, dan AI Observability.
6. **Data operasional dapat dipakai lintas domain**: CRM, vendor, fleet, purchasing, quotation, dan executive intelligence.

### Teknologi utama

| Area | Implementasi |
|---|---|
| Frontend | React, Vite, Tailwind CSS, shadcn/ui, Wouter, TanStack Query |
| Backend | Node.js, TypeScript, Express 5 |
| Database | PostgreSQL pada Supabase, diakses melalui Drizzle ORM dan query SQL terkontrol |
| AI | OpenAI melalui `OPENAI_API_KEY` atau proxy AI yang dikonfigurasi |
| WhatsApp | Fonnte dan dukungan WhatsApp Business webhook |
| File | Supabase Storage/object storage melalui server |
| Realtime | Server-Sent Events (SSE) in-process |
| Validasi | Zod, Drizzle-Zod, validasi business rule di service |

---

## 2. Struktur Aplikasi

```text
AI Task Center
├── Frontend React/Vite
│   ├── artifacts/ai-task-center/src/App.tsx
│   ├── artifacts/ai-task-center/src/components/layout/app-layout.tsx
│   └── artifacts/ai-task-center/src/pages/
├── API Server Express
│   ├── artifacts/api-server/src/app.ts
│   ├── artifacts/api-server/src/routes/
│   └── artifacts/api-server/src/lib/
├── Database contract
│   └── lib/db/src/schema/
├── API contract/client
│   └── lib/api-spec, lib/api-client-react, lib/api-zod
└── Migration/seed/operational scripts
    └── scripts/
```

### Pola request

1. Browser menyimpan token login.
2. Frontend memanggil endpoint relatif seperti `/api/ai-tasks`, bukan alamat `localhost` yang ditulis permanen.
3. Express memasang seluruh router di bawah prefix `/api`.
4. Router memvalidasi autentikasi, role, parameter, dan company scope.
5. Service membaca atau menulis PostgreSQL Supabase.
6. Perubahan tertentu memicu audit log, notifikasi, dan event SSE.

### Login dan company scope

1. Frontend mengirim `POST /api/auth/login` dengan email dan password.
2. Backend membaca `users` dari database Supabase yang sesuai dengan `NODE_ENV`.
3. Password diperiksa menggunakan `bcryptjs`.
4. User aktif menerima JWT dengan masa berlaku tujuh hari.
5. Frontend menyimpan token pada `ai_task_center_token` dan user pada `ai_task_center_user`.
6. Request berikutnya menggunakan header `Authorization: Bearer <JWT>`.
7. Sebagian besar query operasional harus dibatasi `company_id`.
8. `super_admin` memiliki akses lintas perusahaan sesuai mekanisme scoping pada endpoint.

Role yang digunakan di berbagai bagian aplikasi meliputi `super_admin`, `company_admin`, `owner`, `supervisor`, `admin`, serta role operasional seperti staff/divisi. Tidak semua role mempunyai akses edit pada setiap halaman.

---

## 3. Fungsi Setiap Menu Sidebar

Sidebar utama didefinisikan pada `artifacts/ai-task-center/src/components/layout/app-layout.tsx`. Shell aplikasi hanya tampil untuk user yang sudah login. Route dan page dihubungkan pada `artifacts/ai-task-center/src/App.tsx`.

### 3.1 Menu operasional utama

| Menu | Route | Akses tampilan | Fungsi |
|---|---|---|---|
| **Dashboard** | `/` | Semua user login | Ringkasan jumlah task, status, aktivitas terbaru, statistik pesan/dokumen/tim, dan monitoring operasional. |
| **AI Tasks** | `/ai-tasks` | Semua user login | Papan kerja task AI. User dapat melihat, memfilter, membuka detail, mengubah status, mengatur prioritas, dan melakukan assignment sesuai hak akses. |
| **Messages** | `/messages` | Semua user login | Inbox pesan WhatsApp masuk/keluar. Menampilkan customer, nomor, intent, status proses, tombol balas WA, dan penanda selesai. |
| **Documents** | `/documents` | Semua user login | Daftar dokumen yang terkait dengan task/customer, upload file, melihat hasil audit, dan mengelola dokumen sesuai izin. |
| **Team** | `/team` | Semua user login | Direktori anggota tim, role, divisi, nomor telepon, status aktif, skill, kapasitas, dan beban task. |

#### Dashboard

Dashboard adalah halaman ringkasan. Fungsinya bukan menggantikan AI Tasks, tetapi memberi jawaban cepat atas pertanyaan:

- Berapa task baru?
- Berapa task yang menunggu dokumen?
- Berapa task siap direview atau sedang dikerjakan?
- Apakah ada task overdue?
- Aktivitas apa yang baru terjadi?

Dashboard menggunakan data task, message, document, team, activity/audit, dan event realtime jika tersedia.

#### AI Tasks

AI Tasks adalah pusat pekerjaan. Task dapat berasal dari:

- pesan WhatsApp yang diproses AI;
- intake yang sudah lengkap;
- mini form;
- order/logistic sync;
- pembuatan manual oleh user atau sistem lain.

Field penting task:

- nomor task;
- judul dan deskripsi;
- customer dan nomor telepon;
- source;
- category/division;
- priority;
- status;
- assignee;
- vendor/driver/plate number bila relevan;
- SLA dan due date;
- AI intent dan confidence;
- AI summary;
- missing data;
- required action;
- sentiment;
- quotation information.

Status task yang digunakan:

```text
new_inquiry
waiting_documents
documents_received
audit_in_progress
missing_data
ready_for_review
assigned
in_progress
waiting_customer
waiting_vendor
quotation_ready
approved_by_customer
completed
cancelled
```

#### Messages

Messages menyimpan dan menampilkan percakapan mentah. Dari halaman ini user dapat:

- mencari pesan berdasarkan nama, nomor, atau intent;
- memfilter pesan;
- melihat badge seperti `intake:started`, `intake:sport_center_booking`, atau `form_menu_1`;
- membalas customer lewat WhatsApp;
- memproses ulang pesan bila diperlukan;
- menandai pesan selesai.

Angka seperti **Total Pesan**, **Belum Dibaca**, **Diproses AI**, dan **Ada Task** pada screenshot merupakan metrik inbox, bukan jumlah task.

#### Documents

Documents menjadi tempat penyimpanan dokumen operasional. File dapat berasal dari:

- upload user di dashboard;
- attachment WhatsApp;
- mini form;
- customer/vendor/driver portal.

Dokumen dapat diteruskan ke document validation atau AI audit. Jangan menganggap nama file sebagai bukti bahwa file sudah berhasil tersimpan; status attachment dan audit harus diperiksa.

#### Team

Data Team dipakai oleh AI Dispatcher dan proses assignment. Data penting:

- nama;
- role;
- divisi;
- nomor WhatsApp;
- email;
- status aktif;
- skill;
- kapasitas maksimal task;
- jumlah task aktif saat ini.

Nomor telepon kosong berarti notifikasi WhatsApp langsung ke anggota tersebut dapat dilewati oleh notification service.

---

### 3.2 Menu intake dan form

| Menu | Route | Fungsi |
|---|---|---|
| **AI Intake** | `/intake-sessions` | Memantau sesi pengumpulan data AI, field yang sudah terkumpul, field yang masih kurang, status session, dan tindakan mark ready/cancel/create task/send form. |
| **Conv. Intake** | `/conversation-intake` | Melihat percakapan intake langkah demi langkah: pertanyaan AI, jawaban customer, field hasil ekstraksi, dan hasil konversi ke task. |
| **Doc Validation** | `/document-intake` | Melihat audit dokumen, confidence, rule yang gagal, konteks task/session, serta melakukan review atau validasi manual. |
| **Mini Form Config** | `/mini-form-config` | Mengatur template mini form, mode intake, daftar field, required field, urutan, dan hubungan form dengan intent. |
| **Mini Form Analytics** | `/mini-form-analytics` | Mengukur session form, form yang dibuka/dikirim, completion, conversion, dan performa intake pada periode tertentu. |
| **Test Suite AI** | `/conversation-tests` | Menjalankan simulasi percakapan tanpa mengirim WhatsApp sungguhan, lalu memeriksa intent, field, route, task, dan quality gate. |

#### Perbedaan AI Intake dan Conv. Intake

- **AI Intake** berfokus pada status dan kontrol session: apakah data belum lengkap, siap dibuat task, dibatalkan, atau perlu dikirimkan form.
- **Conv. Intake** berfokus pada isi percakapan dan urutan interaksi, sehingga berguna untuk audit kualitas pertanyaan dan jawaban.

#### Mode intake

Route intake dapat memilih salah satu mode:

- **conversation**: AI mengumpulkan field melalui chat;
- **mini_form**: sistem mengirim link form;
- **hybrid**: AI mengumpulkan sebagian data lewat percakapan, kemudian mengirim form untuk field yang lebih cocok diisi secara terstruktur;
- **direct task**: data dianggap cukup dan langsung dibuat task.

---

### 3.3 Menu otak AI, routing, dan kualitas

| Menu | Route | Fungsi |
|---|---|---|
| **AI Dispatcher** | `/dispatcher` | Mengatur antrian dispatch, kandidat assignee, pembagian berdasarkan divisi/skill/beban, dan keputusan assignment. |
| **Knowledge Base** | `/knowledge-base` | Mengelola intent, keyword rule, service catalog, data template, document template, dan konfigurasi pengetahuan operasional. |
| **Governance** | `/governance` | Mengelola SLA, escalation, approval rule, batas kewenangan, dan aturan tata kelola. |
| **AI Training** | `/training` | Mengelola correction, dataset, prompt, experiment, serta feedback untuk meningkatkan kualitas AI. |
| **AI Observability** | `/ai-observability` | Memantau health, error, latency, confidence, penggunaan model, dan kualitas hasil AI. |
| **Creative AI** | `/creative-ai` | Membuat output kreatif berbasis AI seperti permintaan logo/creative task, terpisah dari pipeline task operasional biasa. |

#### Knowledge Base

Knowledge Base adalah sumber aturan bisnis yang dipakai oleh IntentEngine. Contoh data:

- kode intent seperti booking, quotation, complaint, tenant, PPJK, trucking, atau sport center;
- keyword dan bobot keyword;
- service/catalog;
- template pertanyaan;
- template balasan;
- field yang dibutuhkan;
- template dokumen;
- mode intake.

Perubahan keyword mempunyai dampak langsung ke klasifikasi pesan. Keyword yang terlalu pendek dapat menimbulkan false positive. Perubahan besar harus diuji melalui Test Suite AI sebelum digunakan pada traffic produksi.

#### Governance

Governance mengatur keputusan yang tidak boleh hanya bergantung pada model AI, misalnya:

- target SLA;
- eskalasi ketika SLA terlewati;
- approval wajib;
- minimum/maximum amount;
- role yang boleh memutuskan;
- pembatasan berdasarkan company/division.

#### AI Observability

Gunakan halaman ini untuk membedakan:

- AI tidak menemukan intent;
- intent benar tetapi field belum lengkap;
- routing salah;
- task gagal disimpan;
- notifikasi gagal;
- model lambat/error;
- database atau service eksternal bermasalah.

---

### 3.4 Menu customer, vendor, dan fleet

| Menu | Route | Fungsi |
|---|---|---|
| **CRM** | `/crm` | Data customer/perusahaan, PIC, kontak, alamat, kode customer, dan riwayat task. |
| **Vendors** | `/vendors` | Daftar vendor/supplier, layanan, grade, risk, performance, readiness, capability, dan vendor memory. |
| **Vendor Review** | `/admin/vendor-review` | Review pendaftaran vendor self-service, dokumen, approve/reject/request revision. |
| **Fleet Dashboard** | `/fleet/dashboard` | Ringkasan unit, driver, dokumen expired, risk, cost/km, dan performa. |
| **Fleet Risk** | `/fleet/risk` | Risiko kendaraan/driver, safety incident, risk score, dan analisis perilaku. |
| **Fleet Cost/KM** | `/fleet/cost` | Biaya per kilometer dari BBM, maintenance, ban, dan komponen lain. |
| **Route Profit** | `/fleet/route-profitability` | Pendapatan, biaya, volume, dan margin berdasarkan rute. |
| **Fleet Units** | `/fleet/units` | Master kendaraan, status, STNK, odometer, dan detail unit. |
| **Fleet Drivers** | `/fleet/drivers` | Roster driver, kontak, status, SIM, rating, dan performa. |
| **Driver Admin** | `/driver-admin` | Review pendaftaran driver dan dokumen driver. |
| **Fleet BBM** | `/fleet/fuel` | Transaksi BBM, konsumsi, biaya, dan anomaly detection. |
| **Fleet Ban** | `/fleet/tires` | Siklus hidup ban, tread depth, rotasi, dan jadwal penggantian. |
| **Utilisasi** | `/fleet/utilization` | Penggunaan unit, perjalanan, idle time, dan tingkat utilisasi. |

Detail fleet lain yang tersedia di route aplikasi mencakup:

- `/fleet/units/:id`;
- `/fleet/drivers/:id`;
- `/fleet/documents`;
- `/fleet/maintenance`;
- `/fleet/fuel`;
- `/fleet/tires`;
- `/fleet/utilization`.

---

### 3.5 Menu purchasing dan executive

| Menu | Route | Visibility | Fungsi |
|---|---|---|---|
| **Purchasing** | `/purchasing-intelligence` | Semua user yang memiliki akses menu | Evaluasi purchase request, budget impact, duplicate request, price benchmark, margin protection, approval, dan contract rate vendor. |
| **Exec Intelligence** | `/executive-intelligence` | Semua user yang memiliki akses menu | Scorecard kesiapan data/AI, risiko, ROI, dan ringkasan intelijen untuk manajemen. |
| **Command Center** | `/executive-command` | `super_admin`, `company_admin`, `owner` | Monitoring real-time worker, task queue, background process, dan kesehatan engine. |
| **Quotation** | `/quotations` | Semua user yang memiliki akses menu | Membuat dan melacak quotation, misalnya freight, customs, trucking, dan handling. |

Status quotation dan validasi purchasing harus dibaca bersama data customer, vendor, tarif kontrak, dan margin. Quotation bukan pengganti task; quotation dapat menjadi salah satu output atau konteks task.

---

### 3.6 Menu laporan, notifikasi, akses, dan administrasi

| Menu | Route | Fungsi |
|---|---|---|
| **Laporan** | `/reports` | Laporan produktivitas, efisiensi AI, interaksi customer, dan ringkasan periode. |
| **Notifikasi** | `/notifications` | Notifikasi internal aplikasi untuk task, SLA, approval, dan event penting. |
| **Portal** | `/portal` | Entry point portal eksternal/vendor/driver dan status aksesnya. |
| **Audit Log** | `/audit-log` | Riwayat aksi penting: siapa melakukan apa, kapan, pada entity apa, dan hasilnya. |
| **Analitik** | `/analytics` | Grafik volume task, completion, dan tren operasional. |
| **Notif WA** | `/wa-notifications` | Status pengiriman notifikasi WhatsApp, sukses/gagal, receiver, dan retry/diagnostic. |
| **Penerima Notif** | `/notification-receivers` | Daftar nomor/group dan routing penerima notifikasi otomatis. |
| **Export** | `/export` | Export data operasional sesuai endpoint dan hak akses. |
| **Webhook** | `/webhooks` | Konfigurasi atau monitoring webhook/integrasi yang tersedia. |
| **Users** | `/users` | Administrasi user login, status aktif, role, dan company scope. |
| **Pengaturan** | `/settings` | Pengaturan company/system yang tersedia untuk role yang berwenang. |
| **Onboarding Setup** | `/onboarding` | Wizard onboarding dan setup awal AI/company. |
| **Company Governance** | `/company-governance` | Governance per company; hanya `super_admin` atau `company_admin`. |
| **Onboarding Factory** | `/company-onboarding` | Provisioning/onboarding company; hanya `super_admin`. |
| **Holding Dashboard** | `/holding-dashboard` | Ringkasan lintas company/holding; hanya `super_admin`. |
| **AI Operations** | `/ai-operations` | Monitoring readiness dan operasi AI; tampil untuk `super_admin`, `company_admin`, `owner`, atau `supervisor`. |

Footer sidebar juga menyediakan:

- **Profile**: `/profile`, untuk melihat profile user;
- **Keluar**: menghapus sesi/token melalui fungsi logout.

---

## 4. Alur AI Task dari WhatsApp sampai Selesai

### 4.1 Gambaran alur

```text
WhatsApp/Fonnte
      │
      ▼
POST /api/whatsapp/webhook
      │
      ├── filter echo bot / quick message
      ├── normalisasi nomor, group JID, message type, attachment
      ├── simpan whatsapp_messages
      ├── command router / greeting / cancel / close gate
      ├── active intake session?
      │       ├── ya  → process intake → update session / form / task
      │       └── tidak
      ├── resolve intent + extract fields
      ├── governance/routing/mini-form decision
      │       ├── missing data → conversation intake
      │       ├── structured input → mini form / hybrid
      │       └── complete → create ai_tasks
      ├── update message/task/customer context
      ├── send reply or staff notification
      └── emit SSE: new_message / new_task / task_updated
```

Implementasi utama:

- webhook dan `processIncomingMessage`: `artifacts/api-server/src/routes/whatsapp.ts`;
- IntentEngine: `artifacts/api-server/src/lib/intent-engine.ts`;
- adapter AI WhatsApp: `artifacts/api-server/src/lib/whatsapp-ai.ts`;
- IntakeEngine: `artifacts/api-server/src/lib/intake-engine.ts`;
- mini-form routing: `artifacts/api-server/src/lib/mini-form-router.ts`;
- task service: `artifacts/api-server/src/lib/task-service.ts`;
- SSE: `artifacts/api-server/src/lib/sse.ts`.

### 4.2 Langkah 1 — webhook menerima pesan

Endpoint aktif:

```text
POST /api/whatsapp/webhook
```

Payload dapat berasal dari Fonnte atau WhatsApp Business. Backend mengambil nilai yang tersedia untuk:

- `from`, `sender`, `sender_phone`, atau `phone`;
- `name`, `pushname`, atau `sender_name`;
- `message`, `pesan`, atau field pesan lain;
- `device`;
- `group_jid`;
- timestamp;
- attachment URL dan tipe pesan.

Nomor personal dinormalisasi agar suffix seperti `@s.whatsapp.net` atau `@c.us` tidak menyebabkan session/customer lookup gagal. Untuk group, sistem membalas ke group JID yang sesuai.

### 4.3 Langkah 2 — perlindungan echo loop

Fonnte dapat memantulkan kembali pesan yang dikirim bot. Sistem menyaring:

- payload `quick=true` atau `quick=1`;
- isi yang berisi link `/mini-form/`;
- kalimat balasan bot yang dikenal;
- marker `_AI Task Center_`.

Pesan yang terdeteksi sebagai echo tidak boleh masuk lagi ke pipeline AI karena dapat membuat loop dan task duplikat.

### 4.4 Langkah 3 — simpan pesan mentah

Pesan disimpan ke tabel `whatsapp_messages` sebelum pipeline AI berakhir. Field penting:

- company;
- sender/from;
- sender name;
- body/message text;
- message type;
- direction `inbound` atau `outbound`;
- attachment URL;
- raw payload;
- timestamp;
- `processed`;
- `ai_processed`;
- hubungan ke task/customer bila sudah diketahui.

Penyimpanan pesan dibuat agar kegagalan database tidak membuat pipeline AI berhenti secara diam-diam; error tetap dicatat dan sistem mencoba melanjutkan sesuai alur yang aman.

### 4.5 Langkah 4 — command dan pre-gate

Sebelum intent AI umum dijalankan, sistem dapat menangani:

- command WhatsApp;
- greeting/menu;
- pembatalan;
- kalimat penutupan;
- command customer, driver, vendor, supervisor, atau executive sesuai role/nomor.

Tujuannya agar perintah deterministik tidak salah dibaca sebagai intent bisnis umum.

### 4.6 Langkah 5 — cek active intake session

Jika pengirim memiliki session intake aktif, pesan diarahkan ke session tersebut. AI tidak memulai intent baru setiap kali customer menjawab pertanyaan intake.

IntakeEngine melakukan:

1. membaca intent dan template field;
2. mengambil field dari jawaban baru;
3. menggabungkan hasil dengan `collected_fields`;
4. menjalankan fallback regex/deterministic bila ekstraksi model gagal;
5. memeriksa required field;
6. mengirim pertanyaan berikutnya jika belum lengkap;
7. mengirim mini form bila mode hybrid/mini form;
8. membuat task ketika semua field penting tersedia;
9. menandai session sebagai submitted/completed untuk mencegah re-processing.

### 4.7 Langkah 6 — resolve intent

`resolveIntent()` menggunakan knowledge base dan konteks customer. Secara konseptual lapisannya meliputi:

1. normalisasi pesan dan konteks;
2. pencocokan intent/keyword berbobot;
3. service/category/division mapping;
4. template dan intake mode;
5. fallback/AI reasoning dan confidence.

Hasilnya dapat berisi:

- `intent`;
- `intentCode`;
- `category`;
- `division`;
- `confidence`;
- `missingData`;
- `requiredAction`;
- `fields`;
- `sentiment`;
- `summary`;
- `resolution`;
- `intake mode`.

Intent resolution menggunakan cache TTL agar lookup knowledge base tidak berulang tanpa batas. Perubahan knowledge base perlu memperhatikan invalidasi atau TTL cache.

### 4.8 Langkah 7 — pilih route task

`routeIntentToFlow()` menentukan apakah pesan:

- langsung membuat task;
- memulai conversation intake;
- mengirim mini form;
- masuk mode hybrid;
- diteruskan ke jalur khusus domain seperti sport center, fleet, vendor, purchasing, atau quotation.

Decision ini juga dipengaruhi oleh:

- data template;
- required fields;
- customer memory;
- governance;
- status task/session sebelumnya;
- attachment;
- jenis intent.

### 4.9 Langkah 8 — membuat task

Task utama disimpan di `ai_tasks`. Saat task dibuat, sistem dapat melakukan beberapa operasi tambahan:

- menghubungkan task dengan message;
- mengisi customer dan customer context;
- menentukan task number;
- mengisi AI summary, intent, confidence, missing data, dan sentiment;
- menentukan status awal;
- menentukan priority, category, division, SLA;
- membuat audit/timeline;
- mengirim admin notification;
- mengirim notifikasi WA ke receiver/divisi;
- mengirim event SSE `new_task`.

Task tidak boleh dibuat dua kali hanya karena customer mengirim beberapa pesan cepat. Sistem memakai dedupe/session guard dan order sync juga menggunakan task number/order number sebagai kunci deduplikasi.

### 4.10 Langkah 9 — assignment dan pengerjaan

AI Dispatcher menggunakan informasi berikut:

- division/category task;
- skill team member;
- status aktif;
- current task count;
- max active tasks;
- role;
- kapasitas dan aturan governance.

Hasil rekomendasi dapat dikonfirmasi atau diubah user. Perubahan assignment dicatat pada:

- `ai_tasks.assigned_to` / `assigned_to_id`;
- `task_assignments`;
- `task_timeline`;
- `audit_logs`;
- notifikasi internal/WhatsApp bila dikonfigurasi.

### 4.11 Langkah 10 — dokumen, approval, SLA, selesai

Task dapat berpindah melalui status:

```text
new_inquiry
→ missing_data / waiting_documents
→ documents_received
→ audit_in_progress
→ ready_for_review
→ assigned
→ in_progress
→ waiting_customer / waiting_vendor
→ completed
```

Branch lain dapat menuju `quotation_ready`, `approved_by_customer`, atau `cancelled`.

Scheduler dapat:

- mengirim follow-up 24h/72h/168h;
- menandai SLA overdue;
- melakukan escalation;
- menjalankan approval timeout;
- mengirim notifikasi;
- memperbarui audit dan timeline.

---

## 5. Proses Database

### 5.1 Database yang digunakan

AI Task Center menggunakan PostgreSQL pada Supabase. Project development dan production dipisahkan:

| Runtime | PostgreSQL | Supabase API/Storage |
|---|---|---|
| Development | `SUPABASE_DATABASE_URL_DEV` | `SUPABASE_URL_DEV` + `SUPABASE_SERVICE_ROLE_KEY_DEV` |
| Production | `SUPABASE_DATABASE_URL` | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |

Pemilihan koneksi dilakukan berdasarkan `NODE_ENV`. Jangan menaruh connection string atau service role key di source code, dokumentasi, log, atau screenshot.

### 5.2 Cara akses database

Ada dua lapisan:

1. **Drizzle ORM**
   - definisi schema berada di `lib/db/src/schema`;
   - query typed dipakai oleh route/service utama;
   - perubahan schema perlu dipastikan ada pada database Supabase yang aktif.
2. **Raw SQL startup migration/query**
   - `artifacts/api-server/src/app.ts` menjalankan sebagian `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE`;
   - beberapa domain yang berkembang cepat memiliki tabel runtime yang belum sepenuhnya tercermin di Drizzle;
   - script di `scripts/` dipakai untuk migrasi dan seed khusus.

Karena kedua lapisan ini hidup berdampingan, perubahan database harus memeriksa schema Drizzle **dan** migrasi runtime/script. Jangan hanya menambah field pada satu tempat.

### 5.3 Entitas inti dan relasi

```text
users ───────────────┐
team_members ────────┼── assignment/actor
                     │
customers ───── ai_tasks ───── task_comments
     │               │  ├───── task_assignments
     │               │  ├───── task_timeline
     │               │  └───── task_attachments
     │               │
     └──── whatsapp_messages
                     │
              documents/document_audits
```

### 5.4 Katalog tabel database

Nama di bawah berasal dari schema Drizzle dan/atau migrasi runtime. Beberapa tabel lama masih ada untuk kompatibilitas, tetapi bukan jalur utama pembuatan task baru.

#### A. Identitas, company, dan akses

| Tabel | Peran |
|---|---|
| `users` | Akun login, password hash, role, company, divisi, status aktif, login terakhir. |
| `team_members` | Anggota operasional yang dapat menerima task, termasuk phone, skill, kapasitas, dan current task count. |
| `company_settings` | Konfigurasi company dan nilai operasional. |
| `notification_receivers` | Receiver/group tujuan notifikasi berdasarkan event/divisi/company. |
| `admin_notifications` | Notifikasi internal untuk dashboard/admin. |
| `public_tokens` | Token terbatas untuk mini task, customer data, atau akses publik tertentu. |

#### B. Customer dan pesan

| Tabel | Peran |
|---|---|
| `customers` | Master customer/perusahaan, kontak, alamat, kode, dan company scope. |
| `customer_contexts` | Konteks customer yang dipakai untuk pengayaan task dan conversational flow. |
| `whatsapp_messages` | Pesan WhatsApp inbound/outbound, raw payload, attachment, status processing, dan relasi task/customer. |
| `whatsapp_notifications` | Log/queue notifikasi WhatsApp dan status pengiriman. |
| `activity` | Model aktivitas lama; masih dapat muncul pada compatibility flow, tetapi bukan pengganti audit log utama. |

#### C. Task dan pekerjaan

| Tabel | Peran |
|---|---|
| `ai_tasks` | Task utama hasil AI/manual/sync. Menyimpan status, customer, source, intent, AI fields, assignment, SLA, dan quotation info. |
| `task_assignments` | Riwayat assignment task dan perubahan assignee. |
| `task_comments` | Komentar atau komunikasi internal pada task. |
| `task_timeline` | Event kronologis task seperti status, assignment, dokumen, dan perubahan penting. |
| `task_attachments` | Attachment task, status upload/OCR, dan metadata file. |
| `operational_checklists` | Checklist operasional yang terkait task/domain. |
| `tasks` | Model task generik/legacy untuk kompatibilitas; pipeline AI utama menggunakan `ai_tasks`. |

Field penting `ai_tasks`:

```text
id, company_id, task_number, source
customer_id, customer_name, customer_phone
title, description, category, division, priority, status
assigned_to, assigned_to_id, assigned_role, assigned_division, assigned_vendor
driver_name, driver_phone, plate_number
quotation_amount, quotation_notes
due_date, sla_hours, overdue_at, completed_at, sla_status
last_customer_reply_at, follow_up_count
ai_summary, ai_intent, missing_data, required_action
admin_notes, ai_confidence_score, customer_sentiment
created_at, updated_at
```

#### D. Dokumen dan validasi

| Tabel | Peran |
|---|---|
| `documents` | Metadata dokumen yang diunggah/dikaitkan ke operasi. |
| `document_audits` | Hasil AI audit dokumen, score, issue, dan status. |
| `document_intake_audits` | Riwayat validation intake dokumen. |
| `document_validation_rules` | Aturan validasi dokumen yang aktif/nonaktif. |
| `document_templates` | Template dokumen yang diperlukan per intent/service. |
| `document_template_fields` | Field yang harus ada dalam template dokumen. |

Flow dokumen:

```text
upload / attachment
  → object storage
  → metadata task_attachments/documents
  → document validation rule
  → OCR/vision bila diperlukan
  → document audit
  → task status/notification
```

Payment proof dan dokumen private harus diunduh/diproses melalui server menggunakan service role, bukan URL publik anonim.

#### E. Knowledge base dan intake

| Tabel | Peran |
|---|---|
| `intent_master` | Daftar intent dan konfigurasi dasar intent. |
| `keyword_rules` | Keyword/pattern, bobot, dan relasi ke intent. |
| `service_catalog` | Catalog service/domain. |
| `data_templates` | Template data/intake, mode intake, intent code, dan konfigurasi form. |
| `data_template_fields` | Field intake, tipe, required, urutan, dan metadata ekstraksi. |
| `conversation_intake_sessions` | Session chat intake, collected fields, status, next question, dan relasi task. |
| `intake_sessions` | Session intake tambahan/compatibility untuk flow tertentu. |
| `training_*` | Dataset, corrections, prompts, eksperimen, dan feedback AI sesuai schema training. |
| `conversation_test_cases` | Skenario pengujian percakapan. |
| `conversation_test_runs` | Satu eksekusi test suite. |
| `conversation_test_results` | Hasil per case: intent, route, field, task, dan pass/fail. |

#### F. Governance, audit, dan observability

| Tabel | Peran |
|---|---|
| `governance_*` | SLA, approval rule, escalation, policy, dan konfigurasi governance sesuai domain. |
| `audit_logs` | Audit trail aksi sistem/user dengan module, entity, actor, company, dan payload ringkas. |
| `dispatcher_logs` | Riwayat keputusan/rekomendasi dispatch. |
| `follow_up_logs` | Riwayat follow-up otomatis dan hasil pengiriman. |
| `whatsapp_commands` | Definisi command WhatsApp. |
| `whatsapp_command_logs` | Riwayat command yang diterima/dijalankan. |
| `whatsapp_usage_metrics` | Metrik penggunaan WhatsApp/command. |

#### G. Customer memory dan vendor memory

Schema memory menyimpan insight operasional yang dapat dipakai sebagai konteks AI. Domain ini mencakup:

- customer profile/preferences;
- customer interactions;
- customer events;
- customer memory snapshots;
- vendor preferences;
- vendor risk assessments;
- vendor performance snapshots;
- vendor capabilities;
- vendor document registry;
- vendor memory snapshots;
- vendor memory events.

Memory tidak menggantikan master customer/vendor. Memory adalah konteks dan histori untuk membantu resolusi intent, recommendation, risk, dan follow-up.

#### H. Purchasing dan executive intelligence

Schema purchasing/intel mencakup:

- purchase requests;
- duplicate/benchmark signals;
- vendor contract rates;
- budget impact;
- margin protection;
- approval request/decision;
- intelligence readiness;
- performance/metric snapshots;
- executive summaries;
- risk and recommendation data.

Beberapa tabel intelijen berada pada database Supabase dan dibaca melalui helper `supabaseQuery` sesuai implementasi service.

#### I. Fleet

Schema/migrasi fleet mencakup domain:

- `fleet_units`;
- `fleet_drivers`;
- fleet documents;
- fleet maintenance;
- fleet fuel/BBM;
- fleet tires/ban;
- fleet utilization;
- fleet risk/incidents;
- fleet route profitability;
- fleet driver memory/performance;
- fleet reports.

Fleet memiliki scheduler dan dashboard tersendiri, tetapi dapat menjadi sumber data untuk task AI, vendor, cost, executive intelligence, dan briefing.

#### J. Portal dan domain tambahan

Runtime migration juga membuat atau memakai tabel untuk:

- vendor portal tokens/status/documents;
- driver portal tokens/documents/performance;
- quotation;
- shipment tracking/events;
- sport center bookings;
- executive briefing logs;
- company onboarding/modules/sessions;
- holding/company governance.

Sebagian tabel runtime domain ini dibuat dari SQL di `artifacts/api-server/src/app.ts` atau script migrasi khusus, bukan hanya dari file Drizzle yang lama.

### 5.5 Konsistensi data dan deduplikasi

Perhatikan aturan berikut:

1. Query task dan customer harus membawa `company_id`.
2. `task_number`/order number dipakai sebagai dedupe pada bridge logistic order.
3. Intake session harus ditandai submitted agar pesan yang sama tidak membuat task berulang.
4. Notifikasi receiver harus dideduplikasi berdasarkan nomor yang sudah dinormalisasi.
5. Pesan echo bot harus disaring sebelum insert/pemrosesan lanjutan.
6. PostgreSQL pooler mode transaction tidak cocok untuk semua advisory lock; booking/bridge harus menggunakan pola yang kompatibel dengan Supabase pooler.
7. `db.execute()` mengembalikan object dengan `rows`, bukan array langsung.
8. Native PostgreSQL array dikirim sebagai array JavaScript, bukan `JSON.stringify()`.

---

## 6. API dan Integrasi Utama

Seluruh router Express dipasang di prefix `/api`.

### Auth

```text
POST /api/auth/setup
POST /api/auth/login
GET  /api/auth/me
```

### Task dan dashboard

```text
GET   /api/ai-tasks
POST  /api/ai-tasks
GET   /api/ai-tasks/:id
PATCH /api/ai-tasks/:id
DELETE /api/ai-tasks/:id
GET   /api/dashboard/stats
GET   /api/dashboard/activity
GET   /api/dashboard/analytics
```

Route aktual dapat memiliki endpoint tambahan untuk comments, assignments, timeline, attachments, checklist, dan status transition.

### Pesan dan WhatsApp

```text
GET  /api/messages
GET  /api/messages/:id
POST /api/messages/:id/process
POST /api/whatsapp/webhook
POST /api/whatsapp/send
POST /api/whatsapp/send-group
```

### Intake, forms, documents

```text
GET/POST/PATCH /api/intake-sessions/*
GET/POST/PATCH /api/intake-form/*
GET/POST/PATCH /api/mini-form-config/*
GET/POST/PATCH /api/document-validation/*
GET/POST        /api/documents/*
GET/POST        /api/storage/*
GET/POST        /api/attachments/*
```

Tautan publik bertoken dipakai untuk:

```text
/mini-task/:taskId/:token
/customer-data/:taskId/:token
/mini-form/:type/:token
/vendor/register/:token
/vendor/status/:token
/vendor/documents/:token
/driver/home/:token
/driver/profile/:token
/driver/documents/:token
/driver/trips/:token
/driver/history/:token
/sc/status/:token
/sc/bukti/:token
```

### AI, governance, dan quality

```text
/api/dispatcher/*
/api/knowledge-base/*
/api/governance/*
/api/training/*
/api/observability/*
/api/conversation-tests/*
/api/quality-gate/*
/api/ai-operations/*
/api/readiness/*
```

### Operasional domain

```text
/api/customers/*
/api/customers-crm/*
/api/vendors/*
/api/vendor-memory/*
/api/customer-memory/*
/api/purchasing/*
/api/quotations/*
/api/fleet/*
/api/executive/*
/api/company-governance/*
/api/company-onboarding/*
/api/holding-dashboard/*
/api/reports/*
/api/audit-log/*
/api/notifications/*
/api/notification-receivers/*
/api/export/*
```

Daftar endpoint paling akurat tetap berada pada `lib/api-spec/openapi.yaml` dan route handler karena domain aplikasi terus berkembang.

---

## 7. Scheduler, Realtime, dan Background Process

Saat API server start, `app.ts` menyalakan beberapa scheduler/service:

| Proses | Fungsi |
|---|---|
| Follow-up scheduler | Follow-up customer untuk waiting document/data pada interval 24h/72h/168h. |
| Order sync scheduler | Menjembatani `logistic_orders` Supabase ke `ai_tasks`, termasuk reconciliation dan status push-back. |
| Escalation scheduler | Menangani SLA breach, escalation, dan approval timeout. |
| Intelligence scheduler | Refresh intel/readiness secara berkala/nightly. |
| Executive briefing | Briefing harian, default 07:00 WIB; dapat diubah `BRIEFING_TIME_WIB`. |
| Fleet scheduler | Refresh dashboard, risk, fuel anomaly, weekly/monthly fleet jobs. |
| SLA refresh | Memperbarui status SLA secara berkala. |
| Intake expiry | Mengakhiri atau menandai session intake yang stale. |

### SSE

SSE berada pada `artifacts/api-server/src/lib/sse.ts`. Event yang digunakan antara lain:

- `new_message`;
- `new_task`;
- `task_updated`;
- `message_updated`.

Keepalive dikirim berkala. Registry client berada di memory proses API, bukan broker eksternal. Karena itu SSE bekerja baik untuk satu API process, tetapi tidak otomatis menyamakan event antar banyak instance API.

---

## 8. Keamanan, RBAC, dan Data Privacy

### Praktik wajib

- Simpan semua secret pada Replit Secrets.
- Jangan log JWT, password, connection string, atau service role key.
- Selalu filter berdasarkan `company_id` pada endpoint multi-tenant.
- Validasi role di backend; menyembunyikan menu di frontend saja tidak cukup.
- Validasi token public dengan expiry dan scope.
- File private diproses dari server melalui service role/object storage.
- Normalisasi nomor telepon sebelum dedupe/notifikasi.
- Catat perubahan penting di audit log.

### Informasi sensitif

Data yang mungkin sensitif:

- nomor WhatsApp;
- dokumen identitas;
- payment proof;
- harga quotation;
- tarif vendor;
- password hash;
- service role key;
- raw payload WhatsApp.

Akses harus dibatasi berdasarkan role, company, dan tujuan operasional.

---

## 9. Prosedur Operasional Harian

### Awal hari

1. Buka Dashboard.
2. Periksa `new_inquiry`, `waiting_documents`, `missing_data`, dan task overdue.
3. Buka Messages untuk memastikan tidak ada pesan inbound gagal diproses.
4. Periksa AI Intake dan Conv. Intake yang menunggu jawaban.
5. Jalankan assignment/review melalui AI Tasks dan AI Dispatcher.
6. Periksa Notifikasi dan Notif WA bila ada alert pengiriman gagal.

### Menangani pesan yang belum menjadi task

1. Buka Messages.
2. Cari customer/nomor/intent.
3. Periksa badge processing dan isi pesan.
4. Periksa apakah ada active intake session.
5. Jika data sudah lengkap, gunakan proses ulang atau buat task sesuai hak akses.
6. Jika data belum lengkap, pastikan AI Intake/Conv. Intake memiliki next action yang benar.

### Menangani task yang macet

1. Buka detail task.
2. Lihat status, missing data, required action, last customer reply, dan timeline.
3. Periksa message terkait.
4. Periksa dokumen dan audit.
5. Periksa assignment/team capacity.
6. Periksa notification/audit log.
7. Jangan mengubah langsung database produksi tanpa memahami session/task linkage.

### Mengubah perilaku AI

1. Reproduksi masalah di Test Suite AI.
2. Tentukan apakah masalahnya keyword, intent, required field, route, prompt, atau governance.
3. Ubah Knowledge Base/Training sesuai jenis masalah.
4. Jalankan quality gate.
5. Uji regresi untuk intent lain yang mirip.
6. Pantau AI Observability setelah perubahan.

---

## 10. Troubleshooting

### Inbox kosong atau semua halaman terlihat tanpa data

Periksa:

1. API server hidup dan workflow membuka port.
2. `NODE_ENV` memilih database yang benar.
3. `SUPABASE_DATABASE_URL_DEV` tersedia untuk dev.
4. schema Supabase sudah menjalankan migrasi.
5. `company_id` user sesuai dengan data.
6. data seed/initial sync sudah dijalankan.

Jangan langsung membuat database kedua atau mengganti storage. Arsitektur yang ditetapkan adalah Supabase PostgreSQL.

### Login gagal

- `401`: user tidak ada, nonaktif, atau password salah.
- `503`: API tidak dapat mengakses PostgreSQL.
- Periksa connection string environment yang sesuai runtime, bukan hanya Supabase REST service role.
- Periksa `SESSION_SECRET`.

### Pesan masuk tetapi task tidak dibuat

Urutkan pemeriksaan:

1. webhook menerima payload?
2. payload tidak tersaring sebagai Fonnte echo?
3. `whatsapp_messages` berhasil disimpan?
4. ada active intake session?
5. intent/confidence/route terdeteksi?
6. required field masih kurang?
7. `ai_tasks` tersedia dan insert berhasil?
8. company scope/customer mapping valid?
9. notification error terjadi setelah task sebenarnya sudah tersimpan?

Pesan error notifikasi tidak selalu berarti task gagal dibuat.

### Pesan bot berulang

Periksa:

- `quick=true` dari Fonnte;
- content filter;
- duplicate webhook;
- session submitted flag;
- task dedupe;
- pemanggilan `_notifyForTask` ganda.

### Notifikasi staf tidak terkirim

Periksa:

- nomor `team_members.phone`;
- receiver/group routing;
- token Fonnte/device;
- normalized phone;
- log `whatsapp_notifications`;
- apakah nomor sama terdaftar melalui lebih dari satu alias/group.

### Dokumen terlihat ada tetapi audit gagal

Periksa:

- file benar-benar ada di private storage;
- attachment URL/metadata;
- service role environment;
- tipe file dan OCR/vision support;
- rule aktif pada `document_validation_rules`;
- apakah audit error tertutup oleh status task yang terlalu optimistis.

---

## 11. Menjalankan Project

Perintah utama dari root workspace:

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/ai-task-center run dev
pnpm run typecheck
pnpm run build
```

Workflow gabungan yang dikonfigurasi menjalankan:

1. install dependencies;
2. build API;
3. API pada port 8080;
4. frontend Vite pada port 5000.

Variabel penting:

```text
NODE_ENV
PORT
SESSION_SECRET
SUPABASE_DATABASE_URL
SUPABASE_DATABASE_URL_DEV
SUPABASE_URL
SUPABASE_URL_DEV
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SERVICE_ROLE_KEY_DEV
OPENAI_API_KEY
OPENAI_BASE_URL
AI_INTEGRATIONS_OPENAI_API_KEY
FONNTE_TOKEN
FONNTE_TOKEN_1..10
FONNTE_DEVICE_1..10
STAFF_NOTIFY_PHONES
STAFF_NOTIFY_GROUPS
COMPANY_ID
BRIEFING_TIME_WIB
SC_DOMAIN
```

Nama secret dan nilai aktual tidak boleh ditulis ke dokumentasi.

---

## 12. Catatan Penting dan Perbedaan Dokumentasi

### Webhook aktif

Implementasi aktif memproses pesan pada:

```text
POST /api/whatsapp/webhook
```

Dokumen lama dapat menyebut:

```text
POST /api/webhook/whatsapp
```

Route lama tersebut hanya acknowledgement/no-op pada handler tertentu dan bukan jalur processor utama. Konfigurasi provider harus diarahkan ke endpoint aktif.

### Database utama saat ini

Dokumen awal pernah menyebut:

```text
tasks, team, messages, documents, activity
```

Pipeline AI saat ini menggunakan model yang lebih luas dengan `ai_tasks`, `whatsapp_messages`, `customers`, `team_members`, `audit_logs`, intake, knowledge base, memory, governance, fleet, dan intelligence tables. `tasks` dan `activity` diperlakukan sebagai legacy/compatibility pada bagian tertentu.

### Database development dan production terpisah

Berhasil membaca Supabase REST menggunakan service role tidak otomatis membuktikan bahwa PostgreSQL pooler dapat login. Validasi harus dilakukan untuk channel PostgreSQL dan REST/Storage secara terpisah pada environment yang sesuai.

### UI menu tidak sama dengan seluruh route

Sidebar menampilkan menu utama, tetapi aplikasi juga memiliki halaman detail, public token form, portal, status page, dan route domain yang tidak semuanya berupa item sidebar. Dokumentasi menu menjelaskan item sidebar; katalog API menjelaskan kelompok route tambahan.

---

## 13. Referensi Kode

| Area | File utama |
|---|---|
| Sidebar dan menu | `artifacts/ai-task-center/src/components/layout/app-layout.tsx` |
| Route frontend | `artifacts/ai-task-center/src/App.tsx` |
| Webhook/pipeline WhatsApp | `artifacts/api-server/src/routes/whatsapp.ts` |
| Intent engine | `artifacts/api-server/src/lib/intent-engine.ts` |
| WhatsApp AI adapter | `artifacts/api-server/src/lib/whatsapp-ai.ts` |
| Intake engine | `artifacts/api-server/src/lib/intake-engine.ts` |
| Mini form router | `artifacts/api-server/src/lib/mini-form-router.ts` |
| Task service | `artifacts/api-server/src/lib/task-service.ts` |
| Dispatcher | `artifacts/api-server/src/lib/dispatcher.ts` |
| Notification | `artifacts/api-server/src/lib/notifications.ts` |
| Fonnte | `artifacts/api-server/src/lib/fonnte.ts` |
| SSE | `artifacts/api-server/src/lib/sse.ts` |
| Startup migration/scheduler | `artifacts/api-server/src/app.ts` |
| Database schema | `lib/db/src/schema/` |
| API contract | `lib/api-spec/openapi.yaml` |
| Existing menu guide | `docs/panduan-menu-sidebar.md` |
| Supabase/login notes | `docs/ai-task-supabase.md` |

---

## 14. Checklist Pemeliharaan Dokumentasi

Perbarui dokumen ini jika terjadi perubahan pada:

- label atau route menu;
- visibility berdasarkan role;
- status `ai_tasks`;
- webhook provider;
- urutan pipeline AI;
- mode intake;
- tabel/kolom database inti;
- scheduler;
- public token flow;
- company scoping;
- integrasi Fonnte/OpenAI/Supabase.

Setiap perubahan schema harus direfleksikan pada:

1. `lib/db/src/schema`;
2. migrasi/runtime SQL atau script yang terkait;
3. API route/service;
4. frontend page/form;
5. dokumentasi ini;
6. test suite/quality gate bila memengaruhi AI behavior.
