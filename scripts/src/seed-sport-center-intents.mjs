/**
 * Seed Sport Center & Sewa Tenant Intents
 * Menambahkan intents baru ke intent_master dan keyword_rules di Supabase
 * (additive — tidak menghapus data logistik yang sudah ada)
 *
 * Run: node scripts/src/seed-sport-center-intents.mjs
 */
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "",
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ─── 1. Sport Center Intents ──────────────────────────────────────────────
    const sportIntents = [
      { code: "booking_lapangan",           name: "Booking Lapangan Olahraga",           category: "Sport Center", division: "Operasional", priority: "medium", sla: 2  },
      { code: "cek_jadwal_lapangan",        name: "Cek Jadwal / Ketersediaan Lapangan",  category: "Sport Center", division: "Operasional", priority: "low",    sla: 1  },
      { code: "daftar_membership",          name: "Pendaftaran Member / Membership Baru", category: "Sport Center", division: "Pelanggan",   priority: "medium", sla: 4  },
      { code: "cek_membership",             name: "Cek Status Membership",               category: "Sport Center", division: "Pelanggan",   priority: "low",    sla: 2  },
      { code: "perpanjang_membership",      name: "Perpanjang Membership",               category: "Sport Center", division: "Pelanggan",   priority: "medium", sla: 4  },
      { code: "reschedule_booking",         name: "Reschedule / Ganti Jadwal Booking",   category: "Sport Center", division: "Operasional", priority: "medium", sla: 2  },
      { code: "cancel_booking",             name: "Pembatalan Booking Lapangan",         category: "Sport Center", division: "Operasional", priority: "high",   sla: 2  },
      { code: "konfirmasi_pembayaran_sport", name: "Konfirmasi Pembayaran Booking Sport", category: "Sport Center", division: "Keuangan",    priority: "high",   sla: 1  },
      { code: "komplain_fasilitas",         name: "Komplain / Masalah Fasilitas",        category: "Sport Center", division: "Operasional", priority: "high",   sla: 2  },
    ];

    // ─── 2. Sewa Tenant / Kios Intents ───────────────────────────────────────
    const tenantIntents = [
      { code: "info_sewa_tenant",           name: "Info Sewa Tenant / Kios",             category: "Tenant",       division: "Sales",       priority: "low",    sla: 8  },
      { code: "daftar_tenant",              name: "Daftar Sewa Tenant / Kios Baru",      category: "Tenant",       division: "Sales",       priority: "medium", sla: 8  },
      { code: "perpanjang_sewa",            name: "Perpanjang Masa Sewa Tenant",         category: "Tenant",       division: "Keuangan",    priority: "medium", sla: 4  },
      { code: "laporan_masalah_tenant",     name: "Laporan Masalah / Komplain Tenant",   category: "Tenant",       division: "Operasional", priority: "high",   sla: 2  },
      { code: "cek_tagihan_tenant",         name: "Cek Tagihan / Status Pembayaran Sewa", category: "Tenant",      division: "Keuangan",    priority: "medium", sla: 4  },
      { code: "konfirmasi_pembayaran_tenant", name: "Konfirmasi Pembayaran Sewa Tenant", category: "Tenant",       division: "Keuangan",    priority: "high",   sla: 1  },
    ];

    const allIntents = [...sportIntents, ...tenantIntents];

    // Hapus dulu intent codes yang sama (idempotent)
    const intentCodes = allIntents.map(i => i.code);
    await client.query(
      `DELETE FROM intent_master WHERE company_id = 'default' AND intent_code = ANY($1)`,
      [intentCodes]
    );

    const intentResult = await client.query(`
      INSERT INTO intent_master (company_id, intent_code, intent_name, category, suggested_category, suggested_division, suggested_priority, sla_hours, is_active)
      SELECT 'default', v.code, v.name, v.category, v.category, v.division, v.priority, v.sla::int, true
      FROM jsonb_to_recordset($1::jsonb) AS v(code text, name text, category text, division text, priority text, sla int)
      RETURNING id, intent_code
    `, [JSON.stringify(allIntents)]);
    console.log(`✅ ${intentResult.rowCount} intent ditambahkan/diperbarui`);

    // ─── 3. Sport Center Keyword Rules ────────────────────────────────────────
    const sportKeywords = [
      // booking_lapangan
      { kw: "booking lapangan",        code: "booking_lapangan",            w: 5 },
      { kw: "book lapangan",           code: "booking_lapangan",            w: 5 },
      { kw: "pesan lapangan",          code: "booking_lapangan",            w: 5 },
      { kw: "mau booking",             code: "booking_lapangan",            w: 4 },
      { kw: "sewa lapangan",           code: "booking_lapangan",            w: 4 },
      { kw: "badminton",               code: "booking_lapangan",            w: 4 },
      { kw: "futsal",                  code: "booking_lapangan",            w: 4 },
      { kw: "tenis",                   code: "booking_lapangan",            w: 4 },
      { kw: "basket",                  code: "booking_lapangan",            w: 3 },
      { kw: "voli",                    code: "booking_lapangan",            w: 3 },
      { kw: "lapangan",                code: "booking_lapangan",            w: 2 },
      { kw: "court",                   code: "booking_lapangan",            w: 3 },
      // cek_jadwal_lapangan
      { kw: "jadwal lapangan",         code: "cek_jadwal_lapangan",         w: 5 },
      { kw: "cek jadwal",              code: "cek_jadwal_lapangan",         w: 4 },
      { kw: "lapangan kosong",         code: "cek_jadwal_lapangan",         w: 5 },
      { kw: "slot tersedia",           code: "cek_jadwal_lapangan",         w: 4 },
      { kw: "available lapangan",      code: "cek_jadwal_lapangan",         w: 4 },
      { kw: "masih ada slot",          code: "cek_jadwal_lapangan",         w: 4 },
      { kw: "jam berapa bisa",         code: "cek_jadwal_lapangan",         w: 3 },
      // daftar_membership
      { kw: "daftar member",           code: "daftar_membership",           w: 5 },
      { kw: "mau member",              code: "daftar_membership",           w: 5 },
      { kw: "buat member",             code: "daftar_membership",           w: 5 },
      { kw: "membership baru",         code: "daftar_membership",           w: 5 },
      { kw: "daftar gym",              code: "daftar_membership",           w: 4 },
      { kw: "kartu member",            code: "daftar_membership",           w: 3 },
      { kw: "langganan",               code: "daftar_membership",           w: 3 },
      // cek_membership
      { kw: "cek member",              code: "cek_membership",              w: 5 },
      { kw: "status member",           code: "cek_membership",              w: 5 },
      { kw: "member aktif",            code: "cek_membership",              w: 4 },
      { kw: "kapan habis",             code: "cek_membership",              w: 3 },
      { kw: "masa berlaku member",     code: "cek_membership",              w: 5 },
      // perpanjang_membership
      { kw: "perpanjang member",       code: "perpanjang_membership",       w: 5 },
      { kw: "renew member",            code: "perpanjang_membership",       w: 5 },
      { kw: "extend member",           code: "perpanjang_membership",       w: 4 },
      { kw: "bayar member",            code: "perpanjang_membership",       w: 4 },
      // reschedule_booking
      { kw: "reschedule",              code: "reschedule_booking",          w: 5 },
      { kw: "ganti jadwal",            code: "reschedule_booking",          w: 5 },
      { kw: "pindah jadwal",           code: "reschedule_booking",          w: 5 },
      { kw: "ubah booking",            code: "reschedule_booking",          w: 4 },
      // cancel_booking
      { kw: "cancel booking",          code: "cancel_booking",              w: 5 },
      { kw: "batal booking",           code: "cancel_booking",              w: 5 },
      { kw: "batalkan booking",        code: "cancel_booking",              w: 5 },
      { kw: "mau batal",               code: "cancel_booking",              w: 3 },
      // konfirmasi_pembayaran_sport
      { kw: "konfirmasi bayar lapangan", code: "konfirmasi_pembayaran_sport", w: 5 },
      { kw: "bukti bayar lapangan",    code: "konfirmasi_pembayaran_sport", w: 5 },
      { kw: "transfer lapangan",       code: "konfirmasi_pembayaran_sport", w: 4 },
      { kw: "bayar booking",           code: "konfirmasi_pembayaran_sport", w: 4 },
      { kw: "dp lapangan",             code: "konfirmasi_pembayaran_sport", w: 4 },
      // komplain_fasilitas
      { kw: "ac rusak",                code: "komplain_fasilitas",          w: 5 },
      { kw: "fasilitas rusak",         code: "komplain_fasilitas",          w: 5 },
      { kw: "lapangan rusak",          code: "komplain_fasilitas",          w: 5 },
      { kw: "komplain fasilitas",      code: "komplain_fasilitas",          w: 5 },
      { kw: "kotor",                   code: "komplain_fasilitas",          w: 3 },
      { kw: "lampu mati",              code: "komplain_fasilitas",          w: 4 },
    ];

    // ─── 4. Sewa Tenant Keyword Rules ─────────────────────────────────────────
    const tenantKeywords = [
      // info_sewa_tenant
      { kw: "sewa kios",               code: "info_sewa_tenant",            w: 5 },
      { kw: "sewa tenant",             code: "info_sewa_tenant",            w: 5 },
      { kw: "sewa tempat",             code: "info_sewa_tenant",            w: 4 },
      { kw: "sewa lapak",              code: "info_sewa_tenant",            w: 4 },
      { kw: "info sewa",               code: "info_sewa_tenant",            w: 4 },
      { kw: "harga sewa",              code: "info_sewa_tenant",            w: 4 },
      { kw: "tanya sewa",              code: "info_sewa_tenant",            w: 4 },
      { kw: "biaya sewa",              code: "info_sewa_tenant",            w: 4 },
      // daftar_tenant
      { kw: "mau sewa kios",           code: "daftar_tenant",               w: 5 },
      { kw: "daftar tenant",           code: "daftar_tenant",               w: 5 },
      { kw: "buka kios",               code: "daftar_tenant",               w: 5 },
      { kw: "mau buka usaha",          code: "daftar_tenant",               w: 4 },
      { kw: "ajukan sewa",             code: "daftar_tenant",               w: 4 },
      { kw: "kontrak sewa",            code: "daftar_tenant",               w: 4 },
      // perpanjang_sewa
      { kw: "perpanjang sewa",         code: "perpanjang_sewa",             w: 5 },
      { kw: "perpanjang kontrak",      code: "perpanjang_sewa",             w: 5 },
      { kw: "renew sewa",              code: "perpanjang_sewa",             w: 5 },
      { kw: "lanjut sewa",             code: "perpanjang_sewa",             w: 4 },
      // laporan_masalah_tenant
      { kw: "masalah kios",            code: "laporan_masalah_tenant",      w: 5 },
      { kw: "komplain kios",           code: "laporan_masalah_tenant",      w: 5 },
      { kw: "kerusakan kios",          code: "laporan_masalah_tenant",      w: 5 },
      { kw: "laporan tenant",          code: "laporan_masalah_tenant",      w: 4 },
      { kw: "masalah tempat",          code: "laporan_masalah_tenant",      w: 4 },
      { kw: "ada kerusakan",           code: "laporan_masalah_tenant",      w: 3 },
      // cek_tagihan_tenant
      { kw: "tagihan sewa",            code: "cek_tagihan_tenant",          w: 5 },
      { kw: "cek tagihan",             code: "cek_tagihan_tenant",          w: 4 },
      { kw: "invoice sewa",            code: "cek_tagihan_tenant",          w: 5 },
      { kw: "berapa tagihan",          code: "cek_tagihan_tenant",          w: 4 },
      { kw: "status pembayaran sewa",  code: "cek_tagihan_tenant",          w: 5 },
      // konfirmasi_pembayaran_tenant
      { kw: "konfirmasi bayar sewa",   code: "konfirmasi_pembayaran_tenant", w: 5 },
      { kw: "bukti bayar sewa",        code: "konfirmasi_pembayaran_tenant", w: 5 },
      { kw: "transfer sewa",           code: "konfirmasi_pembayaran_tenant", w: 4 },
      { kw: "bayar kios",              code: "konfirmasi_pembayaran_tenant", w: 4 },
      { kw: "bayar tenant",            code: "konfirmasi_pembayaran_tenant", w: 4 },
    ];

    const allKeywords = [...sportKeywords, ...tenantKeywords];

    // Hapus keyword rules lama untuk intent codes baru (idempotent)
    const kwIntentCodes = [...new Set(allKeywords.map(k => k.code))];
    await client.query(
      `DELETE FROM keyword_rules WHERE company_id = 'default' AND intent_code = ANY($1)`,
      [kwIntentCodes]
    );

    const kwResult = await client.query(`
      INSERT INTO keyword_rules (company_id, intent_code, keyword, weight, is_active)
      SELECT 'default', v.code, v.kw, v.w::numeric, true
      FROM jsonb_to_recordset($1::jsonb) AS v(code text, kw text, w int)
      RETURNING id
    `, [JSON.stringify(allKeywords)]);
    console.log(`✅ ${kwResult.rowCount} keyword rules ditambahkan/diperbarui`);

    await client.query("COMMIT");
    console.log("🎉 Selesai! Sport center & tenant intents berhasil di-seed ke Supabase.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
