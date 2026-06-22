/**
 * Sprint 9C — Seed: document_validation_rules
 * 10 document types with required fields + validation prompts
 * Run: node scripts/src/seed-validation-rules.mjs
 */
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "",
});

const RULES = [
  {
    type: "commercial_invoice",
    label: "Commercial Invoice",
    required: ["invoice_number","invoice_date","seller_name","buyer_name","incoterm","currency","total_value","item_description"],
    optional: ["payment_terms","country_of_origin","hs_code","quantity","unit_price"],
    prompt: `You are a document validator. Examine this Commercial Invoice image/PDF and extract the following fields: invoice_number, invoice_date, seller_name, buyer_name, incoterm (e.g. FOB, CIF, EXW), currency, total_value (numeric), item_description. Return JSON only with these keys and null for missing ones. Also add a field "document_type_match": true if this is clearly a commercial invoice, false otherwise.`,
  },
  {
    type: "packing_list",
    label: "Packing List",
    required: ["packing_list_number","shipper","consignee","gross_weight","net_weight","package_count","volume","item_description"],
    optional: ["marks_and_numbers","dimensions","packing_date"],
    prompt: `You are a document validator. Examine this Packing List image/PDF and extract: packing_list_number, shipper, consignee, gross_weight (with unit), net_weight (with unit), package_count (number of packages), volume (CBM), item_description. Return JSON only with these keys and null for missing ones. Also add "document_type_match": true if this is clearly a packing list.`,
  },
  {
    type: "bl_awb",
    label: "Bill of Lading / AWB",
    required: ["document_number","shipper","consignee","origin","destination","vessel_or_flight","gross_weight"],
    optional: ["notify_party","container_number","seal_number","freight_terms","port_of_loading","port_of_discharge"],
    prompt: `You are a document validator. Examine this Bill of Lading or Air Waybill and extract: document_number (B/L or AWB number), shipper, consignee, origin (port/airport), destination (port/airport), vessel_or_flight (vessel name or flight number), gross_weight. Return JSON only. Add "document_type_match": true if this is a B/L or AWB.`,
  },
  {
    type: "hs_code",
    label: "HS Code Document",
    required: ["hs_code","item_description"],
    optional: ["product_name","chapter","heading","subheading","duty_rate"],
    prompt: `You are a document validator. Examine this HS Code document/certificate and extract: hs_code (full HS code number), item_description. Return JSON only. Add "document_type_match": true if this is an HS code classification document.`,
  },
  {
    type: "coa",
    label: "Certificate of Analysis (COA)",
    required: ["product_name","batch_number","test_results","manufacturer"],
    optional: ["expiry_date","issue_date","standard","lab_name"],
    prompt: `You are a document validator. Examine this Certificate of Analysis (COA) and extract: product_name, batch_number, test_results (summary of key results), manufacturer name. Return JSON only. Add "document_type_match": true if this is a COA.`,
  },
  {
    type: "msds",
    label: "MSDS / Safety Data Sheet",
    required: ["product_name","hazard_class","un_number","manufacturer"],
    optional: ["cas_number","flash_point","emergency_contact","revision_date"],
    prompt: `You are a document validator. Examine this MSDS (Material Safety Data Sheet) and extract: product_name, hazard_class (GHS hazard class), un_number (UN number if applicable), manufacturer name. Return JSON only. Add "document_type_match": true if this is an MSDS/SDS.`,
  },
  {
    type: "damage_photo",
    label: "Damage Photo",
    required: ["visible_damage","item_visible","photo_quality"],
    optional: ["damage_area","estimated_severity"],
    prompt: `You are a document validator examining a damage photo. Assess: visible_damage (yes/no — is damage clearly visible?), item_visible (yes/no — is the damaged item clearly in frame?), photo_quality (good/blurry/too_dark — overall photo quality for documentation purposes). Return JSON with these keys. Add "document_type_match": true if this appears to be a damage documentation photo.`,
  },
  {
    type: "stnk_kir_insurance",
    label: "STNK / KIR / Asuransi Kendaraan",
    required: ["plate_number","document_number","expiry_date","owner_name"],
    optional: ["vehicle_type","year","engine_number","chassis_number","insurance_company"],
    prompt: `You are a document validator. Examine this vehicle document (STNK, KIR, or insurance card) and extract: plate_number (license plate), document_number (STNK/KIR/policy number), expiry_date (validity expiry date in YYYY-MM-DD format if possible), owner_name. Return JSON only. Add "document_type_match": true if this is a vehicle registration or insurance document.`,
  },
  {
    type: "fuel_receipt",
    label: "Struk / Kwitansi BBM",
    required: ["receipt_date","station_name","liters","total_amount","vehicle_plate_or_unit"],
    optional: ["fuel_type","price_per_liter","odometer","driver_name"],
    prompt: `You are a document validator. Examine this fuel receipt/struk BBM and extract: receipt_date (date of transaction), station_name (SPBU/gas station name), liters (fuel quantity in liters), total_amount (total payment amount), vehicle_plate_or_unit (license plate or fleet unit ID). Return JSON only. Add "document_type_match": true if this is a fuel receipt.`,
  },
  {
    type: "maintenance_invoice",
    label: "Invoice Bengkel / Maintenance",
    required: ["invoice_number","workshop_name","service_date","vehicle_plate","total_amount"],
    optional: ["service_items","parts_list","mechanic_name","warranty_period","odometer"],
    prompt: `You are a document validator. Examine this maintenance/workshop invoice and extract: invoice_number, workshop_name (nama bengkel), service_date (tanggal servis), vehicle_plate (plat nomor kendaraan), total_amount (total biaya). Return JSON only. Add "document_type_match": true if this is a vehicle maintenance invoice.`,
  },
  {
    type: "cash_advance_receipt",
    label: "Kwitansi Kasbon / Cash Advance",
    required: ["receipt_date","amount","purpose","merchant_or_vendor"],
    optional: ["requester_name","approval_name","project_code","due_date"],
    prompt: `You are a document validator. Examine this cash advance receipt/kwitansi and extract: receipt_date (tanggal), amount (jumlah uang), purpose (keperluan/keterangan), merchant_or_vendor (nama toko/vendor/merchant). Return JSON only. Add "document_type_match": true if this is a receipt or cash advance document.`,
  },
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Delete existing rules for these document types (idempotent)
    const types = RULES.map(r => r.type);
    await client.query(
      `DELETE FROM document_validation_rules WHERE company_id = 'default' AND document_type = ANY($1)`,
      [types]
    );

    for (const rule of RULES) {
      await client.query(`
        INSERT INTO document_validation_rules
          (company_id, document_type, required_fields, optional_fields, validation_prompt, is_active)
        VALUES
          ('default', $1, $2, $3, $4, true)
      `, [rule.type, rule.required, rule.optional, rule.prompt]);
    }

    await client.query("COMMIT");
    console.log(`✅ ${RULES.length} validation rules di-seed ke Supabase`);
    RULES.forEach(r => console.log(`  - ${r.type} (${r.required.length} required fields)`));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
