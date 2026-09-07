# Service Coverage Audit
**Sprint 8D — Phase 7 — Pre-Sprint 9 Hardening**
**Generated:** 2026-06-22

Membandingkan layanan bisnis actual CST dengan coverage di Knowledge Base (intent_master, keyword_rules, data_templates, document_templates, service_catalog, mini_form_config).

---

## Coverage Matrix

| # | Service | Intent Exists? | Data Template? | Doc Template? | Mini Form? | Coverage Score | Status |
|---|---|---|---|---|---|---|---|
| 1 | **Trucking** | ✅ `permintaan_pickup` | ✅ Form Pickup | ❌ Tidak ada | ❌ | 50% | ⚠️ PARTIAL |
| 2 | **Air Freight** | ❌ Tidak ada intent khusus | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 3 | **Sea Freight / Ocean** | ❌ Tidak ada intent khusus | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 4 | **Customs Clearance / PPJK** | ❌ Tidak ada intent khusus | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 5 | **Warehousing** | ❌ Tidak ada intent khusus | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 6 | **Export** | ❌ Tidak ada intent khusus | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 7 | **Import** | ❌ Tidak ada intent khusus | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 8 | **DG Cargo** | ❌ Tidak ada | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 9 | **Live Animal** | ❌ Tidak ada | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 10 | **Cold Chain** | ❌ Tidak ada | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 11 | **Project Cargo** | ❌ Tidak ada | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 12 | **Fleet (Request)** | ❌ Tidak ada intent fleet request | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 13 | **Driver (Request)** | ❌ Tidak ada | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 14 | **Vendor Registration** | ✅ `permintaan_vendor` | ❌ Tidak ada template | ❌ | ❌ | 25% | ⚠️ PARTIAL |
| 15 | **Customer Complaint** | ✅ `komplain_pengiriman` | ✅ Form Komplain | ❌ Tidak ada | ❌ | 50% | ⚠️ PARTIAL |
| 16 | **Invoice Request** | ✅ `pertanyaan_tagihan` | ❌ Tidak ada template | ❌ | ❌ | 25% | ⚠️ PARTIAL |
| 17 | **Payment Confirmation** | ✅ `konfirmasi_pembayaran` | ❌ Tidak ada template | ❌ | ❌ | 25% | ⚠️ PARTIAL |
| 18 | **Kasbon** | ✅ `permintaan_kasbon` | ✅ Form Kasbon | ❌ Tidak ada | ❌ | 50% | ⚠️ PARTIAL |
| 19 | **HR Request** | ❌ Tidak ada | ❌ | ❌ | ❌ | 0% | ❌ MISSING |
| 20 | **Tenant Rental** | ✅ `daftar_tenant`, `info_sewa_tenant`, `cek_tagihan_tenant`, `perpanjang_sewa`, `konfirmasi_pembayaran_tenant`, `laporan_masalah_tenant` (6 intents!) | ❌ Tidak ada template | ❌ | ❌ | 30% | ⚠️ PARTIAL |
| 21 | **Sport Center Booking** | ✅ `booking_lapangan`, `cancel_booking`, `cek_jadwal_lapangan`, `cek_membership`, `daftar_membership`, `komplain_fasilitas`, `konfirmasi_pembayaran_sport`, `perpanjang_membership`, `reschedule_booking` (9 intents!) | ❌ Tidak ada template | ❌ | ❌ | 30% | ⚠️ PARTIAL |
| 22 | **Cek Status Pengiriman** | ✅ `cek_status_pengiriman` | ✅ Form Status | ❌ | ❌ | 50% | ⚠️ PARTIAL |
| 23 | **Permintaan Penawaran** | ✅ `permintaan_penawaran` | ✅ Form Penawaran | ❌ | ❌ | 50% | ⚠️ PARTIAL |
| 24 | **Klaim Asuransi** | ✅ `klaim_asuransi` | ✅ Form Klaim | ❌ | ❌ | 50% | ⚠️ PARTIAL |

---

## Intent Master Coverage

**Total intents terdaftar:** 30

| Category | Intents | Coverage |
|---|---|---|
| Operasional (Logistik) | `cek_status_pengiriman`, `jadwal_pengiriman`, `permintaan_pickup` | 3/3 core flows |
| Komersial | `permintaan_penawaran`, `pendaftaran_pelanggan`, `permintaan_vendor` | OK |
| Keuangan | `konfirmasi_pembayaran`, `pertanyaan_tagihan`, `klaim_asuransi` | OK |
| Komplain | `komplain_pengiriman` | Hanya 1 — perlu tambah |
| Administrasi | `permintaan_dokumen` | Hanya 1 |
| Finance | `permintaan_kasbon` | OK |
| Sport Center | 9 intents | Coverage baik untuk vertical ini |
| Tenant | 6 intents | Coverage baik untuk vertical ini |
| Umum | `general_inquiry` | OK |
| **MISSING** | Air Freight, Sea Freight, Customs, Warehousing, Export, Import, DG, Cold Chain, Project Cargo, Fleet request, Driver request, HR | ❌ 12 layanan utama tidak ada intent |

---

## Data Template Coverage

**Total data_templates:** 6

| Template | Intent Code | Fields |
|---|---|---|
| Form Cek Status Pengiriman | `cek_status_pengiriman` | Ada |
| Form Komplain Pengiriman | `komplain_pengiriman` | Ada |
| Form Permintaan Pickup | `permintaan_pickup` | Ada |
| Form Permintaan Penawaran | `permintaan_penawaran` | Ada |
| Form Klaim Asuransi | `klaim_asuransi` | Ada |
| Form Kasbon | `permintaan_kasbon` | Ada |

**Gap:** 24 dari 30 intents tidak memiliki data template → AI tidak bisa collect missing fields untuk intents ini.

---

## Document Template Coverage

**Total document_templates:** 5

| Template | Category | Intent Code |
|---|---|---|
| (perlu cek aktual dari DB) | — | — |

**Status:** Hanya 5 template dokumen — sangat terbatas.

---

## Service Catalog Coverage

**Total service_catalog entries:** 14

Service catalog mencakup beberapa layanan logistik dasar — namun belum ada mapping eksplisit ke:
- Air Freight / Sea Freight routes
- DG / Cold Chain / Project Cargo spesifikasi
- Fleet / Driver booking

---

## Summary Statistics

| Metric | Value |
|---|---|
| Services dengan FULL coverage (intent + template + doc template) | **0 / 22** |
| Services dengan PARTIAL coverage (intent ada, template kurang) | **10 / 22** |
| Services dengan ZERO coverage | **12 / 22** |
| **Overall Service Coverage Score** | **~23%** |

---

## Critical Gaps untuk Sprint 9

Untuk Sprint 9A (Intake Engine), services berikut **harus** memiliki data_templates sebelum bisa collect data via WhatsApp:

| Priority | Service | Action |
|---|---|---|
| 🔴 CRITICAL | Air Freight | Buat intent + data template (origin, dest, weight, dims, cargo type) |
| 🔴 CRITICAL | Sea Freight | Buat intent + data template (POL, POD, container type, commodity) |
| 🔴 CRITICAL | Customs Clearance | Buat intent + data template (HS code, nilai barang, dokumen) |
| 🔴 CRITICAL | Import | Buat intent + data template (16 fields existing di IMPORT_REQUIRED_FIELDS) |
| 🟡 HIGH | Export | Buat intent + data template |
| 🟡 HIGH | Warehousing | Buat intent + data template |
| 🟡 HIGH | Customer Registration | Template untuk `pendaftaran_pelanggan` |
| 🟡 HIGH | Vendor Registration | Template untuk `permintaan_vendor` |
| 🟠 MEDIUM | Trucking (pickup route) | Template untuk `jadwal_pengiriman` |
| 🟠 MEDIUM | HR Request | Buat intent baru |

---

## Recommendation

**Sebelum Sprint 9A dimulai**, prioritas seed KB:
1. Tambah 5 intent baru minimal: `pengiriman_udara`, `pengiriman_laut`, `bea_cukai_clearance`, `layanan_import`, `layanan_export`
2. Tambah data_templates untuk intents yang ada tapi belum punya template (24 dari 30)
3. Hubungkan IMPORT_REQUIRED_FIELDS yang sudah ada di `whatsapp-ai.ts` ke data_template aktif di DB
