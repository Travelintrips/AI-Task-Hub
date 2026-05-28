import { logger } from "./logger";

const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
const FONNTE_URL   = "https://api.fonnte.com/send";

export interface FonnteResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Kirim pesan WhatsApp via Fonnte gateway.
 * Nomor tujuan harus format internasional tanpa "+" (cth: 6281234567890).
 */
export async function sendFonnte(to: string, message: string): Promise<FonnteResult> {
  if (!FONNTE_TOKEN) {
    logger.warn("FONNTE_TOKEN tidak disetel — notifikasi WhatsApp dilewati");
    return { success: false, error: "FONNTE_TOKEN not configured" };
  }

  const phone = normalizePhone(to);
  if (!phone) {
    return { success: false, error: `Nomor tidak valid: ${to}` };
  }

  try {
    const res = await fetch(FONNTE_URL, {
      method: "POST",
      headers: {
        Authorization: FONNTE_TOKEN,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ target: phone, message }).toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, text }, "Fonnte API error");
      return { success: false, error: `Fonnte HTTP ${res.status}: ${text}` };
    }

    const data = (await res.json()) as { status?: boolean; id?: string; reason?: string };

    if (!data.status) {
      logger.warn({ data }, "Fonnte returned status=false");
      return { success: false, error: data.reason ?? "Fonnte rejected message" };
    }

    logger.info({ phone, messageId: data.id }, "WhatsApp sent via Fonnte");
    return { success: true, messageId: data.id };
  } catch (err) {
    logger.error({ err }, "Gagal mengirim via Fonnte");
    return { success: false, error: "Network error" };
  }
}

/** Normalisasi ke format internasional: hapus "+", pastikan awalan 62 jika nomor Indonesia */
function normalizePhone(raw: string): string | null {
  let num = raw.replace(/\D/g, "");
  if (!num) return null;
  if (num.startsWith("0")) num = "62" + num.slice(1);
  if (num.startsWith("8") && num.length >= 9) num = "62" + num;
  return num;
}
