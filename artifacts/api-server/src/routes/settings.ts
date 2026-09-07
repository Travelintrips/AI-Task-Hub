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

    // Fallback ke env var jika DB belum ada token
    const envFonnteToken = process.env.FONNTE_TOKEN ?? null;
    const envWaToken = process.env.WHATSAPP_TOKEN ?? null;
    const envWaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? null;

    if (!row) {
      const fonnteConfigured = !!envFonnteToken;
      const whatsappConfigured = !!envWaToken && !!envWaPhoneId;
      res.json({
        companyId,
        companyName: null,
        companyPhone: null,
        companyAddress: null,
        companyEmail: null,
        fonnteToken: envFonnteToken ? `••••••••${envFonnteToken.slice(-4)}` : null,
        fonnteConfigured,
        whatsappPhoneNumberId: envWaPhoneId,
        whatsappToken: envWaToken ? `••••••••${envWaToken.slice(-4)}` : null,
        whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? null,
        whatsappConfigured,
        templateMissingDoc: null,
        templateNewTask: null,
        templateAssignment: null,
        templateProgress: null,
        templateApproval: null,
        templateCompleted: null,
        // Task 4: profile completion (no row yet = 0%)
        profileCompletionPct: 0,
        profileMissingFields: ["companyName", "companyPhone", "companyEmail", "industryType"],
        profileFields: { companyName: false, companyPhone: false, companyEmail: false, industryType: false },
      });
      return;
    }

    const resolvedFonnte = row.fonnteToken ?? envFonnteToken;
    const resolvedWaToken = row.whatsappToken ?? envWaToken;
    const resolvedWaPhoneId = row.whatsappPhoneNumberId ?? envWaPhoneId;

    // Task 4: compute company profile completion percentage
    const profileFields = {
      companyName: !!row.companyName,
      companyPhone: !!row.companyPhone,
      companyEmail: !!row.companyEmail,
      industryType: !!row.industryType,
    };
    const profileDone = Object.values(profileFields).filter(Boolean).length;
    const profileCompletionPct = Math.round((profileDone / 4) * 100);
    const profileMissingFields = Object.entries(profileFields).filter(([, v]) => !v).map(([k]) => k);

    res.json({
      ...row,
      fonnteConfigured: !!resolvedFonnte,
      whatsappConfigured: !!resolvedWaToken && !!resolvedWaPhoneId,
      // Mask tokens — kirim hanya 4 karakter terakhir untuk keamanan
      fonnteToken: resolvedFonnte ? `••••••••${resolvedFonnte.slice(-4)}` : null,
      whatsappToken: resolvedWaToken ? `••••••••${resolvedWaToken.slice(-4)}` : null,
      whatsappPhoneNumberId: resolvedWaPhoneId,
      // Task 4: profile completion
      profileCompletionPct,
      profileMissingFields,
      profileFields,
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
        companyName, companyPhone, companyAddress, companyEmail, industryType,
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
        industryType:              industryType ?? null,
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
