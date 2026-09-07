#!/usr/bin/env tsx
/**
 * Sprint 9A Validation — Conversation Intake Engine
 * Self-contained: inlines calculateCompleteness + getCompletionThreshold
 * Uses pg pool with SUPABASE_DATABASE_URL (where the table actually lives).
 *
 * Run: cd scripts && node_modules/.bin/tsx validate-sprint-9a.ts
 */

import { Pool } from "pg";

// ─── Inline: intake-completeness (Sprint 9A Phase 4) ─────────────────────────
interface CompletenessResult {
  completionPct: number; totalRequired: number; totalCollected: number;
  missingFieldNames: string[]; isReady: boolean; threshold: number;
}
const INTENT_THRESHOLDS: Record<string, number> = {
  complaint:60, keluhan:60, cash_advance:100, kasbon:100,
  fleet_repair:80, fleet_maintenance:80, import:90, customs_import:90,
  export:85, trucking:80, freight:80, warehouse:75, general_inquiry:60,
};
function getThreshold(intent: string): number {
  const k = intent.toLowerCase().replace(/[-\s]/g,"_");
  if (INTENT_THRESHOLDS[k] !== undefined) return INTENT_THRESHOLDS[k]!;
  for (const [key,val] of Object.entries(INTENT_THRESHOLDS)) if (k.includes(key)) return val;
  return 80;
}
function calcComp(required: string[], collected: Record<string,unknown>, intent: string): CompletenessResult {
  const threshold = getThreshold(intent);
  if (!required.length) return { completionPct:100, totalRequired:0, totalCollected:0, missingFieldNames:[], isReady:true, threshold };
  const missing = required.filter(f => { const v = collected[f]; return v===null||v===undefined||v===""; });
  const pct = Math.round(((required.length - missing.length) / required.length) * 100);
  return { completionPct:pct, totalRequired:required.length, totalCollected:required.length-missing.length,
           missingFieldNames:missing, isReady:pct>=threshold, threshold };
}

// ─── Cancellation patterns (mirrors intake-engine.ts) ────────────────────────
const CANCEL_RE = /\b(batal|cancel|tidak jadi|ga jadi|stop|batalkan|hapus|ngga jadi|engga jadi)\b/i;

// ─── Colours ──────────────────────────────────────────────────────────────────
const G="\x1b[32m",R="\x1b[31m",Y="\x1b[33m",C="\x1b[36m",B="\x1b[1m",X="\x1b[0m";
const PASS=`${G}✅ PASS${X}`, FAIL=`${R}❌ FAIL${X}`, INFO=`${C}ℹ️  ${X}`;

// ─── JSONB helper — pg returns JSONB already parsed as JS objects ─────────────
function jArr(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") try { return JSON.parse(val); } catch { return []; }
  if (val && typeof val === "object") return Object.values(val as object);
  return [];
}
function jObj(val: unknown): Record<string, unknown> {
  if (val && typeof val === "object" && !Array.isArray(val)) return val as Record<string, unknown>;
  if (typeof val === "string") try { return JSON.parse(val); } catch { return {}; }
  return {};
}

// ─── DB pool ──────────────────────────────────────────────────────────────────
const connStr = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const pool = new Pool({
  connectionString: connStr,
  ssl: connStr.includes("supabase.co") ? { rejectUnauthorized:false } : false,
});
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql,p)).rows;

// ─── Test counters ────────────────────────────────────────────────────────────
let total=0, passed=0, failed=0;
const failures: string[] = [];
function assert(label: string, ok: boolean, detail="") {
  total++;
  if (ok) { passed++; console.log(`  ${PASS}  ${label}`); }
  else     { failed++; failures.push(label+(detail?`: ${detail}`:"")); console.log(`  ${FAIL}  ${label}${detail?`  ${Y}(${detail})${X}`:""}`); }
}

// ─── Test phones ──────────────────────────────────────────────────────────────
const CID="default";
const PH_KASBON="+62TEST_KASBON", PH_TRUCK="+62TEST_TRUCK", PH_COMP="+62TEST_COMP";
const PH_RESUME="+62TEST_RESUME", PH_CANCEL="+62TEST_CANCEL";
const ALL_PH=[PH_KASBON,PH_TRUCK,PH_COMP,PH_RESUME,PH_CANCEL];

// ─── DB helpers ───────────────────────────────────────────────────────────────
const taskCount = async (phone: string) =>
  Number((await q(`SELECT COUNT(*) FROM ai_tasks WHERE customer_phone=$1 AND company_id=$2`,[phone,CID]))[0]?.count??0);

const getSession = async (phone: string) =>
  (await q(`SELECT * FROM conversation_intake_sessions WHERE phone=$1 AND company_id=$2 ORDER BY updated_at DESC LIMIT 1`,[phone,CID]))[0]??null;

const getActiveSessions = (phone: string) =>
  q(`SELECT * FROM conversation_intake_sessions WHERE phone=$1 AND company_id=$2
     AND status IN ('collecting','ready_for_task') AND (expires_at IS NULL OR expires_at>NOW())
     ORDER BY updated_at DESC LIMIT 1`,[phone,CID]);

async function cleanup() {
  for (const ph of ALL_PH) {
    await q(`DELETE FROM conversation_intake_sessions WHERE phone=$1 AND company_id=$2`,[ph,CID]);
    await q(`DELETE FROM ai_tasks WHERE customer_phone=$1 AND company_id=$2`,[ph,CID]);
  }
}

async function insertSession(phone: string, intent: string, required: string[], collected: Record<string,unknown>={}) {
  const c = calcComp(required, collected, intent);
  const rows = await q(`
    INSERT INTO conversation_intake_sessions
      (phone,company_id,intent_code,intent_name,status,
       required_fields,collected_fields,missing_fields,
       required_documents,uploaded_documents,
       completion_pct,needs_admin_review,last_message_at,expires_at)
    VALUES ($1,$2,$3,$4,'collecting',$5,$6,$7,'[]','[]',$8,false,NOW(),NOW()+INTERVAL '24h')
    RETURNING *`,
    [phone,CID,intent,intent,
     JSON.stringify(required),JSON.stringify(collected),
     JSON.stringify(c.missingFieldNames),c.completionPct]);
  return rows[0];
}

async function applyCollected(sessionId: number, intent: string, required: string[], collected: Record<string,unknown>) {
  const c = calcComp(required, collected, intent);
  const newStatus = c.isReady ? "ready_for_task" : "collecting";
  const rows = await q(`
    UPDATE conversation_intake_sessions
    SET collected_fields=$1, missing_fields=$2, completion_pct=$3, status=$4,
        last_message_at=NOW(), updated_at=NOW()
    WHERE id=$5 RETURNING *`,
    [JSON.stringify(collected),JSON.stringify(c.missingFieldNames),c.completionPct,newStatus,sessionId]);
  return { row: rows[0], c };
}

async function createTestTask(phone: string, sessionId: number, intent: string) {
  const tn = `TEST9A-${Date.now()}`;
  const rows = await q(`
    INSERT INTO ai_tasks (task_number,company_id,customer_phone,title,status,priority,created_at)
    VALUES ($1,$2,$3,$4,'open','medium',NOW()) RETURNING task_number`,[tn,CID,phone,`[TEST] ${intent}`]);
  await q(`UPDATE conversation_intake_sessions SET status='submitted',task_id=$1,updated_at=NOW() WHERE id=$2`,
    [rows[0].task_number,sessionId]);
  return rows[0].task_number as string;
}

// ═════════════════════════════════════════════════════════════════════════════
async function run() {
  console.log(`\n${B}${C}━━━ Sprint 9A Validation: Conversation Intake Engine ━━━${X}\n`);
  await cleanup();
  console.log(`${INFO}DB cleaned (${ALL_PH.length} test phones)\n`);

  // ── [UNIT] calculateCompleteness & per-intent thresholds ─────────────────
  console.log(`${B}[UNIT] calculateCompleteness & per-intent thresholds${X}`);
  {
    // cash_advance = 100%
    let r = calcComp(["amount","purpose","payout_method","payout_date"],{},"cash_advance");
    assert("cash_advance threshold = 100%",    r.threshold===100,       `got ${r.threshold}`);
    assert("cash_advance 0/4 (0%) → NOT ready",!r.isReady);
    assert("cash_advance 0% = 0",              r.completionPct===0);

    r = calcComp(["amount","purpose","payout_method","payout_date"],{amount:"500000",purpose:"bensin"},"cash_advance");
    assert("cash_advance 2/4 (50%) → NOT ready",!r.isReady,            `pct=${r.completionPct}`);
    assert("cash_advance 2/4: 2 fields missing", r.missingFieldNames.length===2);

    r = calcComp(["amount","purpose","payout_method","payout_date"],
      {amount:"500000",purpose:"bensin",payout_method:"transfer_bca",payout_date:"hari_ini"},"cash_advance");
    assert("cash_advance 4/4 (100%) → IS ready", r.isReady,            `pct=${r.completionPct}`);
    assert("cash_advance 4/4: no missing fields", r.missingFieldNames.length===0);

    // complaint = 60%
    r = calcComp(["order_id","damage_detail","damage_photo"],{order_id:"ORD-123"},"complaint");
    assert("complaint threshold = 60%",          r.threshold===60);
    assert("complaint 1/3 (33%) → NOT ready",   !r.isReady,            `pct=${r.completionPct}`);

    r = calcComp(["order_id","damage_detail","damage_photo"],
      {order_id:"ORD-123",damage_detail:"barang pecah"},"complaint");
    assert("complaint 2/3 (66%) → IS ready (≥60%)", r.isReady,         `pct=${r.completionPct}`);

    // trucking = 80%
    r = calcComp(["origin","destination","cargo_type","weight_ton","container_size"],
      {origin:"Jakarta",destination:"Surabaya"},"trucking");
    assert("trucking threshold = 80%",            r.threshold===80);
    assert("trucking 2/5 (40%) → NOT ready",     !r.isReady,           `pct=${r.completionPct}`);

    r = calcComp(["origin","destination","cargo_type","weight_ton"],
      {origin:"Jakarta",destination:"Surabaya",cargo_type:"elektronik",weight_ton:"5"},"trucking");
    assert("trucking 4/4 (100%) → IS ready",      r.isReady);

    // edge cases
    assert("no required fields → immediate ready", calcComp([],{},"cash_advance").isReady);
    assert("33% trucking (2/6) → NOT ready (80% threshold)",
      !calcComp(["a","b","c","d","e","f"],{a:"x",b:"y"},"trucking").isReady);
  }

  // ── [T1] "Saya mau kasbon" → session created, NO task ────────────────────
  console.log(`\n${B}[T1] "Saya mau kasbon" → session created, NO task${X}`);
  {
    const tBefore = await taskCount(PH_KASBON);
    const REQUIRED = ["amount","purpose","payout_method","payout_date"];
    await insertSession(PH_KASBON, "cash_advance", REQUIRED, {});
    const s = await getSession(PH_KASBON);
    const tAfter = await taskCount(PH_KASBON);

    assert("T1: session row exists",           !!s,                                 "no session row");
    assert("T1: status = collecting",          s?.status==="collecting",            s?.status);
    assert("T1: task NOT created",             tAfter===tBefore,                    `tasks=${tAfter}`);
    assert("T1: completion_pct = 0",           Number(s?.completion_pct)===0,       String(s?.completion_pct));
    assert("T1: 4 missing fields stored",      jArr(s?.missing_fields).length===4);
    assert("T1: required_fields stored (4)",   jArr(s?.required_fields).length===4);
    assert("T1: intent_code = cash_advance",   s?.intent_code==="cash_advance",     s?.intent_code);
    assert("T1: task_id is null",              !s?.task_id);
    assert("T1: expires_at set (24h future)",  new Date(s?.expires_at)>new Date());

    console.log(`  ${INFO}Session #${s?.id} | pct=${s?.completion_pct}% | status=${s?.status} | missing=${jArr(s?.missing_fields).join(",")}`);
  }

  // ── [T2] "Kasbon 500 ribu untuk bensin" → 2/4 fields, NO task ────────────
  console.log(`\n${B}[T2] "Kasbon 500 ribu untuk bensin" → 2/4 fields, NO task${X}`);
  {
    const s0 = await getSession(PH_KASBON);
    const REQUIRED = ["amount","purpose","payout_method","payout_date"];
    const collected = { amount:"500000", purpose:"bensin" };
    const { c, row: s } = await applyCollected(s0!.id, "cash_advance", REQUIRED, collected);
    const tasks = await taskCount(PH_KASBON);

    assert("T2: task NOT created (50% < 100%)", tasks===0,              `tasks=${tasks}`);
    assert("T2: status still collecting",       s?.status==="collecting",s?.status);
    assert("T2: completion_pct = 50%",          c.completionPct===50,   `pct=${c.completionPct}`);
    assert("T2: isReady = false",               !c.isReady);
    assert("T2: 2 missing (payout_method+date)",c.missingFieldNames.length===2);
    assert("T2: payout_method in missing",      c.missingFieldNames.includes("payout_method"));
    assert("T2: payout_date in missing",        c.missingFieldNames.includes("payout_date"));
    assert("T2: amount persisted in DB",        jObj(s?.collected_fields).amount==="500000");
    assert("T2: purpose persisted in DB",       jObj(s?.collected_fields).purpose==="bensin");

    console.log(`  ${INFO}pct=${c.completionPct}% | missing=${JSON.stringify(c.missingFieldNames)}`);
  }

  // ── [T3] "Hari ini transfer BCA" → 100% → task created ───────────────────
  console.log(`\n${B}[T3] "Hari ini transfer BCA" → 100% → task created → session submitted${X}`);
  {
    const s0 = await getSession(PH_KASBON);
    const REQUIRED = ["amount","purpose","payout_method","payout_date"];
    const collected = { amount:"500000", purpose:"bensin", payout_method:"transfer_bca", payout_date:"hari_ini" };
    const { c, row: s } = await applyCollected(s0!.id, "cash_advance", REQUIRED, collected);

    assert("T3: completion_pct = 100%",        c.completionPct===100,              `pct=${c.completionPct}`);
    assert("T3: isReady = true",               c.isReady);
    assert("T3: status = ready_for_task",      s?.status==="ready_for_task",       s?.status);
    assert("T3: missing_fields = empty",       c.missingFieldNames.length===0);
    assert("T3: all 4 fields in DB",           Object.keys(jObj(s?.collected_fields)).length===4);

    // Simulate: webhook sees ready_for_task → creates task → markIntakeSubmitted
    const tn = await createTestTask(PH_KASBON, s0!.id, "cash_advance");
    const tasks = await taskCount(PH_KASBON);
    const sFinal = await getSession(PH_KASBON);

    assert("T3: EXACTLY 1 task created",       tasks===1,                          `tasks=${tasks}`);
    assert("T3: session status = submitted",   sFinal?.status==="submitted",       sFinal?.status);
    assert("T3: session.task_id populated",    !!sFinal?.task_id,                  "task_id null");
    assert("T3: task number starts TEST9A",    sFinal?.task_id?.startsWith("TEST9A") ?? false);

    console.log(`  ${INFO}Task: ${tn} | session status: ${sFinal?.status} | task_id: ${sFinal?.task_id}`);
  }

  // ── [T4] "Saya mau trucking Jakarta Surabaya" ────────────────────────────
  console.log(`\n${B}[T4] "Saya mau trucking Jakarta Surabaya" → session, missing fields, NO task${X}`);
  {
    const tBefore = await taskCount(PH_TRUCK);
    const REQUIRED = ["origin","destination","cargo_type","weight_ton","container_size"];
    const collected = { origin:"Jakarta", destination:"Surabaya" };
    await insertSession(PH_TRUCK, "trucking", REQUIRED, collected);
    const s = await getSession(PH_TRUCK);
    const tAfter = await taskCount(PH_TRUCK);
    const c = calcComp(REQUIRED, collected, "trucking");

    assert("T4: session created",              !!s);
    assert("T4: status = collecting",          s?.status==="collecting",           s?.status);
    assert("T4: task NOT created",             tAfter===tBefore,                   `tasks=${tAfter}`);
    assert("T4: threshold = 80%",              c.threshold===80);
    assert("T4: 40% NOT ready",               !c.isReady,                          `pct=${c.completionPct}`);
    assert("T4: 3 fields still missing",       c.missingFieldNames.length===3,     JSON.stringify(c.missingFieldNames));
    assert("T4: origin collected",             jObj(s?.collected_fields).origin==="Jakarta");
    assert("T4: destination collected",        jObj(s?.collected_fields).destination==="Surabaya");
    assert("T4: missing_fields stored in DB",  jArr(s?.missing_fields).length===3);

    console.log(`  ${INFO}trucking: ${c.completionPct}% | missing: ${JSON.stringify(c.missingFieldNames)}`);
  }

  // ── [T5] "Barang saya pecah" → complaint, 60% threshold ─────────────────
  console.log(`\n${B}[T5] "Barang saya pecah" → complaint, 60% threshold, 2/3 fields ≥ ready${X}`);
  {
    const tBefore = await taskCount(PH_COMP);
    const REQUIRED = ["order_id","damage_detail","damage_photo"];
    const collected = { order_id:"ORD-12345", damage_detail:"barang pecah saat pengiriman" };
    const c = calcComp(REQUIRED, collected, "complaint");

    assert("T5: threshold = 60%",              c.threshold===60,                   `got ${c.threshold}`);
    assert("T5: 66% completionPct",            c.completionPct>=66,                `pct=${c.completionPct}`);
    assert("T5: 66% ≥ 60% → IS ready",        c.isReady,                          `pct=${c.completionPct}`);

    // Session starts in 'collecting' on initial WhatsApp message — no task yet
    await insertSession(PH_COMP, "complaint", REQUIRED, collected);
    const tAfter = await taskCount(PH_COMP);
    assert("T5: task NOT created in intake mode", tAfter===tBefore,               `tasks=${tAfter}`);

    // Next pass: applyCollected → status becomes ready_for_task
    const s0 = await getSession(PH_COMP);
    const { row: sr } = await applyCollected(s0!.id, "complaint", REQUIRED, collected);
    assert("T5: status → ready_for_task",      sr?.status==="ready_for_task",     sr?.status);
    assert("T5: still 0 tasks (webhook must trigger)", await taskCount(PH_COMP)===0);
    assert("T5: damage_photo still missing",   jArr(sr?.missing_fields).includes("damage_photo"));

    console.log(`  ${INFO}complaint: pct=${c.completionPct}% | threshold=${c.threshold}% | ready=${c.isReady} | status=${sr?.status}`);
  }

  // ── [T6] Resume — previous session found, continues from missing fields ───
  console.log(`\n${B}[T6] Resume — previous session found, continues from missing fields${X}`);
  {
    const REQUIRED = ["amount","purpose","payout_method","payout_date"];
    await insertSession(PH_RESUME, "cash_advance", REQUIRED, { amount:"1000000" });

    // findActiveIntakeSession simulation
    const active = await getActiveSessions(PH_RESUME);
    const s0 = await getSession(PH_RESUME);
    assert("T6: active session found",          active.length===1,                 `found ${active.length}`);
    assert("T6: session still in collecting",   active[0]?.status==="collecting",  active[0]?.status);
    assert("T6: same session as created",       active[0]?.id===s0?.id,           `${active[0]?.id} vs ${s0?.id}`);
    assert("T6: amount already collected",      jObj(active[0]?.collected_fields).amount==="1000000");
    assert("T6: 3 fields still missing",        jArr(active[0]?.missing_fields).length===3);
    assert("T6: task NOT yet created",          await taskCount(PH_RESUME)===0);

    // User continues: adds 2 more fields
    const { c: c1 } = await applyCollected(s0!.id,"cash_advance",REQUIRED,
      { amount:"1000000", purpose:"bayar ongkir", payout_method:"transfer_bri" });
    assert("T6: 3/4 collected after resume",    c1.totalCollected===3,             `collected=${c1.totalCollected}`);
    assert("T6: payout_date still missing",     c1.missingFieldNames.includes("payout_date"));
    assert("T6: 75% NOT ready (threshold=100%)",!c1.isReady,                       `pct=${c1.completionPct}`);
    assert("T6: task still NOT created",        await taskCount(PH_RESUME)===0);

    // User completes: final field
    const { c: c2, row: rFinal } = await applyCollected(s0!.id,"cash_advance",REQUIRED,
      { amount:"1000000", purpose:"bayar ongkir", payout_method:"transfer_bri", payout_date:"besok" });
    assert("T6: 100% after final answer",       c2.completionPct===100);
    assert("T6: status = ready_for_task",       rFinal?.status==="ready_for_task", rFinal?.status);
    assert("T6: isReady = true",                c2.isReady);
    assert("T6: task still 0 before webhook",   await taskCount(PH_RESUME)===0);

    console.log(`  ${INFO}Resume: 1→3→4/4 fields | final status=${rFinal?.status}`);
  }

  // ── [T7] Cancel "batal" ───────────────────────────────────────────────────
  console.log(`\n${B}[T7] Cancel "batal" → session cancelled, no task${X}`);
  {
    const REQUIRED = ["amount","purpose","payout_method","payout_date"];
    await insertSession(PH_CANCEL, "cash_advance", REQUIRED, { amount:"300000" });

    // isCancellation pattern tests
    const YES = ["batal","Batal","BATAL","batalkan","Batalkan saja","tidak jadi","ga jadi","stop","ngga jadi","engga jadi"];
    const NO  = ["ya","ok","lanjut","kasbon","mau lanjut","300 ribu untuk solar"];
    for (const m of YES) assert(`T7: "${m}" → cancel=true`,  CANCEL_RE.test(m));
    for (const m of NO)  assert(`T7: "${m}" → cancel=false`, !CANCEL_RE.test(m));

    const s0 = await getSession(PH_CANCEL);
    await q(`UPDATE conversation_intake_sessions
             SET status='cancelled', last_message='batal', updated_at=NOW()
             WHERE id=$1`,[s0!.id]);
    const sFinal = await getSession(PH_CANCEL);
    const tasks  = await taskCount(PH_CANCEL);

    assert("T7: status = cancelled",            sFinal?.status==="cancelled",      sFinal?.status);
    assert("T7: task NOT created after cancel", tasks===0,                         `tasks=${tasks}`);
    assert("T7: task_id still null",            !sFinal?.task_id);
    assert("T7: collected partial data preserved", jObj(sFinal?.collected_fields).amount==="300000");

    console.log(`  ${INFO}Session #${s0?.id} cancelled | tasks=${tasks} | amount field preserved`);
  }

  // ── [INTEGRITY] Final task count across all test phones ───────────────────
  console.log(`\n${B}[INTEGRITY] ai_tasks count — only 1 task should exist (T3: kasbon 100%)${X}`);
  {
    const counts = await Promise.all(ALL_PH.map(taskCount));
    const [t1,t2,t3,t4,t5] = counts;
    const total_tasks = counts.reduce((a,b)=>a+b,0);

    console.log(`  ${INFO}kasbon=${t1}  trucking=${t2}  complaint=${t3}  resume=${t4}  cancel=${t5}  TOTAL=${total_tasks}`);

    assert("INTEGRITY: kasbon = 1 task (only after 100% complete)", t1===1,        `got ${t1}`);
    assert("INTEGRITY: trucking = 0 tasks (40%, incomplete)",       t2===0,        `got ${t2}`);
    assert("INTEGRITY: complaint = 0 tasks (intake mode)",          t3===0,        `got ${t3}`);
    assert("INTEGRITY: resume = 0 tasks (ready, not triggered yet)",t4===0,        `got ${t4}`);
    assert("INTEGRITY: cancel = 0 tasks (cancelled)",               t5===0,        `got ${t5}`);
    assert("INTEGRITY: TOTAL tasks = 1 only",                       total_tasks===1,`total=${total_tasks}`);
  }

  // ── [STATE] Final session state dump ─────────────────────────────────────
  console.log(`\n${B}[STATE] Final session state per test phone${X}`);
  {
    const rows = await q(`
      SELECT phone, intent_code, status, completion_pct,
             collected_fields, missing_fields, task_id
      FROM conversation_intake_sessions
      WHERE phone=ANY($1) AND company_id=$2
      ORDER BY phone`,[ALL_PH,CID]);
    for (const s of rows) {
      const col = Object.keys(jObj(s.collected_fields)).length;
      const mis = jArr(s.missing_fields).length;
      console.log(`  ${INFO}${String(s.phone).slice(-12).padEnd(14)} | `+
        `${String(s.intent_code).padEnd(14)} | `+
        `${String(s.status).padEnd(16)} | `+
        `pct=${String(s.completion_pct??0).padStart(3)}% | `+
        `col=${col} mis=${mis} | task=${s.task_id??"—"}`);
    }
  }

  // ── RESULTS ───────────────────────────────────────────────────────────────
  const readiness = Math.round((passed/total)*100);
  console.log(`\n${"━".repeat(68)}`);
  console.log(`${B}SPRINT 9A VALIDATION RESULTS${X}`);
  console.log(`${"━".repeat(68)}`);
  console.log(`  Total assertions: ${B}${total}${X}   Passed: ${G}${B}${passed}${X}   Failed: ${failed>0?R:G}${B}${failed}${X}`);

  if (failures.length) {
    console.log(`\n  ${R}${B}Failed assertions:${X}`);
    failures.forEach((f,i)=>console.log(`    ${i+1}. ${R}${f}${X}`));
  }

  const scoreLine = readiness===100 ? `${G}${B}100%${X}` : readiness>=90 ? `${Y}${B}${readiness}%${X}` : `${R}${B}${readiness}%${X}`;
  console.log(`\n  Readiness score: ${scoreLine}`);

  const verdict = readiness===100
    ? `${G}${B}✅  GO FOR SPRINT 9B — all ${total} assertions pass${X}`
    : readiness>=90
    ? `${Y}${B}⚠️   CONDITIONAL GO — fix ${failed} failure(s) first${X}`
    : `${R}${B}🚫  NO-GO — ${failed} failure(s) require fixes before 9B${X}`;
  console.log(`  VERDICT: ${verdict}`);
  console.log(`${"━".repeat(68)}\n`);

  await pool.end();
  process.exit(failed>0?1:0);
}

run().catch(err=>{ console.error(`${R}${B}CRASH:${X}`,err.message); pool.end(); process.exit(2); });
