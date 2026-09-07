/**
 * PHASE 1 — Customer Memory Backfill
 * Sprint 8D — Pre-Sprint 9 Hardening
 *
 * Run: node scripts/backfill-customer-memory.mjs
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });
const COMPANY_ID = 'default';

async function run() {
  console.log('=== Customer Memory Backfill ===\n');

  const { rows: customers } = await pool.query(
    `SELECT id, name, phone, email FROM customers ORDER BY id`
  );
  console.log(`Found ${customers.length} customers`);

  const { rows: existing } = await pool.query(
    `SELECT customer_id FROM customer_memory_snapshots WHERE company_id = $1`,
    [COMPANY_ID]
  );
  const coveredIds = new Set(existing.map(r => r.customer_id));
  console.log(`Already covered: ${coveredIds.size} customers`);

  // Check ai_tasks columns
  const { rows: taskCols } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='ai_tasks'`
  );
  const taskColNames = new Set(taskCols.map(r => r.column_name));

  let created = 0;
  let skipped = 0;

  for (const customer of customers) {
    if (coveredIds.has(customer.id)) {
      console.log(`  SKIP customer ${customer.id} (${customer.name}) — snapshot exists`);
      skipped++;
      continue;
    }

    const phone = customer.phone?.replace(/\D/g, '') ?? null;

    // logistic_orders by name/phone
    const { rows: orders } = await pool.query(`
      SELECT shipment_type, origin, destination, service_category,
             grand_total, status, created_at
      FROM logistic_orders
      WHERE LOWER(customer_name) = LOWER($1)
         OR (phone IS NOT NULL AND REPLACE(phone, '-', '') = $2)
      ORDER BY created_at DESC
      LIMIT 50
    `, [customer.name, phone ?? '']);

    // whatsapp_messages
    const { rows: waMessages } = await pool.query(`
      SELECT COUNT(*) as cnt, MAX(created_at) as last_msg
      FROM whatsapp_messages
      WHERE REPLACE(REPLACE(REPLACE(sender_phone, '+', ''), '-', ''), ' ', '') = $1
    `, [phone ?? '']);

    // ai_tasks
    let tasks = [];
    if (taskColNames.has('customer_id')) {
      const { rows } = await pool.query(`
        SELECT status, created_at FROM ai_tasks WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20
      `, [customer.id]).catch(() => ({ rows: [] }));
      tasks = rows;
    }

    // Compute aggregates
    const totalOrders = orders.length;
    const totalMessages = parseInt(waMessages[0]?.cnt ?? '0');
    const totalTasks = tasks.length;

    const serviceCounts = {};
    let totalRevenue = 0;
    for (const order of orders) {
      const svc = order.service_category ?? order.shipment_type ?? 'General';
      serviceCounts[svc] = (serviceCounts[svc] ?? 0) + 1;
      totalRevenue += parseFloat(order.grand_total ?? '0');
    }

    const frequentServices = Object.entries(serviceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([svc]) => svc);

    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    let riskTier = 'low';
    if (!customer.phone && !customer.email) riskTier = 'medium';
    if (totalOrders === 0 && totalMessages === 0) riskTier = 'unknown';

    const sentimentTrend = totalOrders > 3 ? 'positive' : totalOrders > 0 ? 'neutral' : 'unknown';

    const aiContextBlock = [
      `Customer: ${customer.name}`,
      customer.phone ? `Phone: ${customer.phone}` : 'Phone: tidak tersedia',
      customer.email ? `Email: ${customer.email}` : '',
      totalOrders > 0
        ? `Total orders: ${totalOrders}, rata-rata: Rp${Math.round(avgOrderValue).toLocaleString()}`
        : 'Tidak ada riwayat order',
      frequentServices.length > 0 ? `Layanan: ${frequentServices.join(', ')}` : '',
      totalMessages > 0 ? `WhatsApp messages: ${totalMessages}` : '',
      totalTasks > 0 ? `AI tasks: ${totalTasks}` : '',
      `Risk tier: ${riskTier}`,
    ].filter(Boolean).join('\n');

    const freshness = Math.min(100, Math.max(10, 30 + totalOrders * 5 + totalMessages * 2));
    const lastNIntents = frequentServices.slice(0, 3);
    const openTasks = tasks.filter(t => t.status === 'open' || t.status === 'in_progress').length;

    await pool.query(`
      INSERT INTO customer_memory_snapshots (
        company_id, customer_id, version, snapshot_type, generated_by, model,
        last_n_intents, last_task_summary, open_tasks_count, missing_docs_list,
        frequent_services, risk_tier, sentiment_trend, preferred_channel,
        ai_context_block, token_count, source_task_count, source_msg_count,
        freshness_score, is_stale, valid_until, created_at
      ) VALUES (
        $1, $2, 1, 'backfill', 'backfill-script', 'gpt-4o-mini',
        $3, $4, $5, $6,
        $7, $8, $9, 'whatsapp',
        $10, $11, $12, $13,
        $14, false, NOW() + INTERVAL '30 days', NOW()
      )
    `, [
      COMPANY_ID,
      customer.id,
      lastNIntents,                   // native array
      totalTasks > 0 ? `${totalTasks} tugas AI tercatat` : 'Belum ada riwayat tugas',
      openTasks,
      [],                             // missing_docs_list — native empty array
      frequentServices,               // native array
      riskTier,
      sentimentTrend,
      aiContextBlock,
      aiContextBlock.length,
      totalTasks,
      totalMessages,
      freshness,
    ]);

    await pool.query(`
      INSERT INTO customer_memory_events (
        company_id, customer_id, event_type, actor_id, actor_type,
        entity_type, payload, notes, created_at
      ) VALUES ($1, $2, 'snapshot_created', 'backfill-script', 'system',
        'customer_memory_snapshots', $3, 'Sprint 8D backfill', NOW())
    `, [
      COMPANY_ID,
      customer.id,
      JSON.stringify({ source_orders: totalOrders, source_messages: totalMessages, source_tasks: totalTasks }),
    ]);

    console.log(`  CREATED customer ${customer.id} (${customer.name}) — orders:${totalOrders} msgs:${totalMessages} tasks:${totalTasks} risk:${riskTier}`);
    created++;
  }

  console.log(`\n=== Done ===`);
  console.log(`Created: ${created} | Skipped: ${skipped} | Total: ${created + skipped}/${customers.length}`);
  console.log(`Coverage: ${Math.round((created + skipped) / customers.length * 100)}%`);
}

run().catch(console.error).finally(() => pool.end());
