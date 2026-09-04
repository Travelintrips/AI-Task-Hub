/**
 * Sport Center Availability Engine
 *
 * Checks field booking availability before sending the mini-form.
 * Flow:
 *   1. User provides field_type + booking_date + start_time
 *   2. We query sport_center_bookings for conflicts
 *   3. Reply with availability status + available slots (if any conflict)
 *   4. User confirms → mark _avail_confirmed = true → proceed to form
 */

import { supabasePool, supabaseQuery, supabaseQueryStrict } from "./supabase-db";
import { logger } from "./logger";

// ── Intent detection ───────────────────────────────────────────────────────────

const SPORT_CENTER_INTENT_PATTERNS = [
  "booking_lapangan",
  "sport_center_booking",
  "booking_olahraga",
  "field_booking",
  "lapangan_booking",
  "daftar_membership",
];

export function isSportCenterBookingIntent(intentCode: string): boolean {
  const lower = intentCode.toLowerCase();
  return SPORT_CENTER_INTENT_PATTERNS.some((p) => lower.includes(p));
}

// ── Confirmation detection ─────────────────────────────────────────────────────

const CONFIRM_PATTERNS =
  /^(ya|iya|oke|ok|baik|setuju|benar|betul|lanjut|bisa|boleh|yap|yep|yes|confirm|fix|pas|cocok|deal)\s*[!.?]*$/i;

export function isAvailabilityConfirmation(message: string): boolean {
  return CONFIRM_PATTERNS.test(message.trim());
}

// ── Date/time helpers ─────────────────────────────────────────────────────────

/** Parse "HH:MM" / "HH.MM" / "pukul HH:MM" / "jam HH" → minutes since midnight */
export function timeToMinutes(time: string): number {
  // Strip prefix words like "pukul", "jam", "pk"
  const cleaned = time.trim().toLowerCase()
    .replace(/^(pukul|jam|pk|at)\s+/, "")
    .replace(/[.,]/g, ":");     // "15.00" → "15:00"
  const m = cleaned.match(/^(\d{1,2})(?::(\d{2}))?/);
  if (!m) return -1;
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2] ?? "0", 10);
  if (h > 23 || min > 59) return -1;
  return h * 60 + min;
}

/** Minutes → "HH:MM" */
export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Normalize various Indonesian date formats to YYYY-MM-DD */
export function normalizeDateString(dateStr: string): string | null {
  if (!dateStr) return null;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // DD/MM/YYYY or DD-MM-YYYY
  const slashFmt = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slashFmt) {
    return `${slashFmt[3]}-${String(slashFmt[2]).padStart(2, "0")}-${String(slashFmt[1]).padStart(2, "0")}`;
  }
  // "5 Juli", "5 Juli 2025"
  const MONTHS: Record<string, string> = {
    januari: "01", februari: "02", maret: "03", april: "04",
    mei: "05", juni: "06", juli: "07", agustus: "08",
    september: "09", oktober: "10", november: "11", desember: "12",
  };
  const wordFmt = dateStr.toLowerCase().match(
    /(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+(\d{4}))?/,
  );
  if (wordFmt) {
    const year = wordFmt[3] ?? String(new Date().getFullYear());
    return `${year}-${MONTHS[wordFmt[2]!]}-${String(wordFmt[1]).padStart(2, "0")}`;
  }
  // "tanggal 5" or just "5" → assume current month
  const dayOnlyFmt = dateStr.trim().toLowerCase().match(/^(?:tanggal\s+)?(\d{1,2})$/);
  if (dayOnlyFmt) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(dayOnlyFmt[1]).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

/** Format YYYY-MM-DD → "5 Juli 2025" */
export function formatDateIndo(isoDate: string): string {
  const MONTHS = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  // Try as YYYY-MM-DD first (most common path)
  const d = new Date(isoDate + "T12:00:00Z");
  if (!isNaN(d.getTime())) return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!} ${d.getUTCFullYear()}`;
  // Fallback: parse as generic date string (e.g. JS Date.toString() like "Sun Jul 19 2026 ...")
  const d2 = new Date(isoDate);
  if (!isNaN(d2.getTime())) return `${d2.getDate()} ${MONTHS[d2.getMonth()]!} ${d2.getFullYear()}`;
  return isoDate;
}

/** Extract duration in hours from collected fields */
export function extractDurationHours(fields: Record<string, unknown>): number {
  const dur = String(fields.duration ?? fields.durasi ?? "1 jam").toLowerCase().trim();
  const MAP: Record<string, number> = {
    "1 jam": 1, "1.5 jam": 1.5, "1,5 jam": 1.5, "2 jam": 2, "2.5 jam": 2.5,
    "2,5 jam": 2.5, "3 jam": 3, "4 jam": 4, "5 jam": 5,
    "45 menit": 0.75, "60 menit": 1, "90 menit": 1.5, "120 menit": 2,
  };
  if (MAP[dur] !== undefined) return MAP[dur]!;
  const match = dur.match(/^(\d+(?:[.,]\d+)?)\s*jam/);
  if (match) return parseFloat(match[1]!.replace(",", "."));
  return 1; // default 1 hour
}

// ── Mini-form start-time availability (CST-DEV) ─────────────────────────────

export interface SportCenterStartTimeAvailability {
  checkedDate: string;
  durationMinutes: number;
  facilityIds: number[];
  availableSlots: string[];
}

interface SportCenterFacilityRow {
  id: number;
  name: string;
  category: string | null;
  open_time: string | null;
  close_time: string | null;
}

export async function getSportCenterFacilityOptions(): Promise<string[]> {
  const facilityRows = await supabaseQueryStrict<
    Pick<SportCenterFacilityRow, "name" | "category">
  >(
    `SELECT name, category
       FROM sport_center.sport_facilities
      WHERE is_active = true
      ORDER BY id`,
  );

  const options = Array.from(
    new Set(
      facilityRows
        .map((facility) => (facility.category ?? facility.name).trim())
        .filter(Boolean),
    ),
  );
  if (options.length === 0) {
    throw new Error("Tidak ada jenis lapangan aktif di CST-DEV");
  }
  return options;
}

interface SportCenterBookingSlotRow {
  facility_id: number;
  start_time: string;
  end_time: string | null;
}

const MINI_FORM_LATEST_START_HOUR = 23;
const MINI_FORM_EFFECTIVE_CLOSE_MINUTES = 24 * 60;

/**
 * Return start times that are free on at least one facility matching the
 * selected sport. The mini-form runs in development against CST-DEV, where
 * the source of truth is sport_center.sport_bookings.
 */
export async function getAvailableSportCenterStartTimes({
  fieldType,
  bookingDate,
  durationHours = 1,
}: {
  fieldType: string;
  bookingDate: string;
  durationHours?: number;
}): Promise<SportCenterStartTimeAvailability> {
  const normalizedDate = normalizeDateString(bookingDate);
  if (!normalizedDate) {
    throw new Error("Format tanggal tidak valid");
  }

  const durationMinutes = Math.max(60, Math.round((durationHours || 1) * 60));
  const facilityRows = await supabaseQueryStrict<SportCenterFacilityRow>(
    `SELECT id, name, category, open_time, close_time
       FROM sport_center.sport_facilities
      WHERE is_active = true
      ORDER BY id`,
  );

  if (facilityRows.length === 0) {
    throw new Error("Tidak ada fasilitas olahraga aktif di CST-DEV");
  }

  const normalizedFieldType = fieldType.toLowerCase().trim();
  const isOther = normalizedFieldType === "lainnya" || normalizedFieldType === "other";
  const categoryAliases =
    normalizedFieldType.includes("badminton")
      ? ["badminton"]
      : normalizedFieldType.includes("tenis") || normalizedFieldType.includes("tennis")
        ? ["tenis", "tennis"]
        : normalizedFieldType.includes("futsal") ||
            normalizedFieldType.includes("basket") ||
            normalizedFieldType.includes("voli") ||
            normalizedFieldType.includes("sepak bola")
          ? ["multi guna", "multiguna", "futsal", "basket", "voli", "sepak bola"]
          : normalizedFieldType.includes("gym")
            ? ["gym"]
            : normalizedFieldType.includes("billiard")
              ? ["billiard"]
              : [normalizedFieldType];

  const facilities = facilityRows.filter((facility) => {
    if (isOther) return true;
    const category = (facility.category ?? "").toLowerCase().trim();
    const name = facility.name.toLowerCase();
    return categoryAliases.some(
      (alias) => category === alias || category.includes(alias) || name.includes(alias),
    );
  });

  if (facilities.length === 0) {
    throw new Error(`Fasilitas untuk jenis lapangan "${fieldType}" tidak ditemukan`);
  }

  const facilityIds = facilities.map((facility) => facility.id);
  const bookings = await supabaseQueryStrict<SportCenterBookingSlotRow>(
    `SELECT facility_id, start_time, end_time
       FROM sport_center.sport_bookings
      WHERE booking_date = $1
        AND facility_id = ANY($2)
        AND COALESCE(CAST(status AS TEXT), '') NOT IN
            ('cancelled', 'rejected', 'expired', 'completed')`,
    [normalizedDate, facilityIds],
  );

  const bookingsByFacility = new Map<number, Array<{ start: number; end: number }>>();
  for (const booking of bookings) {
    const start = timeToMinutes(booking.start_time);
    const end = booking.end_time
      ? timeToMinutes(booking.end_time)
      : start + 60;
    if (start < 0 || end <= start) continue;
    const existing = bookingsByFacility.get(booking.facility_id) ?? [];
    existing.push({ start, end });
    bookingsByFacility.set(booking.facility_id, existing);
  }

  // Keep the same hourly choices as the existing form, but do not offer a
  // start time whose requested duration would pass the facility's closing time.
  const availableSlots: string[] = [];
  for (let hour = OPEN_HOUR; hour <= MINI_FORM_LATEST_START_HOUR; hour++) {
    const start = hour * 60;
    const end = start + durationMinutes;
    const hasFreeFacility = facilities.some((facility) => {
      const open = timeToMinutes(facility.open_time ?? `${OPEN_HOUR}:00`);
      // The customer-facing mini-form accepts starts through 23:00. Treat
      // midnight as the effective close for this form even though the legacy
      // facility rows still contain close_time=22:00.
      const configuredClose = timeToMinutes(
        facility.close_time ?? `${CLOSE_HOUR}:00`,
      );
      const close = Math.max(configuredClose, MINI_FORM_EFFECTIVE_CLOSE_MINUTES);
      if (start < open || end > close) return false;
      return !(bookingsByFacility.get(facility.id) ?? []).some(
        (booking) => start < booking.end && end > booking.start,
      );
    });
    if (hasFreeFacility) availableSlots.push(minutesToTime(start));
  }

  return {
    checkedDate: normalizedDate,
    durationMinutes,
    facilityIds,
    availableSlots,
  };
}

// ── Booker name validation ──────────────────────────────────────────────────────

const NAME_BLACKLIST = new Set([
  "ya", "iya", "tidak", "gak", "ga", "oke", "ok", "baik", "siap", "setuju",
  "benar", "betul", "lanjut", "bisa", "boleh", "yap", "yep", "yes", "no",
  "confirm", "fix", "pas", "cocok", "deal", "batal", "cancel",
]);

/**
 * Validates a booker name is a plausible human name, not a stray digit,
 * confirmation word, or garbage extracted by mistake.
 * - Letters/spaces/dots/apostrophes/hyphens only (supports common Indonesian names)
 * - No digits or other symbols
 * - 2–50 chars
 * - Not a generic filler/confirmation word
 */
export function isValidBookerName(name: string | undefined | null): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 50) return false;
  if (/\d/.test(trimmed)) return false;
  if (!/^[A-Za-z\u00C0-\u017F][A-Za-z\u00C0-\u017F.'\- ]*$/.test(trimmed)) return false;
  if (NAME_BLACKLIST.has(trimmed.toLowerCase())) return false;
  return true;
}

// ── Operating hours ────────────────────────────────────────────────────────────

const OPEN_HOUR = 7;   // 07:00
const CLOSE_HOUR = 22; // 22:00

// ── Availability check ────────────────────────────────────────────────────────

export interface AvailabilityResult {
  isAvailable: boolean;
  checkedDate: string;           // YYYY-MM-DD
  checkedDateIndo: string;       // "5 Juli 2025"
  availableSlots: string[];      // ["07:00", "08:00", ...] — free 1-hr slots
  message: string;               // Ready-to-send WA message
}

export async function checkSportCenterAvailability({
  fieldType,
  bookingDate,
  startTime,
  durationHours = 1,
  companyId,
  bookerName,
}: {
  fieldType: string;
  bookingDate: string;
  startTime: string;
  durationHours?: number;
  companyId: string;
  bookerName?: string;
}): Promise<AvailabilityResult> {
  const normalizedDate = normalizeDateString(bookingDate);
  if (!normalizedDate) {
    return {
      isAvailable: false,
      checkedDate: bookingDate,
      checkedDateIndo: bookingDate,
      availableSlots: [],
      message:
        `Format tanggal "*${bookingDate}*" tidak dikenali.\n` +
        `Mohon kirimkan tanggal dengan format seperti *"5 Juli"* atau *"05/07/2025"*.`,
    };
  }

  const reqStartMin = timeToMinutes(startTime);
  const reqEndMin = reqStartMin + Math.round(durationHours * 60);

  if (reqStartMin < 0) {
    return {
      isAvailable: false,
      checkedDate: normalizedDate,
      checkedDateIndo: formatDateIndo(normalizedDate),
      availableSlots: [],
      message:
        `Format jam "*${startTime}*" tidak dikenali.\n` +
        `Contoh: *"10:00"*, *"14:30"*, *"pukul 15.00"*.`,
    };
  }

  // Clamp to operating hours
  const openMin = OPEN_HOUR * 60;
  const closeMin = CLOSE_HOUR * 60;
  if (reqStartMin < openMin || reqStartMin >= closeMin) {
    return {
      isAvailable: false,
      checkedDate: normalizedDate,
      checkedDateIndo: formatDateIndo(normalizedDate),
      availableSlots: [],
      message:
        `Jam operasional kami adalah *07:00 – 22:00*.\n` +
        `Jam *${startTime}* di luar jam operasional. Silakan pilih jam lain.`,
    };
  }

  const dateIndo = formatDateIndo(normalizedDate);
  // Normalize field_type: strip generic prefix words ("lapangan"), use the sport name
  // e.g. "Lapangan Badminton" → "badminton", "Futsal" → "futsal"
  const STRIP_WORDS = new Set(["lapangan", "court", "area", "sport", "center"]);
  const keywords = fieldType.toLowerCase().split(/\s+/).filter(w => !STRIP_WORDS.has(w));
  const rawKeyword = keywords[0] ?? fieldType.toLowerCase();

  // Futsal, basket/basketball, voli/volleyball → disimpan sebagai "Lapangan Multiguna" di sport_bookings
  const MULTIGUNA_SPORTS = new Set(["futsal", "basket", "basketball", "voli", "volley", "volleyball", "bola voli"]);
  const fieldKeyword = MULTIGUNA_SPORTS.has(rawKeyword) ? "multiguna" : rawKeyword;

  try {
    // Query dari public.sport_bookings di Supabase — sumber kebenaran ketersediaan lapangan
    interface BookingRow { start_time: string; end_time: string | null }
    const rows = await supabaseQuery<BookingRow>(`
      SELECT start_time::text, end_time::text
      FROM   public.sport_bookings
      WHERE  company_id   = 1
        AND  booking_date = $1
        AND  (LOWER(facility_name) ILIKE $2 OR $3 = 'all')
        AND  status NOT IN ('cancelled','rejected')
    `, [normalizedDate, `%${fieldKeyword}%`, fieldKeyword === "all" ? "all" : "no"]);

    // Build list of booked minute-ranges
    const booked = rows.map((r) => ({
      s: timeToMinutes(r.start_time),
      e: r.end_time ? timeToMinutes(r.end_time) : timeToMinutes(r.start_time) + 60,
    }));

    // Determine free 1-hour slots for the day
    const freeSlots: string[] = [];
    for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
      const s = h * 60;
      const e = s + 60;
      const isBooked = booked.some((b) => s < b.e && e > b.s);
      if (!isBooked) freeSlots.push(minutesToTime(s));
    }

    // Check if requested slot overlaps any booking
    const hasConflict = booked.some((b) => reqStartMin < b.e && reqEndMin > b.s);

    if (!hasConflict) {
      return {
        isAvailable: true,
        checkedDate: normalizedDate,
        checkedDateIndo: dateIndo,
        availableSlots: freeSlots,
        message: buildAvailableMessage(fieldType, dateIndo, startTime, minutesToTime(reqEndMin), durationHours, bookerName),
      };
    }

    // Unavailable — suggest alternatives
    const altList = freeSlots.length > 0
      ? `\n\n*Jam yang masih tersedia hari itu:*\n${freeSlots.slice(0, 8).map((s) => `• ${s}`).join("\n")}\n\nSilakan pilih jam lain yang cocok.`
      : "\n\nMaaf, semua slot untuk hari itu sudah penuh. Coba hari lain ya! 🙏";

    return {
      isAvailable: false,
      checkedDate: normalizedDate,
      checkedDateIndo: dateIndo,
      availableSlots: freeSlots,
      message:
        `❌ Maaf, lapangan *${fieldType}* pada:\n` +
        `📅 *${dateIndo}* jam *${startTime}*\n` +
        `sudah terisi.` +
        altList,
    };
  } catch (err) {
    logger.warn({ err, companyId, fieldType, bookingDate: normalizedDate }, "sport-center-availability: DB query failed — assuming available");
    return {
      isAvailable: true,
      checkedDate: normalizedDate,
      checkedDateIndo: dateIndo,
      availableSlots: [],
      message: buildAvailableMessage(fieldType, dateIndo, startTime, minutesToTime(reqEndMin), durationHours, bookerName),
    };
  }
}

export function buildAvailableMessage(
  fieldType: string,
  dateIndo: string,
  startTime: string,
  _endTime: string,
  durationHours: number = 1,
  bookerName?: string,
  bookingCode?: string | null,
): string {
  // Normalise startTime: strip leading words like "jam", "pukul", "pk" so we
  // always display the plain HH:MM the user typed (e.g. "12:00" not "jam 12:00").
  const displayTime = startTime.trim()
    .replace(/^(pukul|jam|pk|at)\s+/i, "")
    .replace(/[.,]/g, ":")
    .replace(/^(\d{1,2})$/, "$1:00"); // "12" → "12:00"

  const isBilliard = fieldType.toLowerCase().trim() === "billiard";
  const unitLabel = isBilliard ? "Coin" : "Jam";
  const durationLabel = `${durationHours} ${unitLabel}`;

  const PRICE_PER_UNIT: Record<string, number> = {
    futsal:     350_000,
    badminton:  100_000,
    tennis:     100_000,
    basketball: 350_000,
    voli:       350_000,
    gym:         50_000,
    billiard:    50_000,
  };
  const pricePerUnit = PRICE_PER_UNIT[fieldType.toLowerCase().trim()];
  const totalPrice = pricePerUnit ? pricePerUnit * durationHours : null;
  const hargaPart = totalPrice
    ? `💰 Harga      : *Rp ${totalPrice.toLocaleString("id-ID")}*\n`
    : "";

  const namePart = bookerName?.trim()
    ? `👤 Nama Pemesan : *${bookerName.trim()}*\n`
    : "";

  const codePart = bookingCode
    ? `🎟️ Kode Booking : *${bookingCode}*\n`
    : "";

  return (
    `✅ *Jadwal Tersedia!*\n\n` +
    codePart +
    `🏟️ Lapangan : *${fieldType}*\n` +
    `📅 Tanggal  : *${dateIndo}*\n` +
    `⏰ Jam      : *${displayTime}*\n` +
    `⏱️ Durasi   : *${durationLabel}*\n` +
    hargaPart +
    namePart +
    `\nSilakan balas *YA* untuk konfirmasi booking ini ya. 🙏`
  );
}

// ── Pricing table (Rp per hour / per coin for Billiard) ──────────────────────

export const SC_PRICE_PER_HOUR: Record<string, number> = {
  futsal:     350_000,
  badminton:  100_000,
  tennis:     100_000,
  basketball: 350_000,
  voli:       350_000,
  gym:         50_000,
  billiard:    50_000,
};

export function calcTotalPrice(fieldType: string, durationHours: number): number {
  const ft = fieldType.toLowerCase().trim();
  const price = SC_PRICE_PER_HOUR[ft] ?? 100_000;
  return Math.round(price * Math.max(durationHours, 1));
}

export function getPricePerHour(fieldType: string): number {
  return SC_PRICE_PER_HOUR[fieldType.toLowerCase().trim()] ?? 100_000;
}

// ── Reserve a booking code early (during availability check) ─────────────────
// Called when a slot is confirmed available — before the customer says "ya".
// This lets us show the booking code in the "Jadwal Tersedia!" message.
// The code is stored in collectedFields._booking_code and passed to
// saveSportCenterBooking so no second number is generated on finalization.
// Sequence gaps are acceptable if the customer never confirms.

export async function reserveBookingCode(companyId: string): Promise<string | null> {
  // Simple direct query — no transaction or advisory lock needed here.
  // This is compatible with Supabase Pooler (PgBouncer transaction mode, port 6543).
  try {
    const rows = await supabaseQuery<{ max_seq: string | null }>(
      `SELECT COALESCE(MAX(
         NULLIF(REGEXP_REPLACE(booking_number, '[^0-9]', '', 'g'), '')::integer
       ), 0) AS max_seq
       FROM sport_center_bookings
       WHERE company_id = $1`,
      [companyId],
    );
    const maxSeq = parseInt(rows[0]?.max_seq ?? "0", 10) || 0;
    return `SC-AI-${String(maxSeq + 1).padStart(5, "0")}`;
  } catch (err) {
    logger.warn({ err, companyId }, "reserveBookingCode: failed");
    return null;
  }
}

// ── Generate next booking number (SC-XXXX, per-company, race-safe) ───────────
//
// Uses pg_advisory_xact_lock keyed on company hash to serialize concurrent
// inserts within the same company.  The lock is released automatically when
// the surrounding transaction commits/rolls back.

async function generateBookingNumber(
  client: import("pg").PoolClient,
  companyId: string,
): Promise<string> {
  // NOTE: pg_advisory_xact_lock is NOT used here because Supabase Pooler
  // (port 6543, PgBouncer transaction mode) does not support advisory locks.
  // Concurrency safety relies on the UNIQUE constraint on (company_id, booking_number)
  // — the INSERT in saveSportCenterBooking will retry with an incremented sequence
  // on conflict. Concurrent duplicate bookings are extremely rare in practice.

  // Use MAX of the numeric suffix so deletes never cause reuse.
  // booking_number format is 'SC-AI-NNNNN'; extract the integer part.
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(
       NULLIF(REGEXP_REPLACE(booking_number, '[^0-9]', '', 'g'), '')::integer
     ), 0) AS max_seq
     FROM sport_center_bookings
     WHERE company_id = $1`,
    [companyId],
  );
  const maxSeq = parseInt((rows[0] as { max_seq: string | null }).max_seq ?? "0", 10) || 0;
  return `SC-AI-${String(maxSeq + 1).padStart(5, "0")}`;
}

// ── SC domain helper ──────────────────────────────────────────────────────────

export function getScDomain(): string {
  return (
    process.env.SC_DOMAIN ??
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://sc.travelintrips.co.id")
  );
}

// ── Bank/payment settings ─────────────────────────────────────────────────────

export function getPaymentInfo(): { bankName: string; bankAccount: string; bankHolder: string } {
  return {
    bankName:    process.env.SC_BANK_NAME    ?? "Bank Mandiri",
    bankAccount: process.env.SC_BANK_ACCOUNT ?? "1640006707220",
    bankHolder:  process.env.SC_BANK_HOLDER  ?? "PT Cahaya Sejati Teknologi",
  };
}

// ── Build WA confirmation message for customer ────────────────────────────────

export function buildBookingConfirmationWA(params: {
  phone: string;
  bookingNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime?: string | null;
  totalPrice: number;
  paymentDeadline: Date;
  paymentProofToken: string;
}): string {
  const domain = getScDomain();
  const { bankName, bankAccount, bankHolder } = getPaymentInfo();
  const deadlineStr = params.paymentDeadline.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const timeRange = params.endTime
    ? `${params.startTime} - ${params.endTime}`
    : params.startTime;
  const priceStr = params.totalPrice.toLocaleString("id-ID");
  const shortPhone = params.phone.replace(/^62/, "0");

  return (
    `Halo ${shortPhone}! Booking Anda berhasil dibuat.\n\n` +
    `Nomor Order: *${params.bookingNumber}*\n` +
    `Fasilitas: ${params.facilityName}\n` +
    `Tanggal: ${params.bookingDate}\n` +
    `Jam: ${timeRange}\n` +
    `Total: *Rp ${priceStr}*\n\n` +
    `Silakan lakukan pembayaran sebelum ${deadlineStr} ke:\n` +
    `Bank: ${bankName}\n` +
    `No. Rek: ${bankAccount}\n` +
    `a.n. ${bankHolder}\n\n` +
    `Kirim bukti transfer ke WA ini setelah membayar. Terima kasih!\n\n` +
    `📎 Upload bukti transfer:\n${domain}/sc/bukti/${params.paymentProofToken}\n` +
    `🔍 Cek status booking:\n${domain}/sc/status/${params.paymentProofToken}`
  );
}

// ── Build WA admin group notification ────────────────────────────────────────

export function buildAdminNotifWA(params: {
  bookingNumber: string;
  facilityName: string;
  bookingDate: string;
  startTime: string;
  endTime?: string | null;
  durationHours?: number | string | null;
  bookerName?: string | null;
  phone: string;
  totalPrice: number;
  customerConfirmationMsg?: string | null;
}): string {
  const timeRange = params.endTime
    ? `${params.startTime} - ${params.endTime}`
    : params.startTime;
  const priceStr = params.totalPrice.toLocaleString("id-ID");
  const shortPhone = params.phone.replace(/^62/, "0");
  const durationNum = params.durationHours != null ? Number(params.durationHours) : null;
  const durationStr = durationNum != null && !Number.isNaN(durationNum)
    ? `${durationNum % 1 === 0 ? durationNum : durationNum.toFixed(1)} Jam`
    : "—";

  return (
    `Booking Baru-Dari AI Task\n\n` +
    `Kode Booking: ${params.bookingNumber}\n` +
    `🏟️ Lapangan : ${params.facilityName}\n` +
    `📅 Tanggal  : ${formatDateIndo(params.bookingDate)}\n` +
    `⏰ Jam      : ${timeRange}\n` +
    `⏱️ Durasi   : ${durationStr}\n` +
    `💰 Harga      : Rp ${priceStr}\n` +
    `👤 Nama Pemesan : ${params.bookerName ?? "—"}\n` +
    `No.WA : ${shortPhone}\n\n` +
    `✅ Segera konfirmasi ke user/customer.`
  );
}

// ── Save booking record ───────────────────────────────────────────────────────

export interface SavedBooking {
  id: number;
  bookingNumber: string;
  facilityName: string;
  fieldType: string;
  bookingDate: string;
  startTime: string;
  endTime?: string | null;
  durationHours?: number | null;
  totalPrice: number;
  paymentStatus: string;
  paymentProofToken: string;
  paymentDeadline: Date;
  bookerName?: string | null;
  phone?: string | null;
  status: string;
}

export async function saveSportCenterBooking(params: {
  companyId: string;
  aiTaskId?: number | null;
  intakeSessionId?: number | null;
  fieldType: string;
  bookingDate: string;
  startTime: string;
  endTime?: string | null;
  durationHours?: number | null;
  bookerName?: string | null;
  phone?: string | null;
  notes?: string | null;
  /** Pre-generated booking code from reserveBookingCode(). If provided, skips DB sequence generation. */
  bookingNumber?: string | null;
}): Promise<SavedBooking | null> {
  const pool = supabasePool;
  if (!pool) return null;

  const normalizedDate = normalizeDateString(params.bookingDate) ?? params.bookingDate;
  const durationHours  = params.durationHours ?? 1;
  const pricePerHour   = getPricePerHour(params.fieldType);
  const totalPrice     = calcTotalPrice(params.fieldType, durationHours);
  const paymentDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  // Facility display name
  const facilityMap: Record<string, string> = {
    badminton: "Badminton Court A", futsal: "Lapangan Futsal",
    tennis: "Lapangan Tennis", basketball: "Lapangan Basketball",
    voli: "Lapangan Voli", gym: "GYM", billiard: "Meja Billiard",
  };
  const facilityName = facilityMap[params.fieldType.toLowerCase().trim()] ?? params.fieldType;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check for duplicate: same session + field + date + start_time
    if (params.intakeSessionId) {
      const dup = await client.query(
        `SELECT id FROM sport_center_bookings
         WHERE intake_session_id = $1 AND booking_date = $2 AND start_time = $3 AND company_id = $4
         LIMIT 1`,
        [params.intakeSessionId, normalizedDate, params.startTime, params.companyId],
      );
      if ((dup.rows?.length ?? 0) > 0) {
        await client.query("ROLLBACK");
        logger.info({ sessionId: params.intakeSessionId }, "saveSportCenterBooking: duplicate skipped");
        const existing = await client.query(
          `SELECT * FROM sport_center_bookings WHERE id = $1`, [dup.rows[0]?.id]);
        // client.release() is handled by finally block — do NOT call it here
        const row = existing.rows[0];
        if (row) return rowToSavedBooking(row);
        return null;
      }
    }

    // Use pre-generated booking code if provided (reserved at availability-check time),
    // otherwise generate a new one inside this transaction.
    // On rare UNIQUE conflict (concurrent bookings), retry up to 3 times with next sequence.
    const { randomBytes } = await import("crypto");
    const paymentProofToken = randomBytes(8).toString("base64url");

    let bookingNumber = params.bookingNumber ?? await generateBookingNumber(client, params.companyId);
    let insertResult: import("pg").QueryResult | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        insertResult = await client.query(
          `INSERT INTO sport_center_bookings
             (company_id, ai_task_id, intake_session_id,
              field_type, facility_name, booking_date, start_time, end_time, duration_hours,
              customer_name, phone, notes, status,
              booking_number, price_per_hour, total_price,
              payment_status, payment_proof_token, payment_deadline)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14,$15,'unpaid',$16,$17)
           RETURNING *`,
          [
            params.companyId,
            params.aiTaskId ?? null,
            params.intakeSessionId ?? null,
            params.fieldType,
            facilityName,
            normalizedDate,
            params.startTime,
            params.endTime ?? null,
            durationHours,
            params.bookerName ?? null,
            params.phone ?? null,
            params.notes ?? null,
            bookingNumber,
            pricePerHour,
            totalPrice,
            paymentProofToken,
            paymentDeadline,
          ],
        );
        break; // success — exit retry loop
      } catch (insertErr: unknown) {
        const pgErr = insertErr as { code?: string; constraint?: string };
        if (pgErr.code === "23505" && attempt < 2) {
          // UNIQUE violation on booking_number — get next number and retry
          logger.warn({ bookingNumber, attempt }, "saveSportCenterBooking: booking_number conflict, retrying");
          bookingNumber = await generateBookingNumber(client, params.companyId);
        } else {
          throw insertErr; // non-conflict error or exhausted retries → rethrow
        }
      }
    }

    await client.query("COMMIT");
    const saved = insertResult!.rows[0];
    logger.info(
      { bookingNumber, companyId: params.companyId, fieldType: params.fieldType },
      "sport_center_booking saved",
    );
    return rowToSavedBooking(saved);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.warn({ err }, "saveSportCenterBooking: non-fatal DB error");
    return null;
  } finally {
    client.release();
  }
}

// ── Bridge: sync WA booking into sport_center.sport_bookings + public.sport_bookings ──
//
// Called after saveSportCenterBooking() succeeds.  Non-fatal — if this fails
// the WA flow continues normally; only the sync to the web/admin SC tables is skipped.
//
// Mapping field_type → facility_id  (PRODUCTION IDs):
//   sport_center.sport_facilities: id=1 Multiguna, id=2 Badminton B, id=4 Tennis, id=5 Badminton A, id=6 Gym, id=7 Billiard
//   public.sport_facilities      : id=1 Gym, id=2 Multiguna, id=3 Badminton B, id=4 Tennis, id=5 Badminton A, id=6 Billiard

const SC_FACILITY_MAP: Record<string, number> = {
  badminton: 5,                                              // Badminton Court A
  tenis: 4, tennis: 4,                                      // Lapangan Tennis Outdoor
  gym: 6,                                                    // Gym / Fitness Center
  billiard: 7,                                               // Billiard Coins
  futsal: 1, "multi guna": 1, basketball: 1, basket: 1, voli: 1, // Lapangan Multiguna
};

const PUB_FACILITY_MAP: Record<string, number | null> = {
  badminton: 5,                                              // Badminton Court A
  tenis: 4, tennis: 4,                                      // Lapangan Tennis Outdoor
  gym: 1,                                                    // Gym / Fitness Center
  billiard: 6,                                               // Billiard Coins
  futsal: 2, "multi guna": 2, basketball: 2, basket: 2, voli: 2, // Lapangan Multiguna
};

export async function bridgeToSportBookings(params: {
  saved: SavedBooking;
  fieldType: string;
  notes?: string | null;
}): Promise<void> {
  const normalizedType = params.saved.fieldType.toLowerCase().trim();
  const scFacilityId  = SC_FACILITY_MAP[normalizedType] ?? 1;   // Lapangan Multiguna as fallback (prod id=1)
  const pubFacilityId = PUB_FACILITY_MAP[normalizedType] ?? null;

  // Normalize booking_date: strip ISO timestamp suffix if present
  // e.g. "2026-07-18T00:00:00.000Z" → "2026-07-18"
  const rawDate      = String(params.saved.bookingDate ?? "");
  const bookingDateNorm = rawDate.includes("T") ? rawDate.split("T")[0] : rawDate;

  // Normalize time to HH:MM format (strip seconds if present, e.g. "12:00:00" → "12:00")
  const normalizeTime = (t: string) => (t ?? "").substring(0, 5);
  const startTimeNorm = normalizeTime(params.saved.startTime);
  const endTimeRaw    = params.saved.endTime ?? params.saved.startTime;
  const endTimeNorm   = normalizeTime(endTimeRaw);

  const durationInt   = Math.round(params.saved.durationHours ?? 1);
  const bookingNumber = params.saved.bookingNumber;
  const customerName  = params.saved.bookerName ?? "Customer WA";

  logger.info(
    { bookingNumber, normalizedType, scFacilityId, pubFacilityId, bookingDateNorm, startTimeNorm, endTimeNorm, durationInt },
    "bridgeToSportBookings: starting sync",
  );

  // ── 1. Insert into sport_center.sport_bookings ──────────────────────────
  // booking_date, start_time, end_time are TEXT columns in this schema — pass as-is.
  // duration_hours is INTEGER — pass durationInt (JS number) directly, no ::integer cast needed.
  // supabaseQueryStrict throws on error so the catch block actually fires.
  let scBookingId: number | null = null;
  try {
    const rows = await supabaseQueryStrict<{ id: number }>(
      `INSERT INTO sport_center.sport_bookings
         (order_number, customer_name, customer_email, customer_phone,
          facility_id, booking_date, start_time, end_time, duration_hours,
          total_price, base_price, discount_amount,
          status, source, notes,
          payment_deadline, payment_required_now)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,0,
               'waiting_admin_approval','wa',$11,$12,true)
       ON CONFLICT (order_number) DO NOTHING
       RETURNING id`,
      [
        bookingNumber,                    // $1  order_number
        customerName,                     // $2  customer_name
        "",                               // $3  customer_email (NOT NULL → empty placeholder)
        params.saved.phone ?? "",         // $4  customer_phone
        scFacilityId,                     // $5  facility_id
        bookingDateNorm,                  // $6  booking_date (TEXT col — normalized YYYY-MM-DD)
        startTimeNorm,                    // $7  start_time   (TEXT col — HH:MM)
        endTimeNorm,                      // $8  end_time     (TEXT col — HH:MM)
        durationInt,                      // $9  duration_hours (INTEGER)
        params.saved.totalPrice,          // $10 total_price & base_price
        params.notes ?? null,             // $11 notes
        params.saved.paymentDeadline,     // $12 payment_deadline
      ],
    );
    scBookingId = rows[0]?.id ?? null;
    logger.info({ bookingNumber, scBookingId }, "bridgeToSportBookings: sport_center.sport_bookings OK");
  } catch (err) {
    const e = err as { message?: string; code?: string; detail?: string };
    logger.error(
      { bookingNumber, msg: e.message, code: e.code, detail: e.detail },
      "bridgeToSportBookings: sport_center.sport_bookings INSERT failed",
    );
    // Continue — step 2 runs independently even if step 1 fails
  }

  // ── 2. Insert into public.sport_bookings (runs independently of step 1) ──
  // booking_date is DATE col, start_time/end_time are TIME cols.
  // Data is pre-normalized above (bookingDateNorm = YYYY-MM-DD, times = HH:MM)
  // so no explicit SQL type cast needed — node-postgres handles JS string → pg type coercion.
  // Avoid :: cast syntax: PgBouncer transaction mode (port 6543) can fail on it with parameterized queries.
  try {
    await supabaseQueryStrict(
      `INSERT INTO public.sport_bookings
         (company_id, booking_number, customer_name, customer_phone, customer_email,
          facility_id, facility_name, booking_date, start_time, end_time, duration_hours,
          status, payment_status, base_amount, discount_amount, total_amount,
          notes, sc_booking_id)
       VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               'pending','unpaid',$11,0,$11,$12,$13)
       ON CONFLICT (booking_number) DO NOTHING`,
      [
        bookingNumber,                    // $1  booking_number
        customerName,                     // $2  customer_name
        params.saved.phone ?? null,       // $3  customer_phone
        null,                             // $4  customer_email (nullable)
        pubFacilityId,                    // $5  facility_id (nullable FK)
        params.saved.facilityName,        // $6  facility_name
        bookingDateNorm,                  // $7  booking_date  (DATE col — YYYY-MM-DD)
        startTimeNorm,                    // $8  start_time    (TIME col — HH:MM)
        endTimeNorm,                      // $9  end_time      (TIME col — HH:MM)
        durationInt,                      // $10 duration_hours
        params.saved.totalPrice,          // $11 base_amount & total_amount
        params.notes ?? null,             // $12 notes
        scBookingId,                      // $13 sc_booking_id
      ],
    );
    logger.info({ bookingNumber, scBookingId }, "bridgeToSportBookings: public.sport_bookings OK");
  } catch (err) {
    const e = err as { message?: string; code?: string; detail?: string };
    logger.error(
      { bookingNumber, msg: e.message, code: e.code, detail: e.detail },
      "bridgeToSportBookings: public.sport_bookings INSERT failed",
    );
  }
}

function rowToSavedBooking(row: Record<string, unknown>): SavedBooking {
  return {
    id:                row.id as number,
    bookingNumber:     row.booking_number as string,
    facilityName:      (row.facility_name as string) ?? String(row.field_type),
    fieldType:         row.field_type as string,
    bookingDate:       row.booking_date instanceof Date
                         ? row.booking_date.toISOString().slice(0, 10)
                         : String(row.booking_date ?? "").slice(0, 10),
    startTime:         row.start_time as string,
    endTime:           row.end_time as string | null,
    durationHours:     row.duration_hours != null ? Number(row.duration_hours) : null,
    totalPrice:        Number(row.total_price ?? 0),
    paymentStatus:     (row.payment_status as string) ?? "unpaid",
    paymentProofToken: row.payment_proof_token as string,
    paymentDeadline:   new Date(row.payment_deadline as string),
    bookerName:        row.customer_name as string | null,
    phone:             row.phone as string | null,
    status:            row.status as string,
  };
}
