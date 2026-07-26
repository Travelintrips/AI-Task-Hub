/**
 * MiniFormRouter — Sprint 9B
 *
 * Setelah intent terdeteksi, router ini menentukan flow yang tepat:
 *   - conversation  → lanjutkan ke IntakeEngine (chat)
 *   - mini_form     → buat session + kirim link form via WA
 *   - hybrid        → kirim link form + biarkan IntakeEngine berjalan juga
 *
 * Usage (dari whatsapp.ts / runAiDetection):
 *   const route = await routeIntentToFlow({ phone, companyId, intentCode, ... });
 *   if (route.flow === "conversation") { ... existing startIntakeSession ... }
 *   else { ... mini form link already sent, log and return ... }
 */

import { eq, and, gt, desc } from "drizzle-orm";
import { db, intakeSessionsTable, dataTemplatesTable } from "@workspace/db";
import { generateSecureToken } from "./tokens";
import { getFormConfig, inferFormType } from "./mini-form-config";
import { sendFonnte } from "./fonnte";
import { sendWhatsAppInteractiveButtons } from "./whatsapp";
import { logger } from "./logger";

import type { IntentResolution } from "./intent-engine";

export const FORM_MENU_BUTTONS = [
  { id: "form_menu_home", title: "Kembali Menu Awal" },
  { id: "form_menu_end", title: "Akhiri Percakapan" },
  { id: "form_menu_agent", title: "Hubungi Agent" },
] as const;

export async function sendFormMenu(
  phone: string,
  message: string,
  companyId: string,
  fonnteDevice?: string | null,
): Promise<{ success: boolean; error?: string }> {
  // Coba Meta Cloud API interactive buttons dulu (perlu kredensial Meta)
  const interactive = await sendWhatsAppInteractiveButtons(
    phone,
    message,
    [...FORM_MENU_BUTTONS],
    companyId,
  );
  if (interactive.success) return interactive;

  // PENTING: Fonnte poll (choices) hanya menampilkan UI voting — pilihan yang diklik
  // TIDAK mengirim pesan balik ke webhook. Gunakan plain text dengan instruksi keyword.
  // User membalas dengan teks [Kembali Menu Awal], [Akhiri Percakapan], atau [Hubungi Agent].
  logger.info(
    { phone, companyId },
    "mini-form: Meta buttons unavailable — using plain text menu (Fonnte polls are vote-only)",
  );

  const menuText =
    message +
    `\n\n` +
    `Setelah form dikirim, balas dengan salah satu pilihan:\n\n` +
    `🔄 *[Kembali Menu Awal]*\n` +
    `🔚 *[Akhiri Percakapan]*\n` +
    `👤 *[Hubungi Agent]*`;

  return sendFonnte(phone, menuText, fonnteDevice);
}

export type FlowMode = "conversation" | "hybrid" | "mini_form";

export interface RouterResult {
  flow: FlowMode;
  sessionId: number | null;
  formToken: string | null;
  formUrl: string | null;
  waSent: boolean;
  /** Populated for hybrid mode when deferFormSend=true — the form type to send later */
  formType?: string;
}

// ── Domain helpers ──────────────────────────────────────────────────────────────

function getPublicBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS ?? "";
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "";
  if (devDomain) return `https://${devDomain}`;
  return "http://localhost:5000";
}

// ── Core router ─────────────────────────────────────────────────────────────────

export async function routeIntentToFlow({
  phone,
  companyId,
  intentCode,
  intentName,
  category,
  resolution,
  collectedFields = {},
  missingFields = [],
  requiredDocuments = [],
  fonnteDevice,
  deferFormSend = false,
}: {
  phone: string;
  companyId: string;
  intentCode: string;
  intentName?: string | null;
  category?: string | null;
  resolution: IntentResolution;
  collectedFields?: Record<string, unknown>;
  missingFields?: string[];
  requiredDocuments?: string[];
  fonnteDevice?: string | null;
  /**
   * When true, hybrid mode will NOT send the form immediately.
   * Instead it returns {flow:"hybrid", formType} for the caller to send
   * the form later (after conversation collects required fields).
   */
  deferFormSend?: boolean;
}): Promise<RouterResult> {
  // Look up intake_mode from data_templates (Supabase DB)
  let intakeMode: FlowMode = "conversation";
  let miniFormType: string | null = null;

  try {
    const [tpl] = await db
      .select()
      .from(dataTemplatesTable)
      .where(
        and(
          eq(dataTemplatesTable.companyId, companyId),
          eq(dataTemplatesTable.intentCode, intentCode),
          eq(dataTemplatesTable.isActive, true),
        ),
      )
      .limit(1);

    if (tpl) {
      intakeMode = (tpl.intakeMode as FlowMode | null) ?? "conversation";
      miniFormType = tpl.miniFormType ?? null;
    }
  } catch (err) {
    logger.warn({ err, intentCode }, "mini-form-router: failed to load template, falling back to conversation");
    return { flow: "conversation", sessionId: null, formToken: null, formUrl: null, waSent: false };
  }

  // conversation mode → caller handles existing startIntakeSession flow
  if (intakeMode === "conversation") {
    return { flow: "conversation", sessionId: null, formToken: null, formUrl: null, waSent: false };
  }

  // mini_form or hybrid → generate token + create session + send WA link
  // Normalize: DB may store "field_booking" (underscore); URLs always use hyphen form.
  const formType = (miniFormType ?? inferFormType(intentCode, category)).replace(/_/g, "-");
  const formCfg = getFormConfig(formType);

  // Hybrid + deferFormSend: caller wants to ask questions first, send form later.
  // Return formType so caller can store it on the intake session.
  if (intakeMode === "hybrid" && deferFormSend) {
    logger.info({ phone, intentCode, formType }, "MiniFormRouter: hybrid deferred — returning formType for intake-first flow");
    return { flow: "hybrid", sessionId: null, formToken: null, formUrl: null, waSent: false, formType };
  }

  // ── Anti-loop: reuse existing form_sent session within 30 minutes ──────────
  const existingSession = await findFormSentSession(phone, companyId, intentCode);
  if (existingSession) {
    const baseUrl = getPublicBaseUrl();
    // Normalize stored miniFormType (DB may have underscore form e.g. "field_booking")
    const existingFormType = existingSession.miniFormType.replace(/_/g, "-");
    const existingFormUrl = `${baseUrl}/mini-form/${existingFormType}/${existingSession.formToken}`;

    // Resend the existing form link (user may not have seen it or it went to wrong device)
    const resendMsg =
      `🔗 Link form pemesanan Anda:\n\n${existingFormUrl}\n\nSilakan lengkapi form data untuk melanjutkan proses. Jika ada pertanyaan, tim kami siap membantu! 🙏\n\n` +
      `Setelah form dikirim, silakan pilih tindakan berikutnya dari menu di bawah.`;
    const resent = await sendFormMenu(phone, resendMsg, companyId, fonnteDevice).catch((e) => {
      logger.warn({ e, phone }, "mini-form-router: resend form link failed");
      return { success: false, error: String(e) };
    });

    logger.info(
      { phone, intentCode, sessionId: existingSession.id, formUrl: existingFormUrl, resent: resent.success },
      "MiniFormRouter: reusing existing form_sent session — resending link",
    );
    return {
      flow: intakeMode,
      sessionId: existingSession.id,
      formToken: existingSession.formToken,
      formUrl: existingFormUrl,
      waSent: resent.success,
    };
  }

  const token = generateSecureToken();
  const baseUrl = getPublicBaseUrl();
  const formUrl = `${baseUrl}/mini-form/${formType}/${token}`;

  // Create intake session with formToken (status = form_sent)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let sessionId: number | null = null;
  try {
    const [session] = await db
      .insert(intakeSessionsTable)
      .values({
        companyId,
        phone,
        intentCode,
        intentName: intentName ?? null,
        category: category ?? null,
        status: "form_sent",
        miniFormType: formType,
        formToken: token,
        formSentAt: new Date(),
        collectedFields: collectedFields as Record<string, string>,
        missingFields,
        requiredDocuments,
        expiresAt,
      })
      .returning();
    sessionId = session?.id ?? null;
  } catch (err) {
    logger.error({ err, phone, intentCode }, "mini-form-router: failed to create intake session");
    return { flow: intakeMode, sessionId: null, formToken: null, formUrl: null, waSent: false };
  }

  // Build WA message from form config template
  const template =
    formCfg?.waMessageTemplate ??
    "Baik, untuk mempercepat proses, mohon isi form berikut:\n\n{mini_form_url}\n\nSetelah form dikirim, tim kami akan segera menindaklanjuti. Terima kasih!";

  const waMessage =
    template.replace("{mini_form_url}", formUrl) +
    `\n\nSetelah form dikirim, silakan pilih tindakan berikutnya dari menu di bawah.`;

  // Send WA link to customer — gunakan device yang sama dengan incoming message
  const sent = await sendFormMenu(phone, waMessage, companyId, fonnteDevice).catch((e) => {
    logger.warn({ e, phone }, "mini-form-router: sendFonnte failed");
    return { success: false, error: String(e) };
  });

  logger.info(
    {
      phone,
      intentCode,
      formType,
      intakeMode,
      sessionId,
      formUrl,
      waSent: sent.success,
    },
    `MiniFormRouter: ${intakeMode} flow — form link ${sent.success ? "sent" : "failed"}`,
  );

  return {
    flow: intakeMode,
    sessionId,
    formToken: token,
    formUrl,
    waSent: sent.success,
  };
}

// ── Status check: any recent session in last 2 hours? ─────────────────────────
// Digunakan sebagai fallback ketika form_sent session sudah tidak ada (sudah submitted/cancelled)
// tapi user masih ingin berinteraksi dengan menu form.

export async function findRecentAnySession(
  phone: string,
  companyId: string,
): Promise<{ intentCode: string; category: string | null } | null> {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 jam terakhir
    const [session] = await db
      .select({
        intentCode: intakeSessionsTable.intentCode,
        category: intakeSessionsTable.category,
      })
      .from(intakeSessionsTable)
      .where(
        and(
          eq(intakeSessionsTable.phone, phone),
          eq(intakeSessionsTable.companyId, companyId),
          gt(intakeSessionsTable.updatedAt, cutoff),
        ),
      )
      .orderBy(desc(intakeSessionsTable.updatedAt))
      .limit(1);
    return session ?? null;
  } catch {
    return null;
  }
}

// ── Status check: is session in form_sent state? ────────────────────────────────

export async function findFormSentSession(
  phone: string,
  companyId: string,
  intentCode?: string,
): Promise<{
  id: number;
  formToken: string;
  miniFormType: string;
  intentCode: string;
  category: string | null;
} | null> {
  try {
    const now = new Date();
    const [session] = await db
      .select()
      .from(intakeSessionsTable)
      .where(
        and(
          eq(intakeSessionsTable.phone, phone),
          eq(intakeSessionsTable.companyId, companyId),
          eq(intakeSessionsTable.status, "form_sent"),
          // Only reuse sessions for the SAME intent to prevent wrong form type resend
          intentCode ? eq(intakeSessionsTable.intentCode, intentCode) : undefined,
          // Only reuse sessions that haven't expired yet
          gt(intakeSessionsTable.expiresAt, now),
        ),
      )
      .limit(1);

    if (!session || !session.formToken) return null;
    return {
      id: session.id,
      formToken: session.formToken,
      miniFormType: session.miniFormType ?? "trucking",
      intentCode: session.intentCode,
      category: session.category,
    };
  } catch {
    return null;
  }
}
