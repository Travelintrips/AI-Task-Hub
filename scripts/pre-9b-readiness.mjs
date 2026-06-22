/**
 * SPRINT 9B PREPARATION — PRE-9B READINESS GAPS
 *
 * Tasks:
 *  1. Create document template: trucking_inquiry (3 optional docs)
 *  2. Create document template: ppjk_service (5 required docs)
 *  3. Update intake_mode for all intents (21 conv / 12 hybrid / 15 mini_form)
 *     - UPDATE existing 32 data_templates
 *     - INSERT minimal templates for 16 intents that have none
 *  4. Verify distribution
 *
 * Idempotent — safe to re-run.
 * Run: node scripts/pre-9b-readiness.mjs
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });
const C = 'default';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function upsertDocTemplate({ intentCode, name, category, description }) {
  const { rows } = await pool.query(
    `SELECT id FROM document_templates WHERE company_id=$1 AND intent_code=$2`,
    [C, intentCode]
  );
  if (rows.length) {
    console.log(`  [SKIP] doc_template already exists for ${intentCode} (id=${rows[0].id})`);
    return rows[0].id;
  }
  const { rows: r } = await pool.query(
    `INSERT INTO document_templates
       (company_id, name, category, description, is_active, intent_code, created_at, updated_at)
     VALUES ($1,$2,$3,$4,true,$5,NOW(),NOW()) RETURNING id`,
    [C, name, category, description, intentCode]
  );
  console.log(`  [CREATE] doc_template for ${intentCode} → id=${r[0].id}`);
  return r[0].id;
}

async function upsertDocFields(templateId, docs) {
  await pool.query(`DELETE FROM document_template_fields WHERE template_id=$1`, [templateId]);
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    await pool.query(
      `INSERT INTO document_template_fields
         (template_id, document_name, document_type, is_required,
          description, sort_order, example_file_description, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [templateId, d.name, d.type ?? 'upload', d.required ?? false,
       d.description ?? null, i + 1, d.example ?? null]
    );
  }
  console.log(`  [FIELDS] ${docs.length} document field(s) upserted for template id=${templateId}`);
}

async function setIntakeMode(intentCode, intakeMode) {
  // Check if data_template exists
  const { rows } = await pool.query(
    `SELECT id, intake_mode FROM data_templates WHERE company_id=$1 AND intent_code=$2`,
    [C, intentCode]
  );

  if (rows.length) {
    // UPDATE existing
    await pool.query(
      `UPDATE data_templates SET intake_mode=$1, updated_at=NOW()
       WHERE company_id=$2 AND intent_code=$3`,
      [intakeMode, C, intentCode]
    );
    const prev = rows[0].intake_mode ?? 'NULL';
    const changed = prev !== intakeMode ? `${prev} → ${intakeMode}` : `${intakeMode} (no change)`;
    console.log(`  [UPDATE] ${intentCode}: ${changed}`);
  } else {
    // INSERT minimal data_template so intake_mode is captured
    await pool.query(
      `INSERT INTO data_templates
         (company_id, name, category, description, is_active,
          intent_code, use_mini_form, mini_form_type, intake_mode, created_at, updated_at)
       VALUES ($1,$2,$3,$4,true,$5,false,NULL,$6,NOW(),NOW())`,
      [C,
       `Template ${intentCode}`,
       'Umum',
       `Auto-generated minimal template for ${intentCode}`,
       intentCode,
       intakeMode]
    );
    console.log(`  [INSERT] ${intentCode}: new template with intake_mode=${intakeMode}`);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(' SPRINT 9B PREPARATION — PRE-9B READINESS SCRIPT');
  console.log('═══════════════════════════════════════════════════\n');

  // ── TASK 1: trucking_inquiry document template ───────────────────────────
  console.log('── TASK 1: Document Template — trucking_inquiry ──');
  const truckingDocId = await upsertDocTemplate({
    intentCode: 'trucking_inquiry',
    name: 'Dokumen Trucking',
    category: 'Logistik',
    description: 'Dokumen pendukung untuk layanan trucking / pengiriman darat',
  });
  await upsertDocFields(truckingDocId, [
    {
      name: 'Packing List',
      type: 'pdf',
      required: false,
      description: 'Daftar barang yang akan dikirim',
      example: 'packing_list.pdf',
    },
    {
      name: 'Surat Jalan',
      type: 'pdf',
      required: false,
      description: 'Surat jalan / delivery order dari pengirim',
      example: 'surat_jalan.pdf',
    },
    {
      name: 'Foto Barang',
      type: 'image',
      required: false,
      description: 'Foto kondisi barang sebelum pengiriman',
      example: 'foto_barang.jpg',
    },
  ]);
  console.log('  ✅ trucking_inquiry document template done\n');

  // ── TASK 2: ppjk_service document template ───────────────────────────────
  console.log('── TASK 2: Document Template — ppjk_service ──');
  const ppjkDocId = await upsertDocTemplate({
    intentCode: 'ppjk_service',
    name: 'Dokumen PPJK (Bea Cukai)',
    category: 'Logistik',
    description: 'Dokumen wajib untuk layanan Pengusaha Pengurusan Jasa Kepabeanan (PPJK)',
  });
  await upsertDocFields(ppjkDocId, [
    {
      name: 'Commercial Invoice',
      type: 'pdf',
      required: true,
      description: 'Invoice komersial dari supplier/buyer',
      example: 'commercial_invoice.pdf',
    },
    {
      name: 'Packing List',
      type: 'pdf',
      required: true,
      description: 'Daftar rincian barang dan kemasan',
      example: 'packing_list.pdf',
    },
    {
      name: 'API / NIB',
      type: 'pdf',
      required: true,
      description: 'Angka Pengenal Impor (API) atau Nomor Induk Berusaha (NIB)',
      example: 'api_nib.pdf',
    },
    {
      name: 'NPWP',
      type: 'pdf',
      required: true,
      description: 'Nomor Pokok Wajib Pajak perusahaan',
      example: 'npwp.pdf',
    },
    {
      name: 'Draft PIB/PEB',
      type: 'pdf',
      required: true,
      description: 'Draft Pemberitahuan Impor/Ekspor Barang untuk verifikasi bea cukai',
      example: 'draft_pib_peb.pdf',
    },
  ]);
  console.log('  ✅ ppjk_service document template done\n');

  // ── TASK 3: Update intake_mode for all 48 intents ────────────────────────
  console.log('── TASK 3: Update intake_mode — CONVERSATION (21 intents) ──');
  const conversationIntents = [
    'cek_status_pengiriman',      // 4 fields — simple status check
    'permintaan_kasbon',          // 5 fields — simple cash advance
    'pertanyaan_tagihan',         // 7 fields — billing query
    'konfirmasi_pembayaran',      // 8 fields — payment confirmation
    'customer_data_update',       // 7 fields — admin update
    'permintaan_dokumen',         // 7 fields — document request
    'komplain_pengiriman',        // 5 fields — simple complaint
    'jadwal_pengiriman',          // 7 fields — delivery schedule
    'feedback_positif',           // no template — positive feedback
    'pertanyaan_layanan',         // no template — service info
    'general_inquiry',            // no template — general question
    'cancel_booking',             // no template — simple cancellation
    'cek_jadwal_lapangan',        // no template — field schedule check
    'cek_membership',             // no template — membership status
    'konfirmasi_pembayaran_sport',// no template — sport payment confirm
    'perpanjang_membership',      // no template — membership renewal
    'reschedule_booking',         // no template — reschedule
    'cek_tagihan_tenant',         // no template — tenant billing check
    'info_sewa_tenant',           // no template — rental info
    'konfirmasi_pembayaran_tenant',// no template — tenant payment confirm
    'laporan_masalah_tenant',     // no template — tenant simple complaint
  ];
  for (const code of conversationIntents) {
    await setIntakeMode(code, 'conversation');
  }
  console.log(`  ✅ ${conversationIntents.length} CONVERSATION intents done\n`);

  console.log('── TASK 3: Update intake_mode — HYBRID (12 intents) ──');
  const hybridIntents = [
    'trucking_inquiry',           // 11 fields — AI asks, then form if needed
    'air_freight_inquiry',        // 14 fields — complex, AI-guided
    'sea_freight_inquiry',        // 15 fields — complex, AI-guided
    'customs_clearance',          // 12 fields — AI + customs form
    'ppjk_service',               // 10 fields — AI + PPJK form
    'fleet_repair',               // 10 fields — AI asks symptoms first
    'damaged_goods_complaint',    // 10 fields — AI gathers context, then form
    'delivery_delay_complaint',   // 9 fields  — AI investigates, then form
    'cold_chain',                 // 12 fields — AI asks specifics first
    'warehousing_request',        // 10 fields — AI clarifies, then form
    'permintaan_pickup',          // 8 fields  — AI confirms details, then form
    'fuel_expense',               // 10 fields — AI verifies, then form
  ];
  for (const code of hybridIntents) {
    await setIntakeMode(code, 'hybrid');
  }
  console.log(`  ✅ ${hybridIntents.length} HYBRID intents done\n`);

  console.log('── TASK 3: Update intake_mode — MINI_FORM (15 intents) ──');
  const miniFormIntents = [
    'import_inquiry',             // 13 fields + 7 docs — full structured form
    'export_inquiry',             // 13 fields + 6 docs — full structured form
    'dg_cargo',                   // 13 fields + 4 docs — regulated, must fill form
    'live_animal_cargo',          // 11 fields + 4 docs — regulated, form required
    'project_cargo',              // 13 fields + 5 docs — complex, structured
    'klaim_asuransi',             // 6 fields + 5 docs  — insurance claim form
    'permintaan_penawaran',       // 7 fields — quotation request form
    'pendaftaran_pelanggan',      // 8 fields + 4 docs — customer registration
    'permintaan_vendor',          // 9 fields + 4 docs — vendor registration form
    'daftar_tenant',              // 9 fields — tenant registration form
    'booking_lapangan',           // 10 fields — sport booking form
    'daftar_membership',          // no template — membership sign-up form
    'perpanjang_sewa',            // no template — lease renewal form
    'tire_issue',                 // 10 fields — structured tire claim form
    'komplain_fasilitas',         // no template — facility complaint form
  ];
  for (const code of miniFormIntents) {
    await setIntakeMode(code, 'mini_form');
  }
  console.log(`  ✅ ${miniFormIntents.length} MINI_FORM intents done\n`);

  // ── TASK 4: Verify distribution ──────────────────────────────────────────
  console.log('── TASK 4: Verify intake_mode distribution ──');
  const { rows: dist } = await pool.query(`
    SELECT intake_mode, COUNT(*) as cnt
    FROM data_templates
    WHERE company_id = $1
    GROUP BY intake_mode
    ORDER BY intake_mode
  `, [C]);
  console.log('  intake_mode distribution:');
  let total = 0;
  for (const row of dist) {
    console.log(`    ${row.intake_mode}: ${row.cnt}`);
    total += parseInt(row.cnt);
  }
  console.log(`    TOTAL: ${total}`);

  // Validate
  const convRow = dist.find(r => r.intake_mode === 'conversation');
  const hybRow  = dist.find(r => r.intake_mode === 'hybrid');
  const mfRow   = dist.find(r => r.intake_mode === 'mini_form');

  const convOk = parseInt(convRow?.cnt ?? 0) === 21;
  const hybOk  = parseInt(hybRow?.cnt  ?? 0) === 12;
  const mfOk   = parseInt(mfRow?.cnt   ?? 0) === 15;

  console.log('\n  Validation:');
  console.log(`    conversation = ${convRow?.cnt} (expected 21): ${convOk ? '✅' : '❌'}`);
  console.log(`    hybrid       = ${hybRow?.cnt}  (expected 12): ${hybOk  ? '✅' : '❌'}`);
  console.log(`    mini_form    = ${mfRow?.cnt}   (expected 15): ${mfOk   ? '✅' : '❌'}`);

  // ── Doc template status ───────────────────────────────────────────────────
  const { rows: docCheck } = await pool.query(`
    SELECT dt.intent_code, dt.name,
      (SELECT COUNT(*) FROM document_template_fields f WHERE f.template_id=dt.id) docs
    FROM document_templates dt
    WHERE dt.company_id=$1 AND dt.intent_code IN ('trucking_inquiry','ppjk_service')
  `, [C]);

  console.log('\n  New doc templates:');
  for (const r of docCheck) {
    console.log(`    ${r.intent_code}: "${r.name}" — ${r.docs} document field(s)`);
  }

  // ── Return data for report ────────────────────────────────────────────────
  const { rows: totalDist } = await pool.query(`
    SELECT intake_mode, COUNT(*) as cnt
    FROM data_templates WHERE company_id=$1 GROUP BY intake_mode ORDER BY intake_mode
  `, [C]);

  console.log('\n═══════════════════════════════════════════════════');
  const allOk = convOk && hybOk && mfOk && docCheck.length === 2;
  console.log(allOk
    ? ' ✅ ALL TASKS COMPLETE — Ready for report generation'
    : ' ⚠️  Some checks failed — review output above'
  );
  console.log('═══════════════════════════════════════════════════');

  await pool.end();
  return { dist: totalDist, docCheck, convOk, hybOk, mfOk };
}

main().catch(e => { console.error(e); process.exit(1); });
