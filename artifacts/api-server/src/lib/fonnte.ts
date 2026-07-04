import { logger } from "./logger";

const FONNTE_URL = "https://api.fonnte.com/send";

/**
 * Multi-device token map.
 * FONNTE_TOKEN     = token default (device utama)
 * FONNTE_TOKEN_2   = token device kedua
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
 * Nomor device yang terhubung ke setiap token.
 * Key = token, Value = nomor device (auto-detected dari Fonnte API).
 * Diisi saat startup secara async.
 */
const TOKEN_DEVICE_MAP = new Map<string, string>();

/**
 * Auto-detect nomor device untuk setiap token dari Fonnte /device API.
 * Ini memungkinkan sistem menghindari self-send secara otomatis.
 */
async function detectDeviceNumbers(): Promise<void> {
  const entries: Array<{ key: string; token: string }> = [];

  for (const [key, token] of TOKEN_MAP.entries()) {
    entries.push({ key, token });
  }

  await Promise.allSettled(
    entries.map(async ({ token }) => {
      try {
        const res = await fetch("https://api.fonnte.com/device", {
          method: "POST",
          headers: {
            Authorization: token,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { status?: boolean; device?: string };
        if (data.status && data.device) {
          const normalized = normalizePhone(data.device) ?? data.device;
          TOKEN_DEVICE_MAP.set(token, normalized);
        }
      } catch {
        // Tidak gagalkan startup jika device detection error
      }
    }),
  );

  if (TOKEN_DEVICE_MAP.size > 0) {
    logger.info(
      { devices: Object.fromEntries(TOKEN_DEVICE_MAP) },
      "Fonnte device numbers auto-detected",
    );
  }
}

// Jalankan deteksi device saat modul diload (non-blocking)
detectDeviceNumbers().catch(() => {});

/**
 * Pilih token Fonnte yang tepat.
 * - Jika ada fonnteDevice (pesan masuk dari device tertentu): balas via device yang sama.
 * - Jika mengirim notifikasi keluar: hindari self-send dengan pilih device berbeda dari target.
 */
function resolveToken(targetPhone: string, fonnteDevice?: string | null): string | undefined {
  // Mode reply: pakai device yang sama dengan incoming message
  if (fonnteDevice) {
    const normalized = normalizePhone(fonnteDevice) ?? fonnteDevice;
    if (TOKEN_MAP.has(normalized)) return TOKEN_MAP.get(normalized);
  }

  // Group JID (@g.us) — tidak ada self-send risk, langsung pakai default token
  if (targetPhone.includes("@g.us")) return TOKEN_MAP.get("default");

  const target = normalizePhone(targetPhone) ?? targetPhone;

  // Self-send avoidance: jika target = nomor device default, pakai token alternatif
  const defaultToken = TOKEN_MAP.get("default");
  if (defaultToken && TOKEN_DEVICE_MAP.get(defaultToken) === target) {
    // Cari token lain yang device-nya bukan target
    for (const [, token] of TOKEN_MAP.entries()) {
      if (token === defaultToken) continue;
      const deviceOfToken = TOKEN_DEVICE_MAP.get(token);
      if (!deviceOfToken || deviceOfToken !== target) {
        return token;
      }
    }
  }

  // Cek juga token non-default: jika target = nomor device token N, pakai device lain
  for (const [deviceKey, token] of TOKEN_MAP.entries()) {
    if (deviceKey === "default") continue;
    const normalizedKey = normalizePhone(deviceKey) ?? deviceKey;
    if (normalizedKey === target) {
      // Target adalah device dari token ini — bisa self-send, pakai default saja
      // (default device → token_N device = cross-device, sudah benar)
      return TOKEN_MAP.get("default");
    }
  }

  return TOKEN_MAP.get("default");
}

/**
 * Returns the set of our own Fonnte device phone numbers (auto-detected at startup).
 * Used to filter out self-send echoes where Fonnte omits the quick=true flag.
 */
export function getOwnDeviceNumbers(): Set<string> {
  const devices = new Set<string>();

  // From auto-detected TOKEN_DEVICE_MAP (most reliable)
  for (const phone of TOKEN_DEVICE_MAP.values()) {
    devices.add(phone);
  }

  // Fallback: from FONNTE_DEVICE_N env vars (in case detection hasn't run yet)
  for (let i = 2; i <= 10; i++) {
    const device = process.env[`FONNTE_DEVICE_${i}`];
    if (device) {
      const normalized = normalizePhone(device) ?? device;
      devices.add(normalized);
    }
  }

  return devices;
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
 *   Self-send otomatis dihindari: jika target = nomor device pengirim,
 *   sistem akan pakai device lain secara otomatis.
 */
export async function sendFonnte(
  to: string,
  message: string,
  fonnteDevice?: string | null,
): Promise<FonnteResult> {
  const token = resolveToken(to, fonnteDevice);

  if (!token) {
    logger.warn("FONNTE_TOKEN tidak disetel — notifikasi WhatsApp dilewati");
    return { success: false, error: "FONNTE_TOKEN not configured" };
  }

  const phone = normalizePhone(to);
  if (!phone) {
    return { success: false, error: `Nomor tidak valid: ${to}` };
  }

  // Log jika self-send terdeteksi dan dihindari
  const senderDevice = TOKEN_DEVICE_MAP.get(token);
  if (senderDevice === phone) {
    logger.warn(
      { phone, senderDevice },
      "Fonnte: self-send terdeteksi — tidak ada device alternatif, pesan mungkin tidak terdeliver",
    );
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

    logger.info(
      { phone, messageId: data.id, via: senderDevice ?? fonnteDevice ?? "default" },
      "WhatsApp sent via Fonnte",
    );
    return { success: true, messageId: data.id };
  } catch (err) {
    logger.error({ err }, "Gagal mengirim via Fonnte");
    return { success: false, error: "Network error" };
  }
}

/** Normalisasi ke format internasional: hapus "+", pastikan awalan 62 jika nomor Indonesia.
 *  Untuk group JID Fonnte (mengandung "@g.us"), dikembalikan apa adanya tanpa modifikasi. */
export function normalizePhone(raw: string): string | null {
  // Group JID — pass through as-is, Fonnte menerima format ini langsung
  if (/^\d+@g\.us$/.test(raw)) return raw;
  let num = raw.replace(/\D/g, "");
  if (!num) return null;
  if (num.startsWith("0")) num = "62" + num.slice(1);
  if (num.startsWith("8") && num.length >= 9) num = "62" + num;
  return num;
}
