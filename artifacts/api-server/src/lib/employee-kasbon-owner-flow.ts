import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

const FLOW_KIND = "employee_kasbon_owner_wa_v1";
const WAITING_ACTION = "employee_kasbon_owner_ok";
const WAITING_STATE = "waiting_owner_ok";
const RECORDED_STATE = "recorded_waiting_disbursement";
const PENDING_BIZPORTAL_STATE = "owner_approved_pending_bizportal";

type KasbonMeta = {
  kind: typeof FLOW_KIND;
  state: string;
  requesterPhone: string;
  ownerPhone: string;
  ownerName: string | null;
  fields: Record<string, unknown>;
  queuedAt: string;
  approvedAt?: string;
  approvedByPhone?: string;
  approvedByName?: string | null;
  bizportalAdvanceId?: number;
  bizportalAdvanceNumber?: string;
  approvedNotifyPhone?: string | null;
  approvedNotifySentAt?: string | null;
  lastError?: string | null;
};

type QueueInput = {
  taskId: number;
  companyId: string;
  requesterPhone: string;
  fields: Record<string, unknown>;
  fonnteDevice?: string | null;
};

type HandleInput = {
  phone: string;
  text: string;
  companyId: string;
  fonnteDevice?: string | null;
};

type Owner = {
  id: number;
  name: string | null;
  phone: string;
  companyId: string;
};

let devClient: SupabaseClient | null = null;

function getDevSupabase(): SupabaseClient {
  if (process.env.NODE_ENV === "production") {
    throw new Error("KASBON_OWNER_FLOW_PROD_DISABLED");
  }
  if (devClient) return devClient;
  const url = process.env.SUPABASE_URL_DEV?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV?.trim();
  if (!url || !key) throw new Error("KASBON_DEV_SUPABASE_NOT_CONFIGURED");
  devClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return devClient;
}

function normalizePhone(raw: unknown): string {
  let n = String(raw ?? "").replace(/\D/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  if (n.startsWith("8") && n.length >= 9) n = "62" + n;
  return n;
}

function phoneVariants(raw: string): string[] {
  const n = normalizePhone(raw);
  const out = new Set<string>();
  if (n) out.add(n);
  if (n.startsWith("62")) {
    out.add("0" + n.slice(2));
    out.add(n.slice(2));
  }
  return [...out];
}

function parseMeta(raw: unknown): KasbonMeta | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<KasbonMeta>;
    return parsed.kind === FLOW_KIND && typeof parsed.state === "string"
      ? (parsed as KasbonMeta)
      : null;
  } catch {
    return null;
  }
}

function money(raw: unknown): number | null {
  const cleaned = String(raw ?? "").replace(/[^0-9]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function dateOnly(raw: unknown): string {
  const value = String(raw ?? "").trim();
  return /^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)
    ? value
    : new Date().toISOString().slice(0, 10);
}

function fieldText(fields: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = String(fields[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function idr(value: number): string {
  return "Rp " + new Intl.NumberFormat("id-ID").format(value);
}

async function sendKasbonMessage(
  phone: string,
  message: string,
  _legacyDevice?: string | null,
): Promise<void> {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.EMPLOYEE_KASBON_NOTIFICATION_DRY_RUN === "true"
  ) {
    logger.info(
      { phoneSuffix: normalizePhone(phone).slice(-4), messagePreview: message.slice(0, 100) },
      "employee-kasbon: DEV dry-run notification",
    );
    return;
  }
  const { sendEmployeeKasbonWa } = await import("./employee-kasbon-wa-gateway");
  await sendEmployeeKasbonWa({ to: phone, text: message });
}

export function isOwnerKasbonApprovalReply(text: string): boolean {
  return text.trim().toLowerCase() === "ok";
}

function buildOwnerRequest(taskNumber: string, fields: Record<string, unknown>): string {
  const amount = money(fields.amount);
  const employee = fieldText(fields, "employee_name", "employee", "name") || "-";
  const purpose = fieldText(fields, "purpose") || "-";
  const neededDate = fieldText(fields, "needed_date") || "-";
  const repay = fieldText(fields, "repayment_method") || "Potong Penuh";
  const installment = money(fields.installment_amount);
  return [
    "💰 *PENGAJUAN KASBON KARYAWAN*",
    "",
    `No. Pengajuan: *${taskNumber}*`,
    `Karyawan: *${employee}*`,
    `Nominal: *${amount ? idr(amount) : "-"}*`,
    `Keperluan: ${purpose}`,
    `Tanggal dibutuhkan: ${neededDate}`,
    `Pengembalian: ${repay}${installment ? ` — ${idr(installment)}/periode` : ""}`,
    "",
    "Balas *OK* pada WhatsApp ini untuk menyetujui pengajuan kasbon tersebut.",
    "_Persetujuan ini khusus kasbon karyawan dan tidak memerlukan approval Super Admin tambahan._",
  ].join("\n");
}

function buildApprovedNotification(params: {
  taskNumber: string;
  advanceNumber: string;
  employeeName: string;
  amount: number;
  purpose: string;
  ownerName: string | null;
}): string {
  return [
    "✅ *KASBON KARYAWAN DISETUJUI OWNER*",
    "",
    `No. Pengajuan: *${params.taskNumber}*`,
    `No. Kasbon BizPortal: *${params.advanceNumber}*`,
    `Karyawan: *${params.employeeName}*`,
    `Nominal: *${idr(params.amount)}*`,
    `Keperluan: ${params.purpose || "-"}`,
    `Disetujui oleh: *${params.ownerName || "Owner"}*`,
    "",
    "*Status: Disetujui owner — menunggu pencairan.*",
  ].join("\n");
}

async function configuredOwners(companyId: string): Promise<Owner[]> {
  const envPhone = normalizePhone(process.env.EMPLOYEE_KASBON_OWNER_PHONE);
  if (envPhone) {
    return [{
      id: 0,
      name: process.env.EMPLOYEE_KASBON_OWNER_NAME?.trim() || "Owner",
      phone: envPhone,
      companyId,
    }];
  }

  const supabase = getDevSupabase();
  let query = supabase
    .from("team_members")
    .select("id,company_id,name,role,phone,is_active")
    .eq("is_active", true)
    .eq("role", "owner")
    .not("phone", "is", null)
    .limit(5);
  if (companyId !== "default") query = query.eq("company_id", companyId);
  const { data, error } = await query;
  if (error) throw new Error(`KASBON_OWNER_READ_FAILED:${error.code ?? "UNKNOWN"}`);
  return (data ?? [])
    .filter((row) => normalizePhone(row.phone).length >= 8)
    .map((row) => ({
      id: Number(row.id),
      name: row.name ? String(row.name) : null,
      phone: normalizePhone(row.phone),
      companyId: String(row.company_id ?? companyId),
    }));
}

async function ownerForSender(phone: string, companyId: string): Promise<Owner | null> {
  const sender = normalizePhone(phone);
  const owners = await configuredOwners(companyId);
  const matching = owners.filter((owner) => normalizePhone(owner.phone) === sender);
  return matching.length === 1 ? matching[0]! : null;
}

export async function queueEmployeeKasbonOwnerApproval(input: QueueInput): Promise<{
  queued: boolean;
  reason?: string;
}> {
  const supabase = getDevSupabase();
  const { data: task, error: taskError } = await supabase
    .from("ai_tasks")
    .select("id,task_number,admin_notes")
    .eq("id", input.taskId)
    .single();
  if (taskError || !task) return { queued: false, reason: "TASK_NOT_FOUND" };

  const existing = parseMeta(task.admin_notes);
  if (existing?.kind === FLOW_KIND) return { queued: true, reason: "ALREADY_QUEUED" };

  const owners = await configuredOwners(input.companyId);
  if (owners.length !== 1) {
    logger.warn(
      { taskId: input.taskId, companyId: input.companyId, ownerCount: owners.length },
      "employee-kasbon: owner resolution is not unique",
    );
    return { queued: false, reason: owners.length === 0 ? "OWNER_NOT_FOUND" : "OWNER_AMBIGUOUS" };
  }

  const owner = owners[0]!;
  const taskNumber = String(task.task_number || `TASK-${task.id}`);
  const meta: KasbonMeta = {
    kind: FLOW_KIND,
    state: WAITING_STATE,
    requesterPhone: normalizePhone(input.requesterPhone),
    ownerPhone: owner.phone,
    ownerName: owner.name,
    fields: input.fields,
    queuedAt: new Date().toISOString(),
    approvedNotifyPhone: normalizePhone(process.env.EMPLOYEE_KASBON_APPROVED_NOTIFY_PHONE) || null,
    approvedNotifySentAt: null,
  };

  const { error: updateError } = await supabase
    .from("ai_tasks")
    .update({
      status: "ready_for_review",
      required_action: WAITING_ACTION,
      admin_notes: JSON.stringify(meta),
      assigned_to: owner.name,
      assigned_to_id: owner.id || null,
      assigned_role: "owner",
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id);
  if (updateError) throw new Error(`KASBON_TASK_QUEUE_UPDATE_FAILED:${updateError.code ?? "UNKNOWN"}`);

  const { error: commentError } = await supabase.from("task_comments").insert({
    task_id: task.id,
    sender_type: "system",
    sender_name: "AI Task",
    comment: `Pengajuan kasbon diteruskan ke owner ${owner.name ?? owner.phone}; menunggu balasan OK.`,
  });
  if (commentError) {
    logger.warn({ taskId: task.id, code: commentError.code }, "employee-kasbon: queue comment failed");
  }

  await sendKasbonMessage(owner.phone, buildOwnerRequest(taskNumber, input.fields), input.fonnteDevice ?? null);
  return { queued: true };
}

async function createApprovedKasbon(params: {
  taskId: number;
  taskNumber: string;
  requesterPhone: string;
  fields: Record<string, unknown>;
  ownerName: string | null;
  ownerPhone: string;
}): Promise<{
  id: number;
  advanceNumber: string;
  employeeName: string;
  companyId: number;
  amount: number;
  purpose: string;
}> {
  const supabase = getDevSupabase();
  const amount = money(params.fields.amount);
  if (!amount) throw new Error("KASBON_AMOUNT_INVALID");

  const requestedName = fieldText(params.fields, "employee_name", "employee", "name");
  const purpose = fieldText(params.fields, "purpose");
  const requestedPhone = normalizePhone(
    fieldText(params.fields, "phone", "employee_phone") || params.requesterPhone,
  );
  const variants = new Set(phoneVariants(requestedPhone));

  const { data: employees, error: employeeError } = await supabase
    .from("employees")
    .select("id,company_id,first_name,last_name,phone,status,deleted_at")
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(500);
  if (employeeError) throw new Error(`KASBON_EMPLOYEE_READ_FAILED:${employeeError.code ?? "UNKNOWN"}`);

  const requestedNameNormalized = requestedName.trim().toLowerCase().replace(/\s+/g, " ");
  const matches = (employees ?? []).filter((employee) => {
    const employeePhone = normalizePhone(employee.phone);
    const phoneMatch = Boolean(employeePhone) && variants.has(employeePhone);
    const fullName = `${String(employee.first_name ?? "").trim()} ${String(employee.last_name ?? "").trim()}`
      .trim().toLowerCase().replace(/\s+/g, " ");
    const nameMatch = Boolean(requestedNameNormalized) && fullName === requestedNameNormalized;
    return phoneMatch || nameMatch;
  });
  if (matches.length !== 1) {
    throw new Error(matches.length === 0 ? "KASBON_EMPLOYEE_NOT_FOUND" : "KASBON_EMPLOYEE_AMBIGUOUS");
  }
  const employee = matches[0]!;

  const advanceNumber = `AIK-${params.taskNumber}`.slice(0, 96);
  const { data: existingRows, error: existingError } = await supabase
    .from("cash_advances")
    .select("id,advance_number,party_name,company_id,amount")
    .eq("advance_number", advanceNumber)
    .limit(1);
  if (existingError) throw new Error(`KASBON_EXISTING_READ_FAILED:${existingError.code ?? "UNKNOWN"}`);
  if ((existingRows ?? []).length === 1) {
    const row = existingRows![0]!;
    if (Number(row.amount) !== amount || Number(row.company_id) !== Number(employee.company_id)) {
      throw new Error("KASBON_IDEMPOTENCY_CONFLICT");
    }
    return {
      id: Number(row.id),
      advanceNumber: String(row.advance_number),
      employeeName: String(row.party_name),
      companyId: Number(row.company_id),
      amount,
      purpose,
    };
  }

  const repaymentRaw = fieldText(params.fields, "repayment_method").toLowerCase();
  const repaymentMethod = repaymentRaw.includes("cicil") ? "INSTALLMENT" : "ONE_TIME";
  const installmentAmount = repaymentMethod === "INSTALLMENT"
    ? money(params.fields.installment_amount)
    : null;
  if (repaymentMethod === "INSTALLMENT" && !installmentAmount) {
    throw new Error("KASBON_INSTALLMENT_AMOUNT_REQUIRED");
  }

  const employeeName =
    `${String(employee.first_name ?? "").trim()} ${String(employee.last_name ?? "").trim()}`.trim();
  const noteParts = [
    `AI Task ${params.taskNumber}`,
    "Persetujuan Owner via WhatsApp",
    purpose ? `Keperluan: ${purpose}` : "",
    fieldText(params.fields, "notes") ? `Catatan: ${fieldText(params.fields, "notes")}` : "",
  ].filter(Boolean);

  const payload = {
    company_id: Number(employee.company_id),
    advance_number: advanceNumber,
    type: "kasbon",
    advance_type: "EMPLOYEE",
    counterparty_type: "employee",
    party_name: employeeName,
    employee_id: Number(employee.id),
    amount,
    paid_amount: 0,
    settled_amount: 0,
    remaining_amount: amount,
    outstanding_amount: amount,
    payment_method: "bank",
    date: dateOnly(params.fields.needed_date),
    purpose: purpose || null,
    notes: noteParts.join(" | "),
    status: "active",
    lifecycle_status: "approved",
    approved_by: params.ownerName || params.ownerPhone,
    approved_at: new Date().toISOString(),
    currency: "IDR",
    source_system: "ai_task_owner_wa",
    repayment_method: repaymentMethod,
    installment_amount: installmentAmount,
    posting_status: "PENDING",
    reference_number: params.taskNumber,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("cash_advances")
    .insert(payload)
    .select("id,advance_number,party_name,company_id,amount")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced, error: racedError } = await supabase
        .from("cash_advances")
        .select("id,advance_number,party_name,company_id,amount")
        .eq("advance_number", advanceNumber)
        .single();
      if (!racedError && raced &&
          Number(raced.amount) === amount &&
          Number(raced.company_id) === Number(employee.company_id)) {
        return {
          id: Number(raced.id),
          advanceNumber: String(raced.advance_number),
          employeeName: String(raced.party_name),
          companyId: Number(raced.company_id),
          amount,
          purpose,
        };
      }
    }
    throw new Error(`KASBON_INSERT_FAILED:${insertError.code ?? "UNKNOWN"}`);
  }

  return {
    id: Number(inserted.id),
    advanceNumber: String(inserted.advance_number),
    employeeName: String(inserted.party_name),
    companyId: Number(inserted.company_id),
    amount,
    purpose,
  };
}

export async function tryHandleEmployeeKasbonOwnerApproval(input: HandleInput): Promise<boolean> {
  if (!isOwnerKasbonApprovalReply(input.text)) return false;

  const owner = await ownerForSender(input.phone, input.companyId);
  if (!owner) return false;

  const supabase = getDevSupabase();
  const { data: candidates, error: candidateError } = await supabase
    .from("ai_tasks")
    .select("id,task_number,admin_notes,required_action,updated_at")
    .eq("required_action", WAITING_ACTION)
    .order("updated_at", { ascending: false })
    .limit(5);
  if (candidateError) throw new Error(`KASBON_PENDING_TASK_READ_FAILED:${candidateError.code ?? "UNKNOWN"}`);

  const ownerPhone = normalizePhone(input.phone);
  const matching = (candidates ?? []).filter((task) => {
    const meta = parseMeta(task.admin_notes);
    return Boolean(meta && meta.state === WAITING_STATE && normalizePhone(meta.ownerPhone) === ownerPhone);
  });

  if (matching.length === 0) return false;
  if (matching.length > 1) {
    const refs = matching.map((task) => task.task_number || `TASK-${task.id}`).join(", ");
    await sendKasbonMessage(
      ownerPhone,
      `Ada lebih dari satu pengajuan kasbon menunggu persetujuan (${refs}). Mohon balas pada pesan pengajuan yang dimaksud agar approval tidak ambigu.`,
      input.fonnteDevice ?? null,
    );
    return true;
  }

  const task = matching[0]!;
  const meta = parseMeta(task.admin_notes)!;
  const taskNumber = String(task.task_number || `TASK-${task.id}`);
  const approvedAt = new Date().toISOString();

  let kasbon;
  try {
    kasbon = await createApprovedKasbon({
      taskId: Number(task.id),
      taskNumber,
      requesterPhone: meta.requesterPhone,
      fields: meta.fields,
      ownerName: owner.name ?? meta.ownerName,
      ownerPhone,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedMeta: KasbonMeta = {
      ...meta,
      state: PENDING_BIZPORTAL_STATE,
      approvedAt,
      approvedByPhone: ownerPhone,
      approvedByName: owner.name ?? meta.ownerName,
      lastError: message,
    };
    await supabase.from("ai_tasks").update({
      required_action: "employee_kasbon_bizportal_retry",
      admin_notes: JSON.stringify(failedMeta),
      updated_at: new Date().toISOString(),
    }).eq("id", task.id);
    await supabase.from("task_comments").insert({
      task_id: task.id,
      sender_type: "owner",
      sender_name: owner.name ?? "Owner",
      comment: `OK — owner menyetujui. Pencatatan BizPortal masih pending: ${message}`,
    });
    logger.error({ error, taskId: task.id }, "employee-kasbon: BizPortal write failed after owner approval");
    await sendKasbonMessage(
      ownerPhone,
      `✅ Persetujuan ${taskNumber} sudah diterima. Pencatatan ke BizPortal masih diproses menggunakan pengajuan yang sama; tidak perlu mengirim OK ulang.`,
      input.fonnteDevice ?? null,
    );
    return true;
  }

  const notifyPhone =
    normalizePhone(meta.approvedNotifyPhone) ||
    normalizePhone(process.env.EMPLOYEE_KASBON_APPROVED_NOTIFY_PHONE);
  let notifySentAt: string | null = meta.approvedNotifySentAt ?? null;

  if (notifyPhone && !notifySentAt) {
    try {
      await sendKasbonMessage(notifyPhone, buildApprovedNotification({
        taskNumber,
        advanceNumber: kasbon.advanceNumber,
        employeeName: kasbon.employeeName,
        amount: kasbon.amount,
        purpose: kasbon.purpose,
        ownerName: owner.name ?? meta.ownerName,
      }), input.fonnteDevice ?? null);
      notifySentAt = new Date().toISOString();
    } catch (error) {
      logger.warn({ error, taskId: task.id }, "employee-kasbon: approved target notification failed");
    }
  }

  const nextMeta: KasbonMeta = {
    ...meta,
    state: RECORDED_STATE,
    approvedAt,
    approvedByPhone: ownerPhone,
    approvedByName: owner.name ?? meta.ownerName,
    bizportalAdvanceId: kasbon.id,
    bizportalAdvanceNumber: kasbon.advanceNumber,
    approvedNotifyPhone: notifyPhone || null,
    approvedNotifySentAt: notifySentAt,
    lastError: null,
  };

  const { error: taskUpdateError } = await supabase.from("ai_tasks").update({
    status: "in_progress",
    required_action: "waiting_disbursement",
    admin_notes: JSON.stringify(nextMeta),
    updated_at: new Date().toISOString(),
  }).eq("id", task.id);
  if (taskUpdateError) throw new Error(`KASBON_TASK_FINAL_UPDATE_FAILED:${taskUpdateError.code ?? "UNKNOWN"}`);

  await supabase.from("task_comments").insert({
    task_id: task.id,
    sender_type: "owner",
    sender_name: owner.name ?? "Owner",
    comment: `OK — kasbon disetujui via WhatsApp dan tercatat di BizPortal sebagai ${kasbon.advanceNumber}. Status menunggu pencairan.`,
  });

  await sendKasbonMessage(
    ownerPhone,
    `✅ ${taskNumber} disetujui dan sudah tercatat di BizPortal sebagai *${kasbon.advanceNumber}*. Status: menunggu pencairan.`,
    input.fonnteDevice ?? null,
  ).catch((error) => logger.warn({ error, taskId: task.id }, "employee-kasbon: owner confirmation failed"));

  if (meta.requesterPhone) {
    await sendKasbonMessage(
      meta.requesterPhone,
      `✅ Pengajuan kasbon Anda telah disetujui owner dan tercatat di BizPortal dengan nomor *${kasbon.advanceNumber}*. Status saat ini: menunggu pencairan.`,
      input.fonnteDevice ?? null,
    ).catch((error) =>
      logger.warn({ error, taskId: task.id }, "employee-kasbon: requester notification failed"),
    );
  }

  if (!notifyPhone) {
    logger.warn({ taskId: task.id }, "employee-kasbon: approved notification phone is not configured");
  }
  return true;
}
