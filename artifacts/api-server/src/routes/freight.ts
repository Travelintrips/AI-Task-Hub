/**
 * Freight / PPJK Document Upload & Notification Route
 *
 * POST /api/freight/:id
 *   — Terima form data + file CI & PL via multipart/form-data (multer)
 *   — Upload ke Supabase Storage bucket "exportimport"
 *   — Kirim WA + attachment ke nomor personal dan/atau group
 *   — Simpan record ke DB (ai_tasks)
 *
 * Env vars:
 *   PPJK_WHATSAPP_GROUP_ID  — Group JID Fonnte (mis: 6281234567890-1234567890@g.us)
 *                              Jika tidak diset, notifikasi group dilewati.
 */

import { Router, type IRouter } from "express";
import multer from "multer";
import { db, aiTasksTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  uploadToSupabase,
  getPublicUrl,
  getAccessibleExportImportUrl,
  sendWhatsAppMedia,
  ensureExportImportBucket,
} from "../lib/storage";
import { sendFonnte } from "../lib/fonnte";
import { normalizePhone } from "../lib/fonnte";

const router: IRouter = Router();

// ── Multer setup ──────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB per file
    files: 2,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Tipe file tidak diizinkan: ${file.mimetype}. Gunakan PDF, JPG, atau PNG.`,
        ),
      );
    }
  },
});

// ── POST /api/freight/:id ─────────────────────────────────────────────────────

router.post(
  "/freight/:id",
  upload.fields([
    { name: "commercial_invoice", maxCount: 1 },
    { name: "packing_list", maxCount: 1 },
  ]),
  async (req, res): Promise<void> => {
    const freightId = req.params["id"] as string;

    try {
      // ── 1. Pastikan bucket ada ─────────────────────────────────────────────
      await ensureExportImportBucket();

      // ── 2. Ambil files dari request ────────────────────────────────────────
      const files = req.files as
        | Record<string, Express.Multer.File[]>
        | undefined;

      const ciFile = files?.["commercial_invoice"]?.[0];
      const plFile = files?.["packing_list"]?.[0];

      if (!ciFile && !plFile) {
        res.status(400).json({
          error:
            "Minimal satu dokumen harus diupload (commercial_invoice atau packing_list).",
        });
        return;
      }

      // ── 3. Ambil data form dari body ───────────────────────────────────────
      const body = req.body as {
        customer_phone?: string;
        consignee_name?: string;
        origin_country?: string;
        destination_country?: string;
        commodity?: string;
        gross_weight?: string;
        volume?: string;
        shipment_mode?: string;
        incoterm?: string;
        ready_date?: string;
        contact_person?: string;
        notes?: string;
        company_id?: string;
      };

      const customerPhone = body.customer_phone
        ? (normalizePhone(body.customer_phone) ?? body.customer_phone)
        : null;
      const companyId = body.company_id ?? "default";

      logger.info(
        {
          freightId,
          customerPhone,
          hasCi: !!ciFile,
          hasPl: !!plFile,
          companyId,
        },
        "freight: memulai proses upload dokumen",
      );

      // ── 4. Upload file ke Supabase Storage bucket "exportimport" ──────────
      const folder = `freight-documents/${freightId}`;

      let ciStoragePath: string | null = null;
      let ciPublicUrl: string | null = null;
      let ciAccessibleUrl: string | null = null;
      let ciFilename: string | null = null;

      let plStoragePath: string | null = null;
      let plPublicUrl: string | null = null;
      let plAccessibleUrl: string | null = null;
      let plFilename: string | null = null;

      // Upload CI dan PL secara paralel
      await Promise.allSettled([
        (async () => {
          if (!ciFile) return;
          try {
            ciStoragePath = await uploadToSupabase(ciFile, folder);
            ciPublicUrl = getPublicUrl(ciStoragePath);
            ciAccessibleUrl = await getAccessibleExportImportUrl(
              ciStoragePath,
              ciPublicUrl,
            );
            // Nama file bersih (hapus prefix timestamp)
            ciFilename =
              ciFile.originalname ||
              ciStoragePath.split("/").pop() ||
              "Commercial_Invoice.pdf";
            logger.info(
              { ciStoragePath, ciPublicUrl, ciAccessibleUrl },
              "freight: CI berhasil diupload",
            );
          } catch (err) {
            logger.error({ err }, "freight: gagal upload CI");
          }
        })(),
        (async () => {
          if (!plFile) return;
          try {
            plStoragePath = await uploadToSupabase(plFile, folder);
            plPublicUrl = getPublicUrl(plStoragePath);
            plAccessibleUrl = await getAccessibleExportImportUrl(
              plStoragePath,
              plPublicUrl,
            );
            plFilename =
              plFile.originalname ||
              plStoragePath.split("/").pop() ||
              "Packing_List.pdf";
            logger.info(
              { plStoragePath, plPublicUrl, plAccessibleUrl },
              "freight: PL berhasil diupload",
            );
          } catch (err) {
            logger.error({ err }, "freight: gagal upload PL");
          }
        })(),
      ]);

      // ── 5. Format pesan WhatsApp ───────────────────────────────────────────
      const now = new Date();
      const taskNumber = `PPJK-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${freightId}`;

      const detailLines: string[] = [];
      if (body.consignee_name) detailLines.push(`• Consignee  : ${body.consignee_name}`);
      if (body.origin_country && body.destination_country)
        detailLines.push(`• Rute       : ${body.origin_country} → ${body.destination_country}`);
      if (body.commodity) detailLines.push(`• Komoditi   : ${body.commodity}`);
      if (body.gross_weight) detailLines.push(`• Berat      : ${body.gross_weight} kg`);
      if (body.volume) detailLines.push(`• Volume     : ${body.volume} m³/CBM`);
      if (body.shipment_mode) detailLines.push(`• Moda       : ${body.shipment_mode}`);
      if (body.incoterm) detailLines.push(`• Incoterm   : ${body.incoterm}`);
      if (body.ready_date) detailLines.push(`• Kargo Siap : ${body.ready_date}`);
      if (body.contact_person) detailLines.push(`• Kontak     : ${body.contact_person}`);
      if (body.notes) detailLines.push(`• Catatan    : ${body.notes}`);

      const detailText =
        detailLines.length > 0
          ? `\n\n*Detail Pengiriman:*\n${detailLines.join("\n")}`
          : "";

      const baseMessage =
        `📦 *Dokumen Freight / PPJK Baru*\n` +
        `No. Ref : *${taskNumber}*\n` +
        `Pelanggan: ${customerPhone ?? "—"}` +
        detailText +
        `\n\n_Dokumen terlampir. Mohon segera diproses._`;

      // ── 6. Kirim ke WhatsApp personal (nomor customer) ────────────────────
      const waResults: Array<{ target: string; doc: string; success: boolean; error?: string }> = [];

      if (customerPhone) {
        // Kirim text message dulu (ringkasan tanpa attachment)
        await sendFonnte(customerPhone, baseMessage).catch((e) =>
          logger.warn({ e }, "freight: text WA ke customer gagal (non-fatal)"),
        );

        // Kirim CI ke customer
        if (ciAccessibleUrl && ciFilename) {
          const r = await sendWhatsAppMedia({
            target: customerPhone,
            message: `📄 *Commercial Invoice* — No. Ref: ${taskNumber}`,
            fileUrl: ciAccessibleUrl,
            fileName: ciFilename,
          });
          waResults.push({ target: customerPhone, doc: "CI", ...r });
        }

        // Kirim PL ke customer
        if (plAccessibleUrl && plFilename) {
          const r = await sendWhatsAppMedia({
            target: customerPhone,
            message: `📋 *Packing List* — No. Ref: ${taskNumber}`,
            fileUrl: plAccessibleUrl,
            fileName: plFilename,
          });
          waResults.push({ target: customerPhone, doc: "PL", ...r });
        }
      }

      // ── 7. Kirim ke WhatsApp group (jika PPJK_WHATSAPP_GROUP_ID diset) ────
      const groupId = process.env.PPJK_WHATSAPP_GROUP_ID;
      if (groupId) {
        // Pesan ringkasan ke group
        await sendFonnte(groupId, baseMessage).catch((e) =>
          logger.warn({ e, groupId }, "freight: text WA ke group gagal (non-fatal)"),
        );

        // CI ke group
        if (ciAccessibleUrl && ciFilename) {
          const r = await sendWhatsAppMedia({
            target: groupId,
            message: `📄 *Commercial Invoice* — No. Ref: ${taskNumber}\nPelanggan: ${customerPhone ?? "—"}`,
            fileUrl: ciAccessibleUrl,
            fileName: ciFilename,
          });
          waResults.push({ target: groupId, doc: "CI", ...r });
        }

        // PL ke group
        if (plAccessibleUrl && plFilename) {
          const r = await sendWhatsAppMedia({
            target: groupId,
            message: `📋 *Packing List* — No. Ref: ${taskNumber}\nPelanggan: ${customerPhone ?? "—"}`,
            fileUrl: plAccessibleUrl,
            fileName: plFilename,
          });
          waResults.push({ target: groupId, doc: "PL", ...r });
        }
      } else {
        logger.info(
          "freight: PPJK_WHATSAPP_GROUP_ID tidak diset — notifikasi group dilewati",
        );
      }

      // ── 8. Simpan ke database (ai_tasks) ──────────────────────────────────
      const description =
        `Freight/PPJK submission via API — Ref: ${freightId}\n\n` +
        `${detailText.trim()}\n\n` +
        `Dokumen:\n` +
        (ciPublicUrl ? `• Commercial Invoice: ${ciPublicUrl}\n` : "") +
        (plPublicUrl ? `• Packing List: ${plPublicUrl}\n` : "");

      const [savedTask] = await db
        .insert(aiTasksTable)
        .values({
          companyId,
          taskNumber,
          title: `Permintaan Freight — ${body.origin_country ?? "?"} ke ${body.destination_country ?? "?"}${body.consignee_name ? ` (${body.consignee_name})` : ""}`,
          description: description.trim(),
          category: "Customs",
          division: "PPJK",
          status: "documents_received",
          priority: "medium",
          customerPhone: customerPhone ?? undefined,
          customerName: body.consignee_name ?? undefined,
          source: "freight_api",
          aiSummary: `Dokumen freight diterima: ${[ciFile ? "CI" : null, plFile ? "PL" : null].filter(Boolean).join(" + ")}`,
          missingData: JSON.stringify([]),
        })
        .returning();

      logger.info(
        {
          taskId: savedTask?.id,
          taskNumber,
          waResults,
          hasCi: !!ciPublicUrl,
          hasPl: !!plPublicUrl,
        },
        "freight: proses selesai",
      );

      // ── 9. Return response ─────────────────────────────────────────────────
      const waSuccessCount = waResults.filter((r) => r.success).length;
      const waFailCount = waResults.filter((r) => !r.success).length;

      res.json({
        ok: true,
        taskNumber,
        taskId: savedTask?.id ?? null,
        documents: {
          commercial_invoice: ciPublicUrl
            ? { storagePath: ciStoragePath, publicUrl: ciPublicUrl, accessibleUrl: ciAccessibleUrl }
            : null,
          packing_list: plPublicUrl
            ? { storagePath: plStoragePath, publicUrl: plPublicUrl, accessibleUrl: plAccessibleUrl }
            : null,
        },
        whatsapp: {
          sent: waSuccessCount,
          failed: waFailCount,
          customerNotified: !!customerPhone,
          groupNotified: !!groupId,
          results: waResults,
        },
        message:
          waFailCount === 0 && waSuccessCount > 0
            ? `✅ Dokumen berhasil diterima dan dikirim via WhatsApp (No. Ref: ${taskNumber})`
            : waSuccessCount > 0
              ? `⚠️ Dokumen diterima (No. Ref: ${taskNumber}), namun ${waFailCount} pengiriman WA gagal.`
              : `📁 Dokumen tersimpan (No. Ref: ${taskNumber}). WA tidak terkirim — periksa konfigurasi FONNTE_TOKEN.`,
      });
    } catch (err) {
      logger.error({ err, freightId }, "POST /api/freight/:id failed");

      // Handle multer errors (file size / type)
      if (
        err instanceof Error &&
        (err.message.includes("Tipe file") ||
          err.message.includes("File too large") ||
          err.message.includes("LIMIT_"))
      ) {
        res.status(400).json({ error: err.message });
        return;
      }

      res.status(500).json({ error: "Gagal memproses dokumen freight" });
    }
  },
);

// ── GET /api/freight/:id — Info endpoint (cek status task) ───────────────────

router.get("/freight/:id", async (req, res): Promise<void> => {
  const freightId = req.params["id"] as string;

  try {
    const { eq } = await import("drizzle-orm");
    const tasks = await db
      .select({
        id: aiTasksTable.id,
        taskNumber: aiTasksTable.taskNumber,
        title: aiTasksTable.title,
        status: aiTasksTable.status,
        description: aiTasksTable.description,
        createdAt: aiTasksTable.createdAt,
      })
      .from(aiTasksTable)
      .where(eq(aiTasksTable.taskNumber, `PPJK-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}-${freightId}`))
      .limit(1);

    if (!tasks[0]) {
      res.status(404).json({ error: `Tidak ada task freight dengan ID: ${freightId}` });
      return;
    }

    res.json({ ok: true, task: tasks[0] });
  } catch (err) {
    logger.error({ err, freightId }, "GET /api/freight/:id failed");
    res.status(500).json({ error: "Gagal mengambil data freight" });
  }
});

export default router;
