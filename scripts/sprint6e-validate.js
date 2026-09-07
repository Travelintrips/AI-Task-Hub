/**
 * Sprint 6E — Phase 5: Executive Validation (E2E pipeline)
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: (process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL_DEV)
    .replace(/:6543\//g, ":5432/"),
  ssl: { rejectUnauthorized: false },
});

const steps = [
  ["① WA message received + AI-processed",
   "SELECT id, detected_intent, ai_confidence::numeric, sentiment FROM whatsapp_messages WHERE ai_processed = TRUE LIMIT 1"],
  ["② AI task created (source: whatsapp)",
   "SELECT id, status, priority, source FROM ai_tasks WHERE source = 'whatsapp' LIMIT 1"],
  ["③ Customer memory snapshot",
   "SELECT customer_id, risk_tier, freshness_score, is_stale FROM customer_memory_snapshots WHERE is_stale = FALSE LIMIT 1"],
  ["④ Customer risk assessment",
   "SELECT customer_id, tier, risk_score, is_active FROM customer_risk_assessments WHERE is_active = TRUE LIMIT 1"],
  ["⑤ Vendor memory snapshot",
   "SELECT vendor_id, risk_tier, performance_grade, readiness_score FROM vendor_memory_snapshots WHERE is_stale = FALSE LIMIT 1"],
  ["⑥ Vendor capability",
   "SELECT vendor_id, service_type, origin_cities, confidence_score FROM vendor_capabilities WHERE is_active = TRUE LIMIT 1"],
  ["⑦ CMM recommendation (accepted)",
   "SELECT top_vendor_name, top_composite_score::numeric, confidence, status FROM vendor_recommendations WHERE status = 'accepted' LIMIT 1"],
  ["⑧ Recommendation outcome (accepted rank-1)",
   "SELECT outcome, rank_accepted, actual_margin_pct::numeric, delivery_on_time FROM vendor_recommendation_outcomes WHERE outcome = 'accepted' LIMIT 1"],
  ["⑨ LPR approved + AI-evaluated",
   "SELECT request_number, status, ai_risk_tier, ai_duplicate_flag FROM logistic_purchase_requests WHERE status = 'approved' LIMIT 1"],
  ["⑩ Price benchmark (≥2 samples)",
   "SELECT service_category, origin, destination, median_price::numeric, sample_count, benchmark_confidence FROM purchasing_price_benchmarks WHERE sample_count >= 2 LIMIT 1"],
  ["⑪ intel_routes populated",
   "SELECT origin, destination, readiness_score, confidence_tier FROM intel_routes WHERE readiness_score > 0 LIMIT 1"],
  ["⑫ intel_vendors populated",
   "SELECT vendor_id, performance_grade, readiness_score, confidence_tier FROM intel_vendors WHERE readiness_score > 0 LIMIT 1"],
  ["⑬ intel_customers populated",
   "SELECT customer_id, tier, readiness_score, confidence_tier FROM intel_customers WHERE readiness_score > 0 LIMIT 1"],
  ["⑭ intel_profit populated",
   "SELECT dimension, avg_margin_pct::numeric, readiness_score FROM intel_profit WHERE readiness_score > 0 LIMIT 1"],
  ["⑮ intel_quotations populated",
   "SELECT service_category, win_rate::numeric, readiness_score FROM intel_quotations WHERE readiness_score > 0 LIMIT 1"],
  ["⑯ intel_readiness_scores ≥60 avg",
   "SELECT AVG(overall_readiness_score)::int AS avg_score, COUNT(*)::int AS datasets FROM intel_readiness_scores"],
  ["⑰ intel_refresh_log completed",
   "SELECT dataset_name, status, rows_written FROM intel_refresh_log WHERE status = 'completed' LIMIT 1"],
  ["⑱ Purchasing signal recorded",
   "SELECT signal_type, vendor_id, actual_amount::numeric, margin_pct::numeric FROM purchasing_signals LIMIT 1"],
];

console.log("\n══════════════════════════════════════════════════════");
console.log("  Phase 5 — Executive Validation (E2E Pipeline)");
console.log("══════════════════════════════════════════════════════\n");

let pass = 0, fail = 0;
for (const [label, sql] of steps) {
  try {
    const rows = await pool.query(sql).then(r => r.rows);
    const ok = rows.length > 0;
    if (ok) pass++; else fail++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
    if (ok && rows[0]) {
      const preview = JSON.stringify(rows[0]).substring(0, 110);
      console.log(`        ${preview}`);
    }
  } catch (err) {
    fail++;
    console.log(`  FAIL  ${label}`);
    console.log(`        ERR: ${err.message.substring(0, 80)}`);
  }
}

// Final readiness
const rs = await pool.query(
  "SELECT AVG(overall_readiness_score)::int AS avg, MIN(overall_readiness_score) AS min FROM intel_readiness_scores"
).then(r => r.rows[0]).catch(() => ({ avg: 0, min: 0 }));

const successCriteria = [
  ["Customer Memory rows > 0",  await pool.query("SELECT COUNT(*) FROM customer_memory_snapshots").then(r=>+r.rows[0].count > 0).catch(()=>false)],
  ["Vendor Memory rows > 0",    await pool.query("SELECT COUNT(*) FROM vendor_memory_snapshots").then(r=>+r.rows[0].count > 0).catch(()=>false)],
  ["CMM rows > 0",              await pool.query("SELECT COUNT(*) FROM vendor_recommendations").then(r=>+r.rows[0].count > 0).catch(()=>false)],
  ["Outcome rows > 0",          await pool.query("SELECT COUNT(*) FROM vendor_recommendation_outcomes").then(r=>+r.rows[0].count > 0).catch(()=>false)],
  ["Intel tables rows > 0",     await pool.query("SELECT COUNT(*) FROM intel_routes").then(r=>+r.rows[0].count > 0).catch(()=>false)],
  ["Purchasing signals > 0",    await pool.query("SELECT COUNT(*) FROM purchasing_signals").then(r=>+r.rows[0].count > 0).catch(()=>false)],
  [`Readiness score ≥ 60 (${rs.avg})`, rs.avg >= 60],
];

console.log("\n── Success Criteria ────────────────────────────────");
let criteriaPass = 0;
for (const [label, ok] of successCriteria) {
  if (ok) criteriaPass++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
}

console.log(`\n  Pipeline steps:    ${pass}/${steps.length} PASS`);
console.log(`  Success criteria:  ${criteriaPass}/${successCriteria.length} met`);
console.log(`  Avg readiness:     ${rs.avg}/100 (min: ${rs.min})`);

const verdict = criteriaPass === successCriteria.length
  ? "🟢 GO — Approved for Sprint 7A Fleet Intelligence"
  : criteriaPass >= 5
  ? "🟡 CONDITIONAL — Address failing criteria"
  : "🔴 NO-GO";

console.log(`\n  VERDICT: ${verdict}`);
console.log("══════════════════════════════════════════════════════\n");

await pool.end();
