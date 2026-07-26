import { logger } from "./logger";
import { eq } from "drizzle-orm";
import { db, companySettingsTable } from "@workspace/db";

export interface WhatsAppInteractiveButton {
  id: string;
  title: string;
}

interface WhatsAppCredentials {
  token?: string | null;
  phoneNumberId?: string | null;
}

async function getWhatsAppCredentials(companyId = "default"): Promise<WhatsAppCredentials> {
  try {
    const [settings] = await db
      .select({
        token: companySettingsTable.whatsappToken,
        phoneNumberId: companySettingsTable.whatsappPhoneNumberId,
      })
      .from(companySettingsTable)
      .where(eq(companySettingsTable.companyId, companyId))
      .limit(1);
    return {
      token: settings?.token ?? process.env.WHATSAPP_TOKEN,
      phoneNumberId: settings?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID,
    };
  } catch {
    return {
      token: process.env.WHATSAPP_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    };
  }
}

async function sendCloudApiPayload(
  to: string,
  payload: Record<string, unknown>,
  credentials: WhatsAppCredentials,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!credentials.token || !credentials.phoneNumberId) {
    logger.warn("WhatsApp credentials not configured");
    return { success: false, error: "WhatsApp credentials not configured" };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${credentials.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ status: response.status, errText }, "WhatsApp API error");
      return { success: false, error: `WhatsApp API error: ${response.status}` };
    }

    const data = (await response.json()) as { messages?: Array<{ id: string }> };
    const messageId = data.messages?.[0]?.id;
    return { success: true, messageId };
  } catch (err) {
    logger.error({ err }, "Failed to send WhatsApp message");
    return { success: false, error: "Network error sending WhatsApp message" };
  }
}

export async function sendWhatsAppMessage(
  to: string,
  message: string,
  companyId = "default",
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const credentials = await getWhatsAppCredentials(companyId);
  return sendCloudApiPayload(
    to,
    { type: "text", text: { body: message } },
    credentials,
  );
}

/**
 * Kirim maksimal tiga tombol aksi native melalui WhatsApp Cloud API.
 * Fonnte tidak mendukung lagi button/list native pada endpoint /send.
 */
export async function sendWhatsAppInteractiveButtons(
  to: string,
  bodyText: string,
  buttons: WhatsAppInteractiveButton[],
  companyId = "default",
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const validButtons = buttons
    .filter((button) => button.id.trim() && button.title.trim())
    .slice(0, 3);
  if (validButtons.length === 0) {
    return { success: false, error: "No interactive buttons supplied" };
  }

  const credentials = await getWhatsAppCredentials(companyId);
  return sendCloudApiPayload(
    to,
    {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: validButtons.map((button) => ({
            type: "reply",
            reply: { id: button.id, title: button.title },
          })),
        },
      },
    },
    credentials,
  );
}
