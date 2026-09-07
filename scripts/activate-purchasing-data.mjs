/**
 * PHASE 3 — Purchasing Data Activation
 * Sprint 8D — Pre-Sprint 9 Hardening
 *
 * Run: node scripts/activate-purchasing-data.mjs
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });
const COMPANY_ID = 'default';

async function activateBudgetTracker() {
  console.log('\n--- Phase 3A: Budget Tracker ---');

  const { rows: existing } = await pool.query(
    `SELECT COUNT(*) as cnt FROM purchasing_budget_tracker WHERE company_id = $1`, [COMPANY_ID]
  );
  if (parseInt(existing[0].cnt) > 0) {
    console.log(`  Already has ${existing[0].cnt} rows — skipping`);
    return parseInt(existing[0].cnt);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Try expense_budgets first
  const { rows: budgets } = await pool.query(`SELECT * FROM expense_budgets LIMIT 50`).catch(() => ({ rows: [] }));

  if (budgets.length > 0) {
    console.log(`  Importing ${budgets.length} expense_budgets`);
    for (const b of budgets) {
      await pool.query(`
        INSERT INTO purchasing_budget_tracker (
          company_id, period_year, period_month, service_category, department,
          budget_allocated, budget_used, budget_pending, budget_remaining,
          utilization_pct, currency, supabase_budget_id, refreshed_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, 0, 'IDR', $7, NOW(), NOW(), NOW())
        ON CONFLICT DO NOTHING
      `, [
        COMPANY_ID,
        b.year ?? year, b.month ?? month,
        b.category_id ? `Category-${b.category_id}` : 'General',
        b.department ?? 'Operations',
        parseFloat(b.budget_amount ?? '0'),
        b.id,
      ]);
    }
    console.log(`  Imported ${budgets.length} budget entries`);
    return budgets.length;
  }

  // Generate estimated baseline from logistic_orders service categories
  console.log('  No expense_budgets — generating estimated baseline from logistic_orders');
  const { rows: orderStats } = await pool.query(`
    SELECT
      COALESCE(service_category, shipment_type, 'General') as svc,
      COUNT(*) as cnt,
      COALESCE(SUM(vendor_cost), 0) as total_cost
    FROM logistic_orders
    WHERE created_at >= NOW() - INTERVAL '6 months'
    GROUP BY COALESCE(service_category, shipment_type, 'General')
    ORDER BY total_cost DESC
  `).catch(() => ({ rows: [] }));

  const defaults = [
    { svc: 'Trucking', budget: 50_000_000 },
    { svc: 'Air Freight', budget: 75_000_000 },
    { svc: 'Sea Freight', budget: 100_000_000 },
    { svc: 'Customs Clearance', budget: 30_000_000 },
    { svc: 'Warehousing', budget: 25_000_000 },
    { svc: 'General', budget: 20_000_000 },
  ];

  const toSeed = orderStats.length > 0
    ? orderStats.map(r => ({
        svc: r.svc,
        budget: Math.max(5_000_000, parseFloat(r.total_cost) / 6 * 1.5),
      }))
    : defaults;

  for (const item of toSeed) {
    await pool.query(`
      INSERT INTO purchasing_budget_tracker (
        company_id, period_year, period_month, service_category, department,
        budget_allocated, budget_used, budget_pending, budget_remaining,
        utilization_pct, currency, refreshed_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'Operations', $5, 0, 0, $5, 0, 'IDR', NOW(), NOW(), NOW())
      ON CONFLICT DO NOTHING
    `, [COMPANY_ID, year, month, item.svc, item.budget]);
    console.log(`  Budget: ${item.svc} = Rp${Math.round(item.budget).toLocaleString()} (estimated)`);
  }
  console.log(`  Seeded ${toSeed.length} entries`);
  return toSeed.length;
}

async function activateVendorContractRates() {
  console.log('\n--- Phase 3B: Vendor Contract Rates ---');

  const { rows: existing } = await pool.query(
    `SELECT COUNT(*) as cnt FROM vendor_contract_rates WHERE company_id = $1`, [COMPANY_ID]
  );
  if (parseInt(existing[0].cnt) > 0) {
    console.log(`  Already has ${existing[0].cnt} rows — skipping`);
    return parseInt(existing[0].cnt);
  }

  const today = new Date().toISOString().slice(0, 10);
  const validUntil = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  // Derive from logistic_orders with approved vendor + cost
  const { rows: vendorStats } = await pool.query(`
    SELECT
      lo.approved_vendor_id as vendor_id,
      s.name as vendor_name,
      COALESCE(lo.service_category, lo.shipment_type, 'General') as service_category,
      lo.origin, lo.destination,
      AVG(lo.vendor_cost) as avg_rate,
      COUNT(*) as sample_count
    FROM logistic_orders lo
    LEFT JOIN suppliers s ON s.id = lo.approved_vendor_id
    WHERE lo.approved_vendor_id IS NOT NULL
      AND lo.vendor_cost IS NOT NULL
      AND lo.vendor_cost > 0
    GROUP BY lo.approved_vendor_id, s.name,
             COALESCE(lo.service_category, lo.shipment_type, 'General'),
             lo.origin, lo.destination
    LIMIT 50
  `).catch(() => ({ rows: [] }));

  if (vendorStats.length > 0) {
    console.log(`  Found ${vendorStats.length} vendor-route-category combos from logistic_orders`);
    for (const stat of vendorStats) {
      const note = `Estimated dari ${stat.sample_count} order. Confidence: ${stat.sample_count >= 3 ? 'medium' : 'low'}. Wajib diverifikasi.`;
      await pool.query(`
        INSERT INTO vendor_contract_rates (
          company_id, vendor_id, vendor_name, service_category,
          origin, destination, contracted_rate, currency, rate_unit,
          valid_from, valid_until, contract_reference, notes,
          is_active, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'IDR', 'per_shipment',
          $8, $9, 'ESTIMATED', $10, true, 'backfill-script', NOW(), NOW())
        ON CONFLICT DO NOTHING
      `, [
        COMPANY_ID,
        stat.vendor_id,
        stat.vendor_name ?? `Vendor ${stat.vendor_id}`,
        stat.service_category,
        stat.origin, stat.destination,
        parseFloat(stat.avg_rate),
        today, validUntil,
        note,
      ]);
      console.log(`  Rate: ${stat.vendor_name} | ${stat.service_category} | Rp${Math.round(stat.avg_rate).toLocaleString()}`);
    }
    return vendorStats.length;
  }

  // Fallback — placeholder rates from top suppliers
  console.log('  No vendor cost history — generating placeholder rates');
  const { rows: suppliers } = await pool.query(`SELECT id, name FROM suppliers ORDER BY id LIMIT 5`);
  const categories = ['Trucking', 'Air Freight', 'Sea Freight', 'Customs Clearance'];
  const baseRates = { 'Trucking': 2_500_000, 'Air Freight': 15_000_000, 'Sea Freight': 8_000_000, 'Customs Clearance': 3_000_000 };
  let count = 0;

  for (const sup of suppliers.slice(0, 3)) {
    for (const cat of categories) {
      await pool.query(`
        INSERT INTO vendor_contract_rates (
          company_id, vendor_id, vendor_name, service_category,
          origin, destination, contracted_rate, currency, rate_unit,
          valid_from, valid_until, contract_reference, notes,
          is_active, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'Indonesia', 'Indonesia', $5, 'IDR', 'per_shipment',
          $6, $7, 'PLACEHOLDER',
          'Placeholder — tidak ada data historis. Wajib diisi dengan harga kontrak aktual.',
          true, 'backfill-script', NOW(), NOW())
        ON CONFLICT DO NOTHING
      `, [COMPANY_ID, sup.id, sup.name, cat, baseRates[cat], today, validUntil]);
      count++;
    }
  }
  console.log(`  Generated ${count} placeholder rates (confidence: low)`);
  return count;
}

async function run() {
  console.log('=== Purchasing Data Activation ===');
  const budgetCount = await activateBudgetTracker();
  const rateCount = await activateVendorContractRates();
  console.log(`\n=== Phase 3 Complete ===`);
  console.log(`Budget tracker: ${budgetCount} rows`);
  console.log(`Contract rates: ${rateCount} rows`);
}

run().catch(console.error).finally(() => pool.end());
