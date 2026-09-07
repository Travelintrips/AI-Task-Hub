/**
 * PRE-10A-3 — KB Template Seed Verification
 * Check & seed data_templates + document_templates ke Supabase
 * untuk 3 intent: trucking_inquiry, permintaan_kasbon, damaged_goods_complaint
 *
 * Run: node scripts/src/seed-kb-templates.mjs
 */
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "",
});

async function run() {
  const client = await pool.connect();
  try {
    // ─── 1. AUDIT: Cek state saat ini ────────────────────────────────────────

    console.log("\n=== 1. AUDIT: data_templates saat ini ===");
    const { rows: dtRows } = await client.query(`
      SELECT dt.id, dt.intent_code, dt.name, dt.intake_mode,
             COUNT(dtf.id)::int AS field_count
      FROM data_templates dt
      LEFT JOIN data_template_fields dtf ON dtf.template_id = dt.id
      GROUP BY dt.id, dt.intent_code, dt.name, dt.intake_mode
      ORDER BY dt.id
    `);
    if (dtRows.length === 0) {
      console.log("  (kosong)");
    } else {
      dtRows.forEach(r => console.log(`  ✓ id=${r.id} intent=${r.intent_code} name="${r.name}" mode=${r.intake_mode} fields=${r.field_count}`));
    }

    console.log("\n=== 2. AUDIT: document_templates saat ini ===");
    const { rows: docRows } = await client.query(`
      SELECT dt.id, dt.intent_code, dt.name,
             COUNT(dtf.id)::int AS field_count
      FROM document_templates dt
      LEFT JOIN document_template_fields dtf ON dtf.template_id = dt.id
      GROUP BY dt.id, dt.intent_code, dt.name
      ORDER BY dt.id
    `);
    if (docRows.length === 0) {
      console.log("  (kosong)");
    } else {
      docRows.forEach(r => console.log(`  ✓ id=${r.id} intent=${r.intent_code} name="${r.name}" fields=${r.field_count}`));
    }

    // ─── 2. SEED DATA TEMPLATES ───────────────────────────────────────────────

    const targetIntents = ["trucking_inquiry", "permintaan_kasbon", "damaged_goods_complaint"];
    const existingIntents = new Set(dtRows.map(r => r.intent_code).filter(Boolean));
    const missingDt = targetIntents.filter(i => !existingIntents.has(i));

    console.log(`\n=== 3. SEED data_templates — missing: [${missingDt.join(", ") || "none"}] ===`);

    await client.query("BEGIN");

    // ── trucking_inquiry ──
    if (missingDt.includes("trucking_inquiry")) {
      const { rows: [tpl] } = await client.query(`
        INSERT INTO data_templates (company_id, intent_code, name, category, description, intake_mode, is_active)
        VALUES ('default', 'trucking_inquiry', 'Template Trucking Darat', 'Logistik',
                'Data yang dibutuhkan untuk permintaan jasa trucking darat', 'mini_form', true)
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      if (tpl) {
        const fields = [
          { name: "rute_asal",       label: "Kota / Lokasi Asal",            type: "text",   required: true,  order: 1, help: "Nama kota atau alamat pickup",       sample: "Jakarta Utara, Pelabuhan Tanjung Priok" },
          { name: "rute_tujuan",     label: "Kota / Lokasi Tujuan",          type: "text",   required: true,  order: 2, help: "Nama kota atau alamat delivery",     sample: "Surabaya, Pergudangan SIER" },
          { name: "jenis_muatan",    label: "Jenis Muatan / Komoditi",       type: "text",   required: true,  order: 3, help: "Apa yang akan dikirim",              sample: "Elektronik, mesin, sembako" },
          { name: "berat_kg",        label: "Estimasi Berat (kg)",           type: "number", required: true,  order: 4, help: "Berat total muatan dalam kilogram",  sample: "5000" },
          { name: "tanggal_muat",    label: "Tanggal Rencana Muat",          type: "date",   required: true,  order: 5, help: "Kapan barang siap dimuat",           sample: "25/06/2026" },
          { name: "jenis_kendaraan", label: "Jenis Kendaraan (opsional)",    type: "text",   required: false, order: 6, help: "Tronton, fuso, engkel, dll",         sample: "Fuso CDD" },
        ];
        for (const f of fields) {
          await client.query(`
            INSERT INTO data_template_fields
              (template_id, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT DO NOTHING
          `, [tpl.id, f.name, f.label, f.type, f.required, f.order, f.help, f.sample]);
        }
        console.log(`  ✅ trucking_inquiry: template #${tpl.id} + ${fields.length} fields (mode: mini_form)`);
      } else {
        console.log("  ℹ️  trucking_inquiry: sudah ada (ON CONFLICT), skip");
      }
    } else {
      console.log("  ℹ️  trucking_inquiry: sudah ada, skip");
    }

    // ── permintaan_kasbon ──
    if (missingDt.includes("permintaan_kasbon")) {
      const { rows: [tpl] } = await client.query(`
        INSERT INTO data_templates (company_id, intent_code, name, category, description, intake_mode, is_active)
        VALUES ('default', 'permintaan_kasbon', 'Template Kasbon Karyawan', 'Finance',
                'Data yang dibutuhkan untuk memproses permintaan kasbon karyawan', 'conversation', true)
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      if (tpl) {
        const fields = [
          { name: "nama_karyawan",  label: "Nama Lengkap Karyawan",        type: "text",   required: true,  order: 1, help: "Nama sesuai data karyawan",   sample: "Budi Santoso" },
          { name: "jumlah_kasbon",  label: "Jumlah Kasbon yang Diminta (Rp)", type: "number", required: true, order: 2, help: "Nominal dalam rupiah",       sample: "2000000" },
          { name: "alasan_kasbon",  label: "Alasan / Keperluan Kasbon",    type: "text",   required: true,  order: 3, help: "Singkat dan jelas",           sample: "Biaya berobat keluarga" },
          { name: "tanggal_butuh",  label: "Tanggal Butuh Dana",           type: "date",   required: true,  order: 4, help: "Format: DD/MM/YYYY",          sample: "25/06/2026" },
          { name: "cicilan_bulan",  label: "Rencana Cicilan (berapa bulan)", type: "number", required: false, order: 5, help: "Misal: 2 bulan",            sample: "2" },
        ];
        for (const f of fields) {
          await client.query(`
            INSERT INTO data_template_fields
              (template_id, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT DO NOTHING
          `, [tpl.id, f.name, f.label, f.type, f.required, f.order, f.help, f.sample]);
        }
        console.log(`  ✅ permintaan_kasbon: template #${tpl.id} + ${fields.length} fields (mode: conversation)`);
      } else {
        console.log("  ℹ️  permintaan_kasbon: sudah ada (ON CONFLICT), skip");
      }
    } else {
      console.log("  ℹ️  permintaan_kasbon: sudah ada, skip");
    }

    // ── damaged_goods_complaint ──
    if (missingDt.includes("damaged_goods_complaint")) {
      const { rows: [tpl] } = await client.query(`
        INSERT INTO data_templates (company_id, intent_code, name, category, description, intake_mode, is_active)
        VALUES ('default', 'damaged_goods_complaint', 'Template Komplain Barang Rusak', 'Komplain',
                'Data yang dibutuhkan untuk memproses laporan kerusakan barang', 'hybrid', true)
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      if (tpl) {
        const fields = [
          { name: "nomor_resi",      label: "Nomor Resi / Nomor Pengiriman",  type: "text",   required: true,  order: 1, help: "Nomor AWB atau tracking",    sample: "JKT2606001" },
          { name: "deskripsi_rusak", label: "Deskripsi Kerusakan",            type: "text",   required: true,  order: 2, help: "Jelaskan kondisi kerusakan",  sample: "Kardus penyok, isi barang pecah" },
          { name: "nilai_barang",    label: "Estimasi Nilai Barang (Rp)",     type: "number", required: true,  order: 3, help: "Nilai untuk klaim",           sample: "500000" },
          { name: "tanggal_terima",  label: "Tanggal Barang Diterima",        type: "date",   required: true,  order: 4, help: "Kapan barang sampai",         sample: "23/06/2026" },
          { name: "kontak_pelapor",  label: "Nama & Nomor Pelapor",          type: "text",   required: true,  order: 5, help: "Nama dan nomor WA",           sample: "Andi – 08123456789" },
        ];
        for (const f of fields) {
          await client.query(`
            INSERT INTO data_template_fields
              (template_id, field_name, field_label, field_type, is_required, sort_order, help_text, sample_value)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT DO NOTHING
          `, [tpl.id, f.name, f.label, f.type, f.required, f.order, f.help, f.sample]);
        }
        console.log(`  ✅ damaged_goods_complaint: template #${tpl.id} + ${fields.length} fields (mode: hybrid)`);
      } else {
        console.log("  ℹ️  damaged_goods_complaint: sudah ada (ON CONFLICT), skip");
      }
    } else {
      console.log("  ℹ️  damaged_goods_complaint: sudah ada, skip");
    }

    // ─── 3. SEED DOCUMENT TEMPLATES ──────────────────────────────────────────

    const existingDocIntents = new Set(docRows.map(r => r.intent_code).filter(Boolean));
    const missingDoc = ["damaged_goods_complaint", "trucking_inquiry"].filter(i => !existingDocIntents.has(i));

    console.log(`\n=== 4. SEED document_templates — missing: [${missingDoc.join(", ") || "none"}] ===`);

    // damaged_goods_complaint → dokumen foto kerusakan
    if (missingDoc.includes("damaged_goods_complaint")) {
      const { rows: [docTpl] } = await client.query(`
        INSERT INTO document_templates (company_id, intent_code, name, category, description, is_active)
        VALUES ('default', 'damaged_goods_complaint', 'Dokumen Klaim Barang Rusak', 'Komplain',
                'Dokumen pendukung yang wajib dilampirkan untuk klaim kerusakan barang', true)
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      if (docTpl) {
        const docFields = [
          { name: "foto_kerusakan", type: "JPG/PNG", required: true,  order: 1, desc: "Foto kondisi barang dan kemasan yang rusak (min 2 foto)", example: "Foto tampak depan dan isi barang" },
          { name: "bukti_resi",     type: "PDF/JPG", required: true,  order: 2, desc: "Scan atau foto resi / AWB pengiriman",                    example: "Resi dari kurir atau ekspedisi" },
          { name: "invoice_barang", type: "PDF",     required: false, order: 3, desc: "Invoice pembelian barang untuk dasar nilai klaim",          example: "Invoice dari supplier" },
        ];
        for (const f of docFields) {
          await client.query(`
            INSERT INTO document_template_fields
              (template_id, document_name, document_type, is_required, sort_order, description, example_file_description)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT DO NOTHING
          `, [docTpl.id, f.name, f.type, f.required, f.order, f.desc, f.example]);
        }
        console.log(`  ✅ damaged_goods_complaint doc template #${docTpl.id} + ${docFields.length} dokumen`);
      } else {
        console.log("  ℹ️  damaged_goods_complaint doc: sudah ada, skip");
      }
    } else {
      console.log("  ℹ️  damaged_goods_complaint doc: sudah ada, skip");
    }

    // trucking_inquiry → surat jalan / PO
    if (missingDoc.includes("trucking_inquiry")) {
      const { rows: [docTpl] } = await client.query(`
        INSERT INTO document_templates (company_id, intent_code, name, category, description, is_active)
        VALUES ('default', 'trucking_inquiry', 'Dokumen Pendukung Trucking', 'Logistik',
                'Dokumen yang dibutuhkan untuk pemrosesan order trucking darat', true)
        ON CONFLICT DO NOTHING
        RETURNING id
      `);
      if (docTpl) {
        const docFields = [
          { name: "surat_jalan",    type: "PDF/JPG", required: false, order: 1, desc: "Surat jalan / delivery order (jika sudah ada)", example: "DO dari shipper" },
          { name: "packing_list",   type: "PDF/XLS", required: false, order: 2, desc: "Packing list muatan",                            example: "List item & berat per karton" },
        ];
        for (const f of docFields) {
          await client.query(`
            INSERT INTO document_template_fields
              (template_id, document_name, document_type, is_required, sort_order, description, example_file_description)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT DO NOTHING
          `, [docTpl.id, f.name, f.type, f.required, f.order, f.desc, f.example]);
        }
        console.log(`  ✅ trucking_inquiry doc template #${docTpl.id} + ${docFields.length} dokumen`);
      } else {
        console.log("  ℹ️  trucking_inquiry doc: sudah ada, skip");
      }
    } else {
      console.log("  ℹ️  trucking_inquiry doc: sudah ada, skip");
    }

    await client.query("COMMIT");

    // ─── 4. VERIFY FINAL STATE ────────────────────────────────────────────────

    console.log("\n=== 5. VERIFIKASI AKHIR ===");
    const { rows: finalDt } = await client.query(`
      SELECT dt.intent_code, dt.name, dt.intake_mode,
             COUNT(dtf.id)::int AS fields
      FROM data_templates dt
      LEFT JOIN data_template_fields dtf ON dtf.template_id = dt.id
      WHERE dt.intent_code IN ('trucking_inquiry','permintaan_kasbon','damaged_goods_complaint')
      GROUP BY dt.id, dt.intent_code, dt.name, dt.intake_mode
    `);

    const { rows: finalDoc } = await client.query(`
      SELECT dt.intent_code, dt.name,
             COUNT(dtf.id)::int AS docs
      FROM document_templates dt
      LEFT JOIN document_template_fields dtf ON dtf.template_id = dt.id
      WHERE dt.intent_code IN ('trucking_inquiry','damaged_goods_complaint')
      GROUP BY dt.id, dt.intent_code, dt.name
    `);

    console.log("\ndata_templates:");
    finalDt.forEach(r => console.log(`  intent=${r.intent_code} | mode=${r.intake_mode} | fields=${r.fields} | "${r.name}"`));
    console.log("\ndocument_templates:");
    finalDoc.forEach(r => console.log(`  intent=${r.intent_code} | docs=${r.docs} | "${r.name}"`));

    // ─── 5. SIMULATOR TEST ────────────────────────────────────────────────────

    console.log("\n=== 6. AI SIMULATOR TEST ===");
    const testMessages = [
      { msg: "Saya mau trucking Jakarta Surabaya",  expected: { intent: "trucking_inquiry",           intake: true, miniForm: true  } },
      { msg: "Saya mau kasbon",                     expected: { intent: "permintaan_kasbon",          intake: true, miniForm: false } },
      { msg: "Barang saya pecah",                   expected: { intent: "damaged_goods_complaint",    intake: true, miniForm: true  } },
    ];

    for (const tc of testMessages) {
      const msgLower = tc.msg.toLowerCase();

      // Keyword match
      const { rows: kwRows } = await client.query(`
        SELECT k.keyword, k.weight, k.intent_code, i.category, i.description
        FROM keyword_rules k
        LEFT JOIN intent_master i ON i.intent_code = k.intent_code
        WHERE $1 ILIKE '%' || k.keyword || '%'
          AND (k.is_active IS NULL OR k.is_active = true)
        ORDER BY k.weight DESC
        LIMIT 5
      `, [msgLower]);

      let intentCode = null;
      let detectedIntent = null;
      let confidence = 0;

      if (kwRows.length > 0) {
        intentCode = kwRows[0].intent_code;
        detectedIntent = kwRows[0].description;
        confidence = Math.min(95, 60 + kwRows.length * 7);
      } else {
        // Fallback
        const fallback = [
          { words: ["kasbon","uang muka","pinjam","advance"],       code: "permintaan_kasbon",       desc: "Permintaan Cash Advance" },
          { words: ["trucking","truk","angkut","darat","pengiriman"], code: "trucking_inquiry",       desc: "Permintaan Trucking" },
          { words: ["rusak","barang rusak","damaged","pecah","cacat"], code: "damaged_goods_complaint", desc: "Komplain Kerusakan Barang" },
        ];
        for (const fb of fallback) {
          if (fb.words.some(w => msgLower.includes(w))) {
            intentCode = fb.code; detectedIntent = fb.desc; confidence = 55; break;
          }
        }
      }

      // Template lookup
      let intakeMode = "none";
      let missingFields = [];
      if (intentCode) {
        const { rows: tplRows } = await client.query(`
          SELECT dt.name, dt.intake_mode,
                 array_agg(dtf.field_label) FILTER (WHERE dtf.is_required = true) AS required_fields
          FROM data_templates dt
          LEFT JOIN data_template_fields dtf ON dtf.template_id = dt.id
          WHERE dt.intent_code = $1
          GROUP BY dt.id, dt.name, dt.intake_mode
          LIMIT 1
        `, [intentCode]);
        if (tplRows.length > 0) {
          intakeMode = tplRows[0].intake_mode ?? "conversation";
          missingFields = (tplRows[0].required_fields ?? []).filter(Boolean);
        }
      }

      const hasIntakeFlow = intakeMode !== "none";
      const wouldStartIntake = hasIntakeFlow;
      const wouldCreateTask = !!intentCode && confidence >= 50 && !hasIntakeFlow;
      const wouldSendMiniForm = hasIntakeFlow && (intakeMode === "mini_form" || intakeMode === "hybrid");

      const pass = (
        intentCode === tc.expected.intent &&
        wouldStartIntake === tc.expected.intake &&
        wouldSendMiniForm === tc.expected.miniForm
      );

      console.log(`\n  "${tc.msg}"`);
      console.log(`    intent      : ${intentCode} ${intentCode === tc.expected.intent ? "✅" : "❌ expected " + tc.expected.intent}`);
      console.log(`    confidence  : ${confidence}%`);
      console.log(`    intakeMode  : ${intakeMode}`);
      console.log(`    wouldStartIntake : ${wouldStartIntake} ${wouldStartIntake === tc.expected.intake ? "✅" : "❌ expected " + tc.expected.intake}`);
      console.log(`    wouldSendMiniForm: ${wouldSendMiniForm} ${wouldSendMiniForm === tc.expected.miniForm ? "✅" : "❌ expected " + tc.expected.miniForm}`);
      console.log(`    wouldCreateTask  : ${wouldCreateTask}`);
      console.log(`    missingFields    : [${missingFields.slice(0,3).join(", ")}${missingFields.length > 3 ? "..." : ""}]`);
      console.log(`    → ${pass ? "✅ PASS" : "❌ FAIL"}`);
    }

    console.log("\n=== SELESAI ===");

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("ERROR:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
