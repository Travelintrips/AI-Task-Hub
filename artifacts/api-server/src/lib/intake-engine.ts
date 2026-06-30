/**
 * IntakeEngine — Conversational Data Collection Before Task Creation
 *
 * Flow:
 *   1. Detect/receive intent_code from IntentEngine
 *   2. Load required fields from data_templates + document_templates
 *   3. Extract what the customer already provided in the message
 *   4. Compare collected vs required → determine missing fields
 *   5. If incomplete → generate next question, save session, return reply (no task)
 *   6. If complete   → mark session ready, caller creates ai_task
 *
 * Cancellation: "batal", "cancel", "tidak jadi", "stop", "ga jadi"
 * Timeout: sessions expire after 24 hours of inactivity
 */

import { eq, and, inArray, lte, isNotNull, desc } from "drizzle-orm";
import {
  db,
  intakeSessionsTable,
  dataTemplatesTable,
  dataTemplateFieldsTable,
  documentTemplatesTable,
  documentTemplateFieldsTable,
  auditLogsTable,
  type IntakeSession,
} from "@workspace/db";
import { openai } from "./openai";
import { logger } from "./logger";
import type { IntentResolution } from "./intent-engine";
import { calculateCompleteness, getCompletionThreshold } from "./intake-completeness";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface FieldDef {
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  isRequired: boolean;
  sortOrder: number;
  helpText?: string | null;
}

export interface IntakeResult {
  action: "continue_collecting" | "ready_for_task" | "cancelled" | "expired" | "send_form";
  session: IntakeSession;
  replyToUser: string;
  collectedFields: Record<string, unknown>;
  missingFields: string[];
  requiredDocuments: string[];
  /** Populated when action === "send_form" — the mini form type to send */
  formType?: string;
}

// ─── Cancellation detection ────────────────────────────────────────────────────

const CANCEL_PATTERNS = /\b(batal|cancel|tidak jadi|ga jadi|stop|batalkan|hapus|ngga jadi|engga jadi)\b/i;

export function isCancellation(message: string): boolean {
  return CANCEL_PATTERNS.test(message);
}

// ─── Greeting detection — resets active session silently ──────────────────────
// Pesan-pesan ini menandakan user memulai ulang percakapan.
// Sesi aktif yang ada harus di-cancel agar user bisa mulai dari awal.

const GREETING_PATTERNS = /^(hallo|halo|hai|hi|hey|hei|hello|selamat pagi|selamat siang|selamat sore|selamat malam|pagi|siang|sore|malam|terima kasih|makasih|trims|ok|oke|iya|ya|thanks|tq|thx|noted|siap)\s*[!.]*$/i;

export function isGreeting(message: string): boolean {
  return GREETING_PATTERNS.test(message.trim());
}

// ─── Load template fields from DB ─────────────────────────────────────────────

async function loadRequiredFields(
  intentCode: string,
  category: string | null,
  companyId: string,
): Promise<{ dataFields: FieldDef[]; docFields: string[] }> {
  try {
    // Try to find data template by intent_code first, then by category
    const dataTpl = await db
      .select()
      .from(dataTemplatesTable)
      .where(
        and(
          eq(dataTemplatesTable.companyId, companyId),
          eq(dataTemplatesTable.isActive, true),
          eq(dataTemplatesTable.intentCode, intentCode),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

    const dataTplFallback = !dataTpl && category
      ? await db
          .select()
          .from(dataTemplatesTable)
          .where(
            and(
              eq(dataTemplatesTable.companyId, companyId),
              eq(dataTemplatesTable.isActive, true),
              eq(dataTemplatesTable.category, category),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;

    const activeTpl = dataTpl ?? dataTplFallback;

    let dataFields: FieldDef[] = [];
    if (activeTpl) {
      const fields = await db
        .select()
        .from(dataTemplateFieldsTable)
        .where(eq(dataTemplateFieldsTable.templateId, activeTpl.id))
        .orderBy(dataTemplateFieldsTable.sortOrder);

      dataFields = fields.map((f) => ({
        fieldName: f.fieldName,
        fieldLabel: f.fieldLabel,
        fieldType: f.fieldType,
        isRequired: f.isRequired,
        sortOrder: f.sortOrder,
        helpText: f.helpText ?? null,
      }));
    }

    // Document template
    let docFields: string[] = [];
    try {
      const docTpl = await db
        .select()
        .from(documentTemplatesTable)
        .where(
          and(
            eq(documentTemplatesTable.companyId, companyId),
            eq(documentTemplatesTable.isActive, true),
            eq(documentTemplatesTable.intentCode, intentCode),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (docTpl) {
        const docs = await db
          .select()
          .from(documentTemplateFieldsTable)
          .where(
            and(
              eq(documentTemplateFieldsTable.templateId, docTpl.id),
              eq(documentTemplateFieldsTable.isRequired, true),
            ),
          );
        docFields = docs.map((d) => d.documentName);
      }
    } catch (docErr) {
      logger.warn({ docErr, intentCode }, "IntakeEngine: failed to load document template fields — using empty");
    }

    return { dataFields, docFields };
  } catch (err) {
    logger.warn({ err, intentCode, category }, "IntakeEngine: loadRequiredFields failed — returning empty (table may not exist)");
    return { dataFields: [], docFields: [] };
  }
}

// ─── AI field extraction ───────────────────────────────────────────────────────

async function extractFieldsFromMessage(
  message: string,
  requiredFields: FieldDef[],
  existingCollected: Record<string, unknown>,
  intentCode: string,
  sessionHistory: string,
): Promise<Record<string, unknown>> {
  if (requiredFields.length === 0) return existingCollected;

  const fieldList = requiredFields
    .map((f) => `- ${f.fieldName} (${f.fieldLabel}, type: ${f.fieldType})`)
    .join("\n");

  const prompt = `Kamu adalah asisten AI yang membantu mengekstrak informasi dari pesan pelanggan.

Intent pelanggan: ${intentCode}

Field yang diperlukan:
${fieldList}

Data yang sudah terkumpul sebelumnya (WAJIB disertakan kembali di output):
${JSON.stringify(existingCollected, null, 2)}

Riwayat percakapan:
${sessionHistory}

Pesan terbaru pelanggan: "${message}"

Instruksi PENTING:
1. Ekstrak nilai baru dari pesan terbaru.
2. SELALU gabungkan dengan data yang sudah ada. Jangan hapus atau timpa data yang sudah ada.
3. Kembalikan JSON dengan SEMUA field yang sudah terkumpul (existing + baru).
4. Gunakan field_name sebagai key (bukan label).
5. Jangan sertakan field dengan nilai null/kosong.

Panduan khusus untuk Sport Center (sport_center_booking, daftar_membership, dll):
- "lapangan futsal" / "futsal" / "lapangan bola" / "bola" / "badminton" / "tenis" / "basket" / "voli" → ekstrak sebagai nilai field "field_name" (Nama Lapangan / Jenis Olahraga)
- "tanggal 28" / "tanggal 28 juni" / "besok" / "minggu depan" → ekstrak sebagai nilai field "booking_date" (Tanggal Booking)
- "3 jam" / "2 jam" / "90 menit" → hitung jam_selesai: jam_mulai + durasi, ekstrak sebagai "end_time"
- "jam 10" / "pukul 10.00" / "sore jam 3" → ekstrak sebagai nilai field "start_time" (Jam Mulai)
- nama orang yang disebutkan sebagai pemesan → ekstrak sebagai "booker_name"
- nomor telepon / nomor HP → ekstrak sebagai "phone"
PENTING: Gunakan HANYA field_name yang ada di daftar "Field yang diperlukan" di atas sebagai key JSON.

Kembalikan HANYA JSON object, tanpa penjelasan, tanpa markdown.`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: "json_object" },
    });

    const raw = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Filter out null/undefined values
    const cleaned: Record<string, unknown> = { ...existingCollected };
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== null && v !== undefined && v !== "") {
        cleaned[k] = v;
      }
    }
    return cleaned;
  } catch (err) {
    logger.warn({ err }, "IntakeEngine: field extraction failed — returning existing");
    return existingCollected;
  }
}

// ─── Generate next question ────────────────────────────────────────────────────

async function generateNextQuestion(
  missingFields: FieldDef[],
  collectedFields: Record<string, unknown>,
  intentCode: string,
  companyName: string,
): Promise<string> {
  if (missingFields.length === 0) {
    return "Terima kasih! Semua informasi yang diperlukan sudah lengkap. Tim kami akan segera memproses permintaan Anda.";
  }

  // Ask max 2 missing fields at once to keep conversation natural
  const toAsk = missingFields.slice(0, 2);

  const prompt = `Kamu adalah customer service profesional dari perusahaan manajemen sport center & properti Indonesia.
Intent pelanggan: ${intentCode}

Data yang sudah terkumpul (JANGAN tanyakan lagi):
${JSON.stringify(collectedFields, null, 2)}

Field yang MASIH PERLU ditanyakan:
${toAsk.map((f) => `- ${f.fieldLabel} (${f.helpText ?? ""})`).join("\n")}

Buat SATU pertanyaan lanjutan dalam Bahasa Indonesia, singkat, ramah, dan profesional.
- INI ADALAH PERTANYAAN LANJUTAN, bukan pembuka percakapan. JANGAN gunakan salam seperti "Halo!", "Selamat pagi", "Terima kasih telah menghubungi kami", dll.
- Langsung tanyakan field yang masih kurang
- Jika ada 2 field, tanyakan keduanya dalam satu kalimat
- Jangan tanyakan field yang sudah ada di data terkumpul
- Gunakan bahasa sehari-hari, tidak kaku
- Maksimal 2 kalimat

Kembalikan HANYA teks pertanyaannya, tanpa salam, tanpa penjelasan tambahan.`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 200,
    });
    return resp.choices[0]?.message?.content?.trim() ??
      `Boleh saya tanya, apa ${toAsk[0]?.fieldLabel ?? "informasi lebih lanjut"}nya?`;
  } catch {
    const labels = toAsk.map((f) => f.fieldLabel).join(" dan ");
    return `Boleh saya tanyakan informasi berikut: ${labels}?`;
  }
}

// ─── Generate completion summary ───────────────────────────────────────────────

async function generateCompletionMessage(
  intentCode: string,
  collectedFields: Record<string, unknown>,
): Promise<string> {
  const fieldSummary = Object.entries(collectedFields)
    .slice(0, 8)
    .map(([k, v]) => `• ${k}: ${String(v)}`)
    .join("\n");

  return `✅ Terima kasih! Data Anda sudah lengkap.\n\n*Ringkasan permintaan:*\n${fieldSummary}\n\nTim kami akan segera menghubungi Anda. Mohon tunggu konfirmasi dari kami ya! 🙏`;
}

// ─── Find active session ───────────────────────────────────────────────────────

export async function findActiveIntakeSession(
  phone: string,
  companyId: string,
): Promise<IntakeSession | null> {
  const now = new Date();
  const rows = await db
    .select()
    .from(intakeSessionsTable)
    .where(
      and(
        eq(intakeSessionsTable.phone, phone),
        eq(intakeSessionsTable.companyId, companyId),
        inArray(intakeSessionsTable.status, ["collecting", "ready_for_task"]),
      ),
    )
    .orderBy(desc(intakeSessionsTable.updatedAt))
    .limit(1);

  const session = rows[0] ?? null;

  // Check if expired
  if (session?.expiresAt && session.expiresAt < now) {
    await db
      .update(intakeSessionsTable)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(intakeSessionsTable.id, session.id));
    return null;
  }

  return session;
}

// ─── Create new intake session ─────────────────────────────────────────────────

export async function createIntakeSession({
  phone,
  companyId,
  intentCode,
  intentName,
  category,
  initialMessage,
  resolution,
  miniFormType,
}: {
  phone: string;
  companyId: string;
  intentCode: string;
  intentName?: string | null;
  category?: string | null;
  initialMessage: string;
  resolution: IntentResolution;
  /** For hybrid mode: the form type to send when fields are complete */
  miniFormType?: string | null;
}): Promise<IntakeSession> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  const [session] = await db
    .insert(intakeSessionsTable)
    .values({
      phone,
      companyId,
      intentCode,
      intentName: intentName ?? null,
      category: category ?? null,
      status: "collecting",
      miniFormType: miniFormType ?? null,
      requiredFields: resolution.missingDataKeys,
      collectedFields: {},
      missingFields: resolution.missingDataKeys,
      requiredDocuments: resolution.missingDocuments.map((d) =>
        typeof d === "string" ? d : ((d as { documentName?: string }).documentName ?? String(d)),
      ),
      uploadedDocuments: [],
      completionPct: "0",
      needsAdminReview: resolution.needsAdminReview ?? false,
      lastMessage: initialMessage,
      lastMessageAt: new Date(),
      expiresAt,
    })
    .returning();

  // Audit log
  try {
    await db.insert(auditLogsTable).values({
      companyId,
      action: "session_created",
      module: "intake",
      entityType: "intake_session",
      entityId: session!.id,
      after: JSON.stringify({ sessionId: session!.id, intentCode, phone }),
    });
  } catch { /* non-fatal */ }

  return session!;
}

// ─── Main: process message in context of intake session ───────────────────────

export async function processIntakeMessage({
  session,
  message,
  attachmentUrl,
  companyId,
}: {
  session: IntakeSession;
  message: string;
  attachmentUrl?: string | null;
  companyId: string;
}): Promise<IntakeResult> {
  // 1. Check cancellation
  if (isCancellation(message)) {
    await db
      .update(intakeSessionsTable)
      .set({ status: "cancelled", lastMessage: message, updatedAt: new Date() })
      .where(eq(intakeSessionsTable.id, session.id));

    const updated = await db
      .select()
      .from(intakeSessionsTable)
      .where(eq(intakeSessionsTable.id, session.id))
      .limit(1)
      .then((r) => r[0]!);

    return {
      action: "cancelled",
      session: updated,
      replyToUser: "Baik, permintaan Anda telah dibatalkan. Jika suatu saat ingin melanjutkan, silakan hubungi kami kembali. 🙏",
      collectedFields: (session.collectedFields as Record<string, unknown>) ?? {},
      missingFields: [],
      requiredDocuments: [],
    };
  }

  // 2. Load required fields from templates
  const { dataFields, docFields } = await loadRequiredFields(
    session.intentCode,
    session.category ?? null,
    companyId,
  );

  const existingCollected = (session.collectedFields as Record<string, unknown>) ?? {};

  // 3. Handle document/image upload
  let uploadedDocs = (session.uploadedDocuments as string[]) ?? [];
  if (attachmentUrl) {
    uploadedDocs = [...uploadedDocs, attachmentUrl];
  }

  // 4. Extract new fields from message
  const sessionHistory = session.lastQuestion
    ? `Pertanyaan sebelumnya: "${session.lastQuestion}"`
    : "";

  const newCollected = await extractFieldsFromMessage(
    message,
    dataFields,
    existingCollected,
    session.intentCode,
    sessionHistory,
  );

  // 5. Determine what's still missing
  const requiredFieldNames = dataFields
    .filter((f) => f.isRequired)
    .map((f) => f.fieldName);

  const stillMissing = requiredFieldNames.filter(
    (fname) => !newCollected[fname],
  );

  // Check required documents
  const stillMissingDocs = docFields.filter(
    (dname) => !uploadedDocs.some((u) => u.toLowerCase().includes(dname.toLowerCase())),
  );

  // 5b. Use per-intent completeness threshold
  const completeness = calculateCompleteness(requiredFieldNames, newCollected, session.intentCode);
  const isComplete = completeness.isReady;
  const hasTemplateFields = dataFields.length > 0;

  // Write audit log for field collection
  try {
    const prevCount = Object.keys(existingCollected).length;
    const newCount = Object.keys(newCollected).length;
    if (newCount > prevCount) {
      await db.insert(auditLogsTable).values({
        companyId,
        action: "field_collected",
        module: "intake",
        entityType: "intake_session",
        entityId: session.id,
        after: JSON.stringify({
          sessionId: session.id,
          completionPct: completeness.completionPct,
          newFields: newCount - prevCount,
        }),
      });
    }
  } catch { /* non-fatal */ }

  const now = new Date();

  // 6a. If no template fields defined at all → treat as complete immediately
  if (!hasTemplateFields || isComplete) {
    // Write threshold-reached audit log
    try {
      await db.insert(auditLogsTable).values({
        companyId,
        action: "completion_threshold_reached",
        module: "intake",
        entityType: "intake_session",
        entityId: session.id,
        after: JSON.stringify({
          sessionId: session.id,
          completionPct: completeness.completionPct,
          threshold: completeness.threshold,
        }),
        createdAt: new Date(),
      });
    } catch { /* non-fatal */ }

    // Hybrid mode: session has miniFormType → send form now instead of creating task
    const pendingFormType = session.miniFormType && session.status !== "form_sent"
      ? session.miniFormType
      : null;

    const [updated] = await db
      .update(intakeSessionsTable)
      .set({
        status:           pendingFormType ? "form_sent" : "ready_for_task",
        collectedFields:  newCollected,
        missingFields:    [],
        requiredFields:   requiredFieldNames,
        requiredDocuments: stillMissingDocs,
        uploadedDocuments: uploadedDocs,
        completionPct:    "100",
        lastMessage:      message,
        lastMessageAt:    now,
        updatedAt:        now,
        expiresAt:        new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .where(eq(intakeSessionsTable.id, session.id))
      .returning();

    if (pendingFormType) {
      return {
        action: "send_form",
        session: updated!,
        replyToUser: "",
        collectedFields: newCollected,
        missingFields: [],
        requiredDocuments: stillMissingDocs,
        formType: pendingFormType,
      };
    }

    const completionMsg = await generateCompletionMessage(session.intentCode, newCollected);

    return {
      action: "ready_for_task",
      session: updated!,
      replyToUser: completionMsg,
      collectedFields: newCollected,
      missingFields: [],
      requiredDocuments: stillMissingDocs,
    };
  }

  // 6b. Still collecting — generate next question
  const missingFieldDefs = dataFields.filter((f) =>
    f.isRequired && completeness.missingFieldNames.includes(f.fieldName),
  );

  const nextQuestion = await generateNextQuestion(
    missingFieldDefs,
    newCollected,
    session.intentCode,
    companyId,
  );

  const [updated] = await db
    .update(intakeSessionsTable)
    .set({
      collectedFields:  newCollected,
      missingFields:    completeness.missingFieldNames,
      requiredFields:   requiredFieldNames,
      requiredDocuments: stillMissingDocs,
      uploadedDocuments: uploadedDocs,
      completionPct:    String(completeness.completionPct),
      lastQuestion:     nextQuestion,
      lastMessage:      message,
      lastMessageAt:    now,
      updatedAt:        now,
      expiresAt:        new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .where(eq(intakeSessionsTable.id, session.id))
    .returning();

  return {
    action: "continue_collecting",
    session: updated!,
    replyToUser: nextQuestion,
    collectedFields: newCollected,
    missingFields: completeness.missingFieldNames,
    requiredDocuments: stillMissingDocs,
  };
}

// ─── Start new intake from intent resolution ───────────────────────────────────

export async function startIntakeSession({
  phone,
  companyId,
  message,
  attachmentUrl,
  resolution,
  miniFormType,
}: {
  phone: string;
  companyId: string;
  message: string;
  attachmentUrl?: string | null;
  resolution: IntentResolution;
  /** For hybrid mode: store form type so engine sends form when fields complete */
  miniFormType?: string | null;
}): Promise<IntakeResult> {
  // ── Deduplication: cancel any existing "collecting" sessions for this phone ──
  // This prevents accumulation of stale sessions that would confuse findActiveIntakeSession.
  try {
    const existing = await db
      .select({ id: intakeSessionsTable.id })
      .from(intakeSessionsTable)
      .where(
        and(
          eq(intakeSessionsTable.phone, phone),
          eq(intakeSessionsTable.companyId, companyId),
          inArray(intakeSessionsTable.status, ["collecting", "ready_for_task"]),
        ),
      );

    if (existing.length > 0) {
      const ids = existing.map((r) => r.id);
      await db
        .update(intakeSessionsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(intakeSessionsTable.phone, phone),
            eq(intakeSessionsTable.companyId, companyId),
            inArray(intakeSessionsTable.status, ["collecting", "ready_for_task"]),
          ),
        );
      logger.info(
        { phone, companyId, cancelledIds: ids, newIntent: resolution.intentCode },
        "IntakeEngine: cancelled existing collecting sessions before starting new one",
      );
    }
  } catch (cancelErr) {
    logger.warn({ cancelErr, phone }, "IntakeEngine: failed to cancel existing sessions — continuing");
  }

  // Create session
  const session = await createIntakeSession({
    phone,
    companyId,
    intentCode: resolution.intentCode,
    intentName: resolution.intentName,
    category: resolution.category,
    initialMessage: message,
    resolution,
    miniFormType: miniFormType ?? null,
  });

  // Process the initial message immediately
  return processIntakeMessage({ session, message, attachmentUrl, companyId });
}

// ─── Mark session as submitted (after task created) ───────────────────────────

export async function markIntakeSubmitted(
  sessionId: number,
  taskId: string | number,
): Promise<void> {
  await db
    .update(intakeSessionsTable)
    .set({
      status: "submitted",
      taskId: String(taskId),
      updatedAt: new Date(),
    })
    .where(eq(intakeSessionsTable.id, sessionId));
}

// ─── Expire old sessions (called by scheduler) ────────────────────────────────

export async function expireOldIntakeSessions(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(intakeSessionsTable)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        inArray(intakeSessionsTable.status, ["collecting", "ready_for_task"]),
        isNotNull(intakeSessionsTable.expiresAt),
        lte(intakeSessionsTable.expiresAt, now),
      ),
    )
    .returning({ id: intakeSessionsTable.id });

  return result.length;
}
