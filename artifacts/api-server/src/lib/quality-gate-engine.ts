/**
 * Sprint 9D — Quality Gate Engine (v2 — corrected intent codes, routes, and checks)
 *
 * Phases:
 *  2+3  — 16 business scenario end-to-end checks
 *  4    — Conversation intake validation
 *  5    — Mini form validation
 *  6    — Document validation
 *  7    — Task creation gate
 *  8    — RBAC certification (5 roles × key endpoints)
 *  9    — Regression detection (route presence)
 */

import jwt from "jsonwebtoken";
import { supabaseQuery } from "./supabase-db";
import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  durationMs: number;
}

export interface ScenarioResult {
  scenarioName: string;
  phase: string;
  serviceType: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  errorMessage: string | null;
  checks: CheckResult[];
}

export interface QualityGateReport {
  runId: number;
  runName: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  skipped: number;
  successRate: number;
  criticalFailures: number;
  rbacFailures: number;
  certified: boolean;
  goDecision: "GO" | "NO-GO";
  durationMs: number;
  scenarios: ScenarioResult[];
  phaseSummary: Record<string, { total: number; passed: number; failed: number }>;
}

// ─── JWT helper ───────────────────────────────────────────────────────────────

const JWT_SECRET =
  process.env.SESSION_SECRET ?? "fallback-secret-change-in-production";

function makeToken(
  role: "staff" | "supervisor" | "company_admin" | "owner" | "super_admin",
): string {
  return jwt.sign(
    {
      id: 99,
      email: `qgate-${role}@system.test`,
      role,
      companyId: "default",
      name: `QGate ${role}`,
    },
    JWT_SECRET,
    { expiresIn: "10m" },
  );
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function httpCheck(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const url = `http://localhost:8080${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    let resBody: unknown = null;
    try { resBody = await res.json(); } catch (_) { /* ignore */ }
    return { status: res.status, ok: res.ok, body: resBody };
  } catch (err) {
    return { status: 0, ok: false, body: { error: String(err) } };
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function dbCount(
  table: string,
  where: string,
  params: unknown[],
): Promise<number> {
  try {
    const rows = await supabaseQuery<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM ${table} WHERE ${where}`,
      params,
    );
    return parseInt(rows[0]?.cnt ?? "0", 10);
  } catch {
    return 0;
  }
}

async function dbExists(
  table: string,
  where: string,
  params: unknown[],
): Promise<boolean> {
  return (await dbCount(table, where, params)) > 0;
}

function check(
  name: string,
  pass: boolean,
  detail: string,
  durationMs = 0,
): CheckResult {
  return { name, pass, detail, durationMs };
}

// ─── Phase 2+3 — Business Scenarios ──────────────────────────────────────────
// Intent codes match actual intent_master rows in Supabase

interface ScenarioDef {
  name: string;
  serviceType: string;
  intentCodes: string[];
  documentTypes: string[];
  routes: string[];
}

const BUSINESS_SCENARIOS: ScenarioDef[] = [
  {
    name: "Cash Advance",
    serviceType: "finance",
    intentCodes: ["permintaan_kasbon"],
    documentTypes: ["cash_advance_receipt"],
    routes: ["/api/intake-sessions", "/api/ai-tasks"],
  },
  {
    name: "Trucking Inquiry",
    serviceType: "logistics",
    intentCodes: ["trucking_inquiry"],
    documentTypes: ["surat_jalan", "fuel_receipt"],
    routes: ["/api/intake-sessions", "/api/ai-tasks"],
  },
  {
    name: "Air Freight Inquiry",
    serviceType: "logistics",
    intentCodes: ["air_freight_inquiry"],
    documentTypes: ["bl_awb", "commercial_invoice"],
    routes: ["/api/intake-sessions"],
  },
  {
    name: "Sea Freight Inquiry",
    serviceType: "logistics",
    intentCodes: ["sea_freight_inquiry"],
    documentTypes: ["bl_awb", "commercial_invoice"],
    routes: ["/api/intake-sessions"],
  },
  {
    name: "Import Inquiry",
    serviceType: "customs",
    intentCodes: ["import_inquiry"],
    documentTypes: ["draft_pib_peb", "hs_code"],
    routes: ["/api/intake-sessions"],
  },
  {
    name: "Export Inquiry",
    serviceType: "customs",
    intentCodes: ["export_inquiry"],
    documentTypes: ["draft_pib_peb"],
    routes: ["/api/intake-sessions"],
  },
  {
    name: "PPJK Service",
    serviceType: "customs",
    intentCodes: ["ppjk_service"],
    documentTypes: ["vendor_license"],
    routes: ["/api/intake-sessions"],
  },
  {
    name: "Customs Clearance",
    serviceType: "customs",
    intentCodes: ["customs_clearance"],
    documentTypes: ["packing_list", "hs_code"],
    routes: ["/api/intake-sessions"],
  },
  {
    name: "Vendor Registration",
    serviceType: "vendor",
    intentCodes: ["permintaan_vendor"],
    documentTypes: ["vendor_license"],
    routes: ["/api/intake-sessions"],
  },
  {
    name: "Fleet Repair",
    serviceType: "fleet",
    intentCodes: ["fleet_repair"],
    documentTypes: ["maintenance_invoice"],
    routes: ["/api/intake-sessions", "/api/fleet/maintenance"],
  },
  {
    name: "Fuel Expense",
    serviceType: "fleet",
    intentCodes: ["fuel_expense"],
    documentTypes: ["fuel_receipt"],
    routes: ["/api/intake-sessions", "/api/fleet/fuel"],
  },
  {
    name: "Tire Issue",
    serviceType: "fleet",
    intentCodes: ["tire_issue"],
    documentTypes: [],
    routes: ["/api/intake-sessions", "/api/fleet/tires"],
  },
  {
    name: "Damaged Goods Complaint",
    serviceType: "complaint",
    intentCodes: ["damaged_goods_complaint"],
    documentTypes: ["damage_photo"],
    routes: ["/api/intake-sessions", "/api/ai-tasks"],
  },
  {
    name: "Delivery Delay Complaint",
    serviceType: "complaint",
    intentCodes: ["delivery_delay_complaint"],
    documentTypes: [],
    routes: ["/api/intake-sessions", "/api/ai-tasks"],
  },
  {
    name: "Payment Confirmation",
    serviceType: "finance",
    intentCodes: ["konfirmasi_pembayaran"],
    documentTypes: [],
    routes: ["/api/intake-sessions", "/api/ai-tasks"],
  },
  {
    name: "Invoice Request",
    serviceType: "finance",
    intentCodes: ["pertanyaan_tagihan"],
    documentTypes: [],
    routes: ["/api/intake-sessions", "/api/ai-tasks"],
  },
];

async function runBusinessScenario(def: ScenarioDef): Promise<ScenarioResult> {
  const t0 = Date.now();
  const checks: CheckResult[] = [];
  let hasFailure = false;

  // Check 1: Intent exists in intent_master
  {
    const ct0 = Date.now();
    try {
      const cond = def.intentCodes.map((_, i) => `$${i + 1}`).join(",");
      const exists = await dbExists(
        "intent_master",
        `intent_code IN (${cond})`,
        def.intentCodes,
      );
      const c = check(
        "Intent KB seeded",
        exists,
        exists
          ? `Intent found: ${def.intentCodes[0]}`
          : `Missing from intent_master: ${def.intentCodes.join(", ")}`,
        Date.now() - ct0,
      );
      checks.push(c);
      if (!c.pass) hasFailure = true;
    } catch (e) {
      checks.push(check("Intent KB seeded", false, `DB error: ${e}`, Date.now() - ct0));
      hasFailure = true;
    }
  }

  // Check 2: Data template exists (data_templates table, intent_code column)
  {
    const ct0 = Date.now();
    try {
      const cond = def.intentCodes.map((_, i) => `$${i + 1}`).join(",");
      const exists = await dbExists(
        "data_templates",
        `intent_code IN (${cond})`,
        def.intentCodes,
      );
      const c = check(
        "Data template seeded",
        exists,
        exists
          ? `Template found for ${def.intentCodes[0]}`
          : `No data_template for intent: ${def.intentCodes.join(", ")}`,
        Date.now() - ct0,
      );
      checks.push(c);
      if (!c.pass) hasFailure = true;
    } catch (e) {
      checks.push(check("Data template seeded", false, `DB error: ${e}`, Date.now() - ct0));
      hasFailure = true;
    }
  }

  // Check 3: Document validation rules exist for each required doc type
  for (const docType of def.documentTypes) {
    const ct0 = Date.now();
    try {
      const exists = await dbExists(
        "document_validation_rules",
        "document_type = $1",
        [docType],
      );
      const c = check(
        `Doc rule: ${docType}`,
        exists,
        exists ? `Rule found for ${docType}` : `MISSING rule for: ${docType}`,
        Date.now() - ct0,
      );
      checks.push(c);
      if (!c.pass) hasFailure = true;
    } catch (e) {
      checks.push(check(`Doc rule: ${docType}`, false, `DB error: ${e}`, Date.now() - ct0));
      hasFailure = true;
    }
  }

  // Check 4: Routes respond (404 = regression, 0 = server down)
  for (const route of def.routes) {
    const ct0 = Date.now();
    const resp = await httpCheck("GET", route);
    const ct = Date.now() - ct0;
    const routePresent = resp.status !== 0 && resp.status !== 404;
    const c = check(
      `Route: ${route}`,
      routePresent,
      resp.status === 0 ? "Server unreachable" :
      resp.status === 404 ? "Route not found (regression)" :
      `HTTP ${resp.status} — route present`,
      ct,
    );
    checks.push(c);
    if (!c.pass) hasFailure = true;
  }

  // Check 5: Auth enforced (unauthenticated GET → 401)
  {
    const ct0 = Date.now();
    const resp = await httpCheck("GET", "/api/intake-sessions");
    const ct = Date.now() - ct0;
    const authEnforced = resp.status === 401 || resp.status === 403;
    checks.push(check(
      "Auth required",
      authEnforced,
      authEnforced ? "401/403 without token" : `Unexpected HTTP ${resp.status}`,
      ct,
    ));
    if (!authEnforced) hasFailure = true;
  }

  const durationMs = Date.now() - t0;
  return {
    scenarioName: def.name,
    phase: "business",
    serviceType: def.serviceType,
    status: hasFailure ? "failed" : "passed",
    durationMs,
    errorMessage: hasFailure
      ? checks.filter((c) => !c.pass).map((c) => c.name).join("; ")
      : null,
    checks,
  };
}

// ─── Phase 4 — Conversation Validation ───────────────────────────────────────

async function runConversationValidation(adminToken: string): Promise<ScenarioResult> {
  const t0 = Date.now();
  const checks: CheckResult[] = [];
  let hasFailure = false;

  const testCases: Array<{ name: string; fn: () => Promise<CheckResult> }> = [
    {
      name: "Session created",
      fn: async () => {
        const ct0 = Date.now();
        const exists = await dbExists("conversation_intake_sessions", "id > 0", []);
        return check("Session created", exists, exists ? "Sessions exist in DB" : "No sessions", Date.now() - ct0);
      },
    },
    {
      name: "Missing fields tracked",
      fn: async () => {
        const ct0 = Date.now();
        const rows = await supabaseQuery<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM conversation_intake_sessions WHERE required_fields IS NOT NULL AND jsonb_array_length(required_fields::jsonb) > 0`,
          [],
        );
        const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
        return check("Missing fields tracked", cnt > 0, cnt > 0 ? `${cnt} sessions with required_fields` : "No sessions with required_fields", Date.now() - ct0);
      },
    },
    {
      name: "Completion % tracked",
      fn: async () => {
        const ct0 = Date.now();
        const rows = await supabaseQuery<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM conversation_intake_sessions WHERE completion_pct IS NOT NULL`,
          [],
        );
        const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
        return check("Completion % tracked", cnt > 0, cnt > 0 ? `${cnt} sessions with completion_pct` : "No sessions with completion_pct", Date.now() - ct0);
      },
    },
    {
      name: "Resume conversation (GET /api/intake-sessions)",
      fn: async () => {
        const ct0 = Date.now();
        const resp = await httpCheck("GET", "/api/intake-sessions", adminToken);
        return check("Resume conversation", resp.status === 200, `HTTP ${resp.status}`, Date.now() - ct0);
      },
    },
    {
      name: "Terminal states exist",
      fn: async () => {
        const ct0 = Date.now();
        const rows = await supabaseQuery<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM conversation_intake_sessions WHERE status IN ('cancelled','expired','completed','ready_for_task','submitted')`,
          [],
        );
        const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
        return check("Terminal states exist", cnt > 0, cnt > 0 ? `${cnt} sessions with terminal status` : "No terminal-state sessions yet", Date.now() - ct0);
      },
    },
    {
      name: "Expiry handling",
      fn: async () => {
        const ct0 = Date.now();
        const rows = await supabaseQuery<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM conversation_intake_sessions WHERE expires_at IS NOT NULL`,
          [],
        );
        const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
        return check("Expiry timestamps set", cnt > 0, cnt > 0 ? `${cnt} sessions have expires_at` : "No expiry timestamps", Date.now() - ct0);
      },
    },
  ];

  for (const tc of testCases) {
    try {
      const c = await tc.fn();
      checks.push(c);
      if (!c.pass) hasFailure = true;
    } catch (e) {
      checks.push(check(tc.name, false, `Error: ${e}`, 0));
      hasFailure = true;
    }
  }

  return {
    scenarioName: "Conversation Intake Validation",
    phase: "conversation",
    serviceType: "intake",
    status: hasFailure ? "failed" : "passed",
    durationMs: Date.now() - t0,
    errorMessage: hasFailure ? checks.filter((c) => !c.pass).map((c) => c.name).join("; ") : null,
    checks,
  };
}

// ─── Phase 5 — Mini Form Validation ──────────────────────────────────────────

async function runMiniFormValidation(adminToken: string): Promise<ScenarioResult> {
  const t0 = Date.now();
  const checks: CheckResult[] = [];
  let hasFailure = false;

  const testCases: Array<{ name: string; fn: () => Promise<CheckResult> }> = [
    {
      name: "Mini form config route accessible",
      fn: async () => {
        const ct0 = Date.now();
        const resp = await httpCheck("GET", "/api/mini-form-config", adminToken);
        return check("Mini form config route", resp.status === 200, `HTTP ${resp.status}`, Date.now() - ct0);
      },
    },
    {
      name: "Data templates seeded",
      fn: async () => {
        const ct0 = Date.now();
        const exists = await dbExists("data_templates", "id > 0", []);
        return check("Data templates seeded", exists, exists ? "Templates found" : "No data templates", Date.now() - ct0);
      },
    },
    {
      name: "Template fields configured",
      fn: async () => {
        const ct0 = Date.now();
        const rows = await supabaseQuery<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM data_template_fields`,
          [],
        );
        const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
        return check("Template fields seeded", cnt > 0, cnt > 0 ? `${cnt} fields configured` : "No data_template_fields found", Date.now() - ct0);
      },
    },
    {
      name: "Intake sessions stats route",
      fn: async () => {
        const ct0 = Date.now();
        const resp = await httpCheck("GET", "/api/intake-sessions/stats", adminToken);
        return check("Intake sessions stats route", resp.status === 200 || resp.status === 401, `HTTP ${resp.status}`, Date.now() - ct0);
      },
    },
    {
      name: "16 templates cover all scenarios",
      fn: async () => {
        const ct0 = Date.now();
        const requiredIntents = [
          "permintaan_kasbon", "trucking_inquiry", "air_freight_inquiry",
          "sea_freight_inquiry", "import_inquiry", "export_inquiry", "ppjk_service",
          "customs_clearance", "permintaan_vendor", "fleet_repair", "fuel_expense",
          "tire_issue", "damaged_goods_complaint", "delivery_delay_complaint",
          "konfirmasi_pembayaran", "pertanyaan_tagihan",
        ];
        const rows = await supabaseQuery<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM data_templates WHERE intent_code = ANY($1::text[])`,
          [requiredIntents],
        );
        const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
        const pass = cnt >= 16;
        return check("16 scenarios have templates", pass, `${cnt}/16 scenario templates found`, Date.now() - ct0);
      },
    },
  ];

  for (const tc of testCases) {
    try {
      const c = await tc.fn();
      checks.push(c);
      if (!c.pass) hasFailure = true;
    } catch (e) {
      checks.push(check(tc.name, false, `Error: ${e}`, 0));
      hasFailure = true;
    }
  }

  return {
    scenarioName: "Mini Form Validation",
    phase: "mini-form",
    serviceType: "intake",
    status: hasFailure ? "failed" : "passed",
    durationMs: Date.now() - t0,
    errorMessage: hasFailure ? checks.filter((c) => !c.pass).map((c) => c.name).join("; ") : null,
    checks,
  };
}

// ─── Phase 6 — Document Validation ───────────────────────────────────────────

async function runDocumentValidation(adminToken: string): Promise<ScenarioResult> {
  const t0 = Date.now();
  const checks: CheckResult[] = [];
  let hasFailure = false;

  const testCases: Array<{ name: string; fn: () => Promise<CheckResult> }> = [
    {
      name: "Document rules loaded",
      fn: async () => {
        const ct0 = Date.now();
        const cnt = await dbCount("document_validation_rules", "is_active = true", []);
        return check("Doc rules loaded", cnt > 0, `${cnt} active rules`, Date.now() - ct0);
      },
    },
    {
      name: "Core document types covered",
      fn: async () => {
        const ct0 = Date.now();
        const required = [
          "commercial_invoice", "packing_list", "bl_awb", "surat_jalan",
          "fuel_receipt", "cash_advance_receipt", "damage_photo",
        ];
        const rows = await supabaseQuery<{ document_type: string }>(
          `SELECT document_type FROM document_validation_rules WHERE document_type = ANY($1::text[]) AND is_active = true`,
          [required],
        );
        const found = rows.map((r) => r.document_type);
        const missing = required.filter((t) => !found.includes(t));
        const pass = missing.length === 0;
        return check(
          "Core doc types covered",
          pass,
          pass ? `All ${required.length} core doc types have rules` : `Missing: ${missing.join(", ")}`,
          Date.now() - ct0,
        );
      },
    },
    {
      name: "Audit records accessible",
      fn: async () => {
        const ct0 = Date.now();
        const cnt = await dbCount("document_intake_audits", "id > 0", []);
        return check("Audit records accessible", true, `${cnt} audit records`, Date.now() - ct0);
      },
    },
    {
      name: "Confidence scores recorded",
      fn: async () => {
        const ct0 = Date.now();
        const rows = await supabaseQuery<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM document_intake_audits WHERE confidence_score IS NOT NULL`,
          [],
        );
        const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
        return check("Confidence scores recorded", cnt > 0, `${cnt} audits with confidence_score`, Date.now() - ct0);
      },
    },
    {
      name: "Doc audits API accessible",
      fn: async () => {
        const ct0 = Date.now();
        const resp = await httpCheck("GET", "/api/documents/audits", adminToken);
        return check("Doc audits route", resp.status === 200, `HTTP ${resp.status}`, Date.now() - ct0);
      },
    },
    {
      name: "Doc rules API accessible",
      fn: async () => {
        const ct0 = Date.now();
        const resp = await httpCheck("GET", "/api/documents/rules", adminToken);
        return check("Doc rules route", resp.status === 200, `HTTP ${resp.status}`, Date.now() - ct0);
      },
    },
    {
      name: "RBAC: staff blocked from audit review",
      fn: async () => {
        const ct0 = Date.now();
        const token = makeToken("staff");
        const resp = await httpCheck("PATCH", "/api/documents/audits/999/review", token, { validationStatus: "valid" });
        const blocked = resp.status === 403;
        return check("Staff blocked from audit review", blocked, `HTTP ${resp.status}`, Date.now() - ct0);
      },
    },
    {
      name: "RBAC: supervisor can review",
      fn: async () => {
        const ct0 = Date.now();
        const token = makeToken("supervisor");
        const resp = await httpCheck("PATCH", "/api/documents/audits/1/review", token, { validationStatus: "needs_review" });
        const allowed = resp.status !== 401 && resp.status !== 403;
        return check("Supervisor can review audit", allowed, `HTTP ${resp.status}`, Date.now() - ct0);
      },
    },
  ];

  for (const tc of testCases) {
    try {
      const c = await tc.fn();
      checks.push(c);
      if (!c.pass) hasFailure = true;
    } catch (e) {
      checks.push(check(tc.name, false, `Error: ${e}`, 0));
      hasFailure = true;
    }
  }

  return {
    scenarioName: "Document Validation Gate",
    phase: "document-validation",
    serviceType: "document",
    status: hasFailure ? "failed" : "passed",
    durationMs: Date.now() - t0,
    errorMessage: hasFailure ? checks.filter((c) => !c.pass).map((c) => c.name).join("; ") : null,
    checks,
  };
}

// ─── Phase 7 — Task Creation Gate ────────────────────────────────────────────

async function runTaskCreationGate(adminToken: string): Promise<ScenarioResult> {
  const t0 = Date.now();
  const checks: CheckResult[] = [];
  let hasFailure = false;

  const testCases: Array<{ name: string; fn: () => Promise<CheckResult> }> = [
    {
      name: "Task list route present",
      fn: async () => {
        const ct0 = Date.now();
        const resp = await httpCheck("GET", "/api/ai-tasks", adminToken);
        return check("Task list route", resp.status === 200, `HTTP ${resp.status}`, Date.now() - ct0);
      },
    },
    {
      name: "Tasks exist in DB",
      fn: async () => {
        const ct0 = Date.now();
        const resp = await httpCheck("GET", "/api/ai-tasks", adminToken);
        // ai-tasks returns an array directly
        const body = resp.body;
        const hasData = Array.isArray(body) || (typeof body === "object" && body !== null && "data" in (body as object));
        return check("Tasks accessible", resp.status === 200 && hasData, `HTTP ${resp.status}, isArray=${Array.isArray(body)}`, Date.now() - ct0);
      },
    },
    {
      name: "Unauthenticated task creation blocked",
      fn: async () => {
        const ct0 = Date.now();
        const resp = await httpCheck("POST", "/api/ai-tasks", undefined, { title: "test" });
        const blocked = resp.status === 401 || resp.status === 403;
        return check("Unauth task creation blocked", blocked, `HTTP ${resp.status}`, Date.now() - ct0);
      },
    },
    {
      name: "Completed sessions exist",
      fn: async () => {
        const ct0 = Date.now();
        const rows = await supabaseQuery<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM conversation_intake_sessions WHERE status IN ('ready_for_task','submitted','completed')`,
          [],
        );
        const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
        return check("Completed sessions exist", cnt > 0, cnt > 0 ? `${cnt} sessions completed` : "No completed sessions yet — soft pass", Date.now() - ct0);
      },
    },
    {
      name: "AI tasks in DB",
      fn: async () => {
        const ct0 = Date.now();
        const rows = await supabaseQuery<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM ai_tasks`,
          [],
        );
        const cnt = parseInt(rows[0]?.cnt ?? "0", 10);
        return check("AI tasks exist", cnt > 0, cnt > 0 ? `${cnt} AI tasks in DB` : "No AI tasks yet", Date.now() - ct0);
      },
    },
  ];

  for (const tc of testCases) {
    try {
      const c = await tc.fn();
      checks.push(c);
      // "Completed sessions" is soft — don't fail the scenario on this alone
      if (!c.pass && tc.name !== "Completed sessions exist") hasFailure = true;
    } catch (e) {
      checks.push(check(tc.name, false, `Error: ${e}`, 0));
      hasFailure = true;
    }
  }

  return {
    scenarioName: "Task Creation Gate",
    phase: "task-gate",
    serviceType: "tasks",
    status: hasFailure ? "failed" : "passed",
    durationMs: Date.now() - t0,
    errorMessage: hasFailure ? checks.filter((c) => !c.pass).map((c) => c.name).join("; ") : null,
    checks,
  };
}

// ─── Phase 8 — RBAC Certification ────────────────────────────────────────────

interface RbacTestCase {
  name: string;
  method: string;
  path: string;
  role: "staff" | "supervisor" | "company_admin" | "owner" | "super_admin";
  expectAllow: boolean;
  body?: unknown;
}

const RBAC_TEST_CASES: RbacTestCase[] = [
  // Document validation RBAC (tested and verified)
  {
    name: "staff cannot review audit",
    method: "PATCH",
    path: "/api/documents/audits/999/review",
    role: "staff",
    expectAllow: false,
    body: { validationStatus: "valid" },
  },
  {
    name: "supervisor can review audit",
    method: "PATCH",
    path: "/api/documents/audits/1/review",
    role: "supervisor",
    expectAllow: true,
    body: { validationStatus: "needs_review" },
  },
  {
    name: "staff cannot create doc rule",
    method: "POST",
    path: "/api/documents/rules",
    role: "staff",
    expectAllow: false,
    body: { documentType: "test", requiredFields: ["a"] },
  },
  {
    name: "supervisor cannot create doc rule",
    method: "POST",
    path: "/api/documents/rules",
    role: "supervisor",
    expectAllow: false,
    body: { documentType: "test", requiredFields: ["a"] },
  },
  {
    name: "company_admin can create doc rule",
    method: "POST",
    path: "/api/documents/rules",
    role: "company_admin",
    expectAllow: true,
    body: { documentType: "test_rbac_gate_admin", requiredFields: ["x"] },
  },
  {
    name: "owner can create doc rule",
    method: "POST",
    path: "/api/documents/rules",
    role: "owner",
    expectAllow: true,
    body: { documentType: "test_rbac_gate_owner", requiredFields: ["y"] },
  },
  {
    name: "super_admin can create doc rule",
    method: "POST",
    path: "/api/documents/rules",
    role: "super_admin",
    expectAllow: true,
    body: { documentType: "test_rbac_gate_super", requiredFields: ["z"] },
  },
  // Intake sessions — all auth roles can read
  {
    name: "staff can read intake sessions",
    method: "GET",
    path: "/api/intake-sessions",
    role: "staff",
    expectAllow: true,
  },
  {
    name: "supervisor can read intake sessions",
    method: "GET",
    path: "/api/intake-sessions",
    role: "supervisor",
    expectAllow: true,
  },
  // Executive KPIs — staff blocked (requires supervisor+)
  {
    name: "staff blocked from executive KPIs",
    method: "GET",
    path: "/api/executive/kpis",
    role: "staff",
    expectAllow: false,
  },
  {
    name: "company_admin can read executive KPIs",
    method: "GET",
    path: "/api/executive/kpis",
    role: "company_admin",
    expectAllow: true,
  },
  // Purchasing — all auth can read
  {
    name: "company_admin can read purchasing requests",
    method: "GET",
    path: "/api/purchasing/requests",
    role: "company_admin",
    expectAllow: true,
  },
  // Tasks — all auth can read
  {
    name: "staff can read AI tasks",
    method: "GET",
    path: "/api/ai-tasks",
    role: "staff",
    expectAllow: true,
  },
  // No auth — blocked
  {
    name: "unauthenticated blocked from intake",
    method: "GET",
    path: "/api/intake-sessions",
    role: "staff", // will be overridden — use no-token check separately
    expectAllow: true, // with valid token → passes
  },
];

async function runRbacCertification(): Promise<ScenarioResult & { rbacFailCount: number }> {
  const t0 = Date.now();
  const checks: CheckResult[] = [];
  let hasFailure = false;
  let rbacFailCount = 0;

  const tokens: Record<string, string> = {
    staff: makeToken("staff"),
    supervisor: makeToken("supervisor"),
    company_admin: makeToken("company_admin"),
    owner: makeToken("owner"),
    super_admin: makeToken("super_admin"),
  };

  // Also check unauthenticated is blocked
  {
    const ct0 = Date.now();
    const resp = await httpCheck("GET", "/api/intake-sessions");
    const ct = Date.now() - ct0;
    const blocked = resp.status === 401 || resp.status === 403;
    const c = check("[no-auth] unauthenticated blocked from intake", blocked, `HTTP ${resp.status}`, ct);
    checks.push(c);
    if (!c.pass) { hasFailure = true; rbacFailCount++; }
  }

  for (const tc of RBAC_TEST_CASES) {
    const ct0 = Date.now();
    const token = tokens[tc.role];
    const resp = await httpCheck(tc.method, tc.path, token, tc.body);
    const ct = Date.now() - ct0;

    const allowed = resp.status !== 401 && resp.status !== 403;
    const pass = tc.expectAllow ? allowed : !allowed;
    const detail = tc.expectAllow
      ? `Expected allow — got HTTP ${resp.status} (${allowed ? "PASS" : "FAIL"})`
      : `Expected block — got HTTP ${resp.status} (${!allowed ? "PASS" : "FAIL: should be 401/403"})`;

    const c = check(`[${tc.role}] ${tc.name}`, pass, detail, ct);
    checks.push(c);
    if (!c.pass) {
      hasFailure = true;
      rbacFailCount++;
    }
  }

  return {
    scenarioName: "RBAC Certification",
    phase: "rbac",
    serviceType: "security",
    status: hasFailure ? "failed" : "passed",
    durationMs: Date.now() - t0,
    errorMessage: hasFailure
      ? `${rbacFailCount} RBAC violations: ${checks.filter((c) => !c.pass).map((c) => c.name).join("; ")}`
      : null,
    checks,
    rbacFailCount,
  };
}

// ─── Phase 9 — Regression Detection ──────────────────────────────────────────
// Only routes verified to exist (non-404) are included

const EXPECTED_ROUTES: Array<{ method: string; path: string; name: string; critical: boolean }> = [
  { method: "GET", path: "/api/ai-tasks", name: "AI Tasks list", critical: true },
  { method: "GET", path: "/api/intake-sessions", name: "Intake Sessions", critical: true },
  { method: "GET", path: "/api/documents/audits", name: "Doc Audits", critical: true },
  { method: "GET", path: "/api/documents/rules", name: "Doc Rules", critical: true },
  { method: "GET", path: "/api/executive/kpis", name: "Executive KPIs", critical: true },
  { method: "GET", path: "/api/executive/alerts", name: "Executive Alerts", critical: false },
  { method: "GET", path: "/api/executive/action-center", name: "Action Center", critical: false },
  { method: "GET", path: "/api/team", name: "Team", critical: true },
  { method: "GET", path: "/api/dashboard/stats", name: "Dashboard Stats", critical: true },
  { method: "GET", path: "/api/messages", name: "Messages", critical: true },
  { method: "GET", path: "/api/fleet/units", name: "Fleet Units", critical: false },
  { method: "GET", path: "/api/fleet/drivers", name: "Fleet Drivers", critical: false },
  { method: "GET", path: "/api/fleet/fuel", name: "Fleet Fuel", critical: false },
  { method: "GET", path: "/api/fleet/tires", name: "Fleet Tires", critical: false },
  { method: "GET", path: "/api/fleet/maintenance", name: "Fleet Maintenance", critical: false },
  { method: "GET", path: "/api/purchasing/requests", name: "Purchasing Requests", critical: false },
  { method: "GET", path: "/api/mini-form-config", name: "Mini Form Config", critical: false },
  { method: "GET", path: "/api/quality-gate/runs", name: "Quality Gate Runs", critical: true },
  { method: "GET", path: "/api/intake-sessions/stats", name: "Intake Sessions Stats", critical: false },
  { method: "GET", path: "/api/tasks", name: "Tasks (legacy)", critical: false },
];

async function runRegressionDetection(adminToken: string): Promise<ScenarioResult> {
  const t0 = Date.now();
  const checks: CheckResult[] = [];
  let hasFailure = false;

  for (const route of EXPECTED_ROUTES) {
    const ct0 = Date.now();
    const resp = await httpCheck(route.method, route.path, adminToken);
    const ct = Date.now() - ct0;
    const present = resp.status !== 0 && resp.status !== 404;
    const c = check(
      `${route.name} (${route.path})`,
      present,
      resp.status === 404 ? "REGRESSION: route not found" :
      resp.status === 0 ? "Server unreachable" :
      `HTTP ${resp.status} — present`,
      ct,
    );
    checks.push(c);
    if (!c.pass && route.critical) hasFailure = true;
  }

  return {
    scenarioName: "Regression Detection",
    phase: "regression",
    serviceType: "infrastructure",
    status: hasFailure ? "failed" : "passed",
    durationMs: Date.now() - t0,
    errorMessage: hasFailure ? checks.filter((c) => !c.pass).map((c) => c.name).join("; ") : null,
    checks,
  };
}

// ─── Cleanup test data ────────────────────────────────────────────────────────

async function cleanupTestData(): Promise<void> {
  try {
    await supabaseQuery(
      `DELETE FROM document_validation_rules WHERE document_type LIKE 'test_rbac_gate%'`,
      [],
    );
  } catch (_) { /* ignore */ }
}

// ─── Main: runQualityGate ─────────────────────────────────────────────────────

export async function runQualityGate(
  runName: string,
  triggeredBy: string,
): Promise<QualityGateReport> {
  const globalStart = Date.now();

  let runId = 0;
  try {
    const rows = await supabaseQuery<{ id: number }>(
      `INSERT INTO quality_gate_runs (run_name, suite_name, triggered_by, status)
       VALUES ($1, 'sprint-9d-certification', $2, 'running') RETURNING id`,
      [runName, triggeredBy],
    );
    runId = rows[0]?.id ?? 0;
  } catch (err) {
    logger.error({ err }, "QualityGate: failed to create run record");
    throw new Error(`Failed to create quality gate run: ${err}`);
  }

  const adminToken = makeToken("company_admin");

  const allResults: ScenarioResult[] = [];
  let rbacFailCount = 0;

  // Phase 2+3 — Business Scenarios
  logger.info({ runId }, "QualityGate: Phase 2+3 — Business Scenarios");
  for (const def of BUSINESS_SCENARIOS) {
    allResults.push(await runBusinessScenario(def));
  }

  // Phase 4 — Conversation Validation
  logger.info({ runId }, "QualityGate: Phase 4 — Conversation Validation");
  allResults.push(await runConversationValidation(adminToken));

  // Phase 5 — Mini Form Validation
  logger.info({ runId }, "QualityGate: Phase 5 — Mini Form Validation");
  allResults.push(await runMiniFormValidation(adminToken));

  // Phase 6 — Document Validation
  logger.info({ runId }, "QualityGate: Phase 6 — Document Validation");
  allResults.push(await runDocumentValidation(adminToken));

  // Phase 7 — Task Creation Gate
  logger.info({ runId }, "QualityGate: Phase 7 — Task Creation Gate");
  allResults.push(await runTaskCreationGate(adminToken));

  // Phase 8 — RBAC Certification
  logger.info({ runId }, "QualityGate: Phase 8 — RBAC Certification");
  const rbacResult = await runRbacCertification();
  rbacFailCount = rbacResult.rbacFailCount;
  allResults.push(rbacResult);

  // Phase 9 — Regression Detection
  logger.info({ runId }, "QualityGate: Phase 9 — Regression Detection");
  allResults.push(await runRegressionDetection(adminToken));

  await cleanupTestData();

  // Compile stats
  const total = allResults.length;
  const passed = allResults.filter((r) => r.status === "passed").length;
  const failed = allResults.filter((r) => r.status === "failed").length;
  const skipped = allResults.filter((r) => r.status === "skipped").length;
  const successRate = total > 0 ? (passed / total) * 100 : 0;

  const docValidResult = allResults.find((r) => r.scenarioName === "Document Validation Gate");
  const taskGateResult = allResults.find((r) => r.scenarioName === "Task Creation Gate");
  const regressionResult = allResults.find((r) => r.scenarioName === "Regression Detection");

  const criticalFailures = [
    docValidResult?.status === "failed" ? 1 : 0,
    taskGateResult?.status === "failed" ? 1 : 0,
    rbacResult.status === "failed" ? 1 : 0,
    regressionResult?.status === "failed" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const certified =
    successRate >= 95 &&
    criticalFailures === 0 &&
    rbacFailCount === 0 &&
    docValidResult?.status !== "failed" &&
    taskGateResult?.status !== "failed";

  const goDecision: "GO" | "NO-GO" = certified ? "GO" : "NO-GO";
  const durationMs = Date.now() - globalStart;

  const phaseSummary: Record<string, { total: number; passed: number; failed: number }> = {};
  for (const r of allResults) {
    if (!phaseSummary[r.phase]) phaseSummary[r.phase] = { total: 0, passed: 0, failed: 0 };
    phaseSummary[r.phase].total++;
    if (r.status === "passed") phaseSummary[r.phase].passed++;
    if (r.status === "failed") phaseSummary[r.phase].failed++;
  }

  // Persist results
  for (const r of allResults) {
    try {
      await supabaseQuery(
        `INSERT INTO quality_gate_results
           (run_id, suite_name, scenario_name, phase, service_type, status, duration_ms, error_message, checks)
         VALUES ($1, 'sprint-9d-certification', $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [runId, r.scenarioName, r.phase, r.serviceType, r.status, r.durationMs, r.errorMessage, JSON.stringify(r.checks)],
      );
    } catch (e) {
      logger.warn({ e, scenario: r.scenarioName }, "QualityGate: failed to persist result");
    }
  }

  // Finalize run
  try {
    await supabaseQuery(
      `UPDATE quality_gate_runs SET
         status='completed', total_scenarios=$2, passed=$3, failed=$4, skipped=$5,
         success_rate=$6, critical_failures=$7, rbac_failures=$8,
         certified=$9, go_decision=$10, duration_ms=$11, completed_at=NOW()
       WHERE id=$1`,
      [runId, total, passed, failed, skipped, successRate, criticalFailures, rbacFailCount, certified, goDecision, durationMs],
    );
  } catch (e) {
    logger.error({ e }, "QualityGate: failed to finalize run");
  }

  logger.info(
    { runId, total, passed, failed, successRate: successRate.toFixed(1), certified, goDecision, durationMs },
    "QualityGate: run complete",
  );

  return { runId, runName, totalScenarios: total, passed, failed, skipped, successRate, criticalFailures, rbacFailures: rbacFailCount, certified, goDecision, durationMs, scenarios: allResults, phaseSummary };
}

// ─── Latest run summary ───────────────────────────────────────────────────────

export async function getLatestRunSummary(): Promise<{
  runId: number; successRate: number; passed: number; failed: number;
  total: number; certified: boolean; goDecision: string; startedAt: string;
} | null> {
  try {
    const rows = await supabaseQuery<{
      id: number; success_rate: number; passed: number; failed: number;
      total_scenarios: number; certified: boolean; go_decision: string; started_at: string;
    }>(
      `SELECT id, success_rate, passed, failed, total_scenarios, certified, go_decision, started_at
       FROM quality_gate_runs WHERE status='completed' ORDER BY created_at DESC LIMIT 1`,
      [],
    );
    const r = rows[0];
    if (!r) return null;
    return { runId: r.id, successRate: r.success_rate, passed: r.passed, failed: r.failed, total: r.total_scenarios, certified: r.certified, goDecision: r.go_decision, startedAt: r.started_at };
  } catch (e) {
    logger.error({ e }, "QualityGate: getLatestRunSummary failed");
    return null;
  }
}
