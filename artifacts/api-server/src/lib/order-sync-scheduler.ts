import { db, aiTasksTable, activityTable, adminNotificationsTable, taskCommentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { emitSseEvent } from "./sse";
import { logger } from "./logger";

// ─── Konfigurasi ────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 30 * 1000; // cek order baru tiap 30 detik
const PAGE_SIZE = 500; // ukuran halaman saat menarik order dari Supabase
const COMPANY_ID = "default";

const SUPA_URL = process.env.SUPABASE_URL ?? "";
const SUPA_BASE = SUPA_URL ? `${SUPA_URL}/rest/v1` : "";
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const supaHeaders = {
  apikey: SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  "Content-Type": "application/json",
};

// ─── Tipe baris logistic_orders (subset yang dipakai) ─────────────────────────────
interface LogisticOrder {
  id: number;
  order_number: string | null;
  company_name: string | null;
  customer_name: string | null;
  phone: string | null;
  shipment_type: string | null;
  transport_mode: string | null;
  order_type: string | null;
  origin: string | null;
  destination: string | null;
  commodity: string | null;
  cargo_description: string | null;
  notes: string | null;
  grand_total: number | string | null;
  final_price: number | string | null;
  final_selling_price: number | string | null;
  status: string | null;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ─── Pemetaan status order → status ai_task ───────────────────────────────────────
function mapStatus(orderStatus: string | null): string {
  switch ((orderStatus ?? "").toLowerCase()) {
    case "order received":
      return "new_inquiry";
    case "admin review":
      return "ready_for_review";
    case "vendor confirmed":
      return "assigned";
    case "in progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return "new_inquiry";
  }
}

// ─── Pemetaan balik: status ai_task → status logistic_orders ─────────────────────
function mapReplitStatusToOrder(replitStatus: string): string | null {
  switch (replitStatus) {
    case "new_inquiry":
      return "Order Received";
    case "waiting_documents":
    case "documents_received":
    case "audit_in_progress":
    case "missing_data":
    case "ready_for_review":
    case "quotation_ready":
      return "Admin Review";
    case "assigned":
      return "Vendor Confirmed";
    case "in_progress":
    case "waiting_customer":
    case "waiting_vendor":
    case "approved_by_customer":
      return "In Progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return null; // status tidak dikenali — jangan push
  }
}

// ─── Push perubahan status dari Replit → Supabase logistic_orders ─────────────────
// Dipanggil dari route PATCH /ai-tasks/:id setelah status berhasil diubah.
// task_number harus sama dengan order_number di logistic_orders (dedup key).
// Juga mencatat ke ai_task_sync_log di Supabase.
export async function pushStatusToSupabase(
  taskNumber: string,
  oldStatus: string,
  newStatus: string,
): Promise<void> {
  if (!SUPA_BASE || !SUPA_KEY) return;

  const orderStatus = mapReplitStatusToOrder(newStatus);
  if (!orderStatus) {
    logger.warn({ taskNumber, newStatus }, "pushStatusToSupabase: status tidak dipetakan, dilewati");
    return;
  }

  // Hindari infinite loop: jangan push kalau status order sudah sama
  // (bisa terjadi saat Supabase → Replit sync baru saja berjalan)
  try {
    const checkUrl = `${SUPA_BASE}/logistic_orders?order_number=eq.${encodeURIComponent(taskNumber)}&select=status&limit=1`;
    const checkRes = await fetch(checkUrl, { headers: supaHeaders });
    if (checkRes.ok) {
      const rows = await checkRes.json() as Array<{ status: string | null }>;
      if (rows.length > 0 && rows[0].status === orderStatus) {
        logger.debug({ taskNumber, orderStatus }, "pushStatusToSupabase: status sudah sinkron, dilewati");
        return;
      }
    }
  } catch {
    // lanjut meski cek gagal
  }

  // PATCH ke logistic_orders
  const patchUrl = `${SUPA_BASE}/logistic_orders?order_number=eq.${encodeURIComponent(taskNumber)}`;
  const patchRes = await fetch(patchUrl, {
    method: "PATCH",
    headers: { ...supaHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ status: orderStatus, updated_at: new Date().toISOString() }),
  });

  if (!patchRes.ok) {
    const body = await patchRes.text();
    logger.error(
      { taskNumber, orderStatus, status: patchRes.status, body: body.slice(0, 200) },
      "pushStatusToSupabase: PATCH logistic_orders gagal",
    );
    return;
  }

  // Catat ke ai_task_sync_log
  try {
    const logUrl = `${SUPA_BASE}/ai_task_sync_log`;
    await fetch(logUrl, {
      method: "POST",
      headers: { ...supaHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        order_number: taskNumber,
        old_status: mapReplitStatusToOrder(oldStatus) ?? oldStatus,
        new_status: orderStatus,
        source: "replit",
        notes: `Replit status: ${oldStatus} → ${newStatus}`,
      }),
    });
  } catch (err) {
    logger.warn({ err }, "pushStatusToSupabase: gagal catat ke ai_task_sync_log");
  }

  logger.info({ taskNumber, orderStatus, oldStatus, newStatus }, "Status task dipush ke Supabase logistic_orders");
}

function pickAmount(o: LogisticOrder): string | null {
  const v = o.grand_total ?? o.final_price ?? o.final_selling_price;
  if (v === null || v === undefined) return null;
  return String(v);
}

function buildTitle(o: LogisticOrder): string {
  if (o.order_type === "product") {
    return `Pesanan Produk ${o.order_number ?? o.id}`;
  }
  const route =
    o.origin && o.destination ? `${o.origin} → ${o.destination}` : o.commodity ?? "Pengiriman baru";
  return `Pengiriman ${route}`;
}

function buildDescription(o: LogisticOrder): string {
  const parts: string[] = [];
  if (o.company_name) parts.push(`Perusahaan: ${o.company_name}`);
  if (o.shipment_type) parts.push(`Jenis: ${o.shipment_type}`);
  if (o.transport_mode) parts.push(`Moda: ${o.transport_mode}`);
  if (o.origin || o.destination) parts.push(`Rute: ${o.origin ?? "-"} → ${o.destination ?? "-"}`);
  if (o.commodity) parts.push(`Komoditas: ${o.commodity}`);
  if (o.cargo_description) parts.push(`Kargo: ${o.cargo_description}`);
  if (o.notes) parts.push(`Catatan: ${o.notes}`);
  return parts.join("\n") || "Order otomatis dari sistem logistik.";
}

function buildCategory(o: LogisticOrder): string {
  if (o.order_type === "product") return "Produk";
  return o.transport_mode || o.shipment_type || "Logistik";
}

// ─── Ambil order dari Supabase (REST), dengan pagination penuh ────────────────────
// Diurutkan id.asc dan ditarik semua halaman sebelum cursor dimajukan, sehingga
// tidak ada order yang terlewat walau lebih dari satu halaman berubah.
async function fetchOrders(sinceIso: string | null): Promise<LogisticOrder[]> {
  const all: LogisticOrder[] = [];
  let offset = 0;

  // Filter waktu: updated_at >= since ATAU created_at >= since (nilai di-URL-encode
  // agar "+00:00" tidak salah-parse menjadi spasi oleh PostgREST).
  let filter = "";
  if (sinceIso) {
    const enc = encodeURIComponent(sinceIso);
    filter = `&or=(updated_at.gte.${enc},created_at.gte.${enc})`;
  }

  for (;;) {
    const url = `${SUPA_BASE}/logistic_orders?order=id.asc&limit=${PAGE_SIZE}&offset=${offset}${filter}`;
    const r = await fetch(url, { headers: supaHeaders });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`fetch logistic_orders ${r.status}: ${body.slice(0, 160)}`);
    }
    const page = (await r.json()) as LogisticOrder[];
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

// ─── Buat ai_task baru dari order + push real-time ────────────────────────────────
// Semua tulisan dibungkus transaksi agar tidak ada partial-write; SSE di-emit
// setelah commit. Mengembalikan id task yang dibuat untuk update peta dedup.
async function createTaskFromOrder(o: LogisticOrder): Promise<number> {
  const taskNumber = o.order_number ?? `LOG-${o.id}`;
  const title = buildTitle(o);
  const status = mapStatus(o.status);
  const category = buildCategory(o);
  const amount = pickAmount(o);

  const { taskId, notifId } = await db.transaction(async (tx) => {
    const [task] = await tx
      .insert(aiTasksTable)
      .values({
        companyId: COMPANY_ID,
        taskNumber,
        source: o.source || "portal",
        customerName: o.customer_name,
        customerPhone: o.phone,
        title,
        description: buildDescription(o),
        category,
        division: o.transport_mode ?? null,
        priority: "medium",
        status,
        quotationAmount: amount,
        aiSummary: `Order ${taskNumber} masuk otomatis dari sistem logistik (${o.source ?? "portal"}).`,
        aiIntent: o.order_type === "product" ? "order_product" : "order_shipment",
      })
      .returning();

    await tx.insert(taskCommentsTable).values({
      taskId: task.id,
      senderType: "system",
      senderName: "AI System",
      comment: `📦 Order *${taskNumber}* otomatis masuk dari sistem logistik.${
        amount ? `\n💰 Nilai: Rp ${Number(amount).toLocaleString("id-ID")}` : ""
      }`,
    });

    const [notif] = await tx
      .insert(adminNotificationsTable)
      .values({
        companyId: COMPANY_ID,
        type: "new_inquiry",
        title: `📦 Order baru: ${title}`,
        body: `${category} · Status: ${status}${o.customer_name ? ` · ${o.customer_name}` : ""}`,
        taskId: task.id,
        customerPhone: o.phone ?? null,
        customerName: o.customer_name ?? null,
      })
      .returning();

    await tx.insert(activityTable).values({
      type: "task_created",
      description: `Order ${taskNumber} masuk otomatis — ${category} (${status}) — ${title}`,
      entityId: task.id,
    });

    return { taskId: task.id, notifId: notif.id };
  });

  emitSseEvent(
    "new_task",
    {
      taskId,
      taskNumber,
      title,
      category,
      priority: "medium",
      status,
      customerName: o.customer_name ?? null,
      customerPhone: o.phone ?? null,
      notifId,
      notifType: "new_inquiry",
    },
    COMPANY_ID,
  );

  logger.info({ taskId, taskNumber, status }, "Order otomatis → ai_task dibuat");
  return taskId;
}

// ─── Update status task bila status order berubah + push real-time ────────────────
async function updateTaskStatus(
  taskId: number,
  taskNumber: string,
  newStatus: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(aiTasksTable).set({ status: newStatus }).where(eq(aiTasksTable.id, taskId));
    await tx.insert(activityTable).values({
      type: "task_updated",
      description: `Status order ${taskNumber} diperbarui menjadi "${newStatus}" (sinkron otomatis)`,
      entityId: taskId,
    });
  });

  emitSseEvent("task_updated", { taskId, taskNumber, status: newStatus }, COMPANY_ID);
  logger.info({ taskId, taskNumber, newStatus }, "Status task disinkron dari order");
}

// ─── Satu siklus rekonsiliasi ─────────────────────────────────────────────────────
let lastSyncIso: string | null = null;
let isSyncing = false; // guard agar tidak ada dua siklus berjalan bersamaan

async function runOrderSync(): Promise<void> {
  if (!SUPA_BASE || !SUPA_KEY) return;
  if (isSyncing) return; // lewati bila siklus sebelumnya belum selesai
  isSyncing = true;
  try {
    await runOrderSyncInner();
  } finally {
    isSyncing = false;
  }
}

async function runOrderSyncInner(): Promise<void> {
  const orders = await fetchOrders(lastSyncIso);
  if (orders.length === 0) return;

  // Peta task yang sudah ada: task_number → { id, status }
  const existing = await db
    .select({
      id: aiTasksTable.id,
      taskNumber: aiTasksTable.taskNumber,
      status: aiTasksTable.status,
    })
    .from(aiTasksTable);

  const byNumber = new Map(existing.filter((t) => t.taskNumber).map((t) => [t.taskNumber as string, t]));

  let created = 0;
  let updated = 0;
  let maxIso = lastSyncIso;

  for (const o of orders) {
    const taskNumber = o.order_number ?? `LOG-${o.id}`;
    const match = byNumber.get(taskNumber);

    if (!match) {
      const newId = await createTaskFromOrder(o);
      // Update peta agar order_number duplikat dalam batch yang sama tidak dobel.
      byNumber.set(taskNumber, { id: newId, taskNumber, status: mapStatus(o.status) });
      created++;
    } else {
      const mapped = mapStatus(o.status);
      if (mapped !== match.status) {
        await updateTaskStatus(match.id, taskNumber, mapped);
        match.status = mapped;
        updated++;
      }
    }

    const stamp = o.updated_at ?? o.created_at;
    if (stamp && (!maxIso || stamp > maxIso)) maxIso = stamp;
  }

  if (maxIso) lastSyncIso = maxIso;
  if (created || updated) {
    logger.info({ created, updated }, "Sinkronisasi order → ai_task selesai");
  }
}

// ─── Starter ─────────────────────────────────────────────────────────────────────
let schedulerRunning = false;

export function startOrderSyncScheduler(): void {
  if (schedulerRunning) return;
  if (!SUPA_BASE || !SUPA_KEY) {
    logger.warn("Order sync scheduler tidak aktif — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set");
    return;
  }
  schedulerRunning = true;

  // Rekonsiliasi penuh saat startup (impor semua order yang belum jadi task),
  // lalu lanjut polling inkremental.
  runOrderSync().catch((err) => logger.error({ err }, "Order sync (startup) gagal"));

  setInterval(() => {
    runOrderSync().catch((err) => logger.error({ err }, "Order sync scheduler error"));
  }, POLL_INTERVAL_MS);

  logger.info(`Order sync scheduler started (interval: ${POLL_INTERVAL_MS / 1000}s)`);
}
