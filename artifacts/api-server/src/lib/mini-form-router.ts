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

import { eq, and } from "drizzle-orm";
import { db, intakeSessionsTable, dataTemplatesTable } from "@workspace/db";
import { generateSecureToken } from "./tokens";
import { getFormConfig, inferFormType } from "./mini-form-config";
import { sendFonnte } from "./fonnte";
import { logger } from "./logger";
import type { IntentResolution } from "./intent-engine";

export type FlowMode = "conversation" | "hybrid" | "mini_form";

export interface RouterResult {
  flow: FlowMode;
  sessionId: number | null;
  formToken: string | null;
  formUrl: string | null;
  waSent: boolean;
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
  const formType = miniFormType ?? inferFormType(intentCode, category);
  const formCfg = getFormConfig(formType);

  // ── Anti-loop: reuse existing form_sent session within 30 minutes ──────────
  const existingSession = await findFormSentSession(phone, companyId);
  if (existingSession) {
    const baseUrl = getPublicBaseUrl();
    const existingFormUrl = `${baseUrl}/mini-form/${existingSession.miniFormType}/${existingSession.formToken}`;
    logger.info(
      { phone, intentCode, sessionId: existingSession.id, formUrl: existingFormUrl },
      "MiniFormRouter: reusing existing form_sent session — not sending duplicate",
    );
    return {
      flow: intakeMode,
      sessionId: existingSession.id,
      formToken: existingSession.formToken,
      formUrl: existingFormUrl,
      waSent: false,
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

  const waMessage = template.replace("{mini_form_url}", formUrl);

  // Send WA link to customer
  const sent = await sendFonnte(phone, waMessage).catch((e) => {
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

// ── Status check: is session in form_sent state? ────────────────────────────────

export async function findFormSentSession(
  phone: string,
  companyId: string,
): Promise<{ id: number; formToken: string; miniFormType: string } | null> {
  try {
    const [session] = await db
      .select()
      .from(intakeSessionsTable)
      .where(
        and(
          eq(intakeSessionsTable.phone, phone),
          eq(intakeSessionsTable.companyId, companyId),
          eq(intakeSessionsTable.status, "form_sent"),
        ),
      )
      .limit(1);

    if (!session || !session.formToken) return null;
    return {
      id: session.id,
      formToken: session.formToken,
      miniFormType: session.miniFormType ?? "trucking",
    };
  } catch {
    return null;
  }
}
