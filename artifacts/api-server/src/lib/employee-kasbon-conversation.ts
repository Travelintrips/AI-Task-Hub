import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";
import { sendEmployeeKasbonWa } from "./employee-kasbon-wa-gateway";
import { queueEmployeeKasbonOwnerApproval } from "./employee-kasbon-owner-flow";

const FLOW_KIND = "employee_kasbon_conversation_v1";

type Step =
  | "employee_name"
  | "amount"
  | "purpose"
  | "needed_date"
  | "repayment_method"
  | "installment_amount"
  | "queued";

type ConversationMeta = {
  kind: typeof FLOW_KIND;
  step: Step;
  fields: Record<string, unknown>;
  lastInboundId?: string | null;
};

function supabase(): SupabaseClient {
  if (process.env.NODE_ENV === "production") throw new Error("KASBON_CONVERSATION_PROD_DISABLED");
  const url = process.env.SUPABASE_URL_DEV?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV?.trim();
  if (!url || !key) throw new Error("KASBON_CONVERSATION_SUPABASE_MISSING");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function normalizePhone(raw: unknown): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  if (digits.startsWith("8")) digits = "62" + digits;
  return digits;
}

function phoneVariants(raw: string): Set<string> {
  const n = normalizePhone(raw);
  const out = new Set<string>();
  if (n) out.add(n);
  if (n.startsWith("62")) out.add("0" + n.slice(2));
  return out;
}

function isStart(text: string): boolean {
  return /\b(kasbon|cash\s*advance|uang\s*muka)\b/i.test(text);
}

function parseAmount(text: string): number | null {
  const cleaned = text.toLowerCase().replace(/rp/g, "").replace(/\./g, "").replace(/,/g, "").replace(/[^0-9]/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function todayJakarta(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function parseDate(text: string): string | null {
  if (/hari\s*ini/i.test(text)) return todayJakarta();
  const iso = text.match(/\b(20\d\d)-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/);
  return iso?.[0] ?? null;
}

function parseRepayment(text: string): "Potong Penuh" | "Cicilan" | null {
  if (/cicil/i.test(text)) return "Cicilan";
  if (/penuh|potong\s*penuh|sekali/i.test(text)) return "Potong Penuh";
  return null;
}

function prompt(step: Step): string {
  switch (step) {
    case "employee_name": return "Baik. Siapa nama karyawan yang mengajukan kasbon? Mohon tulis nama sesuai data karyawan di BizPortal.";
    case "amount": return "Berapa nominal kasbon yang diajukan? Contoh: Rp500.000.";
    case "purpose": return "Kasbon tersebut untuk keperluan apa?";
    case "needed_date": return "Kapan kasbon dibutuhkan? Balas *hari ini* atau tanggal format YYYY-MM-DD.";
    case "repayment_method": return "Cara pengembaliannya bagaimana? Balas *Potong Penuh* atau *Cicilan*.";
    case "installment_amount": return "Berapa nominal cicilan per periode? Contoh: Rp500.000.";
    default: return "Data kasbon sedang diproses.";
  }
}

async function activeEmployeeName(client: SupabaseClient, phone: string): Promise<string | null> {
  const variants = phoneVariants(phone);
  const { data, error } = await client.from("employees")
    .select("first_name,last_name,phone,status,deleted_at")
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(500);
  if (error) throw new Error(`KASBON_CONVERSATION_EMPLOYEE_READ_FAILED:${error.code ?? "UNKNOWN"}`);
  const matches = (data ?? []).filter((row) => variants.has(normalizePhone(row.phone)));
  if (matches.length !== 1) return null;
  return `${String(matches[0]!.first_name ?? "").trim()} ${String(matches[0]!.last_name ?? "").trim()}`.trim();
}

async function sendReply(phone: string, taskNumber: string, step: Step, message: string): Promise<void> {
  await sendEmployeeKasbonWa({
    to: phone,
    text: message,
    idempotencyKey: `kasbon-conv-${taskNumber}-${step}`,
  });
}

export async function handleEmployeeKasbonConversationInbound(input: {
  phone: string;
  text: string;
  inboundId?: string | null;
  companyId?: string;
}): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return false;
  const text = input.text.trim();
  if (!text) return false;
  const phone = normalizePhone(input.phone);
  if (!phone) return false;
  const companyId = input.companyId ?? "default";
  const client = supabase();

  const { data: rows, error: findError } = await client.from("ai_tasks")
    .select("id,task_number,admin_notes,required_action,status")
    .eq("source", "employee_kasbon_conversation")
    .eq("customer_phone", phone)
    .in("status", ["new_inquiry", "in_progress"])
    .order("id", { ascending: false })
    .limit(1);
  if (findError) throw new Error(`KASBON_CONVERSATION_TASK_READ_FAILED:${findError.code ?? "UNKNOWN"}`);

  let task = rows?.[0] ?? null;
  let meta: ConversationMeta | null = null;
  if (task?.admin_notes) {
    try {
      const parsed = JSON.parse(task.admin_notes) as ConversationMeta;
      if (parsed?.kind === FLOW_KIND) meta = parsed;
    } catch { /* ignore malformed old note */ }
  }

  if (!task || !meta) {
    if (!isStart(text)) return false;
    const employeeName = await activeEmployeeName(client, phone);
    const step: Step = employeeName ? "amount" : "employee_name";
    const fields: Record<string, unknown> = employeeName ? { employee_name: employeeName } : {};
    const taskNumber = `KASBON-WA-${Date.now()}`;
    meta = { kind: FLOW_KIND, step, fields, lastInboundId: input.inboundId ?? null };
    const { data: created, error } = await client.from("ai_tasks").insert({
      company_id: companyId,
      task_number: taskNumber,
      source: "employee_kasbon_conversation",
      customer_name: employeeName,
      customer_phone: phone,
      title: `Pengajuan Kasbon Karyawan — ${taskNumber}`,
      description: "Pengajuan kasbon melalui WhatsApp AI Task",
      category: "Finance",
      priority: "medium",
      status: "in_progress",
      ai_intent: "permintaan_kasbon",
      required_action: `waiting_${step}`,
      admin_notes: JSON.stringify(meta),
      last_customer_reply_at: new Date().toISOString(),
    }).select("id,task_number,admin_notes,required_action,status").single();
    if (error || !created) throw new Error(`KASBON_CONVERSATION_TASK_CREATE_FAILED:${error?.code ?? "UNKNOWN"}`);
    task = created;
    await sendReply(phone, taskNumber, step, prompt(step));
    logger.info({ taskId: task.id, phoneSuffix: phone.slice(-4), step }, "employee-kasbon conversation started");
    return true;
  }

  if (input.inboundId && meta.lastInboundId === input.inboundId) return true;
  const fields = { ...(meta.fields ?? {}) };
  let next: Step = meta.step;

  switch (meta.step) {
    case "employee_name": {
      if (text.length < 2) { await sendReply(phone, task.task_number, meta.step, prompt(meta.step)); return true; }
      fields.employee_name = text;
      next = "amount";
      break;
    }
    case "amount": {
      const amount = parseAmount(text);
      if (!amount) { await sendReply(phone, task.task_number, meta.step, "Nominal belum terbaca. Mohon kirim angka, contoh *Rp500.000*."); return true; }
      fields.amount = amount;
      next = "purpose";
      break;
    }
    case "purpose":
      fields.purpose = text;
      next = "needed_date";
      break;
    case "needed_date": {
      const date = parseDate(text);
      if (!date) { await sendReply(phone, task.task_number, meta.step, "Tanggal belum terbaca. Balas *hari ini* atau format *YYYY-MM-DD*."); return true; }
      fields.needed_date = date;
      next = "repayment_method";
      break;
    }
    case "repayment_method": {
      const repayment = parseRepayment(text);
      if (!repayment) { await sendReply(phone, task.task_number, meta.step, "Pilih cara pengembalian: *Potong Penuh* atau *Cicilan*."); return true; }
      fields.repayment_method = repayment;
      next = repayment === "Cicilan" ? "installment_amount" : "queued";
      break;
    }
    case "installment_amount": {
      const amount = parseAmount(text);
      if (!amount) { await sendReply(phone, task.task_number, meta.step, "Nominal cicilan belum terbaca. Contoh *Rp500.000*."); return true; }
      fields.installment_amount = amount;
      next = "queued";
      break;
    }
    case "queued":
      return true;
  }

  const updatedMeta: ConversationMeta = { ...meta, fields, step: next, lastInboundId: input.inboundId ?? null };
  const { error: updateError } = await client.from("ai_tasks").update({
    customer_name: typeof fields.employee_name === "string" ? fields.employee_name : null,
    required_action: next === "queued" ? "preparing_owner_approval" : `waiting_${next}`,
    admin_notes: JSON.stringify(updatedMeta),
    last_customer_reply_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", task.id);
  if (updateError) throw new Error(`KASBON_CONVERSATION_TASK_UPDATE_FAILED:${updateError.code ?? "UNKNOWN"}`);

  if (next !== "queued") {
    await sendReply(phone, task.task_number, next, prompt(next));
    return true;
  }

  const queued = await queueEmployeeKasbonOwnerApproval({
    taskId: Number(task.id),
    companyId,
    requesterPhone: phone,
    fields,
  });
  if (!queued.queued) {
    await sendReply(phone, task.task_number, "queued", "Data kasbon sudah lengkap, tetapi pengajuan belum dapat diteruskan ke owner. Tim akan memeriksa konfigurasi owner.");
    throw new Error(`KASBON_CONVERSATION_OWNER_QUEUE_FAILED:${queued.reason ?? "UNKNOWN"}`);
  }
  await sendReply(phone, task.task_number, "queued", "✅ Data pengajuan kasbon sudah lengkap dan telah diteruskan ke owner untuk persetujuan. Anda akan menerima kabar setelah diproses.");
  return true;
}
