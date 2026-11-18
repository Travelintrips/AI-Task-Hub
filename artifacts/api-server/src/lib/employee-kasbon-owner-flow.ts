import { and, desc, eq } from "drizzle-orm";
import {
  aiTasksTable,
  db,
  taskCommentsTable,
  teamMembersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { sendFonnte } from "./fonnte";
import { resolveWaRole } from "./wa-role-resolver";
import { createClient } from "@supabase/supabase-js";

const FLOW_KIND = "employee_kasbon_owner_wa_v1";
const WAITING_ACTION = "employee_kasbon_owner_ok";
const WAITING_STATE = "waiting_owner_ok";
const RECORDED_STATE = "recorded_waiting_disbursement";

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
  fonnteDevice?: string | null,
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
  await sendKasbonMessage(phone, message, fonnteDevice ?? null);
}

export function isOwnerKasbonApprovalReply(text: string): boolean {
  return text.trim().toLowerCase() === "ok";
}

function buildOwnerRequest(taskNumber: string, fields: Record<string, unknown>): string {
  const amount = money(fields.amount);
  const employee = fieldText(fields, "employee_name", "employee", "name") || "-";
  const purpose = fieldText(fields, "purpose") || "-";
  const neededDate = fieldText(fields, "needed_date") || "-";
  const repay = fieldText(fields, "repayment_method") || "Potong penuh";
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

async function activeOwners(companyId: string) {
  let rows = await db
    .select({
      id: teamMembersTable.id,
      name: teamMembersTable.name,
      phone: teamMembersTable.phone,
      role: teamMembersTable.role,
      companyId: teamMembersTable.companyId,
    })
    .from(teamMembersTable)
    .where(and(
      eq(teamMembersTable.companyId, companyId),
      eq(teamMembersTable.role, "owner"),
      eq(teamMembersTable.isActive, true),
    ))
    .limit(3);

  // Older AI Task data often carries companyId="default". Only fall back when
  // exactly one active owner exists globally, so an ambiguous owner is never chosen.
  if (rows.length === 0 && companyId === "default") {
    rows = await db
      .select({
        id: teamMembersTable.id,
        name: teamMembersTable.name,
        phone: teamMembersTable.phone,
        role: teamMembersTable.role,
        companyId: teamMembersTable.companyId,
      })
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.role, "owner"), eq(teamMembersTable.isActive, true)))
      .limit(3);
  }
  const valid = rows.filter((row) => normalizePhone(row.phone).length >= 8);
  if (valid.length > 0) return valid;

  const envOwnerPhone = normalizePhone(process.env.EMPLOYEE_KASBON_OWNER_PHONE);
  if (envOwnerPhone) {
    return [{
      id: 0,
      name: process.env.EMPLOYEE_KASBON_OWNER_NAME?.trim() || "Owner",
      phone: envOwnerPhone,
      role: "owner",
      companyId,
    }];
  }
  return valid;
}

export async function queueEmployeeKasbonOwnerApproval(input: QueueInput): Promise<{
  queued: boolean;
  reason?: string;
}> {
  const taskRows = await db
    .select()
    .from(aiTasksTable)
    .where(eq(aiTasksTable.id, input.taskId))
    .limit(1);
  const task = taskRows[0];
  if (!task) return { queued: false, reason: "TASK_NOT_FOUND" };

  const existing = parseMeta(task.adminNotes);
  if (existing?.kind === FLOW_KIND) {
    return { queued: true, reason: "ALREADY_QUEUED" };
  }

  const owners = await activeOwners(input.companyId);
  if (owners.length !== 1) {
    logger.warn(
      { taskId: input.taskId, companyId: input.companyId, ownerCount: owners.length },
      "employee-kasbon: owner resolution is not unique",
    );
    return { queued: false, reason: owners.length === 0 ? "OWNER_NOT_FOUND" : "OWNER_AMBIGUOUS" };
  }
  const owner = owners[0]!;
  const ownerPhone = normalizePhone(owner.phone);
  const taskNumber = task.taskNumber || `TASK-${task.id}`;
  const meta: KasbonMeta = {
    kind: FLOW_KIND,
    state: WAITING_STATE,
    requesterPhone: normalizePhone(input.requesterPhone),
    ownerPhone,
    ownerName: owner.name,
    fields: input.fields,
    queuedAt: new Date().toISOString(),
    approvedNotifyPhone: normalizePhone(process.env.EMPLOYEE_KASBON_APPROVED_NOTIFY_PHONE) || null,
    approvedNotifySentAt: null,
  };

  await db.transaction(async (tx) => {
    await tx
      .update(aiTasksTable)
      .set({
        status: "ready_for_review",
        requiredAction: WAITING_ACTION,
        adminNotes: JSON.stringify(meta),
        assignedTo: owner.name,
        assignedToId: owner.id,
        assignedRole: "owner",
        updatedAt: new Date(),
      })
      .where(eq(aiTasksTable.id, task.id));
    await tx.insert(taskCommentsTable).values({
      taskId: task.id,
      senderType: "system",
      senderName: "AI Task",
      comment: `Pengajuan kasbon diteruskan ke owner ${owner.name ?? ownerPhone}; menunggu balasan OK.`,
    });
  });

  await sendKasbonMessage(ownerPhone, buildOwnerRequest(taskNumber, input.fields), input.fonnteDevice ?? null);
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
  // This first implementation is intentionally DEV-only. PROD remains fail-closed
  // until the DEV flow is proven end-to-end and explicitly promoted.
  if (process.env.NODE_ENV === "production") {
    throw new Error("KASBON_OWNER_FLOW_PROD_DISABLED");
  }
  const supabaseUrl = process.env.SUPABASE_URL_DEV?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV?.trim();
  if (!supabaseUrl || !serviceRole) {
    throw new Error("KASBON_BIZPORTAL_DEV_SUPABASE_NOT_CONFIGURED");
  }
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
    // A concurrent retry may win the unique advance_number race. Re-read and
    // accept only an identical canonical transaction.
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

  const actor = await resolveWaRole(input.phone, input.companyId);
  const envOwnerPhone = normalizePhone(process.env.EMPLOYEE_KASBON_OWNER_PHONE);
  const senderPhone = normalizePhone(input.phone);
  const isConfiguredOwner = Boolean(envOwnerPhone) && senderPhone === envOwnerPhone;
  if (actor.role !== "owner" && !isConfiguredOwner) return false;
  const ownerActor = actor.role === "owner"
    ? actor
    : {
        ...actor,
        role: "owner" as const,
        name: process.env.EMPLOYEE_KASBON_OWNER_NAME?.trim() || "Owner",
      };

  const candidates = await db
    .select()
    .from(aiTasksTable)
    .where(eq(aiTasksTable.requiredAction, WAITING_ACTION))
    .orderBy(desc(aiTasksTable.updatedAt))
    .limit(5);

  const ownerPhone = normalizePhone(input.phone);
  const matching = candidates.filter((task) => {
    const meta = parseMeta(task.adminNotes);
    if (!meta || meta.state !== WAITING_STATE) return false;
    return normalizePhone(meta.ownerPhone) === ownerPhone;
  });

  if (matching.length === 0) return false;
  if (matching.length > 1) {
    const refs = matching.map((task) => task.taskNumber || `TASK-${task.id}`).join(", ");
    await sendKasbonMessage(
      ownerPhone,
      `Ada lebih dari satu pengajuan kasbon menunggu persetujuan (${refs}). Mohon balas pada pesan pengajuan yang dimaksud agar approval tidak ambigu.`,
      input.fonnteDevice ?? null,
    );
    return true;
  }

  const task = matching[0]!;
  const meta = parseMeta(task.adminNotes)!;
  const taskNumber = task.taskNumber || `TASK-${task.id}`;

  let kasbon;
  try {
    kasbon = await createApprovedKasbon({
      taskId: task.id,
      taskNumber,
      requesterPhone: meta.requesterPhone,
      fields: meta.fields,
      ownerName: ownerActor.name ?? meta.ownerName,
      ownerPhone,
    });
  } catch (error) {
    logger.error({ error, taskId: task.id }, "employee-kasbon: BizPortal write failed");
    await db.insert(taskCommentsTable).values({
      taskId: task.id,
      senderType: "system",
      senderName: "AI Task",
      comment: `Owner sudah menyetujui, tetapi pencatatan BizPortal belum berhasil: ${error instanceof Error ? error.message : String(error)}`,
    }).catch(() => {});
    await sendKasbonMessage(
      ownerPhone,
      `✅ Persetujuan ${taskNumber} sudah diterima. Pencatatan ke BizPortal belum berhasil dan akan tetap memakai pengajuan yang sama; tidak perlu mengirim OK ulang.`,
      input.fonnteDevice ?? null,
    );
    return true;
  }

  const approvedAt = new Date().toISOString();
  const notifyPhone =
    normalizePhone(meta.approvedNotifyPhone) ||
    normalizePhone(process.env.EMPLOYEE_KASBON_APPROVED_NOTIFY_PHONE);
  let notifySentAt: string | null = meta.approvedNotifySentAt ?? null;

  if (notifyPhone && !notifySentAt) {
    const message = buildApprovedNotification({
      taskNumber,
      advanceNumber: kasbon.advanceNumber,
      employeeName: kasbon.employeeName,
      amount: kasbon.amount,
      purpose: kasbon.purpose,
      ownerName: ownerActor.name ?? meta.ownerName,
    });
    await sendKasbonMessage(notifyPhone, message, input.fonnteDevice ?? null);
    notifySentAt = new Date().toISOString();
  }

  const nextMeta: KasbonMeta = {
    ...meta,
    state: RECORDED_STATE,
    approvedAt,
    approvedByPhone: ownerPhone,
    approvedByName: ownerActor.name ?? meta.ownerName,
    bizportalAdvanceId: kasbon.id,
    bizportalAdvanceNumber: kasbon.advanceNumber,
    approvedNotifyPhone: notifyPhone || null,
    approvedNotifySentAt: notifySentAt,
  };

  await db.transaction(async (tx) => {
    await tx
      .update(aiTasksTable)
      .set({
        status: "in_progress",
        requiredAction: "waiting_disbursement",
        adminNotes: JSON.stringify(nextMeta),
        updatedAt: new Date(),
      })
      .where(eq(aiTasksTable.id, task.id));
    await tx.insert(taskCommentsTable).values({
      taskId: task.id,
      senderType: "owner",
      senderName: ownerActor.name ?? "Owner",
      comment: `OK — kasbon disetujui via WhatsApp dan tercatat di BizPortal sebagai ${kasbon.advanceNumber}. Status menunggu pencairan.`,
    });
  });

  await sendKasbonMessage(
    ownerPhone,
    `✅ ${taskNumber} disetujui dan sudah tercatat di BizPortal sebagai *${kasbon.advanceNumber}*. Status: menunggu pencairan.`,
    input.fonnteDevice ?? null,
  );

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
    logger.warn(
      { taskId: task.id },
      "employee-kasbon: approved notification phone is not configured",
    );
  }
  return true;
}
