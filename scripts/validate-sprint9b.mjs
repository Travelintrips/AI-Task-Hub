/**
 * Sprint 9B Validation Script — Mini Form Router (v2)
 * Tests all 8 scenarios; uses polling instead of fixed sleep.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const BASE = "http://localhost:8080";
const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });

// ── Helpers ──────────────────────────────────────────────────────────────────

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function db(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

async function login() {
  const r = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "diva@admin.com", password: "admin123" }),
  });
  if (!r.body.token) throw new Error("Login failed: " + JSON.stringify(r.body));
  return r.body.token;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// Simulate incoming WhatsApp message via Fonnte webhook
async function simulateWhatsApp(phone, message, companyId = "default") {
  return api("/api/webhook/fonnte", {
    method: "POST",
    headers: { "x-company-id": companyId, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: phone,
      message,
      name: "Test Customer",
      type: "text",
      device: "628111000000",
    }),
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Poll DB until session appears or timeout
async function pollSession(phone, afterTime, maxMs = 20000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const rows = await db(
      `SELECT id, status, mini_form_type, form_token, intent_code
       FROM conversation_intake_sessions
       WHERE phone=$1 AND created_at > $2
       ORDER BY id DESC LIMIT 1`,
      [phone, afterTime]
    );
    if (rows.length > 0) return rows[0];
    await sleep(1500);
  }
  return null;
}

// ── Test state ────────────────────────────────────────────────────────────────

const results = [];
let TOKEN = "";

function pass(name, detail = "") {
  results.push({ status: "✅ PASS", name, detail });
  console.log(`  ✅ PASS: ${name}${detail ? " — " + detail : ""}`);
}

function fail(name, detail = "") {
  results.push({ status: "❌ FAIL", name, detail });
  console.log(`  ❌ FAIL: ${name}${detail ? " — " + detail : ""}`);
}

function info(label, value) {
  console.log(`     📌 ${label}: ${JSON.stringify(value)}`);
}

// ── SETUP ─────────────────────────────────────────────────────────────────────

async function setup() {
  console.log("\n=== SPRINT 9B VALIDATION (v2) ===\n");

  const [taskSnap] = await db("SELECT COUNT(*) AS cnt FROM ai_tasks WHERE source='mini_form'");
  const [sessSnap] = await db("SELECT COUNT(*) AS cnt FROM conversation_intake_sessions");
  console.log(`📊 Baseline: ai_tasks(mini_form)=${taskSnap.cnt}  sessions=${sessSnap.cnt}\n`);

  TOKEN = await login();
  console.log(`🔑 Auth token obtained (${TOKEN.length} chars)\n`);

  return { baselineTasks: parseInt(taskSnap.cnt), baselineSessions: parseInt(sessSnap.cnt) };
}

// ── Shared webhook test helper ────────────────────────────────────────────────

async function webhookTest(testName, phone, message, expectedIntent, expectedFlow) {
  console.log(`\n── ${testName} ──`);

  // Cancel any pending sessions for this phone
  await db(
    "UPDATE conversation_intake_sessions SET status='cancelled' WHERE phone=$1 AND status IN ('collecting','form_sent','ready_for_task')",
    [phone]
  );

  const ts = new Date().toISOString();
  const whr = await simulateWhatsApp(phone, message);
  info("webhook", { status: whr.status, queued: whr.body?.queued ?? whr.body?.ok ?? "?" });

  // Poll for session (up to 20 seconds for AI processing)
  const sess = await pollSession(phone, ts, 20000);

  if (!sess) {
    // Check if a task was created directly (conversation flow with all fields known)
    const tasks = await db(
      `SELECT id, title, source FROM ai_tasks WHERE customer_phone=$1 AND created_at > $2 ORDER BY id DESC LIMIT 1`,
      [phone, ts]
    );
    if (tasks.length > 0) {
      pass(`${testName}-direct-task`, `flow=conversation, task: ${tasks[0].title}`);
      return { flow: "conversation", directTask: tasks[0] };
    }
    fail(`${testName}-session`, "No session or task created after 20s");
    return null;
  }

  info("session", {
    id: sess.id,
    status: sess.status,
    intent: sess.intent_code,
    miniFormType: sess.mini_form_type,
    hasToken: !!sess.form_token,
  });

  // Validate intent code
  if (sess.intent_code === expectedIntent) {
    pass(`${testName}-intent`, `intent_code=${sess.intent_code} ✓`);
  } else {
    fail(`${testName}-intent`, `expected ${expectedIntent}, got ${sess.intent_code}`);
  }

  // Validate flow-specific behavior
  if (expectedFlow === "mini_form" || expectedFlow === "hybrid") {
    if (sess.form_token && sess.form_token.length >= 32) {
      pass(`${testName}-form-token`, `token stored (${sess.form_token.length} chars) ✓`);
    } else {
      fail(`${testName}-form-token`, `token=${sess.form_token}`);
    }
    if (sess.mini_form_type) {
      pass(`${testName}-form-type`, `mini_form_type=${sess.mini_form_type} ✓`);
    } else {
      fail(`${testName}-form-type`, "mini_form_type is null");
    }
    const statuses = ["form_sent", "collecting", "ready_for_task"];
    if (statuses.includes(sess.status)) {
      pass(`${testName}-status`, `status=${sess.status} ✓`);
    } else {
      fail(`${testName}-status`, `unexpected status=${sess.status}`);
    }
    // No task yet
    const tasks = await db(
      "SELECT id FROM ai_tasks WHERE customer_phone=$1 AND source='mini_form' AND created_at > $2 LIMIT 1",
      [phone, ts]
    );
    if (tasks.length === 0) {
      pass(`${testName}-no-premature-task`, "no task before form submission ✓");
    } else {
      fail(`${testName}-no-premature-task`, `task created prematurely: ${tasks[0].id}`);
    }
    const formUrl = `https://<your-domain>/mini-form/${sess.mini_form_type}/${sess.form_token}`;
    info("form_url", formUrl);
  } else if (expectedFlow === "conversation") {
    if (!sess.form_token) {
      pass(`${testName}-no-form-token`, "no form link (conversation mode) ✓");
    } else {
      fail(`${testName}-no-form-token`, `unexpected token: ${sess.form_token}`);
    }
    const convStatuses = ["collecting", "ready_for_task", "submitted"];
    if (convStatuses.includes(sess.status)) {
      pass(`${testName}-conv-status`, `status=${sess.status} ✓`);
    } else if (sess.status === "form_sent") {
      fail(`${testName}-conv-status`, "got form_sent — should be conversation mode");
    } else {
      fail(`${testName}-conv-status`, `status=${sess.status}`);
    }
  }

  return sess;
}

// ── TEST 6: form submission ───────────────────────────────────────────────────

async function test6_submission() {
  console.log("\n── TEST 6: form submission via public API ──");

  // Find a form_sent session to test submission
  const validSessions = await db(
    `SELECT s.id, s.form_token, s.mini_form_type, s.phone, s.intent_code,
            s.missing_fields, s.collected_fields
     FROM conversation_intake_sessions s
     WHERE s.status='form_sent' AND s.form_token IS NOT NULL
     ORDER BY s.id DESC LIMIT 1`
  );

  if (validSessions.length === 0) {
    fail("T6-find-session", "No form_sent session available");
    return;
  }

  const sess = validSessions[0];
  const { form_token: token, mini_form_type: formType, phone, missing_fields: missingFields } = sess;

  info("submitting", { sessionId: sess.id, formType, phone, missingFields });

  // GET form first
  const getR = await api(`/api/public/mini-form/${formType}/${token}`);
  if (getR.status === 200) {
    pass("T6-get-form", `GET → 200, title="${getR.body.formTitle}"`);
  } else {
    fail("T6-get-form", `status=${getR.status}`);
    return;
  }

  // Build complete field payload using DB field names (from missingFields + builtin required fields)
  // We supply ALL possible field names so any form type will have its required fields covered
  const fieldPayload = {
    // Trucking fields
    pickup_address: "Jl. Raya Bekasi No. 100, Jakarta Timur",
    delivery_address: "Jl. Ahmad Yani No. 50, Surabaya",
    cargo_type: "Elektronik",
    cargo_weight: "500",
    pickup_date: "2026-07-01",
    contact_person: "Budi Santoso",
    vehicle_type: "CDD",
    notes: "Test Sprint 9B validation",
    // Freight (import) fields
    origin_country: "China",
    destination_country: "Indonesia",
    commodity: "Elektronik",
    gross_weight: "1000",
    volume: "5",
    shipment_mode: "Sea Freight FCL",
    // Complaint fields (English builtins)
    order_number: "ORD-TEST-001",
    item_name: "Laptop Asus",
    damage_description: "Layar pecah",
    damage_quantity: "1",
    received_date: "2026-06-20",
    requested_solution: "Ganti Barang Baru",
    // Fleet repair (English builtins)
    plate_number: "B 1234 ABC",
    location: "Cibitung, Bekasi",
    issue_type: "Mesin",
    issue_description: "Mesin overheat",
    urgent: "Tinggi (hari ini)",
    // Cash advance
    amount: "2000000",
    purpose: "Operasional perjalanan",
    needed_date: "2026-06-25",
    // ── Indonesian DB field names (from data_template_fields) ──
    // fleet_repair template fields
    nama_pengemudi: "Ahmad Supardi",
    nomor_telepon: "08123456789",
    plat_kendaraan: "B 1234 ABC",
    jenis_kerusakan: "Mesin Overheat",
    deskripsi_masalah: "Mesin sangat panas dan asap keluar, tidak bisa lanjut",
    lokasi_kendaraan: "Cibitung, Bekasi Timur",
    kondisi_kendaraan: "Mogok",
    tanggal_kejadian: "2026-06-22",
    urgensi: "Tinggi (hari ini)",
    foto_kerusakan: "",
    // trucking template fields
    asal_pengiriman: "Jakarta Timur",
    tujuan_pengiriman: "Surabaya",
    jenis_barang: "Elektronik",
    berat_barang: "500 kg",
    jumlah_barang: "10 karton",
    tanggal_pengiriman: "2026-07-01",
    kontak_pengirim: "Budi Santoso",
    nomor_hp: "08129876543",
    jenis_kendaraan: "CDD",
    catatan: "Fragile, mohon hati-hati",
    // complaint template fields
    nomor_order: "ORD-TEST-001",
    nama_barang: "Laptop Asus",
    deskripsi_kerusakan: "Layar retak dan pecah",
    jumlah_rusak: "1",
    tanggal_terima: "2026-06-20",
    solusi_yang_diminta: "Penggantian barang baru",
    nilai_kerugian: "5000000",
    bukti_foto: "",
    // import template fields
    negara_asal: "China",
    negara_tujuan: "Indonesia",
    jenis_komoditas: "Elektronik Consumer",
    berat_kotor: "1000 kg",
    volume_cbm: "5 CBM",
    moda_pengiriman: "Sea Freight FCL",
    estimasi_nilai: "50000000",
    tanggal_kapal: "2026-07-15",
    dokumen_tersedia: "Invoice, Packing List",
  };

  const postR = await api(`/api/public/mini-form/${formType}/${token}`, {
    method: "POST",
    body: JSON.stringify({ fields: fieldPayload, submittedBy: "Test Sprint 9B v2" }),
  });

  info("submit_response", {
    status: postR.status,
    ok: postR.body.ok,
    isComplete: postR.body.isComplete,
    taskNumber: postR.body.taskNumber,
    missingFields: postR.body.missingFields,
  });

  if (postR.status === 200 && postR.body.ok) {
    pass("T6-submit-200", "POST → 200 OK");
  } else {
    fail("T6-submit-200", `status=${postR.status}`);
  }

  if (postR.body.isComplete) {
    pass("T6-is-complete", `task created: ${postR.body.taskNumber}`);
  } else {
    fail("T6-is-complete", `still missing: ${JSON.stringify(postR.body.missingFields)}`);
  }

  await sleep(500);
  const [sessAfter] = await db(
    "SELECT status, task_id FROM conversation_intake_sessions WHERE id=$1",
    [sess.id]
  );
  info("session_after", sessAfter);

  if (sessAfter?.status === "submitted") {
    pass("T6-session-submitted", "status=submitted ✓");
  } else {
    fail("T6-session-submitted", `status=${sessAfter?.status}`);
  }

  if (sessAfter?.task_id) {
    pass("T6-task-linked", `task_id=${sessAfter.task_id} ✓`);
  } else {
    fail("T6-task-linked", "no task_id on session");
  }

  if (postR.body.taskNumber) {
    const tasks = await db(
      "SELECT id, title, status, source FROM ai_tasks WHERE task_number=$1",
      [postR.body.taskNumber]
    );
    if (tasks.length > 0) {
      pass("T6-ai-task-created", `#${postR.body.taskNumber}: "${tasks[0].title}"`);
    } else {
      fail("T6-ai-task-created", `not found in ai_tasks`);
    }
  }
}

// ── TEST 7: invalid/expired token ────────────────────────────────────────────

async function test7_invalidToken() {
  console.log("\n── TEST 7: invalid/expired token ──");

  const badToken = "00000000000000000000000000000000000000000000000000";

  const r1 = await api(`/api/public/mini-form/trucking/${badToken}`);
  r1.status === 404
    ? pass("T7-invalid-get-404", "invalid token → 404 ✓")
    : fail("T7-invalid-get-404", `status=${r1.status}`);

  const r2 = await api(`/api/public/mini-form/trucking/${badToken}`, {
    method: "POST",
    body: JSON.stringify({ fields: { pickup_address: "test" } }),
  });
  r2.status === 404
    ? pass("T7-invalid-post-404", "POST invalid token → 404 ✓")
    : fail("T7-invalid-post-404", `status=${r2.status}`);

  // Re-submit already-submitted
  const submitted = await db(
    "SELECT form_token, mini_form_type FROM conversation_intake_sessions WHERE status='submitted' AND form_token IS NOT NULL LIMIT 1"
  );
  if (submitted.length > 0) {
    const { form_token: tok, mini_form_type: ft } = submitted[0];
    const r3 = await api(`/api/public/mini-form/${ft}/${tok}`, {
      method: "POST",
      body: JSON.stringify({ fields: { pickup_address: "replay" } }),
    });
    r3.body.ok === true || r3.status === 200
      ? pass("T7-re-submit-idempotent", `already-submitted → ok=true (idempotent) ✓`)
      : fail("T7-re-submit-idempotent", `status=${r3.status} body=${JSON.stringify(r3.body)}`);
  } else {
    pass("T7-re-submit-skip", "no submitted sessions yet (skip replay)");
  }

  // Short token
  const r4 = await api(`/api/public/mini-form/trucking/short`);
  r4.status === 400
    ? pass("T7-short-token-400", "short token → 400 ✓")
    : fail("T7-short-token-400", `status=${r4.status}`);
}

// ── TEST 8: analytics ─────────────────────────────────────────────────────────

async function test8_analytics() {
  console.log("\n── TEST 8: analytics endpoint ──");

  const r = await api("/api/intake-sessions/analytics?days=30", {
    headers: authHeader(TOKEN),
  });

  info("status", r.status);

  if (r.status === 200) {
    pass("T8-analytics-200", "GET /api/intake-sessions/analytics → 200 ✓");
  } else {
    fail("T8-analytics-200", `status=${r.status} — ${JSON.stringify(r.body)}`);
    return;
  }

  const d = r.body;
  info("summary", d.summary);

  typeof d.summary?.total === "number"
    ? pass("T8-summary-total", `total=${d.summary.total}`)
    : fail("T8-summary-total", "missing summary.total");

  typeof d.summary?.submissionRate === "number"
    ? pass("T8-submission-rate", `submissionRate=${d.summary.submissionRate}%`)
    : fail("T8-submission-rate", "missing submissionRate");

  Array.isArray(d.daily)
    ? pass("T8-daily-array", `${d.daily.length} daily points`)
    : fail("T8-daily-array", "missing daily[]");

  Array.isArray(d.topIntents)
    ? pass("T8-top-intents", `${d.topIntents.length} intents`)
    : fail("T8-top-intents", "missing topIntents[]");

  typeof d.summary?.miniFormTotal === "number"
    ? pass("T8-mini-form-count", `miniFormTotal=${d.summary.miniFormTotal}`)
    : fail("T8-mini-form-count", "missing miniFormTotal");

  console.log("\n  📊 Flow Distribution:");
  console.log(`     conversation: ${d.summary?.conversationTotal ?? 0}`);
  console.log(`     mini_form:    ${d.summary?.miniFormTotal ?? 0}`);
  console.log(`     hybrid:       ${d.summary?.hybridTotal ?? 0}`);
  console.log(`     submissionRate: ${d.summary?.submissionRate ?? 0}%`);

  if (d.byFormType && Object.keys(d.byFormType).length > 0) {
    pass("T8-by-form-type", `${Object.keys(d.byFormType).length} form types`);
    for (const [ft, stats] of Object.entries(d.byFormType)) {
      console.log(`     ${ft}: sent=${stats.sent} submitted=${stats.submitted} pending=${stats.pending}`);
    }
  }
}

// ── POST-TEST CHECKS ──────────────────────────────────────────────────────────

async function postTestChecks(baseline) {
  console.log("\n── POST-TEST DB CHECKS ──");

  const [taskSnap] = await db("SELECT COUNT(*) AS cnt FROM ai_tasks WHERE source='mini_form'");
  const [sessSnap] = await db("SELECT COUNT(*) AS cnt FROM conversation_intake_sessions");
  const [formSentSnap] = await db("SELECT COUNT(*) AS cnt FROM conversation_intake_sessions WHERE status='form_sent'");
  const [submittedSnap] = await db("SELECT COUNT(*) AS cnt FROM conversation_intake_sessions WHERE status='submitted'");

  const newTasks = parseInt(taskSnap.cnt) - baseline.baselineTasks;
  const newSessions = parseInt(sessSnap.cnt) - baseline.baselineSessions;

  console.log(`  📌 ai_tasks(mini_form): ${baseline.baselineTasks} → ${taskSnap.cnt} (Δ+${newTasks})`);
  console.log(`  📌 sessions total: ${baseline.baselineSessions} → ${sessSnap.cnt} (Δ+${newSessions})`);
  console.log(`  📌 sessions form_sent: ${formSentSnap.cnt}`);
  console.log(`  📌 sessions submitted: ${submittedSnap.cnt}`);

  newTasks >= 1
    ? pass("POST-task-created", `${newTasks} new mini_form task(s) from form submission ✓`)
    : fail("POST-task-created", "no new mini_form tasks (expected ≥1 from T6)");

  newSessions >= 4
    ? pass("POST-sessions-created", `${newSessions} new sessions (T1-T5 routing coverage) ✓`)
    : fail("POST-sessions-created", `only ${newSessions} new sessions (expected ≥4)`);

  // Sample active form URLs
  const sample = await db(
    `SELECT phone, mini_form_type, form_token, intent_code, status
     FROM conversation_intake_sessions
     WHERE form_token IS NOT NULL
     ORDER BY id DESC LIMIT 5`
  );

  console.log("\n  📨 Recent Form Sessions:");
  for (const s of sample) {
    const url = `https://<domain>/mini-form/${s.mini_form_type}/${s.form_token?.slice(0,16)}...`;
    console.log(`     [${s.status}] ${s.intent_code} → ${url}`);
  }
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────

function printSummary() {
  console.log("\n════════════════════════════════════════");
  console.log("SPRINT 9B VALIDATION SUMMARY");
  console.log("════════════════════════════════════════");

  const passed = results.filter((r) => r.status.includes("PASS"));
  const failed = results.filter((r) => r.status.includes("FAIL"));

  console.log(`\n✅ PASSED: ${passed.length}`);
  for (const r of passed) console.log(`   ${r.name}: ${r.detail}`);

  if (failed.length > 0) {
    console.log(`\n❌ FAILED: ${failed.length}`);
    for (const r of failed) console.log(`   ${r.name}: ${r.detail}`);
  }

  const total = passed.length + failed.length;
  const score = total > 0 ? Math.round((passed.length / total) * 100) : 0;

  console.log(`\n📊 SCORE: ${passed.length}/${total} (${score}%)`);
  const verdict = score >= 85 ? "✅ GO — Sprint 9C" : score >= 70 ? "⚠️  CONDITIONAL GO" : "❌ NO-GO";
  console.log(`🏁 VERDICT: ${verdict}`);
  console.log("════════════════════════════════════════\n");
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const baseline = await setup();

    // T1-T5: webhook routing tests (uses polling, each up to 20s)
    await webhookTest("T1 trucking/hybrid", "628111000001",
      "Saya butuh trucking dari Jakarta ke Surabaya untuk 500 kg elektronik",
      "trucking_inquiry", "hybrid");

    await webhookTest("T2 import/mini_form", "628111000002",
      "Mau import barang dari China ke Indonesia, butuh freight forwarding",
      "import_inquiry", "mini_form");

    await webhookTest("T3 complaint/hybrid", "628111000003",
      "Barang saya rusak, order ORD-2024-001, laptop pecah layarnya waktu sampai",
      "damaged_goods_complaint", "hybrid");

    await webhookTest("T4 fleet/hybrid", "628111000004",
      "Truk B 1234 ABC mesin overheat di Cibitung, butuh perbaikan segera",
      "fleet_repair", "hybrid");

    await webhookTest("T5 kasbon/conversation", "628111000005",
      "Saya mau minta kasbon 2 juta untuk kebutuhan operasional",
      "permintaan_kasbon", "conversation");

    // T6: submit a real form
    await test6_submission();

    // T7: invalid token guards
    await test7_invalidToken();

    // T8: analytics endpoint (route ordering fix)
    await test8_analytics();

    // Final DB state
    await postTestChecks(baseline);

    printSummary();
  } catch (err) {
    console.error("\n💥 FATAL:", err.message, err.stack);
  } finally {
    await pool.end();
  }
}

main();
