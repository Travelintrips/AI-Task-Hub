/**
 * Test: Kirim notifikasi ke semua Penerima Notifikasi kategori Sport Center
 * Jalankan: node scripts/test-sport-center-notif.mjs
 */

import pg from "pg";

const DB_URL = process.env.SUPABASE_DATABASE_URL_DEV || process.env.DATABASE_URL;
// Fonnte uses numbered tokens: FONNTE_TOKEN_1, FONNTE_TOKEN_2, ...
const FONNTE_TOKEN = process.env.FONNTE_TOKEN || process.env.FONNTE_TOKEN_1 || process.env.FONNTE_TOKEN_2;

if (!DB_URL) { console.error("❌ SUPABASE_DATABASE_URL_DEV tidak ditemukan"); process.exit(1); }
if (!FONNTE_TOKEN) { console.error("❌ FONNTE_TOKEN / FONNTE_TOKEN_1 tidak ditemukan"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DB_URL, max: 2 });

async function sendFonnte(target, message) {
  const body = new URLSearchParams({ target, message, countryCode: "62" });
  const res = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: { Authorization: FONNTE_TOKEN },
    body,
  });
  const json = await res.json();
  return json;
}

async function main() {
  const SPORT_CENTER_ALIASES = ["Sport Center", "Lapangan", "Olahraga", "Booking Lapangan"];
  const placeholders = SPORT_CENTER_ALIASES.map((_, i) => `$${i + 1}`).join(", ");

  console.log("📋 Mencari penerima notifikasi kategori Sport Center...");
  const { rows: receivers } = await pool.query(
    `SELECT id, name, phone, category, is_active
     FROM notification_receivers
     WHERE category IN (${placeholders}) AND is_active = true`,
    SPORT_CENTER_ALIASES,
  );

  if (receivers.length === 0) {
    console.log("⚠️  Tidak ada penerima aktif ditemukan untuk kategori Sport Center.");
    console.log("   Pastikan data sudah ada di tabel notification_receivers.");
    await pool.end();
    return;
  }

  console.log(`\n✅ Ditemukan ${receivers.length} penerima aktif:\n`);
  receivers.forEach((r) => {
    const tipe = r.phone?.includes("@g.us") ? "📢 Grup" : "📱 Pribadi";
    console.log(`  ${tipe}  ${r.name} — ${r.phone} (${r.category})`);
  });

  const testMsg =
    `🧪 *[TEST NOTIFIKASI]*\n\n` +
    `✅ *Jadwal Tersedia!*\n\n` +
    `🏟️ Lapangan : *Tennis*\n` +
    `📅 Tanggal  : *7 Juli 2026*\n` +
    `⏰ Jam      : *14:00*\n` +
    `⏱️ Durasi   : *2 Jam*\n` +
    `💰 Harga    : *Rp 200.000*\n` +
    `👤 Nama Pemesan : *Test User*\n\n` +
    `Baik team kami akan segera membantu. 🙏\n\n` +
    `_(Ini adalah pesan tes — bukan booking nyata)_`;

  console.log("\n📤 Mengirim pesan tes ke semua penerima...\n");
  for (const r of receivers) {
    try {
      const result = await sendFonnte(r.phone, testMsg);
      if (result.status === true || result.detail?.includes("success") || result.process === true) {
        console.log(`  ✅ Terkirim ke: ${r.name} (${r.phone})`);
      } else {
        console.log(`  ⚠️  ${r.name} (${r.phone}): ${JSON.stringify(result)}`);
      }
    } catch (err) {
      console.log(`  ❌ Gagal ke ${r.name} (${r.phone}): ${err.message}`);
    }
    // Jeda 1 detik antar pesan agar tidak rate-limited
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("\n✅ Selesai.\n");
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
