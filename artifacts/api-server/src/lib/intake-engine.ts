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
  notificationReceiversTable,
  type IntakeSession,
} from "@workspace/db";
import { openai } from "./openai";
import { logger } from "./logger";
import type { IntentResolution } from "./intent-engine";
import { calculateCompleteness, getCompletionThreshold } from "./intake-completeness";
import {
  isSportCenterBookingIntent,
  isAvailabilityConfirmation,
  checkSportCenterAvailability,
  extractDurationHours,
  timeToMinutes,
  minutesToTime,
  isValidBookerName,
  formatDateIndo,
  normalizeDateString,
} from "./sport-center-availability";
import { sendFonnte } from "./fonnte";

// ─── Sport Center notification helper ─────────────────────────────────────────
// Sends the booking confirmation message to ALL active "Sport Center" recipients
// registered in the Penerima Notifikasi table (phones + groups).
async function sendSportCenterNotifications(
  companyId: string,
  message: string,
  fonnteDevice: string | null | undefined,
): Promise<void> {
  const SPORT_CENTER_ALIASES = ["Sport Center", "Lapangan", "Olahraga", "Booking Lapangan"];
  try {
    const receivers = await db
      .select()
      .from(notificationReceiversTable)
      .where(
        and(
          eq(notificationReceiversTable.companyId, companyId),
          eq(notificationReceiversTable.isActive, true),
          inArray(notificationReceiversTable.category, SPORT_CENTER_ALIASES),
        ),
      );

    if (receivers.length === 0) {
      logger.warn({ companyId }, "IntakeEngine: no active Sport Center notification receivers found");
      return;
    }

    await Promise.allSettled(
      receivers.map((r) =>
        sendFonnte(r.phone, message, null).catch((e) =>
          logger.warn({ e, phone: r.phone }, "IntakeEngine: sport center notify to receiver failed"),
        ),
      ),
    );

    logger.info({ companyId, receiverCount: receivers.length }, "IntakeEngine: sport center notifications sent");
  } catch (err) {
    logger.warn({ err, companyId }, "IntakeEngine: sendSportCenterNotifications failed (non-fatal)");
  }
}

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
  /**
   * Optional message to send BEFORE replyToUser (e.g. "please wait while we check").
   * whatsapp.ts sends this first, then sends replyToUser after the async check completes.
   */
  preReply?: string;
}

// ─── Cancellation detection ────────────────────────────────────────────────────

const CANCEL_PATTERNS = /\b(batal|cancel|tidak jadi|ga jadi|stop|batalkan|hapus|ngga jadi|engga jadi)\b/i;

export function isCancellation(message: string): boolean {
  return CANCEL_PATTERNS.test(message);
}

// ─── Greeting detection — resets active session silently ──────────────────────
// Pesan-pesan ini menandakan user memulai ulang percakapan.
// Sesi aktif yang ada harus di-cancel agar user bisa mulai dari awal.

// Opener greetings: trigger session reset + full welcome menu
const GREETING_OPENER_PATTERNS = /^(halo|hallo|helo|hai|haii|hi|hey|hei|hello|selamat pagi|selamat siang|selamat sore|selamat malam|pagi|siang|sore|malam|assalamualaikum|assalamu'?alaikum|salamualaikum|waalaikumsalam|test|ping)\s*[!.?]*$/i;

// Closing phrases: user wrapping up — send simple ack, no session reset, no menu
const CLOSING_PHRASE_PATTERNS = /^(terima kasih|terimakasih|makasih|trims|ok|oke|iya|ya|thanks|tq|thx|noted|siap|baik|oke siap|ok siap)\s*[!.?]*$/i;

export function isGreeting(message: string): boolean {
  return GREETING_OPENER_PATTERNS.test(message.trim());
}

export function isClosingPhrase(message: string): boolean {
  return CLOSING_PHRASE_PATTERNS.test(message.trim());
}

// ─── Sport Center: regex date/time extractor (no-OpenAI fallback) ─────────────
// Extracts Indonesian date and time from free-text without calling OpenAI.
// Used as a reliable fallback when extractFieldsFromMessage (OpenAI) fails.

const MONTHS_ID: Record<string, string> = {
  jan: "01", januari: "01",
  feb: "02", februari: "02",
  mar: "03", maret: "03",
  apr: "04", april: "04",
  mei: "05", may: "05",
  jun: "06", juni: "06",
  jul: "07", juli: "07",
  agu: "08", agustus: "08",
  sep: "09", september: "09",
  okt: "10", oktober: "10",
  nov: "11", november: "11",
  des: "12", desember: "12",
};

function extractDateTimeRegex(msg: string): { date: string | null; time: string | null } {
  const text = msg.toLowerCase().trim();

  // ── Time: "jam 16:00", "jam 16", "pukul 16.30", standalone "16:00" ──
  let time: string | null = null;
  // Explicit keyword match first
  const timeKeyword = text.match(/(?:jam|pukul)\s*(\d{1,2})[:.](\d{2})/);
  const timeKeywordHour = !timeKeyword && text.match(/(?:jam|pukul)\s*(\d{1,2})(?!\d)/);
  // Standalone HH:MM
  const timeStandalone = !timeKeyword && !timeKeywordHour && text.match(/\b(\d{1,2})[:.](00|15|30|45)\b/);

  const rawH = timeKeyword?.[1] ?? timeKeywordHour?.[1] ?? timeStandalone?.[1] ?? null;
  const rawM = timeKeyword?.[2] ?? timeStandalone?.[2] ?? "00";
  if (rawH !== null) {
    const hNum = parseInt(rawH, 10);
    if (hNum >= 0 && hNum <= 23) {
      time = `${String(hNum).padStart(2, "0")}:${rawM.padStart(2, "0")}`;
    }
  }

  // ── Date: "6 juli", "tanggal 6 juli", "6 juli 2026" ──
  let date: string | null = null;
  const dateMatch = text.match(
    /(?:tan(?:ggal?|gl)?\s+)?(\d{1,2})\s+(jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|agu(?:stus)?|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?)\s*(\d{4})?/i,
  );
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, "0");
    const monthKey = dateMatch[2].toLowerCase();
    const month = MONTHS_ID[monthKey] ?? null;
    const year = dateMatch[3] ?? String(new Date().getFullYear());
    if (month) date = `${year}-${month}-${day}`;
  }

  // ── Date: "tanggal 8", "tanggl 8", "tgl 8" (day-only → use current month) ──
  // NOTE: only exclude a directly-following digit (e.g. avoid grabbing "1" out
  // of "18"). Do NOT exclude "space + word" — messages like "tanggal 8 jam 18"
  // are common and the day-only date must still be captured in that case.
  if (!date) {
    const dayOnlyMatch = text.match(/(?:tan(?:ggal?|gl)\s+)(\d{1,2})(?!\d)/i);
    if (dayOnlyMatch) {
      const day = parseInt(dayOnlyMatch[1]!, 10);
      if (day >= 1 && day <= 31) {
        const now = new Date();
        date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }

  return { date, time };
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

  const isAvailUnavailable = existingCollected._avail_status === "unavailable";
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
2. SELALU gabungkan dengan data yang sudah ada.${isAvailUnavailable
  ? `\n   KHUSUS: Jadwal sebelumnya SUDAH TERISI. Jika user memberikan tanggal atau jam BARU yang berbeda dari data sebelumnya, GANTI nilai booking_date dan/atau start_time dengan yang baru.`
  : " Jangan hapus atau timpa data yang sudah ada."}
3. Kembalikan JSON dengan SEMUA field yang sudah terkumpul (existing + baru).
4. Gunakan field_name sebagai key (bukan label).
5. Jangan sertakan field dengan nilai null/kosong.

Panduan khusus untuk Sport Center (sport_center_booking, daftar_membership, dll):
- "lapangan futsal" / "futsal" / "lapangan bola" / "bola" / "badminton" / "tenis" / "basket" / "voli" → ekstrak sebagai nilai field "field_name" (Nama Lapangan / Jenis Olahraga)
- "tanggal 28" / "tanggal 28 juni" / "besok" / "minggu depan" / "tanggl 8" / "tgl 8" → ekstrak sebagai nilai field "booking_date" (YYYY-MM-DD, gunakan tahun ${new Date().getFullYear()}, bulan saat ini jika tidak disebutkan)
- "3 jam" / "2 jam" / "90 menit" → hitung jam_selesai: jam_mulai + durasi, ekstrak sebagai "end_time"
- "jam 10" / "pukul 10.00" / "sore jam 3" / "jam 15" / angka tunggal seperti "15" atau "16" dalam konteks jam → ekstrak sebagai nilai field "start_time" (format HH:00)
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

// Hardcoded fallback labels for common fields when dataFields is not available
const FIELD_LABEL_FALLBACK: Record<string, string> = {
  // Trucking / Freight
  pickup_address:      "Alamat Pickup",
  delivery_address:    "Alamat Tujuan",
  cargo_type:          "Jenis Muatan",
  cargo_weight:        "Berat Muatan (kg)",
  cargo_volume:        "Volume (m³)",
  vehicle_type:        "Jenis Kendaraan",
  pickup_date:         "Tanggal Pickup",
  contact_person:      "Nama Kontak",
  phone:               "No. HP / WhatsApp",
  notes:               "Catatan Tambahan",
  // Sport Center
  booker_name:         "Nama Pemesan",
  field_type:          "Jenis Lapangan",
  field_name:          "Jenis Lapangan",
  booking_date:        "Tanggal Main",
  start_time:          "Jam Mulai",
  end_time:            "Jam Selesai",
  duration:            "Durasi Sewa",
  durasi:              "Durasi Sewa",
  payment_method:      "Metode Pembayaran",
  // Freight
  origin_country:      "Negara Asal",
  destination_country: "Negara Tujuan",
  commodity:           "Jenis Komoditi",
  gross_weight:        "Berat Kotor (kg)",
  volume:              "Volume (m³/CBM)",
  // Kasbon / Fleet
  amount:              "Jumlah",
  purpose:             "Keperluan",
  needed_date:         "Tanggal Dibutuhkan",
  plate_number:        "Nomor Plat",
  description:         "Keterangan",
};

async function generateCompletionMessage(
  intentCode: string,
  collectedFields: Record<string, unknown>,
  dataFields?: FieldDef[],
): Promise<string> {
  // Build label map: DB template fields take priority, fallback map as backup
  const labelMap: Record<string, string> = { ...FIELD_LABEL_FALLBACK };
  if (dataFields && dataFields.length > 0) {
    for (const f of dataFields) {
      labelMap[f.fieldName] = f.fieldLabel;
    }
  }

  // Skip internal/system fields from the summary
  const SKIP_KEYS = new Set(["phone", "companyId", "sessionId"]);

  const fieldSummary = Object.entries(collectedFields)
    .filter(([k]) => !SKIP_KEYS.has(k))
    .slice(0, 8)
    .map(([k, v]) => `• ${labelMap[k] ?? k}: ${String(v)}`)
    .join("\n");

  return `✅ Terima kasih! Data Anda sudah lengkap.\n\n*Ringkasan permintaan:*\n${fieldSummary}\n\nTim kami akan segera menghubungi Anda. Mohon tunggu konfirmasi dari kami ya! 🙏`;
}

// ─── Sport Center availability gate ───────────────────────────────────────────
// Returns an IntakeResult to send back if the gate needs to intercept,
// or null if the gate is satisfied and the normal flow should continue.

async function runSportCenterAvailabilityGate({
  session,
  message,
  newCollected,
  existingCollected,
  requiredFieldNames,
  completeness,
  stillMissingDocs,
  companyId,
  now,
  dataFields,
  fonnteDevice,
}: {
  session: IntakeSession;
  message: string;
  newCollected: Record<string, unknown>;
  existingCollected: Record<string, unknown>;
  requiredFieldNames: string[];
  completeness: ReturnType<typeof calculateCompleteness>;
  stillMissingDocs: string[];
  companyId: string;
  now: Date;
  dataFields: FieldDef[];
  fonnteDevice?: string | null;
}): Promise<IntakeResult | null> {
  const fieldType  = String(newCollected.field_type ?? newCollected.field_name  ?? "").trim();
  const bookingDate = String(newCollected.booking_date ?? "").trim();
  const startTime   = String(newCollected.start_time   ?? "").trim();

  const prevAvailStatus    = existingCollected._avail_status    as string | undefined;
  const prevAvailConfirmed = existingCollected._avail_confirmed as boolean | undefined;

  // Detect if user changed date/time since the last check or confirmation
  const dateChanged = !!existingCollected.booking_date && newCollected.booking_date !== existingCollected.booking_date;
  const timeChanged = !!existingCollected.start_time   && newCollected.start_time   !== existingCollected.start_time;
  const slotChanged = dateChanged || timeChanged;

  if (slotChanged) {
    // Slot changed → clear ALL previous availability state so we re-check fresh
    delete newCollected._avail_status;
    delete newCollected._avail_checked;
    delete newCollected._avail_confirmed;   // ← also reset even if was previously confirmed
  }

  // If already confirmed (and slot hasn't changed) → gate passes
  if (prevAvailConfirmed && !slotChanged) return null;

  const currentAvailStatus = newCollected._avail_status as string | undefined;

  // ── Case 0: Slot info incomplete → ask for what's still missing all at once ──
  // Fires when booking_date OR start_time is missing (regardless of fieldType).
  // This ensures the very first sport center message always triggers a structured
  // question rather than GPT's generic generateNextQuestion.

  // Generic/non-specific field type names that should be treated as "not yet specified"
  const GENERIC_FIELD_TYPES = new Set([
    "lapangan olahraga", "olahraga", "lapangan", "sport",
    "lapangan sport", "sport center", "fasilitas", "field",
    // NOTE: "gym" intentionally removed — GYM is now a specific bookable field (option 6)
  ]);
  const isGenericFieldType = !fieldType || GENERIC_FIELD_TYPES.has(fieldType.toLowerCase().trim());

  // ── Numbered menu for lapangan selection ──────────────────────────────────
  const FIELD_MENU_OPTIONS: Record<string, string> = {
    "1": "Badminton",
    "2": "Futsal",
    "3": "Tennis",
    "4": "Basketball",
    "5": "Voli",
    "6": "GYM",
    "7": "Billiard",
  };
  const FIELD_MENU_TEXT =
    `🏟️ Pilih lapangan/Fasilitas yang ingin Anda booking:\n\n` +
    `1️⃣ Badminton\n` +
    `2️⃣ Futsal\n` +
    `3️⃣ Tennis\n` +
    `4️⃣ Basketball\n` +
    `5️⃣ Voli\n` +
    `6️⃣ GYM\n` +
    `7️⃣ Meja Billiard\n\n` +
    `Balas dengan *nomor* atau *nama lapangan* yang Anda pilih.`;

  const missingSlot = !bookingDate || !startTime;
  if (missingSlot && !prevAvailStatus) {
    // Build a tailored question depending on what's already known
    let openingQ: string;
    if (isGenericFieldType && !bookingDate && !startTime) {
      // No specific field, no date, no time → show menu first
      openingQ = FIELD_MENU_TEXT;
    } else if (isGenericFieldType && (bookingDate || startTime)) {
      // Has date/time but field is still generic → show menu
      openingQ = FIELD_MENU_TEXT;
    } else if (!isGenericFieldType && (!bookingDate || !startTime)) {
      // Has specific field type but missing date/time.
      // Price list per field type (Rp per hour / per coin for Billiard)
      const PRICE_PER_HOUR: Record<string, number> = {
        futsal:     350_000,
        badminton:   75_000,
        tennis:     100_000,
        basketball: 150_000,
        voli:       100_000,
        gym:         50_000,
        billiard:    50_000,
      };
      const ft = fieldType.toLowerCase().trim();
      const pricePerUnit = PRICE_PER_HOUR[ft];
      const isBilliard = ft === "billiard";
      const unitLabel = isBilliard ? "Coin" : "Jam";
      const maxUnits = 5;
      const priceLines = pricePerUnit
        ? Array.from({ length: maxUnits }, (_, i) => i + 1)
            .map((n) => `${n} ${unitLabel} = Rp ${(pricePerUnit * n).toLocaleString("id-ID")}`)
            .join("\n")
        : "";
      const fieldLabel = isBilliard ? "Meja Billiard" : `lapangan *${fieldType}*`;
      const itemLabel  = isBilliard ? "Jumlah Coin, Tanggal, Jam main, Nama pemesan" : "Tanggal & Bulan, Jam mulai, Durasi, Nama pemesan";
      const example    = isBilliard
        ? `"10 Juli jam 14:00 5 Coin Nama Ahmad"`
        : `"5 Juli jam 10:00 Durasi 2 Jam dan Nama Ahmad"`;
      openingQ =
        `Untuk booking ${fieldLabel}, mohon berikan:\n` +
        itemLabel.split(", ").map((item) => `* ${item}`).join("\n") + `\n` +
        `(Contoh: ${example})` +
        (priceLines ? `\n\n💰 Harga:\n${priceLines}` : "");
    } else {
      openingQ =
        `🏟️ Lapangan apa yang ingin Anda booking, dan tanggal serta jam berapa?\n\n` +
        `_(Contoh: "Badminton, 5 Juli jam 10:00")_`;
    }

    try {
      const [updated] = await db
        .update(intakeSessionsTable)
        .set({
          collectedFields:  newCollected,
          lastQuestion:     openingQ,
          lastMessage:      message,
          lastMessageAt:    now,
          updatedAt:        now,
          expiresAt:        new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .where(eq(intakeSessionsTable.id, session.id))
        .returning();

      return {
        action:            "continue_collecting",
        session:           updated!,
        replyToUser:       openingQ,
        collectedFields:   newCollected,
        missingFields:     completeness.missingFieldNames,
        requiredDocuments: stillMissingDocs,
      };
    } catch (dbErr) {
      logger.error({ dbErr, sessionId: session.id }, "SportCenterGate Case0: DB update failed — returning hardcoded question");
      return {
        action:            "continue_collecting",
        session,
        replyToUser:       openingQ,
        collectedFields:   newCollected,
        missingFields:     completeness.missingFieldNames,
        requiredDocuments: stillMissingDocs,
      };
    }
  }

  // ── Case 0.5: Has date + time but missing durasi → ask durasi menu ──────────
  const hasDuration = !!(newCollected.duration ?? newCollected.durasi);
  if (!isGenericFieldType && bookingDate && startTime && !hasDuration && !currentAvailStatus) {
    const durasiQ =
      `Pilih *durasi* booking lapangan *${fieldType}*:\n\n` +
      `1️⃣ 1 Jam\n` +
      `2️⃣ 2 Jam\n` +
      `3️⃣ 3 Jam\n` +
      `4️⃣ 4 Jam\n` +
      `5️⃣ 5 Jam`;
    try {
      const [updated] = await db
        .update(intakeSessionsTable)
        .set({
          collectedFields: newCollected,
          lastQuestion:    durasiQ,
          lastMessage:     message,
          lastMessageAt:   now,
          updatedAt:       now,
          expiresAt:       new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .where(eq(intakeSessionsTable.id, session.id))
        .returning();
      return {
        action:            "continue_collecting",
        session:           updated!,
        replyToUser:       durasiQ,
        collectedFields:   newCollected,
        missingFields:     completeness.missingFieldNames,
        requiredDocuments: stillMissingDocs,
      };
    } catch (dbErr) {
      logger.error({ dbErr }, "SportCenterGate Case0.5: DB update failed");
      return {
        action:            "continue_collecting",
        session,
        replyToUser:       durasiQ,
        collectedFields:   newCollected,
        missingFields:     completeness.missingFieldNames,
        requiredDocuments: stillMissingDocs,
      };
    }
  }

  // ── Case 0.7: Has field + date + time + durasi but no VALID booker name ─────
  // Guards against garbage extraction (digits, confirmation words, symbols)
  // silently reaching the confirmation message with a missing/wrong name.
  const hasValidName = isValidBookerName(newCollected.booker_name as string | undefined);
  if (!isGenericFieldType && bookingDate && startTime && hasDuration && !hasValidName && !currentAvailStatus) {
    const hadAttempt = !!newCollected.booker_name && !hasValidName;
    if (hadAttempt) delete newCollected.booker_name;

    const namaQ = hadAttempt
      ? `Mohon maaf, nama yang Anda berikan sepertinya kurang tepat. Mohon berikan *nama pemesan* (huruf saja, tanpa angka/simbol), contoh: "Robby" atau "Budi Santoso".`
      : `Atas nama siapa booking lapangan *${fieldType}* ini? Mohon berikan *nama pemesan*.`;

    try {
      const [updated] = await db
        .update(intakeSessionsTable)
        .set({
          collectedFields: newCollected,
          lastQuestion:    namaQ,
          lastMessage:     message,
          lastMessageAt:   now,
          updatedAt:       now,
          expiresAt:       new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .where(eq(intakeSessionsTable.id, session.id))
        .returning();
      return {
        action:            "continue_collecting",
        session:           updated!,
        replyToUser:       namaQ,
        collectedFields:   newCollected,
        missingFields:     completeness.missingFieldNames,
        requiredDocuments: stillMissingDocs,
      };
    } catch (dbErr) {
      logger.error({ dbErr }, "SportCenterGate Case0.7: DB update failed");
      return {
        action:            "continue_collecting",
        session,
        replyToUser:       namaQ,
        collectedFields:   newCollected,
        missingFields:     completeness.missingFieldNames,
        requiredDocuments: stillMissingDocs,
      };
    }
  }

  // ── Case A: Have field + date + time + durasi + valid name → check availability
  // Skip if fieldType is still generic (user hasn't specified which lapangan)
  if (!isGenericFieldType && fieldType && bookingDate && startTime && hasDuration && hasValidName && !currentAvailStatus) {
    logger.info({ companyId, fieldType, bookingDate, startTime }, "IntakeEngine: running sport center availability check");

    // Send the "please wait" message FIRST and actually await its delivery
    // before running the Supabase availability query, so the WhatsApp message
    // order always reflects the real sequence: "mohon tunggu" → (DB check) → hasil.
    //
    // NOTE: awaiting the sendFonnte() HTTP call only guarantees Fonnte *accepted*
    // the request — it does NOT guarantee WhatsApp has actually displayed the
    // message yet. Because the availability DB query below is very fast
    // (<200ms), the second message ("Jadwal Tersedia!") could reach Fonnte's
    // delivery queue before the first one is actually pushed out, causing the
    // two messages to appear out of order in the chat. We add a fixed 15s
    // delay here to give Fonnte/WhatsApp enough time to deliver message #1
    // before message #2 is ever sent.
    await sendFonnte(
      session.phone,
      "Mohon ditunggu, kami cek dulu ketersediaan jadwalnya ya... 🔍",
      fonnteDevice ?? null,
    ).catch((e) => logger.warn({ e }, "IntakeEngine: failed to send availability pre-check message"));

    // Fonnte tidak menyediakan indikator "sedang mengetik" native seperti WA
    // Business API resmi, jadi kita simulasikan dengan mengirim satu pesan
    // progres singkat di tengah masa tunggu — supaya customer tahu prosesnya
    // masih berjalan (bukan macet), bukan cuma diam 15 detik.
    const halfDelayMs = 7000;
    await new Promise((resolve) => setTimeout(resolve, halfDelayMs));

    await sendFonnte(
      session.phone,
      "⏳ Sebentar ya, masih kami cek...",
      fonnteDevice ?? null,
    ).catch((e) => logger.warn({ e }, "IntakeEngine: failed to send availability progress pulse message"));

    await new Promise((resolve) => setTimeout(resolve, 15000 - halfDelayMs));

    const durationHours = extractDurationHours(newCollected);
    const bookerName = String(newCollected.booker_name ?? "").trim() || undefined;
    const avail = await checkSportCenterAvailability({ fieldType, bookingDate, startTime, durationHours, companyId, bookerName });

    newCollected._avail_status  = avail.isAvailable ? "available" : "unavailable";
    newCollected._avail_checked = true;

    if (avail.isAvailable) {
      // Auto-confirm: no "ya" needed — mark confirmed, auto-complete, notify group, create task immediately
      newCollected._avail_confirmed = true;

      // Auto-compute end_time from start_time + duration
      if (newCollected.start_time && !newCollected.end_time) {
        const startMins = timeToMinutes(String(newCollected.start_time));
        if (startMins >= 0) {
          newCollected.end_time = minutesToTime(startMins + Math.round(durationHours * 60));
        }
      }

      // Ensure phone is captured from session
      if (!newCollected.phone) newCollected.phone = session.phone;

      // Notify ALL active Sport Center recipients (groups + phone numbers) from Penerima Notifikasi table.
      // avail.message already contains the full "Jadwal Tersedia!" summary with Harga + Nama Pemesan.
      sendSportCenterNotifications(companyId, avail.message, fonnteDevice)
        .catch((e) => logger.warn({ e }, "IntakeEngine: failed to send sport center notifications"));

      // Persist session as ready_for_task — whatsapp.ts will create the AI task immediately
      const [updatedAvail] = await db
        .update(intakeSessionsTable)
        .set({
          status:          "ready_for_task",
          collectedFields: newCollected,
          missingFields:   [],
          requiredFields:  requiredFieldNames,
          completionPct:   "100",
          lastQuestion:    avail.message,
          lastMessage:     message,
          lastMessageAt:   now,
          updatedAt:       now,
          expiresAt:       new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .where(eq(intakeSessionsTable.id, session.id))
        .returning();

      return {
        action:            "ready_for_task",
        session:           updatedAvail!,
        replyToUser:       avail.message,
        collectedFields:   newCollected,
        missingFields:     [],
        requiredDocuments: stillMissingDocs,
      };
    }

    // Unavailable — show the unavailable message and wait for new slot
    const [updated] = await db
      .update(intakeSessionsTable)
      .set({
        collectedFields:   newCollected,
        missingFields:     completeness.missingFieldNames,
        requiredFields:    requiredFieldNames,
        completionPct:     String(completeness.completionPct),
        lastQuestion:      avail.message,
        lastMessage:       message,
        lastMessageAt:     now,
        updatedAt:         now,
        expiresAt:         new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .where(eq(intakeSessionsTable.id, session.id))
      .returning();

    return {
      action:            "continue_collecting",
      session:           updated!,
      replyToUser:       avail.message,
      collectedFields:   newCollected,
      missingFields:     completeness.missingFieldNames,
      requiredDocuments: stillMissingDocs,
    };
  }

  // ── Case B: Slot was available (old session without auto-confirm) ──────────
  // Auto-confirm immediately — no "ya" needed anymore.
  if (currentAvailStatus === "available") {
    if (!dateChanged && !timeChanged) {
      // Mark confirmed, auto-compute end_time, fall through to task creation
      newCollected._avail_confirmed = true;
      if (newCollected.start_time && !newCollected.end_time) {
        const dh = extractDurationHours(newCollected);
        const startMins = timeToMinutes(String(newCollected.start_time));
        if (startMins >= 0) {
          newCollected.end_time = minutesToTime(startMins + Math.round(dh * 60));
        }
      }
      return null;
    }
    // Date/time changed → clear status so Case A re-checks availability
    return null;
  }

  // ── Case C: Slot unavailable, and user hasn't changed date/time yet ───────
  if (currentAvailStatus === "unavailable" && !dateChanged && !timeChanged) {
    // ── C-1: "ganti tanggal" / "hari lain" keywords → reset slot and re-ask ──
    const wantsDateChange = /ganti\s*tanggal|ubah\s*tanggal|tanggal\s*lain|hari\s*lain|beda\s*tanggal|coba\s*tanggal|coba\s*hari|mau\s*ganti/i.test(message);
    if (wantsDateChange) {
      delete newCollected.booking_date;
      delete newCollected.start_time;
      delete newCollected._avail_status;
      delete newCollected._avail_checked;
      const reAskQ =
        `Baik! Silakan berikan *tanggal* dan *jam* baru yang Anda inginkan ya. 📅\n` +
        `_(Contoh: "8 Juli jam 14:00")_`;
      const [updated] = await db
        .update(intakeSessionsTable)
        .set({ collectedFields: newCollected, lastQuestion: reAskQ, lastMessage: message, lastMessageAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
        .where(eq(intakeSessionsTable.id, session.id))
        .returning();
      return { action: "continue_collecting", session: updated!, replyToUser: reAskQ, collectedFields: newCollected, missingFields: completeness.missingFieldNames, requiredDocuments: stillMissingDocs };
    }

    // ── C-2: User provides a new time (e.g. "jam 15", "pukul 16", "15", "16") ──
    // extractDateTimeRegex handles "jam X" and "X:00" — but NOT bare numbers.
    // We also try bare numbers 7-21 as hour selections.
    let caseCSuggestedTime: string | null = null;
    const { time: regexExtractedTime } = extractDateTimeRegex(message);
    if (regexExtractedTime) {
      caseCSuggestedTime = regexExtractedTime;
    } else {
      // Bare number in range 7–21 treated as an hour selection
      const bareHour = message.trim().match(/^(\d{1,2})$/);
      if (bareHour) {
        const h = parseInt(bareHour[1]!, 10);
        if (h >= 7 && h <= 21) caseCSuggestedTime = `${String(h).padStart(2, "0")}:00`;
      }
    }

    if (caseCSuggestedTime && caseCSuggestedTime !== String(existingCollected.start_time ?? "")) {
      // New valid time → run inline availability check (same as Case A)
      newCollected.start_time = caseCSuggestedTime;
      delete newCollected._avail_status;
      delete newCollected._avail_checked;
      delete newCollected._avail_confirmed;

      const durationHours = extractDurationHours(newCollected);
      const bookerName = String(newCollected.booker_name ?? "").trim() || undefined;
      const avail = await checkSportCenterAvailability({
        fieldType, bookingDate, startTime: caseCSuggestedTime, durationHours, companyId, bookerName,
      });
      newCollected._avail_status  = avail.isAvailable ? "available" : "unavailable";
      newCollected._avail_checked = true;

      if (avail.isAvailable) {
        newCollected._avail_confirmed = true;
        if (!newCollected.end_time) {
          const startMins = timeToMinutes(caseCSuggestedTime);
          if (startMins >= 0) newCollected.end_time = minutesToTime(startMins + Math.round(durationHours * 60));
        }
        if (!newCollected.phone) newCollected.phone = session.phone;
        // Notify ALL active Sport Center recipients from Penerima Notifikasi table
        sendSportCenterNotifications(companyId, avail.message, fonnteDevice)
          .catch((e) => logger.warn({ e }, "IntakeEngine: CaseC sport center notify failed"));
        const [updatedAvail] = await db
          .update(intakeSessionsTable)
          .set({ status: "ready_for_task", collectedFields: newCollected, missingFields: [], requiredFields: requiredFieldNames, completionPct: "100", lastQuestion: avail.message, lastMessage: message, lastMessageAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
          .where(eq(intakeSessionsTable.id, session.id))
          .returning();
        return { action: "ready_for_task", session: updatedAvail!, replyToUser: avail.message, collectedFields: newCollected, missingFields: [], requiredDocuments: stillMissingDocs };
      }

      // New slot also unavailable → show updated unavailability message
      const [updated] = await db
        .update(intakeSessionsTable)
        .set({ collectedFields: newCollected, missingFields: completeness.missingFieldNames, requiredFields: requiredFieldNames, completionPct: String(completeness.completionPct), lastQuestion: avail.message, lastMessage: message, lastMessageAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
        .where(eq(intakeSessionsTable.id, session.id))
        .returning();
      return { action: "continue_collecting", session: updated!, replyToUser: avail.message, collectedFields: newCollected, missingFields: completeness.missingFieldNames, requiredDocuments: stillMissingDocs };
    }

    // ── C-3: No usable new slot info → polite reminder with available slots ──
    const prevAvailMsg = String(existingCollected._avail_msg ?? "");
    const availSlotsHint = prevAvailMsg.includes("tersedia") ? "" :
      `\n\nSilakan pilih salah satu *jam yang tersedia* di atas, atau ketik *"ganti tanggal"* untuk memilih hari lain.`;
    const reminder =
      `Jadwal tersebut sudah terisi. Silakan pilih jam lain atau ketik *"ganti tanggal"* untuk hari lain.` +
      availSlotsHint;

    const [updated] = await db
      .update(intakeSessionsTable)
      .set({
        collectedFields:   newCollected,
        lastMessage:       message,
        lastMessageAt:     now,
        updatedAt:         now,
        expiresAt:         new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .where(eq(intakeSessionsTable.id, session.id))
      .returning();

    return {
      action:            "continue_collecting",
      session:           updated!,
      replyToUser:       reminder,
      collectedFields:   newCollected,
      missingFields:     completeness.missingFieldNames,
      requiredDocuments: stillMissingDocs,
    };
  }

  // Gate not applicable (e.g. missing field+date+time) → normal flow collects them
  return null;
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
  fonnteDevice,
}: {
  session: IntakeSession;
  message: string;
  attachmentUrl?: string | null;
  companyId: string;
  fonnteDevice?: string | null;
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

  // ── Pre-process: map numbered menu reply → lapangan name for sport center ──
  // If the last question was the lapangan menu and user replied with "1"–"6",
  // inject directly WITHOUT calling OpenAI to avoid loop when key is invalid.
  const FIELD_MENU_MAP: Record<string, string> = {
    "1": "Badminton", "2": "Futsal", "3": "Tennis",
    "4": "Basketball", "5": "Voli", "6": "GYM", "7": "Billiard",
  };

  // Keywords that mark a field_type as already-specific (user has chosen a real lapangan).
  // Uses substring/contains matching so "lapangan futsal", "main futsal", etc. are caught.
  const SPECIFIC_LAPANGAN_KEYWORDS = ["badminton", "futsal", "tennis", "basketball", "voli", "gym", "billiard"];
  const existingFieldTypeLower = String(existingCollected.field_type ?? "").toLowerCase().trim();
  const existingFieldNameLower = String(existingCollected.field_name ?? "").toLowerCase().trim();
  // A field is specific only if it contains one of the known lapangan keywords.
  // Generic values ("lapangan", "lapangan olahraga", "olahraga", "", etc.) are NOT specific.
  const lapanganAlreadySpecific =
    SPECIFIC_LAPANGAN_KEYWORDS.some((kw) => existingFieldTypeLower.includes(kw)) ||
    SPECIFIC_LAPANGAN_KEYWORDS.some((kw) => existingFieldNameLower.includes(kw));

  // Restrict digit interception further: only intercept when the session has NOT yet
  // run an availability check (i.e. _avail_status is absent). Once availability is
  // checked/confirmed, numeric answers belong to a different part of the flow.
  const availAlreadyChecked = !!existingCollected._avail_status || !!existingCollected._avail_confirmed;

  const isMenuQuestion = session.lastQuestion?.includes("Pilih lapangan") ?? false;
  const isDurationQuestion = session.lastQuestion?.toLowerCase().includes("durasi") ?? false;
  const trimmedMsg = message.trim();

  // Belt-and-suspenders: even if lastQuestion doesn't match the menu text
  // (e.g. due to encoding issues, session state drift, or AI extracted a generic
  // field_type like "lapangan" from the initial message), treat a single digit
  // "1"–"6" as a menu selection when:
  //   (a) sport_center_booking session
  //   (b) lapangan choice is not yet specific (absent OR still generic)
  //   (c) availability not yet checked (so we're still in the selection phase)
  const isDigitMenuReply =
    !isMenuQuestion &&
    !isDurationQuestion &&
    isSportCenterBookingIntent(session.intentCode) &&
    /^[1-7]$/.test(trimmedMsg) &&
    !lapanganAlreadySpecific &&
    !availAlreadyChecked;

  // Duration digit reply: user picks "1"–"5" from the duration menu shown in the
  // combined date+duration+name prompt (after lapangan is already specific).
  const DURATION_MENU_MAP: Record<string, string> = {
    "1": "1 jam", "2": "2 jam", "3": "3 jam", "4": "4 jam", "5": "5 jam",
  };
  const isDurationDigitReply =
    isDurationQuestion &&
    lapanganAlreadySpecific &&
    !availAlreadyChecked &&
    /^[1-5]$/.test(trimmedMsg);

  const menuLapangan = (isMenuQuestion || isDigitMenuReply) ? (FIELD_MENU_MAP[trimmedMsg] ?? null) : null;

  // Also try to match by name directly (e.g. user types "Futsal" instead of "2")
  // Also applies when isMenuQuestion=true even for named values
  const namedLapangan = (isMenuQuestion || isDigitMenuReply) && !menuLapangan
    ? Object.values(FIELD_MENU_MAP).find(
        (v) => v.toLowerCase() === trimmedMsg.toLowerCase(),
      ) ?? null
    : null;

  let newCollected: Record<string, unknown>;

  if (isDurationDigitReply) {
    // ── Duration digit selected from the numbered menu ──────────────────
    newCollected = {
      ...existingCollected,
      duration: DURATION_MENU_MAP[trimmedMsg]!,
    };
    logger.info({ duration: DURATION_MENU_MAP[trimmedMsg], from: session.phone }, "IntakeEngine: duration digit reply resolved directly");
  } else if (menuLapangan || namedLapangan) {
    // ── Direct injection — no OpenAI needed ──────────────────────────────
    // Detect the actual lapangan field key from dataFields so we work with
    // any template (field_type, field_name, jenis_lapangan, etc.).
    // Fallback aliases cover the hardcoded FIELD_LABEL_FALLBACK entries.
    const LAPANGAN_KEY_ALIASES = new Set(["field_type", "field_name", "jenis_lapangan", "lapangan", "nama_lapangan"]);
    const lapanganFieldKey = dataFields.find(
      (f) => LAPANGAN_KEY_ALIASES.has(f.fieldName.toLowerCase()),
    )?.fieldName ?? "field_type"; // safe fallback

    const lapanganValue = menuLapangan ?? namedLapangan!;
    newCollected = {
      ...existingCollected,
      [lapanganFieldKey]: lapanganValue,
      // Always also set field_type + field_name as aliases so the availability
      // gate (which reads newCollected.field_type ?? newCollected.field_name)
      // can always find the value regardless of template key used.
      field_type: lapanganValue,
      field_name: lapanganValue,
    };
    // Strip date/time if not already collected (anti-hallucination guard)
    const DATE_TIME_FIELDS = ["booking_date", "start_time", "end_time", "duration", "durasi", "tanggal_booking", "jam_booking"];
    for (const f of DATE_TIME_FIELDS) {
      if (!existingCollected[f]) {
        delete newCollected[f];
      }
    }
    logger.info({ lapangan: lapanganValue, key: lapanganFieldKey, from: session.phone }, "IntakeEngine: menu reply resolved directly — bypassing OpenAI");
  } else {
    // Normal path: call OpenAI to extract fields from free-text message
    newCollected = await extractFieldsFromMessage(
      message,
      dataFields,
      existingCollected,
      session.intentCode,
      sessionHistory,
    );

    // Discard a booker_name extracted by OpenAI if it doesn't look like a
    // plausible name (stray digit, confirmation word, symbols, etc.) — the
    // regex fallback below or a re-ask will recover it instead of silently
    // carrying garbage into the confirmation message.
    if (
      isSportCenterBookingIntent(session.intentCode) &&
      newCollected.booker_name &&
      !isValidBookerName(String(newCollected.booker_name))
    ) {
      logger.warn(
        { rejected: newCollected.booker_name, phone: session.phone },
        "IntakeEngine: OpenAI booker_name rejected by validation",
      );
      delete newCollected.booker_name;
    }

    // ── Regex fallbacks for Sport Center fields ───────────────────────────
    // OpenAI sometimes fails to extract fields (wrong key, timeout, context).
    // These run ONLY when the session is waiting for that type of info and
    // OpenAI did not populate the field — never overwrites a valid AI response.
    if (isSportCenterBookingIntent(session.intentCode)) {
      const lastQ = (session.lastQuestion ?? "").toLowerCase();
      const awaitingDateTime =
        lastQ.includes("tanggal") || lastQ.includes("jam") || lastQ.includes("mulai");
      const awaitingDuration = lastQ.includes("durasi");
      const awaitingName = lastQ.includes("nama");

      if (awaitingDateTime) {
        const { date: regexDate, time: regexTime } = extractDateTimeRegex(message);
        // Allow overwriting start_time / booking_date when availability was already
        // checked as "unavailable" — user is providing a new preferred slot.
        const availWasUnavailable = existingCollected._avail_status === "unavailable";
        if (regexDate && (!newCollected.booking_date || availWasUnavailable)) {
          newCollected = { ...newCollected, booking_date: regexDate };
          logger.info({ date: regexDate, phone: session.phone }, "IntakeEngine: booking_date via regex fallback");
        }
        if (regexTime && (!newCollected.start_time || availWasUnavailable)) {
          newCollected = { ...newCollected, start_time: regexTime };
          logger.info({ time: regexTime, phone: session.phone }, "IntakeEngine: start_time via regex fallback");
        }
      }

      // Duration regex: "2 jam", "3jam", "90 menit", "120 menit", or isolated digit
      // when the last question contained a duration menu.
      if ((awaitingDateTime || awaitingDuration) && !newCollected.duration && !newCollected.durasi) {
        const MENIT_TO_JAM: Record<string, number> = {
          "30": 0.5, "45": 0.75, "60": 1, "90": 1.5, "120": 2, "150": 2.5, "180": 3, "240": 4, "300": 5,
        };
        // Prefer an explicit "durasi X jam" / "selama X jam" phrase — this avoids
        // false positives like "tanggal 8 jam 18 durasi 3 jam" where a naive
        // "<number> jam" match would grab the "8" from the date instead of the
        // actual "3" duration.
        const durasiKeywordMatch = message.match(/(?:durasi|selama)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*jam/i);
        const durasiMenitKeywordMatch = !durasiKeywordMatch && message.match(/(?:durasi|selama)\s*[:\-]?\s*(\d+)\s*menit/i);
        // Generic fallback: bare "<n> jam" not immediately preceded by a date word
        // (e.g. "tanggal 8 jam 18" is date+time, not duration) and not immediately
        // followed by another number (which would mean it's actually a time like
        // "jam 18" continuing into a range).
        const genericJamMatch = !durasiKeywordMatch && !durasiMenitKeywordMatch
          ? message.match(/(?<!tan(?:ggal?|gl)\s)(\d+(?:[.,]\d+)?)\s*jam(?!\s*\d)/i)
          : null;
        const genericMenitMatch = !durasiKeywordMatch && !durasiMenitKeywordMatch && !genericJamMatch
          ? message.match(/(\d+)\s*menit/i)
          : null;
        const durJamMatch = durasiKeywordMatch ?? genericJamMatch;
        const durMenitMatch = durasiMenitKeywordMatch ?? genericMenitMatch;
        if (durJamMatch) {
          newCollected = { ...newCollected, duration: `${durJamMatch[1]!.replace(",", ".")} jam` };
          logger.info({ duration: newCollected.duration, phone: session.phone }, "IntakeEngine: duration (jam) via regex fallback");
        } else if (durMenitMatch) {
          const jam = MENIT_TO_JAM[durMenitMatch[1]!] ?? Math.round(parseInt(durMenitMatch[1]!, 10) / 60 * 2) / 2;
          newCollected = { ...newCollected, duration: `${jam} jam` };
          logger.info({ duration: newCollected.duration, phone: session.phone }, "IntakeEngine: duration (menit→jam) via regex fallback");
        } else if (awaitingDuration && /^[1-5]$/.test(message.trim())) {
          // Single digit — last resort when isDurationDigitReply check was bypassed
          newCollected = { ...newCollected, duration: `${message.trim()} jam` };
          logger.info({ duration: newCollected.duration, phone: session.phone }, "IntakeEngine: duration digit via regex fallback");
        }
      }

      // Booker name regex: "nama Robby", "nama pemesan: Robby", "atas nama Robby"
      // Captures one or more words after "nama", stopping before field-keyword
      // boundaries (jam, tanggal, durasi, etc.) so "nama Ahmad jam 10" → "Ahmad",
      // "nama Budi Santoso durasi 2 jam" → "Budi Santoso".
      if ((awaitingDateTime || awaitingName) && !newCollected.booker_name) {
        const nameMatch = message.match(
          /(?:nama(?:\s+pemesan)?|pemesan|atas\s+nama)\s*[:\-]?\s*([A-Za-z][A-Za-z.'-]*(?:\s+(?!(?:jam|tanggal|durasi|waktu|menit|hari|bulan)\b)[A-Za-z][A-Za-z.'-]*)*)/i,
        );
        if (nameMatch?.[1] && isValidBookerName(nameMatch[1].trim())) {
          newCollected = { ...newCollected, booker_name: nameMatch[1]!.trim() };
          logger.info({ booker_name: newCollected.booker_name, phone: session.phone }, "IntakeEngine: booker_name via regex fallback");
        } else if (
          awaitingName &&
          !nameMatch &&
          isValidBookerName(message.trim()) &&
          message.trim().split(/\s+/).length <= 4
        ) {
          // User was asked specifically for a name and replied with a bare
          // name (no "nama ..." prefix), e.g. just "Robby" or "Budi Santoso".
          newCollected = { ...newCollected, booker_name: message.trim() };
          logger.info({ booker_name: newCollected.booker_name, phone: session.phone }, "IntakeEngine: booker_name via bare-reply fallback");
        }
      }
    }
  }

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

  // ── 6-SPORT: Sport Center availability gate ────────────────────────────────
  // Runs for booking_lapangan / sport_center_booking intents BEFORE the
  // isComplete check.  Intercepts the flow to:
  //   A. Check availability once date + time + field_type are known
  //   B. Show available/unavailable result + ask for confirmation
  //   C. Let flow continue only after user confirms
  if (isSportCenterBookingIntent(session.intentCode)) {
    const gateResult = await runSportCenterAvailabilityGate({
      session,
      message,
      newCollected,
      existingCollected,
      requiredFieldNames,
      completeness,
      stillMissingDocs,
      companyId,
      now,
      dataFields,
      fonnteDevice,
    });
    if (gateResult !== null) return gateResult;
    // null → gate satisfied (confirmed or not applicable) → fall through
  }

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

    const completionMsg = await generateCompletionMessage(session.intentCode, newCollected, dataFields);

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
