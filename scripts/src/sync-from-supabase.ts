import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const { Pool } = pg;

// ─── Supabase REST helper ──────────────────────────────────────────────────────
const SUPA_BASE = (process.env.SUPABASE_URL ?? "") + "/rest/v1";
const SUPA_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPA_BASE || !SUPA_KEY) {
  console.error("❌  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak di-set");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("❌  DATABASE_URL tidak di-set");
  process.exit(1);
}

const supaHeaders = {
  apikey: SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  "Content-Type": "application/json",
};

async function fetchAll<T = Record<string, unknown>>(
  table: string,
  params = "",
): Promise<T[]> {
  const url = `${SUPA_BASE}/${table}?limit=2000&order=id${params}`;
  const r = await fetch(url, { headers: supaHeaders });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Supabase fetch ${table} failed ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = await r.json() as T[];
  return Array.isArray(data) ? data : [];
}

// ─── Replit Postgres pool ──────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function q(sql: string, params: unknown[] = []) {
  return pool.query(sql, params);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function safe(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return String(v);
}

function safeDate(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

let synced = 0;
let skipped = 0;
let errors = 0;

function log(msg: string) { console.log(msg); }
function ok(label: string, n: number) {
  synced += n;
  log(`  ✅  ${label}: ${n} baris disinkronkan`);
}
function warn(label: string, msg: string) {
  skipped++;
  log(`  ⚠️   ${label}: ${msg}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. COMPANY SETTINGS  (companies → company_settings)
// ════════════════════════════════════════════════════════════════════════════════
async function syncCompanySettings() {
  log("\n📋  Sinkronisasi Company Settings...");
  type SupaCompany = {
    id: number; company_name: string; company_code: string;
    phone: string | null; email: string | null; address: string | null;
  };
  const rows = await fetchAll<SupaCompany>("companies");

  if (!rows.length) { warn("companies", "tidak ada data"); return; }

  const main = rows[0];
  await q(`
    INSERT INTO company_settings (company_id, company_name, company_phone, company_address, company_email)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (company_id) DO UPDATE SET
      company_name    = EXCLUDED.company_name,
      company_phone   = EXCLUDED.company_phone,
      company_address = EXCLUDED.company_address,
      company_email   = EXCLUDED.company_email,
      updated_at      = NOW()
  `, ["default", main.company_name, main.phone, main.address, main.email]);

  ok("company_settings", 1);
}

// ════════════════════════════════════════════════════════════════════════════════
// 2. USERS  (users → users)
// ════════════════════════════════════════════════════════════════════════════════
async function syncUsers() {
  log("\n👥  Sinkronisasi Users...");
  type SupaUser = {
    id: string; email: string | null; name: string | null;
    first_name: string | null; last_name: string | null;
    role: string | null; division: string | null; phone: string | null;
    password_hash: string | null; is_active: boolean | null;
    last_login_at: string | null; created_at: string | null;
    company_id: number | null;
  };

  const rows = await fetchAll<SupaUser>("users");
  if (!rows.length) { warn("users", "tidak ada data"); return; }

  const VALID_ROLES = ["super_admin","company_admin","supervisor","staff","vendor","customer"];
  let count = 0;

  for (const u of rows) {
    const email = u.email?.toLowerCase().trim();
    if (!email) { warn(`user ${u.id}`, "tidak punya email, di-skip"); continue; }

    const nameFull = (u.name ?? [u.first_name, u.last_name].filter(Boolean).join(" ").trim()) || email;

    const role = u.role && VALID_ROLES.includes(u.role) ? u.role : "staff";

    // Jika password_hash dari Supabase null (OAuth user), buat placeholder
    let hash = u.password_hash;
    if (!hash) {
      const rand = crypto.randomBytes(16).toString("hex");
      hash = await bcrypt.hash(rand, 10);
    }

    try {
      await q(`
        INSERT INTO users
          (company_id, name, email, password_hash, role, division, phone,
           is_active, last_login_at, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        ON CONFLICT (email) DO UPDATE SET
          name         = EXCLUDED.name,
          role         = EXCLUDED.role,
          division     = EXCLUDED.division,
          phone        = EXCLUDED.phone,
          is_active    = EXCLUDED.is_active,
          last_login_at= EXCLUDED.last_login_at,
          updated_at   = NOW()
      `, [
        "default",
        nameFull,
        email,
        hash,
        role,
        u.division ?? null,
        u.phone ?? null,
        u.is_active ?? true,
        safeDate(u.last_login_at),
        safeDate(u.created_at) ?? new Date().toISOString(),
      ]);
      count++;
    } catch (e: unknown) {
      errors++;
      log(`  ❌  user ${email}: ${(e as Error).message}`);
    }
  }
  ok("users", count);
}

// ════════════════════════════════════════════════════════════════════════════════
// 3. CUSTOMERS  (customers → customers)
// ════════════════════════════════════════════════════════════════════════════════
async function syncCustomers() {
  log("\n🏢  Sinkronisasi Customers...");
  type SupaCust = {
    id: number; name: string | null; email: string | null;
    phone: string | null; tax_id: string | null; address: string | null;
    notes: string | null; created_at: string | null; company_id: number | null;
  };

  const rows = await fetchAll<SupaCust>("customers");
  if (!rows.length) { warn("customers", "tidak ada data"); return; }

  let count = 0;
  for (const c of rows) {
    const companyName = c.name ?? "Unknown Customer";
    try {
      await q(`
        INSERT INTO customers
          (company_id, company_name, whatsapp, email, npwp, address, notes,
           total_tasks, total_documents, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,$8,NOW())
        ON CONFLICT DO NOTHING
      `, [
        "default",
        companyName,
        c.phone ?? null,
        c.email ?? null,
        c.tax_id ?? null,
        c.address ?? null,
        c.notes ?? null,
        safeDate(c.created_at) ?? new Date().toISOString(),
      ]);
      count++;
    } catch (e: unknown) {
      errors++;
      log(`  ❌  customer ${companyName}: ${(e as Error).message}`);
    }
  }
  ok("customers", count);
}

// ════════════════════════════════════════════════════════════════════════════════
// 4. WHATSAPP MESSAGES  (wa_incoming_messages → whatsapp_messages)
// ════════════════════════════════════════════════════════════════════════════════
async function syncWhatsappMessages() {
  log("\n💬  Sinkronisasi WhatsApp Messages...");
  type SupaWA = {
    id: number; sender: string | null; sender_name: string | null;
    message: string | null; message_type: string | null;
    is_read: boolean | null; raw_payload: unknown;
    received_at: string | null; created_at: string | null;
  };

  const rows = await fetchAll<SupaWA>("wa_incoming_messages");
  if (!rows.length) { warn("wa_incoming_messages", "tidak ada data"); return; }

  let count = 0;
  for (const m of rows) {
    const sender = m.sender ?? "unknown";
    const body   = m.message ?? "";
    const ts     = safeDate(m.received_at ?? m.created_at) ?? new Date().toISOString();

    try {
      await q(`
        INSERT INTO whatsapp_messages
          (company_id, "from", sender_phone, sender_name, body, message_text,
           message_type, direction, raw_payload, "timestamp", processed,
           ai_processed, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'inbound',$8,$9,$10,false,$11)
        ON CONFLICT DO NOTHING
      `, [
        "default",
        sender,
        sender,
        m.sender_name ?? null,
        body,
        body,
        m.message_type ?? "text",
        m.raw_payload ? JSON.stringify(m.raw_payload) : null,
        ts,
        m.is_read ?? false,
        ts,
      ]);
      count++;
    } catch (e: unknown) {
      errors++;
      log(`  ❌  WA msg ${m.id}: ${(e as Error).message}`);
    }
  }
  ok("whatsapp_messages", count);
}

// ════════════════════════════════════════════════════════════════════════════════
// 5. ADMIN NOTIFICATIONS  (admin_notifications → admin_notifications)
// ════════════════════════════════════════════════════════════════════════════════
async function syncAdminNotifications() {
  log("\n🔔  Sinkronisasi Admin Notifications...");
  type SupaNotif = {
    id: number; type: string | null; order_number: string | null;
    customer_name: string | null; company_name: string | null;
    payload: Record<string, unknown> | null;
    read_at: string | null; created_at: string | null;
  };

  const rows = await fetchAll<SupaNotif>("admin_notifications");
  if (!rows.length) { warn("admin_notifications", "tidak ada data"); return; }

  let count = 0;
  for (const n of rows) {
    const title = n.order_number
      ?? (n.payload as Record<string, unknown>)?.orderNumber as string
      ?? `Notifikasi ${n.type ?? "sistem"}`;

    const body = n.payload
      ? `${n.customer_name ? "Customer: " + n.customer_name + ". " : ""}${JSON.stringify(n.payload).slice(0, 500)}`
      : `${n.type ?? ""} - ${n.customer_name ?? ""}`;

    try {
      await q(`
        INSERT INTO admin_notifications
          (company_id, type, title, body, customer_name, is_read, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT DO NOTHING
      `, [
        "default",
        n.type ?? "info",
        title,
        body,
        n.customer_name ?? null,
        n.read_at !== null,
        safeDate(n.created_at) ?? new Date().toISOString(),
      ]);
      count++;
    } catch (e: unknown) {
      errors++;
      log(`  ❌  notif ${n.id}: ${(e as Error).message}`);
    }
  }
  ok("admin_notifications", count);
}

// ════════════════════════════════════════════════════════════════════════════════
// 6. ACTIVITY LOGS  (activity_logs → activity)
// ════════════════════════════════════════════════════════════════════════════════
async function syncActivityLogs() {
  log("\n📊  Sinkronisasi Activity Logs...");
  type SupaActivity = {
    id: number; action: string | null; description: string | null;
    order_id: number | null; actor_name: string | null;
    created_at: string | null;
  };

  const rows = await fetchAll<SupaActivity>("activity_logs");
  if (!rows.length) { warn("activity_logs", "tidak ada data"); return; }

  let count = 0;
  for (const a of rows) {
    const desc = a.description
      ?? `${a.actor_name ?? "System"} ${a.action ?? "melakukan aksi"}`;
    try {
      await q(`
        INSERT INTO activity (type, description, entity_id, created_at)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT DO NOTHING
      `, [
        a.action ?? "event",
        desc,
        a.order_id ?? null,
        safeDate(a.created_at) ?? new Date().toISOString(),
      ]);
      count++;
    } catch (e: unknown) {
      errors++;
      log(`  ❌  activity ${a.id}: ${(e as Error).message}`);
    }
  }
  ok("activity", count);
}

// ════════════════════════════════════════════════════════════════════════════════
// 7. WHATSAPP NOTIFICATION LOGS  (notification_logs → whatsapp_notifications)
// ════════════════════════════════════════════════════════════════════════════════
async function syncNotificationLogs() {
  log("\n📨  Sinkronisasi Notification Logs (WA)...");
  type SupaNotifLog = {
    id: number; channel: string | null; recipient: string | null;
    message: string | null; status: string | null;
    error_msg: string | null; created_at: string | null;
  };

  // Hanya sync notifikasi WhatsApp
  const rows = await fetchAll<SupaNotifLog>("notification_logs", "&channel=eq.wa");
  if (!rows.length) { warn("notification_logs", "tidak ada data WA"); return; }

  let count = 0;
  for (const n of rows) {
    const status = n.status === "sent" ? "sent" : n.status === "failed" ? "failed" : "pending";
    try {
      await q(`
        INSERT INTO whatsapp_notifications
          (company_id, recipient_phone, recipient_type, message_text, status,
           error_message, sent_at, created_at)
        VALUES ($1,$2,'customer',$3,$4,$5,$6,$7)
        ON CONFLICT DO NOTHING
      `, [
        "default",
        n.recipient ?? "unknown",
        n.message ?? "",
        status,
        n.error_msg ?? null,
        status === "sent" ? (safeDate(n.created_at) ?? new Date().toISOString()) : null,
        safeDate(n.created_at) ?? new Date().toISOString(),
      ]);
      count++;
    } catch (e: unknown) {
      errors++;
      log(`  ❌  notif_log ${n.id}: ${(e as Error).message}`);
    }
  }
  ok("whatsapp_notifications (WA logs)", count);
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("🚀  Mulai sinkronisasi data dari Supabase → Replit Postgres\n");
  console.log(`🔗  Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`🗄️   Replit DB: ${process.env.DATABASE_URL?.split("@")[1] ?? "configured"}`);

  const start = Date.now();

  try {
    await syncCompanySettings();
    await syncUsers();
    await syncCustomers();
    await syncWhatsappMessages();
    await syncAdminNotifications();
    await syncActivityLogs();
    await syncNotificationLogs();
  } catch (e) {
    console.error("\n💥  Error fatal:", e);
  } finally {
    await pool.end();
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${"─".repeat(50)}`);
  console.log(`✅  Selesai dalam ${elapsed}s`);
  console.log(`   • Tersinkronisasi : ${synced} baris`);
  console.log(`   • Di-skip         : ${skipped} peringatan`);
  console.log(`   • Error           : ${errors}`);
  console.log("─".repeat(50));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
