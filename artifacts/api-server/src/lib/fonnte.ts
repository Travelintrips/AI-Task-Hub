import { logger } from "./logger";

const FONNTE_URL = "https://api.fonnte.com/send";

/**
 * Multi-device token map.
 * FONNTE_TOKEN     = token default (device utama, misalnya 081216104734)
 * FONNTE_TOKEN_2   = token device kedua (misalnya 6285121073537)
 * FONNTE_DEVICE_2  = nomor device kedua (format internasional tanpa "+")
 *
 * Jika ada lebih banyak device, tambahkan pasangan FONNTE_TOKEN_N / FONNTE_DEVICE_N.
 */
function buildTokenMap(): Map<string, string> {
  const map = new Map<string, string>();

  const defaultToken = process.env.FONNTE_TOKEN;
  if (defaultToken) {
    map.set("default", defaultToken);
  }

  for (let i = 2; i <= 10; i++) {
    const token = process.env[`FONNTE_TOKEN_${i}`];
    const device = process.env[`FONNTE_DEVICE_${i}`];
    if (token && device) {
      const normalized = normalizePhone(device) ?? device;
      map.set(normalized, token);
    }
  }

  return map;
}

const TOKEN_MAP = buildTokenMap();

/**
 * Pilih token Fonnte yang tepat berdasarkan device yang menerima pesan.
 * Jika device tidak ditemukan di map, pakai token default.
 */
function resolveToken(fonnteDevice?: string | null): string | undefined {
  if (fonnteDevice) {
    const normalized = normalizePhone(fonnteDevice) ?? fonnteDevice;
    if (TOKEN_MAP.has(normalized)) return TOKEN_MAP.get(normalized);
  }
  return TOKEN_MAP.get("default");
}

export interface FonnteResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Kirim pesan WhatsApp via Fonnte gateway.
 * Nomor tujuan harus format internasional tanpa "+" (cth: 6281234567890).
 * fonnteDevice — nomor device Fonnte yang menerima pesan asal (opsional).
 *   Kalau diisi, sistem akan balas via device yang sama.
 */
export async function sendFonnte(
  to: string,
  message: string,
  fonnteDevice?: string | null,
): Promise<FonnteResult> {
  const token = resolveToken(fonnteDevice);

  if (!token) {
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
        Authorization: token,
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

    logger.info({ phone, messageId: data.id, via: fonnteDevice ?? "default" }, "WhatsApp sent via Fonnte");
    return { success: true, messageId: data.id };
  } catch (err) {
    logger.error({ err }, "Gagal mengirim via Fonnte");
    return { success: false, error: "Network error" };
  }
}

/** Normalisasi ke format internasional: hapus "+", pastikan awalan 62 jika nomor Indonesia */
export function normalizePhone(raw: string): string | null {
  let num = raw.replace(/\D/g, "");
  if (!num) return null;
  if (num.startsWith("0")) num = "62" + num.slice(1);
  if (num.startsWith("8") && num.length >= 9) num = "62" + num;
  return num;
}
