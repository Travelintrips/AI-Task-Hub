# Onboarding Readiness Report — Sprint 10A-1.2

**Tanggal**: 23 Juni 2026
**Versi**: 10A-1.2 — Onboarding Readiness Hardening
**Status Keseluruhan**: 🟡 **NO-GO untuk Sprint 10A-2** (Onboarding Wizard)

---

## Executive Summary

Audit onboarding mengidentifikasi **7 area perbaikan** yang harus selesai sebelum
wizard onboarding dapat dibangun. Sprint 10A-1.2 menyelesaikan semua blocker teknis.

| Area | Sebelum | Sesudah | Status |
|------|---------|---------|--------|
| Vendor Master | ❌ `/api/vendors` 404 karena duplikasi | ✅ OPTION A confirmed: `suppliers` = master | **FIXED** |
| Fleet Schema | ❌ `fleet_vehicles` vs `fleet_units` ambigu | ✅ `fleet_units` canonical, routes sudah benar | **FIXED** |
| Customer Data Quality | ❌ WhatsApp nullable, tidak divalidasi | ✅ Wajib di POST + normalisasi E.164 | **FIXED** |
| Company Profile | ❌ 0% lengkap, tidak ada indikator | ✅ `profileCompletionPct` di GET /settings | **FIXED** |
| WhatsApp Health | ❌ Tidak ada endpoint status | ✅ `GET /api/system/whatsapp-health` | **FIXED** |
| Onboarding Status | ❌ Tidak ada endpoint | ✅ `GET /api/system/onboarding-status` | **FIXED** |
| Report | ❌ Tidak ada | ✅ Dokumen ini | **DONE** |

---

## Task 1 — Vendor Master Audit

### Keputusan: **OPTION A — Reuse `suppliers` table**

| Aspek | Detail |
|-------|--------|
| Tabel master | `suppliers` (28 record, INTEGER id) |
| Layer intelijen | `vendor_*` (34 tabel: preferences, risk, performance, dll — masih kosong) |
| Route GET | `vendor-memory.ts` sudah query `suppliers` sebagai source ✅ |
| Route write | `vendors.ts` baru: `POST /api/vendors`, `PATCH /api/vendors/:id` |
| Duplikasi | Dihapus — satu definisi GET /vendors yang query suppliers |

**Kolom penting `suppliers`**: id, name, service_type, phone, country, contact_person,
contact_email, is_active, supported_modes, fee, markup, sort_order, created_at

**Intelligence layer** (enrichment, bukan master):
- `vendor_risk_assessments` — risk tier, credit limit
- `vendor_performance_snapshots` — on_time_rate, response_rate
- `vendor_memory_snapshots` — performance grade, readiness score

### Skor Vendor Readiness: 40/100

| Check | Status | Nilai |
|-------|--------|-------|
| Tabel master (suppliers) terisi | ✅ 28 vendors | +20 |
| Service type lengkap | ❌ `service_type = NULL` di semua record | 0 |
| Kontak phone lengkap | ⚠️ 50% ada phone | +10 |
| Intelligence layer terisi | ❌ vendor_preferences, risk = 0 record | 0 |
| Scoring route berfungsi | ✅ GET /api/vendors 200 | +10 |

---

## Task 2 — Fleet Vehicle Schema Fix

### Keputusan: **fleet_units adalah tabel canonical**

| Tabel | Keterangan | Status |
|-------|-----------|--------|
| `fleet_units` | Drizzle ORM table, Sprint 7B, memiliki `unit_number` | ✅ Canonical |
| `fleet_vehicles` | Tabel Supabase legacy (schema berbeda: `plate` bukan `plate_number`) | ⚠️ Legacy/abaikan |

**Bukti fleet_units adalah canonical**:
- Drizzle schema di `lib/db/src/schema/fleet.ts` menggunakan `fleetUnitsTable`
- Semua route fleet (`fleet-units.ts`, `fleet-fuel.ts`, `fleet-tires.ts`, dll.) import dari `fleetUnitsTable`
- `fleet_units` memiliki kolom `unit_number` ✅ + `plate_number` ✅
- 3 record aktif di `fleet_units`
- `fleet_vehicles` hanya untuk referensi historis, tidak dipakai app

**Tidak ada migration yang diperlukan.** Routes sudah benar.

### Skor Fleet Readiness: 35/100

| Check | Status | Nilai |
|-------|--------|-------|
| Canonical table jelas (fleet_units) | ✅ | +20 |
| Data kendaraan ada | ✅ 3 units | +15 |
| Pengemudi terdaftar | ⚠️ Perlu verifikasi | 0 |
| Maintenance records ada | ❌ Belum terisi | 0 |
| Fuel logs ada | ❌ Belum terisi | 0 |

---

## Task 3 — Customer Data Quality

### Perubahan: Validasi WhatsApp Wajib

**File**: `artifacts/api-server/src/routes/customers-crm.ts`

| Validasi | Sebelum | Sesudah |
|----------|---------|---------|
| companyName | Wajib | Wajib ✅ |
| whatsapp | Opsional | **Wajib** ✅ |
| Format WA | Tidak dinormalisasi | Normalisasi E.164 (strip non-digit, `0→62`) |
| Minimum digit | Tidak ada | Minimal 10 digit |

**Reasoning**: WhatsApp adalah channel utama AI intent detection. Customer tanpa nomor WA
tidak bisa menerima notifikasi otomatis dan tidak bisa di-match saat pesan masuk.

**Data existing** (tidak terpengaruh retroactively):

| Metric | Nilai |
|--------|-------|
| Total customers | ~30 |
| Dengan whatsapp | ~20 (67%) |
| Tanpa whatsapp | ~10 (33%) |

### Skor Customer Readiness: 45/100

| Check | Status | Nilai |
|-------|--------|-------|
| Data customer ada | ✅ 30+ records | +20 |
| WhatsApp wajib (new) | ✅ Enforced di API | +15 |
| Data lama lengkap | ❌ 33% tanpa WA | 0 |
| company_name terisi | ⚠️ Beberapa null | +10 |

---

## Task 4 — Company Profile Completeness

### Perubahan: `profileCompletionPct` di GET /api/settings

**File**: `artifacts/api-server/src/routes/settings.ts`

```json
{
  "profileCompletionPct": 0,
  "profileMissingFields": ["companyName", "companyPhone", "companyEmail", "industryType"],
  "profileFields": {
    "companyName": false,
    "companyPhone": false,
    "companyEmail": false,
    "industryType": false
  }
}
```

**Scoring**: 4 required fields × 25% masing-masing = 0–100%

**Status saat ini**: company_settings profil 0% lengkap. Semua 4 field = NULL.

WhatsApp tokens sudah dikonfigurasi (fonnte_token & whatsapp_token ada) — jadi operational
tapi profile perusahaan belum terisi.

### Skor Company Readiness: 25/100

| Check | Status | Nilai |
|-------|--------|-------|
| company_name | ❌ NULL | 0 |
| company_phone | ❌ NULL | 0 |
| company_email | ❌ NULL | 0 |
| industry_type | ❌ NULL | 0 |
| WhatsApp (Fonnte) configured | ✅ Token ada | +25 |

---

## Task 5 — WhatsApp Health Check

### Endpoint Baru: `GET /api/system/whatsapp-health`

**File**: `artifacts/api-server/src/routes/system.ts`

**Response real-time** (diuji 23 Jun 2026):

```json
{
  "status": "healthy",
  "gateway": {
    "fonnte": { "configured": true, "tokenMasked": "••••••••VSSZ" },
    "meta": { "configured": true, "phoneNumberId": "085121073537,087882639826" }
  },
  "webhook": {
    "configured": true,
    "verifyTokenSet": true,
    "fonnte_url": "/api/webhook/fonnte",
    "meta_url": "/api/webhook/whatsapp"
  },
  "activity": {
    "lastMessageAt": "2026-06-23T06:03:50.179Z",
    "lastMessageSource": "whatsapp_command",
    "messages24h": 0
  },
  "issues": []
}
```

**Status**: 🟢 healthy — Fonnte + Meta configured, webhook verify token set.

### Skor WhatsApp Readiness: 75/100

| Check | Status | Nilai |
|-------|--------|-------|
| Fonnte token configured | ✅ | +30 |
| Meta WA API configured | ✅ | +15 |
| Webhook verify token | ✅ | +15 |
| Last message < 24h | ❌ 0 pesan 24h terakhir | 0 |
| Delivery templates configured | ❌ NULL di semua template | 0 |
| Last delivery tracked | ❌ lastDeliveryAt = null | 0 |
| Test Fonnte endpoint | ✅ Tersedia | +15 |

---

## Task 6 — Empty State Inventory

Audit semua halaman frontend terhadap empty states:

| Halaman | Empty State | CTA Ada? | Onboarding Guidance? |
|---------|------------|----------|---------------------|
| Dashboard | "No activity yet" generic | ✅ (link ke tasks) | ❌ Tidak ada |
| Tasks | "Belum ada tugas" + ikon | ✅ Tombol tambah | ❌ Tidak menjelaskan cara kerja |
| Messages | "Belum ada pesan" | ❌ Tidak ada CTA | ❌ Tidak ada setup guide |
| Documents | "Belum ada dokumen" | ✅ Upload | ❌ Tidak ada |
| Team | "Belum ada anggota tim" | ✅ Tambah | ❌ Tidak ada |
| Vendors | Menampilkan 28 vendors | N/A | ❌ Tidak ada |
| Fleet | Empty kalau data 0 | ✅ Tambah kendaraan | ❌ Tidak ada |
| Customers | "Belum ada customer" | ✅ Tambah | ❌ Tidak ada guidance WA |
| Settings | Form kosong tapi tidak ada % | ✅ Form tersedia | ❌ Tidak ada completion guide |
| Knowledge Base | Data ada | N/A | N/A |

**Temuan utama**:
- Semua halaman punya empty state basic ✅
- **Tidak ada halaman yang punya contextual onboarding guidance** ❌
- Settings tidak menampilkan `profileCompletionPct` di UI (baru di API) ❌
- Messages tidak punya "Setup WhatsApp Webhook" CTA saat inbox kosong ❌

---

## Task 7 — Onboarding Readiness Report

### Onboarding Status Endpoint: `GET /api/system/onboarding-status`

```json
{
  "overallPct": 14,
  "readyForProduction": false,
  "steps": {
    "company_profile": { "done": false, "pct": 0 },
    "whatsapp": { "done": true, "pct": 100 },
    "team": { "done": true, "count": 3 },
    "customers": { "done": true, "total": 30 },
    "fleet": { "done": true, "count": 3 },
    "knowledge_base": { "done": true, "intentCount": 100 },
    "first_task": { "done": true, "taskCount": 22 }
  }
}
```

### Skor Kesiapan per Area

| Area | Skor | Status |
|------|------|--------|
| Vendor Readiness | 40/100 | 🟡 Perlu service_type diisi |
| Fleet Readiness | 35/100 | 🟡 Perlu maintenance & fuel records |
| Customer Readiness | 45/100 | 🟡 Perlu migrasi data lama isi WA |
| WhatsApp Readiness | 75/100 | 🟢 Gateway OK, delivery templates belum |
| Company Readiness | 25/100 | 🔴 Profil perusahaan belum diisi |

### **Skor Keseluruhan: 44/100**

---

## Verdict: 🟡 GO untuk Sprint 10A-2 dengan catatan

Semua **blocker teknis** dari PRE-SPRINT 10A-2 audit sudah diatasi:

✅ `/api/vendors` tidak lagi 404  
✅ `fleet_units` dikonfirmasi sebagai canonical table  
✅ WhatsApp wajib saat create customer  
✅ `profileCompletionPct` tersedia di API  
✅ `GET /api/system/whatsapp-health` tersedia  
✅ `GET /api/system/onboarding-status` tersedia  

**Pre-conditions untuk Sprint 10A-2 (Onboarding Wizard)**:

Blocker teknis: ✅ semua selesai
Blocker data (tidak block dev, block GO-LIVE):
1. Company profile belum diisi (0%) — wizard akan bantu ini
2. suppliers.service_type semua NULL — perlu data enrichment
3. WA delivery templates belum dikonfigurasi — wizard akan bantu

**Rekomendasi**: Lanjut ke Sprint 10A-2. Wizard yang akan dibangun justru untuk
menyelesaikan masalah data yang tersisa.

---

## Appendix — Endpoints Baru Sprint 10A-1.2

| Endpoint | Deskripsi |
|----------|-----------|
| `POST /api/vendors` | Buat vendor baru di tabel suppliers |
| `PATCH /api/vendors/:id` | Update vendor di tabel suppliers |
| `GET /api/system/whatsapp-health` | Status gateway WhatsApp real-time |
| `GET /api/system/onboarding-status` | Status onboarding 7 checklist items |

## Appendix — Files Modified

| File | Perubahan |
|------|-----------|
| `artifacts/api-server/src/routes/vendors.ts` | NEW: POST + PATCH suppliers via /api/vendors |
| `artifacts/api-server/src/routes/system.ts` | NEW: whatsapp-health + onboarding-status |
| `artifacts/api-server/src/routes/customers-crm.ts` | PATCH: whatsapp required, normalisasi E.164 |
| `artifacts/api-server/src/routes/settings.ts` | PATCH: profileCompletionPct computed field |
| `artifacts/api-server/src/routes/index.ts` | PATCH: register vendors + system routers |
