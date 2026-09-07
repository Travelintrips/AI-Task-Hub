# Service Coverage Audit — Post Sprint 8E
**Generated:** 2026-06-22
**Sprint:** 8E — Service Coverage Expansion

## Executive Summary

| Metric | Before Sprint 8E | After Sprint 8E | Target |
|--------|-----------------|-----------------|--------|
| Overall Coverage | **23%** | **90%** | ≥80% |
| Services with 100% coverage | 0/24 | 17/24 | — |
| Services with ≥67% coverage | 10/24 | 24/24 | — |
| Services with 0% coverage | 12/24 | 0/24 | — |

**Verdict: ✅ SPRINT 8E TARGET MET — READY FOR SPRINT 9A**

---

## Coverage Matrix

| # | Service | Intent Code | Data Template | Doc Template | Score | Status |
|---|---------|-------------|---------------|--------------|-------|--------|
| 1 | Trucking | `trucking_inquiry` | ✅ | ❌ | 67% | 🟡 |
| 2 | Air Freight | `air_freight_inquiry` | ✅ | ✅ | 100% | 🟢 |
| 3 | Sea Freight | `sea_freight_inquiry` | ✅ | ✅ | 100% | 🟢 |
| 4 | Customs Clearance | `customs_clearance` | ✅ | ✅ | 100% | 🟢 |
| 5 | PPJK | `ppjk_service` | ✅ | ❌ | 67% | 🟡 |
| 6 | Warehousing | `warehousing_request` | ✅ | ✅ | 100% | 🟢 |
| 7 | Import | `import_inquiry` | ✅ | ✅ | 100% | 🟢 |
| 8 | Export | `export_inquiry` | ✅ | ✅ | 100% | 🟢 |
| 9 | DG Cargo | `dg_cargo` | ✅ | ✅ | 100% | 🟢 |
| 10 | Live Animal | `live_animal_cargo` | ✅ | ✅ | 100% | 🟢 |
| 11 | Cold Chain | `cold_chain` | ✅ | ✅ | 100% | 🟢 |
| 12 | Project Cargo | `project_cargo` | ✅ | ✅ | 100% | 🟢 |
| 13 | Fleet Repair | `fleet_repair` | ✅ | ✅ | 100% | 🟢 |
| 14 | Fuel Expense | `fuel_expense` | ✅ | ✅ | 100% | 🟢 |
| 15 | Tire Issue | `tire_issue` | ✅ | ✅ | 100% | 🟢 |
| 16 | Cash Advance | `permintaan_kasbon` | ✅ | ❌ | 67% | 🟡 |
| 17 | Damaged Goods | `damaged_goods_complaint` | ✅ | ✅ | 100% | 🟢 |
| 18 | Delivery Delay | `delivery_delay_complaint` | ✅ | ✅ | 100% | 🟢 |
| 19 | Invoice Request | `pertanyaan_tagihan` | ✅ | ❌ | 67% | 🟡 |
| 20 | Payment Confirm | `konfirmasi_pembayaran` | ✅ | ✅ | 100% | 🟢 |
| 21 | Vendor Registration | `permintaan_vendor` | ✅ | ✅ | 100% | 🟢 |
| 22 | Customer Data Update | `customer_data_update` | ✅ | ❌ | 67% | 🟡 |
| 23 | Tenant Rental | `daftar_tenant` | ✅ | ❌ | 67% | 🟡 |
| 24 | Sport Center Booking | `booking_lapangan` | ✅ | ❌ | 67% | 🟡 |

---

## KB Growth Summary

| Table | Before | After | Added |
|-------|--------|-------|-------|
| `intent_master` | 30 | 48 | +18 new intents |
| `keyword_rules` | 220 | 503 | +283 keywords across 18 intents |
| `service_catalog` | 14 | 24 | +10 (Air Freight ×2, Sea FCL, Customs ×2, PPJK, WH, DG, Live Animal, Project Cargo) |
| `data_templates` | 6 | 32 | +26 templates (18 new + 8 existing intents without template) |
| `data_template_fields` | 35 | 303 | +268 fields |
| `document_templates` | 5 | 21 | +16 new doc templates |
| `document_template_fields` | 18 | 83 | +65 doc fields |

---

## New Intents Added (18)

| Intent Code | Layanan | Category | SLA |
|-------------|---------|----------|-----|
| `trucking_inquiry` | Layanan Trucking | Logistik | 24h |
| `air_freight_inquiry` | Pengiriman Udara | Logistik | 12h |
| `sea_freight_inquiry` | Pengiriman Laut | Logistik | 48h |
| `customs_clearance` | Bea Cukai / Clearance | Logistik | 24h |
| `ppjk_service` | Layanan PPJK | Logistik | 24h |
| `warehousing_request` | Layanan Gudang | Logistik | 48h |
| `import_inquiry` | Layanan Import | Logistik | 24h |
| `export_inquiry` | Layanan Export | Logistik | 24h |
| `dg_cargo` | Barang Berbahaya | Logistik | 12h |
| `live_animal_cargo` | Hewan Hidup | Logistik | 12h |
| `cold_chain` | Cold Chain / Rantai Dingin | Logistik | 12h |
| `project_cargo` | Project Cargo / Heavy Lift | Logistik | 24h |
| `fleet_repair` | Perbaikan Kendaraan | Operasional | 8h |
| `fuel_expense` | Laporan BBM | Operasional | 48h |
| `tire_issue` | Masalah Ban | Operasional | 8h |
| `damaged_goods_complaint` | Komplain Kerusakan Barang | Komplain | 4h |
| `delivery_delay_complaint` | Komplain Keterlambatan | Komplain | 4h |
| `customer_data_update` | Update Data Pelanggan | Administrasi | 72h |

---

## Intake Mode

Semua 32 data_templates dikonfigurasi dengan:
- `intake_mode = 'conversation'` — AI mengumpulkan field via chat WhatsApp
- `use_mini_form = false` — Mini form akan diaktifkan di Sprint 9B jika diperlukan

---

## Remaining Gaps (7 layanan — 67%)

Layanan berikut sudah punya intent + data_template tapi **belum ada document_template**:
1. Trucking (`trucking_inquiry`) — low priority (Packing List sudah di pickup)
2. PPJK (`ppjk_service`) — medium priority
3. Cash Advance (`permintaan_kasbon`) — low (tidak perlu dokumen formal)
4. Invoice Request (`pertanyaan_tagihan`) — low
5. Customer Data Update (`customer_data_update`) — low (KTP sudah di pendaftaran)
6. Tenant Rental (`daftar_tenant`) — medium
7. Sport Booking (`booking_lapangan`) — low (tidak butuh dokumen)

**Rekomendasi:** Gap ini tidak memblokir Sprint 9A — Intake Engine bisa collect semua field tanpa doc template.

---

## Sprint 9A Readiness

| Check | Status |
|-------|--------|
| Coverage ≥80% | ✅ 90% |
| Semua 24 target services punya intent | ✅ |
| Semua 24 target services punya data_template | ✅ |
| Semua fields terdefinisi per template | ✅ 303 fields |
| intake_mode dikonfigurasi | ✅ semua 'conversation' |
| Seed script idempotent | ✅ aman re-run |

**Verdict: ✅ FULL GO untuk Sprint 9A**
