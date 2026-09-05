/**
 * Public Mini Form API — Sprint 9B
 * No authentication required — token-based access
 *
 * GET  /api/public/mini-form/types            — list all form types (for config UI)
 * GET  /api/public/mini-form/preview/:templateId — admin preview (no task)
 * GET  /api/public/mini-form/:type/:token     — load session + fields
 * POST /api/public/mini-form/:type/:token     — submit form
 */

import { Router, type IRouter } from "express";
import { eq, and, or, inArray, sql } from "drizzle-orm";

// ── Kategori alias — mapping dari nama internal sistem → nama yang dipakai di Penerima Notifikasi
// Ini memungkinkan admin menambahkan penerima dengan nama yang lebih familiar (misal "Trucking")
// meskipun sistem secara internal menggunakan nama berbeda (misal "Logistik").
const CATEGORY_ALIASES: Record<string, string[]> = {
  Logistik: [
    "Logistik",
    "Trucking",
    "Freight",
    "Pengiriman",
    "Sea Freight",
    "Air Freight",
  ],
  Customs: ["Customs", "PPJK", "Bea Cukai", "PPJK/Customs"],
  Finance: ["Finance", "Kasbon", "Keuangan", "Pembayaran"],
  Fleet: ["Fleet", "Armada", "Kendaraan", "Fleet Management"],
  Tenant: ["Tenant", "Properti", "Sewa Properti"],
  "Sport Center": ["Sport Center", "Lapangan", "Olahraga", "Booking Lapangan"],
  Umum: ["Umum", "General", "General Inquiry", "Pertanyaan"],
};

/** Kembalikan semua alias untuk sebuah kategori (termasuk kategori itu sendiri) */
function getCategoryAliases(category: string): string[] {
  return CATEGORY_ALIASES[category] ?? [category];
}
import {
  db,
  intakeSessionsTable,
  dataTemplatesTable,
  dataTemplateFieldsTable,
  aiTasksTable,
  notificationReceiversTable,
  intentMasterTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { createAdminNotification } from "../lib/admin-notifications";
import { MINI_FORM_CONFIGS, getFormConfig } from "../lib/mini-form-config";
import type { MiniFormFieldDef } from "../lib/mini-form-config";
import { sendFonnte, sendFonnteDocument } from "../lib/fonnte";
import {
  saveSportCenterBooking,
  extractDurationHours,
  bridgeToSportBookings,
  finalizeSportCenterBookingPayment,
  getAvailableSportCenterStartTimes,
  getSportCenterFacilityOptions,
  getSportCenterPaymentSettings,
} from "../lib/sport-center-availability";
import { supabaseQuery } from "../lib/supabase-db";
import { getAccessibleUrl, extractStoragePath } from "../lib/supabase";
import { validateDocument } from "../lib/document-validation-engine";

// ── Fallback map: intent code prefix → kategori penerima notifikasi
// Digunakan ketika intent_master lookup ke DB tidak menemukan data
const INTENT_CODE_CATEGORY: Record<string, string> = {
  ppjk: "Customs",
  customs: "Customs",
  bea_cukai: "Customs",
  trucking: "Logistik",
  freight: "Logistik",
  import: "Logistik",
  export: "Logistik",
  ekspor: "Logistik",
  logistik: "Logistik",
  kasbon: "Finance",
  cash_advance: "Finance",
  finance: "Finance",
  booking_lapangan: "Sport Center",
  sport: "Sport Center",
  lapangan: "Sport Center",
  fleet: "Fleet",
  armada: "Fleet",
  tenant: "Tenant",
  sewa: "Tenant",
};

/** Resolve kategori dari intentCode menggunakan prefix map */
function inferCategoryFromIntentCode(intentCode: string): string | null {
  const lower = intentCode.toLowerCase().replace(/-/g, "_");
  for (const [prefix, cat] of Object.entries(INTENT_CODE_CATEGORY)) {
    if (lower.startsWith(prefix) || lower.includes(prefix)) return cat;
  }
  return null;
}

const router: IRouter = Router();

// ── GET /public/mini-form/types ───────────────────────────────────────────────

router.get("/public/mini-form/types", (_req, res): void => {
  const summary = Object.values(MINI_FORM_CONFIGS).map(
    ({ type, title, description, fields }) => ({
      type,
      title,
      description,
      fieldCount: fields.length,
      requiredCount: fields.filter((f) => f.required).length,
    }),
  );
  res.json(summary);
});

// ── GET /public/mini-form/preview/:templateId ─────────────────────────────────

router.get(
  "/public/mini-form/preview/:templateId",
  async (req, res): Promise<void> => {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      const templateId = parseInt(req.params["templateId"] as string, 10);
      if (isNaN(templateId)) {
        res.status(400).json({ error: "templateId tidak valid" });
        return;
      }

      const [tpl] = await db
        .select()
        .from(dataTemplatesTable)
        .where(eq(dataTemplatesTable.id, templateId))
        .limit(1);

      if (!tpl) {
        res.status(404).json({ error: "Template tidak ditemukan" });
        return;
      }

      const dbFields = await db
        .select()
        .from(dataTemplateFieldsTable)
        .where(eq(dataTemplateFieldsTable.templateId, templateId))
        .orderBy(dataTemplateFieldsTable.sortOrder);

      const formType = tpl.miniFormType ?? "trucking";
      const builtinCfg = getFormConfig(formType);
      const facilityOptions =
        formType.replace(/_/g, "-") === "field-booking"
          ? await getSportCenterFacilityOptions()
          : null;
      const paymentSettings =
        formType.replace(/_/g, "-") === "field-booking"
          ? await getSportCenterPaymentSettings()
          : null;

      res.json({
        preview: true,
        template: {
          id: tpl.id,
          name: tpl.name,
          intentCode: tpl.intentCode,
          category: tpl.category,
          intakeMode: tpl.intakeMode,
          miniFormType: formType,
          useMiniForm: tpl.useMiniForm,
        },
        formTitle: builtinCfg?.title ?? tpl.name,
        formDescription: builtinCfg?.description ?? tpl.description,
        builtinFields:
          builtinCfg?.fields.map((field) =>
            field.name === "field_type" && facilityOptions
              ? { ...field, options: facilityOptions }
              : field,
          ) ?? [],
        facilityOptions,
        paymentSettings,
        customFields: dbFields,
        collectedFields: {},
        missingFields: [],
      });
    } catch (err) {
      logger.error({ err }, "GET /public/mini-form/preview/:templateId failed");
      res.status(500).json({ error: "Gagal memuat preview" });
    }
  },
);

// ── GET /public/mini-form/:type/:token ────────────────────────────────────────

router.get(
  "/public/mini-form/:type/:token",
  async (req, res): Promise<void> => {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      const { type, token } = req.params as { type: string; token: string };
      if (!token || token.length < 16) {
        res.status(400).json({ error: "Token tidak valid" });
        return;
      }

      const formCfg = getFormConfig(type);
      if (!formCfg) {
        res.status(404).json({ error: `Tipe form '${type}' tidak dikenal` });
        return;
      }

      const [session] = await db
        .select()
        .from(intakeSessionsTable)
        .where(eq(intakeSessionsTable.formToken, token))
        .limit(1);

      if (!session) {
        res
          .status(404)
          .json({ error: "Form tidak ditemukan atau link sudah tidak aktif" });
        return;
      }

      if (session.status === "submitted") {
        res.json({
          status: "submitted",
          message:
            "Data Anda sudah kami terima. Terima kasih! Tim kami akan segera menghubungi Anda.",
        });
        return;
      }
      if (session.status === "cancelled" || session.status === "expired") {
        res.status(410).json({
          error: "Sesi ini sudah tidak aktif. Silakan hubungi kami kembali.",
        });
        return;
      }

      // Load custom DB fields if template exists
      const dataTpl = await db
        .select()
        .from(dataTemplatesTable)
        .where(
          and(
            eq(dataTemplatesTable.companyId, session.companyId),
            eq(dataTemplatesTable.isActive, true),
            eq(dataTemplatesTable.intentCode, session.intentCode),
          ),
        )
        .limit(1)
        .then((r) => r[0] ?? null);

      const customFields = dataTpl
        ? await db
            .select()
            .from(dataTemplateFieldsTable)
            .where(eq(dataTemplateFieldsTable.templateId, dataTpl.id))
            .orderBy(dataTemplateFieldsTable.sortOrder)
        : [];

      // Auto-inject phone from session so it's always pre-filled.
      // session.phone comes LAST so collectedFields {phone:null} cannot override the known WA number.
      const collectedFields = {
        ...((session.collectedFields as Record<string, unknown>) ?? {}),
        ...(session.phone ? { phone: session.phone } : {}),
      };

      // Never show "phone" as a missing field — we always know it from the WA session.
      const missingFields = ((session.missingFields ?? []) as string[]).filter(
        (f) => f !== "phone",
      );
      const facilityOptions =
        type.replace(/_/g, "-") === "field-booking"
          ? await getSportCenterFacilityOptions()
          : null;
      const paymentSettings =
        type.replace(/_/g, "-") === "field-booking"
          ? await getSportCenterPaymentSettings()
          : null;

      res.json({
        status: session.status,
        intentCode: session.intentCode,
        intentName: session.intentName,
        category: session.category,
        formTitle: formCfg.title,
        formDescription: formCfg.description,
        builtinFields: formCfg.fields.map((field) =>
          field.name === "field_type" && facilityOptions
            ? { ...field, options: facilityOptions }
            : field,
        ),
        facilityOptions,
        paymentSettings,
        customFields,
        collectedFields,
        missingFields,
        requiredDocuments: session.requiredDocuments ?? [],
        uploadedDocuments: session.uploadedDocuments ?? [],
      });
    } catch (err) {
      logger.error({ err }, "GET /public/mini-form/:type/:token failed");
      res.status(500).json({ error: "Gagal memuat form" });
    }
  },
);

// ── GET /public/mini-form/:type/:token/availability ──────────────────────────
// Checks CST-DEV before the public form renders the Jam Mulai options.

router.get(
  "/public/mini-form/:type/:token/availability",
  async (req, res): Promise<void> => {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      const { type, token } = req.params as { type: string; token: string };
      const formCfg = getFormConfig(type);
      if (!formCfg || type.replace(/_/g, "-") !== "field-booking") {
        res.status(404).json({ error: "Availability hanya tersedia untuk form booking lapangan" });
        return;
      }

      const [session] = await db
        .select()
        .from(intakeSessionsTable)
        .where(eq(intakeSessionsTable.formToken, token))
        .limit(1);
      if (!session) {
        res.status(404).json({ error: "Form tidak ditemukan" });
        return;
      }
      if (["submitted", "cancelled", "expired"].includes(session.status)) {
        res.status(410).json({ error: "Sesi form sudah tidak aktif" });
        return;
      }

      const queryString = (value: unknown): string =>
        typeof value === "string" ? value : "";
      const fieldType = queryString(req.query["fieldType"]);
      const bookingDate = queryString(req.query["bookingDate"]);
      const duration = queryString(req.query["duration"]) || "1 jam";
      if (!fieldType || !bookingDate) {
        res.status(400).json({ error: "Jenis lapangan dan tanggal wajib dipilih terlebih dahulu" });
        return;
      }

      const availability = await getAvailableSportCenterStartTimes({
        fieldType,
        bookingDate,
        durationHours: extractDurationHours({ duration }),
        requireExactFacility: true,
      });
      res.json(availability);
    } catch (err) {
      logger.error({ err }, "GET /public/mini-form/:type/:token/availability failed");
      res.status(503).json({
        error:
          process.env.NODE_ENV === "production"
            ? "Jadwal belum dapat diperiksa dari database produksi. Silakan coba lagi."
            : "Jadwal belum dapat diperiksa dari CST-DEV. Silakan coba lagi.",
      });
    }
  },
);

// ── POST /public/mini-form/:type/:token ───────────────────────────────────────

router.post(
  "/public/mini-form/:type/:token",
  async (req, res): Promise<void> => {
    try {
      const { type, token } = req.params as { type: string; token: string };
      const body = req.body as {
        fields: Record<string, string>;
        submittedBy?: string;
        uploadedDocuments?: string[];
      };

      if (!token || token.length < 16) {
        res.status(400).json({ error: "Token tidak valid" });
        return;
      }

      const formCfg = getFormConfig(type);
      if (!formCfg) {
        res.status(404).json({ error: `Tipe form '${type}' tidak dikenal` });
        return;
      }

      if (!body.fields || typeof body.fields !== "object") {
        res.status(400).json({ error: "Data field wajib diisi" });
        return;
      }

      const [session] = await db
        .select()
        .from(intakeSessionsTable)
        .where(eq(intakeSessionsTable.formToken, token))
        .limit(1);

      if (!session) {
        res.status(404).json({ error: "Form tidak ditemukan" });
        return;
      }
      if (session.status === "submitted") {
        res.json({
          ok: true,
          message: "Sudah tersubmit sebelumnya. Terima kasih!",
        });
        return;
      }
      if (session.status === "cancelled" || session.status === "expired") {
        res.status(410).json({ error: "Sesi ini sudah tidak aktif" });
        return;
      }

      // Merge: existing collected fields + new submitted fields + session phone last (always wins).
      // session.phone comes LAST so collectedFields {phone:null} or body.fields {phone:""} cannot override it.
      const merged: Record<string, unknown> = {
        ...((session.collectedFields as Record<string, unknown>) ?? {}),
        ...body.fields,
        // Always override phone with the authoritative WA sender number from the session.
        ...(session.phone ? { phone: session.phone } : {}),
      };

      // Auto-alias field_name ↔ field_type — the AI session uses "field_name" but the
      // field-booking form config uses "field_type" for the same "Jenis Lapangan" field.
      if (!merged.field_name && merged.field_type)
        merged.field_name = merged.field_type;
      if (!merged.field_type && merged.field_name)
        merged.field_type = merged.field_name;

      // Auto-compute end_time from start_time + duration so users never have to fill it manually.
      // This covers field-booking and any form where the AI asks for end_time but the form only shows start + duration.
      if (!merged.end_time && merged.start_time && merged.duration) {
        const durationMap: Record<string, number> = {
          "1 jam": 60,
          "1,5 jam": 90,
          "1.5 jam": 90,
          "2 jam": 120,
          "3 jam": 180,
          "4 jam": 240,
          "90 menit": 90,
          "60 menit": 60,
          "45 menit": 45,
        };
        const startStr = String(merged.start_time); // e.g. "11:00"
        const durationStr = String(merged.duration);
        const addMinutes = durationMap[durationStr.toLowerCase()];
        if (addMinutes && /^\d{1,2}:\d{2}$/.test(startStr)) {
          const [h, m] = startStr.split(":").map(Number);
          const totalMin = (h ?? 0) * 60 + (m ?? 0) + addMinutes;
          const endH = Math.floor(totalMin / 60) % 24;
          const endM = totalMin % 60;
          merged.end_time = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
        }
      }

      // Calculate missing required fields from builtin + missing list
      const requiredBuiltinNames = formCfg.fields
        .filter((f: MiniFormFieldDef) => f.required)
        .map((f: MiniFormFieldDef) => f.name);

      // "phone" is always provided by the WA session — remove it from the required list.
      // "end_time" is always auto-computed from start_time + duration — never require user input for it.
      const ALWAYS_EXCLUDE = new Set(["phone", "end_time"]);
      const prevMissing = (
        Array.isArray(session.missingFields)
          ? (session.missingFields as string[])
          : []
      ).filter((f) => !ALWAYS_EXCLUDE.has(f));
      const allRequired = Array.from(
        new Set([...requiredBuiltinNames, ...prevMissing]),
      ).filter((f) => !ALWAYS_EXCLUDE.has(f));
      const stillMissing = allRequired.filter(
        (f) => !merged[f] || String(merged[f]).trim() === "",
      );

      // Merge uploaded docs
      const prevDocs = Array.isArray(session.uploadedDocuments)
        ? (session.uploadedDocuments as string[])
        : [];
      const newDocs = body.uploadedDocuments ?? [];
      const mergedDocs = Array.from(new Set([...prevDocs, ...newDocs]));

      const isComplete = stillMissing.length === 0;

      // Re-check at submit time so a slot booked after the form loaded cannot
      // be submitted through a stale browser tab.
      if (isComplete && type.replace(/_/g, "-") === "field-booking") {
        const availability = await getAvailableSportCenterStartTimes({
          fieldType: String(merged.field_type ?? merged.field_name ?? ""),
          bookingDate: String(merged.booking_date ?? ""),
          durationHours: extractDurationHours(merged),
          requireExactFacility: true,
        });
        const selectedStart = String(merged.start_time ?? "");
        if (!availability.availableSlots.includes(selectedStart)) {
          res.status(409).json({
            ok: false,
            isComplete: false,
            message: "Jam tersebut baru saja terisi atau tidak tersedia. Silakan pilih jam lain.",
            missingFields: ["start_time"],
          });
          return;
        }
      }

      let taskId: number | null = null;
      let taskNumber: string | null = null;
      // Diisi saat attachment diproses dan dibaca saat membentuk response akhir.
      // Deklarasikan di scope handler agar tetap tersedia di luar if (isComplete).
      let attachmentSummary: {
        total: number;
        failed: number;
        errors: string[];
      } | null = null;

      if (isComplete) {
        const now = new Date();
        taskNumber = `WA-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-F${session.id}`;

        // Build smart title from collected fields
        const title = buildTaskTitle(type, merged, session);

        const fieldSummary = Object.entries(merged)
          .slice(0, 12)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join("\n");

        const [newTask] = await db
          .insert(aiTasksTable)
          .values({
            companyId: session.companyId,
            taskNumber,
            title,
            description:
              `Task dibuat dari mini-form (${formCfg.title}).\n` +
              `Sumber: mini_form | Intake Session: #${session.id}\n` +
              `Diisi oleh: ${body.submittedBy ?? session.phone}\n\n` +
              `Data terkumpul:\n${fieldSummary}`,
            status: "new_inquiry",
            priority:
              type === "complaint" || type === "fleet-repair"
                ? "high"
                : "medium",
            category: session.category ?? formCfg.title,
            customerPhone: session.phone,
            customerId: session.customerId
              ? parseInt(session.customerId, 10) || null
              : null,
            aiSummary: `Form ${formCfg.title} diisi via link WhatsApp`,
            source: "mini_form",
            missingData: JSON.stringify([]),
          })
          .returning();

        taskId = newTask!.id;

        // ── Sport Center: save booking record + bridge to public.sport_bookings ──
        if (
          type === "field-booking" ||
          session.intentCode.toLowerCase().includes("booking_lapangan") ||
          session.intentCode.toLowerCase().includes("sport_center")
        ) {
          const endTime = String(merged.end_time ?? "").trim() || undefined;
          const isFieldBookingForm = type.replace(/_/g, "-") === "field-booking";
          const savedFormBooking = await saveSportCenterBooking({
            companyId: session.companyId,
            aiTaskId: taskId,
            intakeSessionId: session.id,
            fieldType: String(merged.field_type ?? merged.field_name ?? "Umum"),
            bookingDate: String(merged.booking_date ?? ""),
            startTime: String(merged.start_time ?? ""),
            endTime: endTime ?? null,
            durationHours: extractDurationHours(merged),
            bookerName: String(merged.booker_name ?? "").trim() || null,
            phone: session.phone,
            notes: String(merged.notes ?? "").trim() || null,
          }).catch((e) => {
            logger.error(
              { e },
              "intake-form: saveSportCenterBooking failed",
            );
            if (isFieldBookingForm) throw e;
            return null;
          });

          // Bridge ke tabel Sport Center canonical/public. Untuk field-booking,
          // payment dan status booking harus diselesaikan setelah bridge selesai,
          // bukan dijalankan async/non-fatal, supaya payment tidak kehilangan FK booking.
          if (savedFormBooking) {
            const bridged = await bridgeToSportBookings({
              saved: savedFormBooking,
              fieldType: String(
                merged.field_type ?? merged.field_name ?? "Umum",
              ),
              notes: String(merged.notes ?? "").trim() || null,
            });

            if (isFieldBookingForm) {
              const paymentProofUrl = String(merged.payment_proof ?? "").trim();
              const paymentMethod = String(merged.payment_method ?? "").trim();
              if (!paymentProofUrl || !paymentMethod) {
                throw new Error(
                  "Bukti pembayaran dan metode pembayaran wajib tersedia untuk menyelesaikan booking lapangan",
                );
              }

              await finalizeSportCenterBookingPayment({
                saved: savedFormBooking,
                canonicalBookingId: bridged.canonicalBookingId,
                publicBookingId: bridged.publicBookingId,
                paymentMethod,
                paymentProofUrl,
                notes: String(merged.notes ?? "").trim() || null,
              });
            }
          }
        }

        await createAdminNotification({
          type: "new_inquiry",
          title: `📋 Mini Form Disubmit — ${formCfg.title}`,
          body: `${session.phone} mengisi ${formCfg.title}. Task #${taskNumber} dibuat otomatis.`,
          customerPhone: session.phone,
          taskId,
          companyId: session.companyId,
        });

        // ── Kirim WA ke Penerima Notifikasi yang aktif sesuai kategori ─────────
        // Ini diisi jika ada file attachment yang dicoba dikirim, digunakan di res.json
        try {
          // Lookup kategori dari intent_master — coba heliumdb dulu, lalu Supabase
          let resolvedCategory: string | null = null;
          try {
            const [intentRow] = await db
              .select({ category: intentMasterTable.category })
              .from(intentMasterTable)
              .where(eq(intentMasterTable.intentCode, session.intentCode))
              .limit(1);
            resolvedCategory = intentRow?.category ?? null;
          } catch {
            /* ignore */
          }

          // Jika heliumdb tidak punya, coba Supabase (tempat seed data sebenarnya)
          if (!resolvedCategory) {
            try {
              const rows = await supabaseQuery<{ category: string | null }>(
                `SELECT category FROM intent_master WHERE intent_code = $1 AND is_active = true LIMIT 1`,
                [session.intentCode],
              );
              resolvedCategory = rows[0]?.category ?? null;
            } catch {
              /* ignore */
            }
          }

          // Terakhir: inferensi dari intentCode itu sendiri (selalu berhasil untuk kode yang dikenal)
          if (!resolvedCategory) {
            resolvedCategory = inferCategoryFromIntentCode(session.intentCode);
          }

          // Fallback chain: intent_master (heliumdb/supabase) → intentCode prefix → session.category → formCfg.title
          const effectiveCategory =
            resolvedCategory ?? session.category ?? formCfg.title;

          logger.info(
            {
              intentCode: session.intentCode,
              resolvedCategory,
              sessionCategory: session.category,
              effectiveCategory,
            },
            "intake-form: resolving notification receiver category",
          );

          // ── Tentukan kategori routing dengan prioritas yang jelas ──────────────
          //
          // MASALAH LAMA: aliasSet adalah UNION dari semua sumber (DB + intentCode).
          // Ini menyebabkan form PPJK/freight (intentCode="ppjk_import") juga masuk ke group
          // Trucking karena DB intent_master.category = "Logistik" → alias "Trucking" ikut masuk.
          //
          // PRIORITAS BARU:
          //   1. intentCode inference — paling spesifik, selalu sistem-defined
          //   2. DB intent_master.category — trusted tapi bisa punya data lama
          //   3. session.category / formCfg.title — fallback
          //
          // Jika intentCode memberikan kategori yang BERBEDA dari DB, intentCode menang.
          // Dengan begitu form PPJK tidak juga masuk ke Trucking.

          const intentCodeCategory = inferCategoryFromIntentCode(
            session.intentCode,
          );

          const aliasSet = new Set<string>();

          if (intentCodeCategory) {
            // intentCode adalah sumber paling spesifik — pakai sebagai primary
            getCategoryAliases(intentCodeCategory).forEach((a) =>
              aliasSet.add(a),
            );

            // Tambahkan DB/session aliases HANYA jika SAMA dengan intentCode category
            // (untuk menangkap alias tambahan yang didaftarkan admin, misal "PPJK/Customs")
            if (resolvedCategory && resolvedCategory === intentCodeCategory) {
              getCategoryAliases(resolvedCategory).forEach((a) =>
                aliasSet.add(a),
              );
            }
            if (session.category && session.category === intentCodeCategory) {
              getCategoryAliases(session.category).forEach((a) =>
                aliasSet.add(a),
              );
            }
          } else {
            // intentCode tidak memberikan kategori — fallback ke DB/session
            if (resolvedCategory)
              getCategoryAliases(resolvedCategory).forEach((a) =>
                aliasSet.add(a),
              );
            if (session.category)
              getCategoryAliases(session.category).forEach((a) =>
                aliasSet.add(a),
              );
            if (aliasSet.size === 0)
              getCategoryAliases(effectiveCategory).forEach((a) =>
                aliasSet.add(a),
              );
          }

          const categoryList = Array.from(aliasSet);

          logger.info(
            {
              intentCodeCategory,
              resolvedCategory,
              sessionCategory: session.category,
              categoryList,
            },
            "intake-form: final category routing list",
          );

          // Cari penerima aktif yang match salah satu alias kategori.
          // Catatan companyId: intake sessions selalu dibuat dengan companyId="default",
          // sementara receiver bisa tersimpan dengan company ID numerik (mis: "4").
          // Solusi: jika session.companyId="default", jangan filter by companyId agar
          // semua receiver aktif (termasuk yang company-specific) ikut ditemukan.
          // Jika session punya company ID spesifik, cari receiver untuk company tsb + "default".
          const companyFilter =
            session.companyId === "default"
              ? sql`1=1` // no company filter — find receivers from all companies
              : or(
                  eq(notificationReceiversTable.companyId, session.companyId),
                  eq(notificationReceiversTable.companyId, "default"),
                );

          const receivers = await db
            .select()
            .from(notificationReceiversTable)
            .where(
              and(
                companyFilter,
                eq(notificationReceiversTable.isActive, true),
                categoryList.length === 1
                  ? eq(notificationReceiversTable.category, categoryList[0]!)
                  : inArray(notificationReceiversTable.category, categoryList),
              ),
            );

          if (receivers.length > 0) {
            const fieldLabelMap: Record<string, string> = {
              booker_name: "Nama Pemesan",
              phone: "No. HP",
              field_name: "Jenis Lapangan",
              field_type: "Jenis Lapangan",
              duration: "Durasi Sewa",
              booking_date: "Tanggal Main",
              start_time: "Jam Mulai",
              end_time: "Jam Selesai",
              durasi: "Durasi Sewa",
              payment_method: "Metode Pembayaran",
              payment_proof: "Upload Bukti Pembayaran",
              notes: "Catatan",
              contact_person: "Nama Kontak",
              contact_phone: "No. Kontak",
              consignee_name: "Nama Consignee",
              shipment_type: "Jenis Pengiriman",
              ready_date: "Tanggal Kargo Siap",
              origin_country: "Negara Asal",
              destination_country: "Negara Tujuan",
              commodity: "Komoditi",
              gross_weight: "Berat (kg)",
              volume: "Volume (m³)",
              incoterm: "Incoterm",
              shipment_mode: "Moda Pengiriman",
            };

            // Field yang dikecualikan dari ringkasan teks utama:
            // - phone: sudah tampil di baris "Pelanggan:" di header notifikasi
            // - uploaded_document:... : kunci sintetis yang ditambahkan oleh loop di bawah
            // CATATAN: File field URL TIDAK lagi dikecualikan — ditampilkan di bagian
            // "Dokumen Terlampir:" sebagai teks sekaligus juga dicoba kirim sebagai attachment.
            const SKIP_SUMMARY_KEYS = new Set(["phone"]);
            const isPublicUrl = (v: unknown): v is string =>
              typeof v === "string" &&
              (v.startsWith("http://") || v.startsWith("https://"));

            // Label untuk file fields (agar tampil rapi di teks dokumen)
            const fileLabelMap: Record<string, string> = {
              commercial_invoice: "Commercial Invoice",
              packing_list:       "Packing List",
              attachment:         "Dokumen Pendukung",
              photo:              "Foto Kendaraan",
              photo_damage:       "Foto Kerusakan",
            };

            // Identifikasi semua file fields yang punya URL dari konfigurasi form
            const fileFieldUrlEntries: Array<{ label: string; url: string }> = [];
            for (const field of formCfg.fields) {
              if (field.type === "file") {
                const val = merged[field.name];
                if (isPublicUrl(val)) {
                  fileFieldUrlEntries.push({
                    label: fileLabelMap[field.name] ?? field.label,
                    url: val,
                  });
                }
              }
            }

            const isFieldBookingForm = type.replace(/_/g, "-") === "field-booking";
            const summaryEntries: Array<[string, unknown]> = isFieldBookingForm
              ? [
                  ["booker_name", merged.booker_name],
                  ["field_type", merged.field_type ?? merged.field_name],
                  ["booking_date", merged.booking_date],
                  ["duration", merged.duration ?? merged.durasi],
                  ["start_time", merged.start_time],
                  ["end_time", merged.end_time],
                  ["payment_method", merged.payment_method],
                  ["notes", merged.notes],
                ]
              : Object.entries(merged).slice(0, 20);

            const fieldSummaryWa = summaryEntries
              .filter(([k]) => {
                if (SKIP_SUMMARY_KEYS.has(k)) return false;
                // skip synthetic uploaded_document:... keys
                if (k.startsWith("uploaded_document:")) return false;
                // skip file fields — sudah ditampilkan di bagian "Dokumen Terlampir"
                const fieldDef = formCfg.fields.find((f) => f.name === k);
                if (fieldDef?.type === "file") return false;
                return true;
              })
              .map(([k, v]) => {
                const label = fieldLabelMap[k] ?? k;
                const displayValue = String(v ?? "").trim() || "-";
                return `• ${label}: ${displayValue}`;
              })
              .join("\n");

            // Tambahkan bagian dokumen jika ada file yang diupload
            const docTextSection =
              fileFieldUrlEntries.length > 0
                ? `\n\n*Dokumen Terlampir:*\n` +
                  fileFieldUrlEntries
                    .map(({ label, url }) => `• ${label}: ${url}`)
                    .join("\n")
                : "";

            const notifMsg =
              `📋 *Pesanan Baru — ${formCfg.title}*\n` +
              `No. Task: *${taskNumber}*\n` +
              `Pelanggan: ${session.phone}\n\n` +
              `*Detail Pesanan:*\n${fieldSummaryWa}` +
              docTextSection +
              `\n\nMohon Segera Konfirmasi.`;

            await Promise.allSettled(
              receivers.map((r) =>
                sendFonnte(r.phone, notifMsg).catch((e) =>
                  logger.warn(
                    { e, phone: r.phone },
                    "intake-form: WA to receiver failed",
                  ),
                ),
              ),
            );

            // ── Kirim semua file field sebagai attachment dokumen WA ──
            // Dinamis dari formCfg — mencakup semua form: CI/PL (freight), foto (complaint/fleet-repair),
            // dokumen pendukung (cash-advance), dll. Tidak perlu hardcode per form type.
            const docAttachments: Array<{ key: string; label: string }> =
              formCfg.fields
                .filter((f: MiniFormFieldDef) => f.type === "file")
                .map((f: MiniFormFieldDef) => ({
                  key: f.name,
                  label: f.label,
                }));

            // Custom templates may persist uploaded URLs in uploadedDocuments
            // without exposing the corresponding file field. Add those URLs as
            // synthetic attachments so the document is not silently lost.
            const uploadedDocumentUrls = mergedDocs.filter(isPublicUrl);
            const knownFileUrls = new Set(
              docAttachments.map(({ key }) => merged[key]).filter(isPublicUrl),
            );
            for (const url of uploadedDocumentUrls) {
              if (!knownFileUrls.has(url)) {
                const rawFilename =
                  url.split("/").pop()?.split("?")[0] ?? "Dokumen.pdf";
                const filename =
                  rawFilename.replace(/^\d+_/, "") || "Dokumen.pdf";
                docAttachments.push({
                  key: `uploaded_document:${url}`,
                  label: filename,
                });
                merged[`uploaded_document:${url}`] = url;
              }
            }

            // Log diagnostik: berapa file field yang ditemukan dan nilai masing-masing
            const docFieldStatus = docAttachments.map(({ key, label }) => ({
              key,
              label,
              value: merged[key] ?? null,
              isUrl: isPublicUrl(merged[key]),
            }));
            logger.info(
              { docAttachmentCount: docAttachments.length, docFieldStatus },
              "intake-form: file field attachment diagnostic",
            );

            const attachmentResults: Array<{
              key: string;
              filename: string;
              urlMode: string;
              successCount: number;
              failCount: number;
              errors: string[];
            }> = [];

            // Kumpulkan dokumen yang perlu divalidasi — validasi dikirim SETELAH semua file terkirim
            const pendingValidations: Array<{ key: string; filename: string; fileUrl: string }> = [];

            for (const { key, label } of docAttachments) {
              const fileUrl = merged[key];
              if (!isPublicUrl(fileUrl)) {
                if (fileUrl) {
                  logger.warn(
                    { key, value: fileUrl },
                    "intake-form: file field has value but not a public URL — skip WA attachment",
                  );
                } else {
                  logger.info(
                    { key },
                    "intake-form: file field kosong — tidak ada dokumen untuk dikirim",
                  );
                }
                continue;
              }

              // Ekstrak nama file asli dari URL (hapus query string & prefix timestamp)
              const rawFilename =
                fileUrl.split("/").pop()?.split("?")[0] ?? `${label}.pdf`;
              // Hapus prefix timestamp (misal: "1753449600000_") yang ditambah getUploadUrl
              const filename =
                rawFilename.replace(/^\d+_/, "") || `${label}.pdf`;

              // ── Verifikasi URL benar-benar accessible sebelum kirim ke Fonnte ──
              // getPublicUrl() Supabase SELALU mengembalikan URL bahkan jika bucket private.
              // HEAD check memastikan Fonnte bisa download file tanpa auth.
              const storagePath = extractStoragePath(fileUrl);
              let accessibleFileUrl = fileUrl;
              let urlMode = "original";

              if (storagePath) {
                try {
                  const accessible = await getAccessibleUrl(storagePath, fileUrl);
                  accessibleFileUrl = accessible.url;
                  urlMode = accessible.mode;
                  logger.info(
                    { key, filename, storagePath, urlMode, accessibleFileUrl },
                    "intake-form: URL accessibility check selesai",
                  );
                } catch (accessErr) {
                  logger.warn(
                    { key, filename, storagePath, accessErr },
                    "intake-form: getAccessibleUrl gagal — pakai original URL",
                  );
                }
              } else {
                logger.warn(
                  { key, fileUrl },
                  "intake-form: tidak dapat ekstrak storage path dari URL — pakai URL langsung",
                );
              }

              logger.info(
                {
                  key,
                  filename,
                  originalUrl: fileUrl,
                  accessibleUrl: accessibleFileUrl,
                  urlMode,
                  receiverCount: receivers.length,
                  receivers: receivers.map((r) => r.phone),
                },
                "intake-form: mulai kirim WA document attachment ke semua receiver",
              );

              const docResult = {
                key,
                filename,
                urlMode,
                successCount: 0,
                failCount: 0,
                errors: [] as string[],
              };

              await Promise.allSettled(
                receivers.map(async (r) => {
                  logger.info(
                    {
                      target: r.phone,
                      filename,
                      url: accessibleFileUrl,
                      urlMode,
                    },
                    "intake-form: [Fonnte doc payload] target/url/filename (token disembunyikan)",
                  );

                  const result = await sendFonnteDocument(
                    r.phone,
                    accessibleFileUrl,
                    filename,
                  ).catch((e: unknown) => {
                    logger.warn(
                      { e, phone: r.phone, key, filename },
                      "intake-form: sendFonnteDocument threw exception",
                    );
                    return { success: false, error: String(e) };
                  });

                  if (!result.success) {
                    docResult.failCount++;
                    docResult.errors.push(`${r.phone}: ${result.error ?? "unknown"}`);
                    logger.warn(
                      {
                        phone: r.phone,
                        key,
                        filename,
                        accessibleUrl: accessibleFileUrl,
                        urlMode,
                        error: result.error,
                      },
                      "intake-form: WA document attachment GAGAL",
                    );
                  } else {
                    docResult.successCount++;
                    logger.info(
                      {
                        phone: r.phone,
                        key,
                        filename,
                        messageId: "messageId" in result ? result.messageId : undefined,
                      },
                      "intake-form: WA document attachment BERHASIL",
                    );
                  }
                }),
              );

              attachmentResults.push(docResult);

              // Simpan untuk validasi setelah semua file terkirim
              pendingValidations.push({ key, filename, fileUrl: accessibleFileUrl });
            }

            // Log ringkasan hasil attachment
            const totalDocs = attachmentResults.length;
            const failedDocs = attachmentResults.filter((r) => r.failCount > 0);
            logger.info(
              {
                totalDocs,
                failedDocs: failedDocs.length,
                results: attachmentResults,
              },
              "intake-form: ringkasan kirim WA document attachment",
            );

            // Simpan summary ke scope luar agar bisa dilaporkan di response
            if (totalDocs > 0) {
              attachmentSummary = {
                total: totalDocs,
                failed: failedDocs.length,
                errors: failedDocs.flatMap((r) => r.errors),
              };
            }

            logger.info(
              {
                companyId: session.companyId,
                taskId,
                effectiveCategory,
                receiverCount: receivers.length,
              },
              "intake-form: WA notifications sent to receivers",
            );

            // ── Auto-validate SETELAH semua file terkirim ──
            // Dijalankan setelah loop attachment agar urutan WA: 1) form pesanan, 2) file, 3) validasi
            ;(async () => {
              const groupId = process.env.PPJK_WHATSAPP_GROUP_ID;
              for (const { key, filename, fileUrl } of pendingValidations) {
                try {
                  const docTypeRaw = key
                    .replace(/^uploaded_document:.*/, "attachment")
                    .replace(/[^a-z0-9_]/gi, "_")
                    .toLowerCase();

                  const result = await validateDocument({
                    companyId: session.companyId,
                    documentType: docTypeRaw,
                    fileName: filename,
                    fileUrl,
                    taskId: taskId ?? null,
                  });

                  logger.info(
                    { key, filename, status: result.validationStatus, auditId: result.auditId, taskId },
                    "intake-form: auto-validate selesai",
                  );

                  if (groupId) {
                    const docTypeLabel = docTypeRaw
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (c) => c.toUpperCase());
                    const taskRef = taskId ? ` (Task #${taskId})` : "";
                    let notifMsg: string;
                    if (result.validationStatus === "valid") {
                      notifMsg =
                        `✅ *Dokumen Diterima*${taskRef}\n` +
                        `📄 *${filename}*\n` +
                        `Tipe: ${docTypeLabel}\n` +
                        `Status: Valid & siap diproses.`;
                    } else {
                      const reason = result.issueSummary ?? "Dokumen tidak sesuai tipe yang diminta";
                      notifMsg =
                        `❌ *Validasi Dokumen Gagal*${taskRef}\n` +
                        `📄 *${filename}*\n` +
                        `Tipe: ${docTypeLabel}\n\n` +
                        `${reason}\n` +
                        `Mohon dicek kembali.`;
                    }
                    await sendFonnte(groupId, notifMsg).catch((e) =>
                      logger.warn({ e, groupId }, "intake-form: gagal notif PPJK grup (non-fatal)"),
                    );
                  }
                } catch (autoErr) {
                  logger.warn({ autoErr, key, filename }, "intake-form: auto-validate gagal (non-fatal)");
                }
              }
            })();
          } else {
            logger.warn(
              { companyId: session.companyId, effectiveCategory },
              "intake-form: no active notification receivers found for category",
            );
          }
        } catch (notifErr) {
          logger.warn(
            { notifErr },
            "intake-form: failed to send WA to notification receivers (non-fatal)",
          );
        }
      }

      // Bersihkan kunci sintetis "uploaded_document:..." dari merged sebelum disimpan ke DB.
      // Kunci ini ditambahkan oleh loop document attachment di atas dan tidak perlu persisten.
      const mergedForStorage: Record<string, unknown> = Object.fromEntries(
        Object.entries(merged).filter(([k]) => !k.startsWith("uploaded_document:")),
      );

      // ── Simpan sesi — non-fatal: task sudah dibuat & WA sudah dikirim jika ada error di sini ──
      try {
        await db
          .update(intakeSessionsTable)
          .set({
            collectedFields: mergedForStorage,
            missingFields: stillMissing,
            uploadedDocuments: mergedDocs,
            status: isComplete ? "submitted" : "ready_for_task",
            taskId: taskId ? String(taskId) : session.taskId,
            updatedAt: new Date(),
          })
          .where(eq(intakeSessionsTable.id, session.id));

        logger.info(
          {
            sessionId: session.id,
            type,
            isComplete,
            taskId,
            missingLeft: stillMissing.length,
          },
          "Mini form submitted",
        );
      } catch (updateErr) {
        // Non-fatal: task sudah dibuat dan WA sudah terkirim.
        // Gagal update session jangan return 500 ke user.
        logger.error(
          { updateErr, sessionId: session.id, taskId, isComplete },
          "intake-form: db.update intakeSessionsTable GAGAL (non-fatal) — task tetap dibuat",
        );
      }

      const hasAttachmentFailure =
        attachmentSummary !== null && attachmentSummary.failed > 0;

      res.json({
        ok: true,
        isComplete,
        taskNumber,
        missingFields: stillMissing,
        attachmentStatus: attachmentSummary
          ? {
              total: attachmentSummary.total,
              failed: attachmentSummary.failed,
              partialFailure: hasAttachmentFailure,
              errors: attachmentSummary.errors,
            }
          : null,
        message: isComplete
          ? hasAttachmentFailure
            ? `🎉 Data Anda telah kami terima (No. Task: ${taskNumber}). Namun ${attachmentSummary!.failed} dari ${attachmentSummary!.total} dokumen gagal dikirim ke WhatsApp — tim kami tetap akan memprosesnya.`
            : "🎉 Terima kasih! Data Anda telah kami terima dan kami akan segera memproses permintaan Anda."
          : `Data sebagian disimpan. Masih ada ${stillMissing.length} data yang perlu dilengkapi.`,
      });
    } catch (err) {
      logger.error({ err }, "POST /public/mini-form/:type/:token failed");
      res.status(500).json({ error: "Gagal menyimpan data form" });
    }
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTaskTitle(
  type: string,
  fields: Record<string, unknown>,
  session: { intentName?: string | null; intentCode: string; phone: string },
): string {
  const get = (k: string) => String(fields[k] ?? "").trim();
  switch (type) {
    case "trucking":
      return get("pickup_address") && get("delivery_address")
        ? `Permintaan Trucking — ${get("pickup_address")} ke ${get("delivery_address")}`
        : `Permintaan Trucking — ${session.phone}`;
    case "freight":
      return get("origin_country") && get("destination_country")
        ? `Permintaan Freight — ${get("origin_country")} ke ${get("destination_country")}`
        : `Permintaan Freight — ${session.phone}`;
    case "complaint":
      return get("order_number")
        ? `Komplain Barang Rusak — ${get("order_number")}`
        : `Komplain Barang Rusak — ${session.phone}`;
    case "fleet-repair":
      return get("plate_number")
        ? `Fleet Repair — ${get("plate_number")}`
        : `Fleet Repair — ${session.phone}`;
    case "cash-advance":
      return get("amount")
        ? `Pengajuan Kasbon — Rp ${Number(get("amount")).toLocaleString("id-ID")}`
        : `Pengajuan Kasbon — ${session.phone}`;
    case "field-booking":
      return get("field_type") && get("booking_date")
        ? `Booking ${get("field_type")} — ${get("booking_date")}${get("start_time") ? " " + get("start_time") : ""} (${get("booker_name") || session.phone})`
        : `Pemesanan Lapangan — ${session.phone}`;
    default:
      return `${session.intentName ?? session.intentCode} — ${session.phone}`;
  }
}

export default router;
