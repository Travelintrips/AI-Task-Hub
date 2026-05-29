import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, companySettingsTable } from "@workspace/db";
import { requireAuth, requireRole, getCompanyIdForWrite } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /settings ────────────────────────────────────────────────────────────

router.get("/settings", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);

    const [row] = await db
      .select()
      .from(companySettingsTable)
      .where(eq(companySettingsTable.companyId, companyId))
      .limit(1);

    if (!row) {
      res.json({
        companyId,
        companyName: null,
        companyPhone: null,
        companyAddress: null,
        companyEmail: null,
        fonnteToken: null,
        fonnteConfigured: false,
        whatsappPhoneNumberId: null,
        whatsappToken: null,
        whatsappWebhookVerifyToken: null,
        whatsappConfigured: false,
        templateMissingDoc: null,
        templateNewTask: null,
        templateAssignment: null,
        templateProgress: null,
        templateApproval: null,
        templateCompleted: null,
      });
      return;
    }

    res.json({
      ...row,
      fonnteConfigured: !!row.fonnteToken,
      whatsappConfigured: !!row.whatsappToken && !!row.whatsappPhoneNumberId,
      // Mask tokens — kirim hanya 4 karakter terakhir untuk keamanan
      fonnteToken: row.fonnteToken ? `••••••••${row.fonnteToken.slice(-4)}` : null,
      whatsappToken: row.whatsappToken ? `••••••••${row.whatsappToken.slice(-4)}` : null,
    });
  } catch (err) {
    logger.error({ err }, "GET /settings failed");
    res.status(500).json({ error: "Gagal memuat pengaturan" });
  }
});

// ─── PUT /settings ────────────────────────────────────────────────────────────

router.put(
  "/settings",
  requireAuth,
  requireRole("company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyIdForWrite(req);

      const {
        companyName, companyPhone, companyAddress, companyEmail,
        fonnteToken, whatsappPhoneNumberId, whatsappToken, whatsappWebhookVerifyToken,
        templateMissingDoc, templateNewTask, templateAssignment,
        templateProgress, templateApproval, templateCompleted,
      } = req.body as Record<string, string | undefined>;

      // Jika token berbentuk mask (••••), jangan overwrite nilai lama
      const isMasked = (v?: string) => v?.startsWith("••••••••");

      const [existing] = await db
        .select()
        .from(companySettingsTable)
        .where(eq(companySettingsTable.companyId, companyId))
        .limit(1);

      const payload = {
        companyId,
        companyName:               companyName ?? null,
        companyPhone:              companyPhone ?? null,
        companyAddress:            companyAddress ?? null,
        companyEmail:              companyEmail ?? null,
        fonnteToken:               isMasked(fonnteToken) ? (existing?.fonnteToken ?? null) : (fonnteToken ?? null),
        whatsappPhoneNumberId:     whatsappPhoneNumberId ?? null,
        whatsappToken:             isMasked(whatsappToken) ? (existing?.whatsappToken ?? null) : (whatsappToken ?? null),
        whatsappWebhookVerifyToken: whatsappWebhookVerifyToken ?? null,
        templateMissingDoc:        templateMissingDoc ?? null,
        templateNewTask:           templateNewTask ?? null,
        templateAssignment:        templateAssignment ?? null,
        templateProgress:          templateProgress ?? null,
        templateApproval:          templateApproval ?? null,
        templateCompleted:         templateCompleted ?? null,
      };

      if (existing) {
        await db
          .update(companySettingsTable)
          .set(payload)
          .where(eq(companySettingsTable.companyId, companyId));
      } else {
        await db.insert(companySettingsTable).values(payload);
      }

      // Jika Fonnte token baru disimpan, update env supaya langsung aktif
      const resolvedFonnte = payload.fonnteToken;
      if (resolvedFonnte) {
        process.env.FONNTE_TOKEN = resolvedFonnte;
      }
      const resolvedWaToken = payload.whatsappToken;
      if (resolvedWaToken) {
        process.env.WHATSAPP_TOKEN = resolvedWaToken;
      }
      if (payload.whatsappPhoneNumberId) {
        process.env.WHATSAPP_PHONE_NUMBER_ID = payload.whatsappPhoneNumberId;
      }
      if (payload.whatsappWebhookVerifyToken) {
        process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = payload.whatsappWebhookVerifyToken;
      }

      logger.info({ companyId }, "Settings updated");
      res.json({ success: true, message: "Pengaturan berhasil disimpan" });
    } catch (err) {
      logger.error({ err }, "PUT /settings failed");
      res.status(500).json({ error: "Gagal menyimpan pengaturan" });
    }
  },
);

// ─── POST /settings/test-fonnte ───────────────────────────────────────────────

router.post(
  "/settings/test-fonnte",
  requireAuth,
  requireRole("company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { phone, token } = req.body as { phone?: string; token?: string };

      if (!phone) {
        res.status(400).json({ error: "Nomor HP tujuan wajib diisi" });
        return;
      }

      const companyId = getCompanyIdForWrite(req);
      const [row] = await db
        .select({ fonnteToken: companySettingsTable.fonnteToken })
        .from(companySettingsTable)
        .where(eq(companySettingsTable.companyId, companyId))
        .limit(1);

      const fonnteToken = (token && !token.startsWith("••••••••"))
        ? token
        : row?.fonnteToken ?? process.env.FONNTE_TOKEN;

      if (!fonnteToken) {
        res.status(400).json({ error: "FONNTE_TOKEN belum dikonfigurasi" });
        return;
      }

      const normalizedPhone = phone.replace(/\D/g, "").replace(/^0/, "62");
      const result = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          Authorization: fonnteToken,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          target: normalizedPhone,
          message: "✅ Tes koneksi WhatsApp dari AI Task Center berhasil!",
        }).toString(),
      });

      const body = await result.json() as { status?: boolean; reason?: string };

      if (result.ok && body.status !== false) {
        res.json({ success: true, message: `Pesan tes terkirim ke ${phone}` });
      } else {
        res.status(400).json({ success: false, error: body.reason ?? "Gagal mengirim pesan" });
      }
    } catch (err) {
      logger.error({ err }, "POST /settings/test-fonnte failed");
      res.status(500).json({ error: "Gagal menguji koneksi Fonnte" });
    }
  },
);

export default router;
