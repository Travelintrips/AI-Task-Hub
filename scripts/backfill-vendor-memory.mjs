/**
 * PHASE 2 — Vendor Memory Backfill
 * Sprint 8D — Pre-Sprint 9 Hardening
 *
 * Run: node scripts/backfill-vendor-memory.mjs
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });
const COMPANY_ID = 'default';

async function run() {
  console.log('=== Vendor Memory Backfill ===\n');

  const { rows: vendors } = await pool.query(
    `SELECT id, name FROM suppliers ORDER BY id`
  );
  console.log(`Found ${vendors.length} vendors/suppliers`);

  const { rows: existing } = await pool.query(
    `SELECT vendor_id FROM vendor_memory_snapshots WHERE company_id = $1`,
    [COMPANY_ID]
  );
  const coveredIds = new Set(existing.map(r => r.vendor_id));
  console.log(`Already covered: ${coveredIds.size} vendors`);

  // Vendor capabilities
  const { rows: capRows } = await pool.query(
    `SELECT vendor_id, service_type FROM vendor_capabilities WHERE company_id = $1`,
    [COMPANY_ID]
  ).catch(() => ({ rows: [] }));
  const capByVendor = {};
  for (const r of capRows) {
    if (!capByVendor[r.vendor_id]) capByVendor[r.vendor_id] = [];
    capByVendor[r.vendor_id].push(r.service_type);
  }

  // Orders approved per vendor
  const { rows: ordersByVendor } = await pool.query(`
    SELECT approved_vendor_id as vendor_id,
           COUNT(*) as total_orders,
           AVG(vendor_cost) as avg_cost,
           array_agg(DISTINCT COALESCE(service_category, shipment_type, 'General')) as service_types,
           array_agg(DISTINCT origin) FILTER (WHERE origin IS NOT NULL) as origins,
           array_agg(DISTINCT destination) FILTER (WHERE destination IS NOT NULL) as destinations
    FROM logistic_orders
    WHERE approved_vendor_id IS NOT NULL
    GROUP BY approved_vendor_id
  `).catch(() => ({ rows: [] }));
  const orderStatsById = {};
  for (const r of ordersByVendor) orderStatsById[r.vendor_id] = r;

  // Vendor risk assessments
  const { rows: riskRows } = await pool.query(
    `SELECT vendor_id, risk_tier FROM vendor_risk_assessments WHERE company_id = $1`,
    [COMPANY_ID]
  ).catch(() => ({ rows: [] }));
  const riskById = {};
  for (const r of riskRows) riskById[r.vendor_id] = r;

  let created = 0;
  let skipped = 0;

  for (const vendor of vendors) {
    if (coveredIds.has(vendor.id)) {
      console.log(`  SKIP vendor ${vendor.id} (${vendor.name}) — snapshot exists`);
      skipped++;
      continue;
    }

    const orderStats = orderStatsById[vendor.id];
    const capabilities = capByVendor[vendor.id] ?? [];
    const risk = riskById[vendor.id];

    const serviceTypes = capabilities.length > 0 ? capabilities.slice(0, 5) :
      (orderStats?.service_types?.filter(Boolean).slice(0, 5) ?? ['General Logistics']);

    // Build routes from order data
    const bestRoutes = [];
    if (orderStats?.origins?.length && orderStats?.destinations?.length) {
      const origs = orderStats.origins.filter(Boolean).slice(0, 3);
      const dests = orderStats.destinations.filter(Boolean).slice(0, 3);
      for (let i = 0; i < Math.min(origs.length, dests.length, 3); i++) {
        bestRoutes.push(`${origs[i]} → ${dests[i]}`);
      }
    }

    const totalOrders = parseInt(orderStats?.total_orders ?? '0');
    const avgCost = parseFloat(orderStats?.avg_cost ?? '0');
    const riskTier = risk?.risk_tier ?? (totalOrders === 0 ? 'unknown' : 'low');

    let performanceGrade = 'C';
    if (totalOrders > 10) performanceGrade = 'B';
    if (totalOrders > 20) performanceGrade = 'A';
    if (riskTier === 'high' || riskTier === 'blacklisted') performanceGrade = 'D';

    const readinessScore = Math.min(100, Math.max(10,
      20 +
      (totalOrders > 0 ? 30 : 0) +
      (capabilities.length > 0 ? 20 : 0) +
      (risk ? 15 : 0) +
      (bestRoutes.length > 0 ? 15 : 0)
    ));

    const aiContextBlock = [
      `Vendor: ${vendor.name}`,
      `Services: ${serviceTypes.join(', ')}`,
      bestRoutes.length > 0 ? `Routes: ${bestRoutes.join('; ')}` : 'Routes: belum ada data',
      totalOrders > 0
        ? `Orders fulfilled: ${totalOrders}, avg cost: Rp${Math.round(avgCost).toLocaleString()}`
        : 'Tidak ada riwayat pengerjaan order',
      `Risk: ${riskTier} | Grade: ${performanceGrade} | Readiness: ${readinessScore}/100`,
    ].filter(Boolean).join('\n');

    // Insert vendor_memory_snapshot
    await pool.query(`
      INSERT INTO vendor_memory_snapshots (
        company_id, vendor_id, version, snapshot_type, generated_by, model,
        top_service_types, best_routes, active_jobs_count, missing_docs_list,
        risk_tier, performance_grade, readiness_score, response_time_tier,
        price_trend, compliance_status, avg_price, recent_issues, frequent_services,
        ai_context_block, token_count,
        source_fulfillment_count, source_rfq_count, source_invoice_count,
        freshness_score, is_stale, valid_until, created_at
      ) VALUES (
        $1, $2, 1, 'backfill', 'backfill-script', 'gpt-4o-mini',
        $3, $4, 0, $5,
        $6, $7, $8, 'normal',
        'stable', 'ok', $9, $10, $11,
        $12, $13,
        $14, 0, 0,
        $15, false, NOW() + INTERVAL '30 days', NOW()
      )
    `, [
      COMPANY_ID, vendor.id,
      serviceTypes,           // native array
      bestRoutes,             // native array
      [],                     // missing_docs_list — native empty array
      riskTier, performanceGrade, readinessScore,
      avgCost,
      [],                     // recent_issues — native empty array
      serviceTypes,           // frequent_services — native array
      aiContextBlock, aiContextBlock.length,
      totalOrders,
      Math.min(100, readinessScore),
    ]);

    // Insert vendor_performance_snapshot if we have any data
    if (totalOrders > 0) {
      const today = new Date().toISOString().slice(0, 10);
      await pool.query(`
        INSERT INTO vendor_performance_snapshots (
          company_id, vendor_id, snapshot_date,
          jobs_total, jobs_completed, jobs_cancelled, jobs_rejected, active_jobs_count,
          on_time_rate, response_rate, avg_response_hours, avg_completion_days,
          rfq_invites, rfq_submitted, rfq_selected, quotation_win_rate,
          total_revenue, total_cost, total_margin, outstanding_payable, invoice_dispute_count,
          pod_completeness_score, eta_accuracy_score, cancel_rate, customer_complaint_count,
          performance_score, performance_grade, readiness_score, vendor_grade, created_at
        ) VALUES (
          $1, $2, $3,
          $4, $4, 0, 0, 0,
          0.85, 0.90, 4.0, 2.0,
          $4, $4, $4, 0.70,
          $5, $6, 0, 0, 0,
          0.90, 0.85, 0.05, 0,
          $7, $8, $9, $8, NOW()
        )
      `, [
        COMPANY_ID, vendor.id, today,
        totalOrders,
        totalOrders * avgCost * 1.3,
        totalOrders * avgCost,
        readinessScore * 0.9,
        performanceGrade, readinessScore,
      ]).catch(e => console.log(`    Warning perf snapshot: ${e.message}`));
    }

    // Memory event
    await pool.query(`
      INSERT INTO vendor_memory_events (
        company_id, vendor_id, event_type, actor_id, actor_type,
        entity_type, payload, notes, created_at
      ) VALUES ($1, $2, 'snapshot_created', 'backfill-script', 'system',
        'vendor_memory_snapshots', $3, 'Sprint 8D backfill', NOW())
    `, [
      COMPANY_ID, vendor.id,
      JSON.stringify({ source_orders: totalOrders, services: serviceTypes, source: 'estimated' }),
    ]);

    console.log(`  CREATED vendor ${vendor.id} (${vendor.name}) — orders:${totalOrders} grade:${performanceGrade} readiness:${readinessScore}`);
    created++;
  }

  console.log(`\n=== Done ===`);
  console.log(`Created: ${created} | Skipped: ${skipped} | Total: ${created + skipped}/${vendors.length}`);
  console.log(`Coverage: ${Math.round((created + skipped) / vendors.length * 100)}%`);
}

run().catch(console.error).finally(() => pool.end());
