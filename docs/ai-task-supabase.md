# AI Task Center — Login dan Supabase

Dokumen ini menjelaskan jalur login dan tabel Supabase yang dipakai AI Task
Center. Dev dan Produksi menggunakan project Supabase yang berbeda, tetapi
kontrak tabel dan endpoint-nya sama.

## Pemilihan koneksi

| Runtime | Database PostgreSQL | Supabase Storage/API |
| --- | --- | --- |
| Development | `SUPABASE_DATABASE_URL_DEV` | `SUPABASE_URL_DEV` + `SUPABASE_SERVICE_ROLE_KEY_DEV` |
| Production | `SUPABASE_DATABASE_URL` | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |

Pemilihan database harus mengikuti `NODE_ENV`. Jangan mengandalkan urutan
environment variable karena bila kedua URL tersedia, Dev dapat tanpa sengaja
membaca database Produksi.

Semua URL PostgreSQL dan service role key wajib disimpan sebagai Replit
Secrets. Jangan menaruhnya di source code, `.replit`, log, atau screenshot.

## Alur login

1. Browser mengirim `POST /api/auth/login` dengan `email` dan `password`.
2. API membaca `public.users` melalui Drizzle/PostgreSQL project aktif.
3. API memeriksa `is_active` dan mencocokkan `password_hash` menggunakan
   `bcryptjs`.
4. API memperbarui `last_login_at`.
5. API menerbitkan JWT 7 hari menggunakan `SESSION_SECRET`.
6. Frontend menyimpan token pada `ai_task_center_token` dan user pada
   `ai_task_center_user`.
7. Request berikutnya membawa `Authorization: Bearer <JWT>`.
8. `GET /api/auth/me` memvalidasi user dan `/api/ai-tasks` mengambil task
   berdasarkan `company_id`.

Jika PostgreSQL tidak dapat terhubung, endpoint login mengembalikan `503`
`Login service temporarily unavailable`, bukan `500` tanpa keterangan. Jika
user tidak ada, nonaktif, atau password salah, responsnya `401`.

## Tabel inti AI Task

### Identitas dan penugasan

- `users` — akun login, role, perusahaan, divisi, password hash, login terakhir.
- `team_members` — anggota operasional, role/divisi, nomor WhatsApp, kapasitas task.

### Task dan aktivitasnya

- `ai_tasks` — task utama; menyimpan `company_id`, sumber, customer, status,
  prioritas, assignment, SLA, intent, confidence, summary, dan sentiment.
- `task_assignments` — riwayat penugasan task.
- `task_comments` — komentar/komunikasi internal pada task.
- `task_timeline` — event perubahan/status task.
- `task_attachments` — dokumen/file yang terhubung ke task, termasuk status OCR.

### Input dan jejak AI

- `whatsapp_messages` — pesan masuk/keluar dan hubungan ke task/customer.
- `conversation_intake_sessions` — sesi pengumpulan data sebelum task dibuat.
- `document_audits` — hasil validasi dokumen AI.
- `audit_logs` — jejak audit operasional.
- `whatsapp_notifications` — antrean notifikasi task/customer/staff.
- `admin_notifications` — notifikasi internal dashboard.

### Hubungan utama

```text
users / team_members
        │
        └── assigned_to / assigned_to_id
                    │
customers ─────── ai_tasks ─────── task_comments
                    │  │  ├────── task_assignments
                    │  │  ├────── task_timeline
                    │  │  └────── task_attachments
whatsapp_messages ──┘
```

Semua query task yang berasal dari dashboard harus membawa filter
`company_id`. `super_admin` dapat melihat lintas perusahaan melalui mekanisme
scoping yang sudah ada.

## Status verifikasi terakhir

- Dev: koneksi PostgreSQL berhasil; login, `/api/auth/me`, dan `/api/ai-tasks`
  berhasil.
- Produksi: service role Supabase REST berhasil membaca `users` dan `ai_tasks`,
  tetapi connection string PostgreSQL masih gagal autentikasi. Sebelum publish,
  perbarui `SUPABASE_DATABASE_URL` dengan connection string PostgreSQL pooler
  yang benar dari project Produksi.