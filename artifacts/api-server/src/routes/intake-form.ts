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
  "Logistik":     ["Logistik", "Trucking", "Freight", "Pengiriman", "Sea Freight", "Air Freight"],
  "Customs":      ["Customs", "PPJK", "Bea Cukai", "PPJK/Customs"],
  "Finance":      ["Finance", "Kasbon", "Keuangan", "Pembayaran"],
  "Fleet":        ["Fleet", "Armada", "Kendaraan", "Fleet Management"],
  "Tenant":       ["Tenant", "Properti", "Sewa Properti"],
  "Sport Center": ["Sport Center", "Lapangan", "Olahraga", "Booking Lapangan"],
  "Umum":         ["Umum", "General", "General Inquiry", "Pertanyaan"],
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
import { saveSportCenterBooking, extractDurationHours, bridgeToSportBookings } from "../lib/sport-center-availability";
import { supabaseQuery } from "../lib/supabase-db";

// ── Fallback map: intent code prefix → kategori penerima notifikasi
// Digunakan ketika intent_master lookup ke DB tidak menemukan data
const INTENT_CODE_CATEGORY: Record<string, string> = {
  ppjk:             "Customs",
  customs:          "Customs",
  bea_cukai:        "Customs",
  trucking:         "Logistik",
  freight:          "Logistik",
  import:           "Logistik",
  export:           "Logistik",
  ekspor:           "Logistik",
  logistik:         "Logistik",
  kasbon:           "Finance",
  cash_advance:     "Finance",
  finance:          "Finance",
  booking_lapangan: "Sport Center",
  sport:            "Sport Center",
  lapangan:         "Sport Center",
  fleet:            "Fleet",
  armada:           "Fleet",
  tenant:           "Tenant",
  sewa:             "Tenant",
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
  const summary = Object.values(MINI_FORM_CONFIGS).map(({ type, title, description, fields }) => ({
    type,
    title,
    description,
    fieldCount: fields.length,
    requiredCount: fields.filter((f) => f.required).length,
  }));
  res.json(summary);
});

// ── GET /public/mini-form/preview/:templateId ─────────────────────────────────

router.get("/public/mini-form/preview/:templateId", async (req, res): Promise<void> => {
  try {
    const templateId = parseInt(req.params["templateId"] as string, 10);
    if (isNaN(templateId)) { res.status(400).json({ error: "templateId tidak valid" }); return; }

    const [tpl] = await db
      .select()
      .from(dataTemplatesTable)
      .where(eq(dataTemplatesTable.id, templateId))
      .limit(1);

    if (!tpl) { res.status(404).json({ error: "Template tidak ditemukan" }); return; }

    const dbFields = await db
      .select()
      .from(dataTemplateFieldsTable)
      .where(eq(dataTemplateFieldsTable.templateId, templateId))
      .orderBy(dataTemplateFieldsTable.sortOrder);

    const formType = tpl.miniFormType ?? "trucking";
    const builtinCfg = getFormConfig(formType);

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
      builtinFields: builtinCfg?.fields ?? [],
      customFields: dbFields,
      collectedFields: {},
      missingFields: [],
    });
  } catch (err) {
    logger.error({ err }, "GET /public/mini-form/preview/:templateId failed");
    res.status(500).json({ error: "Gagal memuat preview" });
  }
});

// ── GET /public/mini-form/:type/:token ────────────────────────────────────────

router.get("/public/mini-form/:type/:token", async (req, res): Promise<void> => {
  try {
    const { type, token } = req.params as { type: string; token: string };
    if (!token || token.length < 16) { res.status(400).json({ error: "Token tidak valid" }); return; }

    const formCfg = getFormConfig(type);
    if (!formCfg) { res.status(404).json({ error: `Tipe form '${type}' tidak dikenal` }); return; }

    const [session] = await db
      .select()
      .from(intakeSessionsTable)
      .where(eq(intakeSessionsTable.formToken, token))
      .limit(1);

    if (!session) { res.status(404).json({ error: "Form tidak ditemukan atau link sudah tidak aktif" }); return; }

    if (session.status === "submitted") {
      res.json({
        status: "submitted",
        message: "Data Anda sudah kami terima. Terima kasih! Tim kami akan segera menghubungi Anda.",
      });
      return;
    }
    if (session.status === "cancelled" || session.status === "expired") {
      res.status(410).json({ error: "Sesi ini sudah tidak aktif. Silakan hubungi kami kembali." });
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
    const missingFields = ((session.missingFields ?? []) as string[]).filter((f) => f !== "phone");

    res.json({
      status: session.status,
      intentCode: session.intentCode,
      intentName: session.intentName,
      category: session.category,
      formTitle: formCfg.title,
      formDescription: formCfg.description,
      builtinFields: formCfg.fields,
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
});

// ── POST /public/mini-form/:type/:token ───────────────────────────────────────

router.post("/public/mini-form/:type/:token", async (req, res): Promise<void> => {
  try {
    const { type, token } = req.params as { type: string; token: string };
    const body = req.body as {
      fields: Record<string, string>;
      submittedBy?: string;
      uploadedDocuments?: string[];
    };

    if (!token || token.length < 16) { res.status(400).json({ error: "Token tidak valid" }); return; }

    const formCfg = getFormConfig(type);
    if (!formCfg) { res.status(404).json({ error: `Tipe form '${type}' tidak dikenal` }); return; }

    if (!body.fields || typeof body.fields !== "object") {
      res.status(400).json({ error: "Data field wajib diisi" }); return;
    }

    const [session] = await db
      .select()
      .from(intakeSessionsTable)
      .where(eq(intakeSessionsTable.formToken, token))
      .limit(1);

    if (!session) { res.status(404).json({ error: "Form tidak ditemukan" }); return; }
    if (session.status === "submitted") {
      res.json({ ok: true, message: "Sudah tersubmit sebelumnya. Terima kasih!" }); return;
    }
    if (session.status === "cancelled" || session.status === "expired") {
      res.status(410).json({ error: "Sesi ini sudah tidak aktif" }); return;
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
    if (!merged.field_name && merged.field_type) merged.field_name = merged.field_type;
    if (!merged.field_type && merged.field_name) merged.field_type = merged.field_name;

    // Auto-compute end_time from start_time + duration so users never have to fill it manually.
    // This covers field-booking and any form where the AI asks for end_time but the form only shows start + duration.
    if (!merged.end_time && merged.start_time && merged.duration) {
      const durationMap: Record<string, number> = {
        "1 jam": 60, "1,5 jam": 90, "1.5 jam": 90,
        "2 jam": 120, "3 jam": 180, "4 jam": 240,
        "90 menit": 90, "60 menit": 60, "45 menit": 45,
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
      .filter((f: MiniFormFieldDef) => f.required && f.type !== "file")
      .map((f: MiniFormFieldDef) => f.name);

    // "phone" is always provided by the WA session — remove it from the required list.
    // "end_time" is always auto-computed from start_time + duration — never require user input for it.
    const ALWAYS_EXCLUDE = new Set(["phone", "end_time"]);
    const prevMissing = (Array.isArray(session.missingFields) ? (session.missingFields as string[]) : [])
      .filter((f) => !ALWAYS_EXCLUDE.has(f));
    const allRequired = Array.from(new Set([...requiredBuiltinNames, ...prevMissing]))
      .filter((f) => !ALWAYS_EXCLUDE.has(f));
    const stillMissing = allRequired.filter(
      (f) => !merged[f] || String(merged[f]).trim() === "",
    );

    // Merge uploaded docs
    const prevDocs = Array.isArray(session.uploadedDocuments) ? (session.uploadedDocuments as string[]) : [];
    const newDocs = body.uploadedDocuments ?? [];
    const mergedDocs = Array.from(new Set([...prevDocs, ...newDocs]));

    const isComplete = stillMissing.length === 0;

    let taskId: number | null = null;
    let taskNumber: string | null = null;

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
          status: "New Inquiry",
          priority: type === "complaint" || type === "fleet-repair" ? "high" : "medium",
          category: session.category ?? formCfg.title,
          customerPhone: session.phone,
          customerId: session.customerId ? parseInt(session.customerId, 10) || null : null,
          aiSummary: `Form ${formCfg.title} diisi via link WhatsApp`,
          source: "mini_form",
          missingData: JSON.stringify([]),
        })
        .returning();

      taskId = newTask!.id;

      // ── Sport Center: save booking record + bridge to public.sport_bookings ──
      if (type === "field-booking" || session.intentCode.toLowerCase().includes("booking_lapangan") || session.intentCode.toLowerCase().includes("sport_center")) {
        const endTime = String(merged.end_time ?? "").trim() || undefined;
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
        }).catch((e) => { logger.warn({ e }, "intake-form: saveSportCenterBooking failed (non-fatal)"); return null; });

        // Bridge ke public.sport_bookings agar data form customer tersimpan di tabel utama
        if (savedFormBooking) {
          bridgeToSportBookings({
            saved: savedFormBooking,
            fieldType: String(merged.field_type ?? merged.field_name ?? "Umum"),
            notes: String(merged.notes ?? "").trim() || null,
          }).catch((e) => logger.warn({ e }, "intake-form: bridgeToSportBookings failed (non-fatal)"));
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
        } catch { /* ignore */ }

        // Jika heliumdb tidak punya, coba Supabase (tempat seed data sebenarnya)
        if (!resolvedCategory) {
          try {
            const rows = await supabaseQuery<{ category: string | null }>(
              `SELECT category FROM intent_master WHERE intent_code = $1 AND is_active = true LIMIT 1`,
              [session.intentCode],
            );
            resolvedCategory = rows[0]?.category ?? null;
          } catch { /* ignore */ }
        }

        // Terakhir: inferensi dari intentCode itu sendiri (selalu berhasil untuk kode yang dikenal)
        if (!resolvedCategory) {
          resolvedCategory = inferCategoryFromIntentCode(session.intentCode);
        }

        // Fallback chain: intent_master (heliumdb/supabase) → intentCode prefix → session.category → formCfg.title
        const effectiveCategory = resolvedCategory ?? session.category ?? formCfg.title;

        logger.info(
          { intentCode: session.intentCode, resolvedCategory, sessionCategory: session.category, effectiveCategory },
          "intake-form: resolving notification receiver category",
        );

        // Kumpulkan semua alias kategori yang perlu dicek
        // Misal: intent "Customs" → cari penerima dengan kategori "Customs" ATAU "PPJK" ATAU "Bea Cukai" dll.
        const aliasSet = new Set<string>();
        if (resolvedCategory) getCategoryAliases(resolvedCategory).forEach(a => aliasSet.add(a));
        if (session.category) getCategoryAliases(session.category).forEach(a => aliasSet.add(a));
        if (aliasSet.size === 0) getCategoryAliases(effectiveCategory).forEach(a => aliasSet.add(a));

        // SELALU tambahkan alias dari intentCode — penting untuk kasus di mana intentCode
        // lebih spesifik dari category (misal: ppjk_service → category "Logistik" di DB,
        // tapi penerima notif terdaftar dengan kategori "PPJK" atau "Customs")
        const intentCodeCategory = inferCategoryFromIntentCode(session.intentCode);
        if (intentCodeCategory) getCategoryAliases(intentCodeCategory).forEach(a => aliasSet.add(a));
        const categoryList = Array.from(aliasSet);

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

          // Field file (CI/PL) yang punya URL dikirim sebagai attachment — jangan tampilkan sebagai teks
          const FILE_FIELD_KEYS = new Set(["commercial_invoice", "packing_list"]);
          const isPublicUrl = (v: unknown): v is string =>
            typeof v === "string" && (v.startsWith("http://") || v.startsWith("https://"));

          const fieldSummaryWa = Object.entries(merged)
            .filter(([k]) => !FILE_FIELD_KEYS.has(k)) // skip file fields sepenuhnya dari teks
            .slice(0, 20)
            .map(([k, v]) => {
              const label = fieldLabelMap[k] ?? k;
              return `• ${label}: ${String(v)}`;
            })
            .join("\n");

          const notifMsg =
            `📋 *Pesanan Baru — ${formCfg.title}*\n` +
            `No. Task: *${taskNumber}*\n` +
            `Pelanggan: ${session.phone}\n\n` +
            `*Detail Pesanan:*\n${fieldSummaryWa}\n\n` +
            `Mohon Segera Konfirmasi.`;

          await Promise.allSettled(
            receivers.map((r) =>
              sendFonnte(r.phone, notifMsg).catch((e) =>
                logger.warn({ e, phone: r.phone }, "intake-form: WA to receiver failed"),
              ),
            ),
          );

          // ── Kirim Commercial Invoice & Packing List sebagai attachment dokumen WA ──
          const docAttachments: Array<{ key: string; label: string }> = [
            { key: "commercial_invoice", label: "Commercial Invoice" },
            { key: "packing_list",       label: "Packing List" },
          ];

          for (const { key, label } of docAttachments) {
            const fileUrl = merged[key];
            if (!isPublicUrl(fileUrl)) {
              if (fileUrl) {
                logger.info({ key, value: fileUrl }, "intake-form: file field has value but not a public URL — skip WA attachment");
              }
              continue;
            }

            // Ekstrak nama file asli dari URL (hapus query string & prefix timestamp)
            const rawFilename = fileUrl.split("/").pop()?.split("?")[0] ?? `${label}.pdf`;
            // Hapus prefix timestamp (misal: "1753449600000_") yang ditambah getUploadUrl
            const filename = rawFilename.replace(/^\d+_/, "") || `${label}.pdf`;

            logger.info({ key, filename, fileUrl, receiverCount: receivers.length }, "intake-form: sending WA document attachment");

            await Promise.allSettled(
              receivers.map(async (r) => {
                const result = await sendFonnteDocument(r.phone, fileUrl, filename).catch((e: unknown) => {
                  logger.warn({ e, phone: r.phone, key }, "intake-form: sendFonnteDocument threw");
                  return { success: false, error: String(e) };
                });
                if (!result.success) {
                  logger.warn({ phone: r.phone, key, filename, error: result.error }, "intake-form: WA document attachment failed");
                } else {
                  logger.info({ phone: r.phone, key, filename }, "intake-form: WA document attachment sent");
                }
              }),
            );
          }

          logger.info(
            { companyId: session.companyId, taskId, effectiveCategory, receiverCount: receivers.length },
            "intake-form: WA notifications sent to receivers",
          );
        } else {
          logger.warn(
            { companyId: session.companyId, effectiveCategory },
            "intake-form: no active notification receivers found for category",
          );
        }
      } catch (notifErr) {
        logger.warn({ notifErr }, "intake-form: failed to send WA to notification receivers (non-fatal)");
      }
    }

    await db
      .update(intakeSessionsTable)
      .set({
        collectedFields: merged,
        missingFields: stillMissing,
        uploadedDocuments: mergedDocs,
        status: isComplete ? "submitted" : "ready_for_task",
        taskId: taskId ? String(taskId) : session.taskId,
        updatedAt: new Date(),
      })
      .where(eq(intakeSessionsTable.id, session.id));

    logger.info(
      { sessionId: session.id, type, isComplete, taskId, missingLeft: stillMissing.length },
      "Mini form submitted",
    );

    res.json({
      ok: true,
      isComplete,
      taskNumber,
      missingFields: stillMissing,
      message: isComplete
        ? "🎉 Terima kasih! Data Anda telah kami terima dan kami akan segera memproses permintaan Anda."
        : `Data sebagian disimpan. Masih ada ${stillMissing.length} data yang perlu dilengkapi.`,
    });
  } catch (err) {
    logger.error({ err }, "POST /public/mini-form/:type/:token failed");
    res.status(500).json({ error: "Gagal menyimpan data form" });
  }
});

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
