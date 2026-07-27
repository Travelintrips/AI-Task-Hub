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

  for (let i = 1; i <= 10; i++) {
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
 * Ambil token terbaik yang tersedia: default → token pertama di map → undefined.
 * Dipakai sebagai fallback ketika tidak ada device spesifik yang cocok.
 */
function bestAvailableToken(): string | undefined {
  const def = TOKEN_MAP.get("default");
  if (def) return def;
  // Jika tidak ada default, pakai token pertama yang ada (misal hanya FONNTE_TOKEN_2)
  for (const [, token] of TOKEN_MAP.entries()) return token;
  return undefined;
}

/**
 * Pilih token Fonnte yang tepat.
 * - Jika ada fonnteDevice (pesan masuk dari device tertentu): balas via device yang sama.
 * - Jika mengirim notifikasi keluar: hindari self-send dengan pilih device berbeda dari target.
 */
function resolveToken(targetPhone: string, fonnteDevice?: string | null): string | undefined {
  // Mode reply: pakai device yang sama dengan incoming message
  if (fonnteDevice) {
    const normalized = normalizePhone(fonnteDevice) ?? fonnteDevice;
    // 1. Cari di TOKEN_MAP by device phone key (dari FONNTE_DEVICE_N)
    if (TOKEN_MAP.has(normalized)) return TOKEN_MAP.get(normalized);
    // 2. Reverse-lookup via TOKEN_DEVICE_MAP (auto-detected saat startup)
    for (const [token, devicePhone] of TOKEN_DEVICE_MAP.entries()) {
      if (devicePhone === normalized) return token;
    }
  }

  // Group JID (@g.us) — tidak ada self-send risk, pakai token terbaik yang tersedia
  if (targetPhone.includes("@g.us")) return bestAvailableToken();

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
      // Target adalah device dari token ini — bisa self-send, pakai token lain
      // (cari token non-self, fallback ke token terbaik yang tersedia)
      return bestAvailableToken();
    }
  }

  return bestAvailableToken();
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

/** Opsi polling yang didukung endpoint kirim Fonnte. */
/**
 * Kirim file/dokumen sebagai attachment WhatsApp via Fonnte.
 * documentUrl harus berupa public URL yang dapat diakses Fonnte.
 * filename  = nama file yang ditampilkan di WhatsApp (misal: "Commercial Invoice.pdf").
 */
export async function sendFonnteDocument(
  to: string,
  documentUrl: string,
  filename: string,
  fonnteDevice?: string | null,
): Promise<FonnteResult> {
  // Grup: coba semua token
  if (to.includes("@g.us")) {
    const allTokens: string[] = [];
    for (const [, t] of TOKEN_MAP.entries()) {
      if (!allTokens.includes(t)) allTokens.push(t);
    }
    if (allTokens.length === 0) {
      logger.warn({ to, filename }, "sendFonnteDocument: FONNTE_TOKEN tidak dikonfigurasi — dokumen ke grup dilewati");
      return { success: false, error: "FONNTE_TOKEN tidak dikonfigurasi" };
    }
    logger.info({ groupJid: to, filename, documentUrl, tokenCount: allTokens.length }, "sendFonnteDocument: mencoba kirim dokumen ke grup");
    let lastError = "Semua device gagal mengirim dokumen ke grup";
    for (const t of allTokens) {
      const r = await sendDocWithToken(to, documentUrl, filename, t);
      if (r.success) {
        logger.info({ groupJid: to, filename, messageId: r.messageId }, "sendFonnteDocument: dokumen berhasil dikirim ke grup");
        return r;
      }
      lastError = r.error ?? lastError;
      logger.debug({ groupJid: to, filename, error: r.error, token: t.slice(0, 8) + "…" }, "sendFonnteDocument: token gagal kirim ke grup, coba berikutnya");
    }
    logger.warn({ groupJid: to, filename, lastError }, "sendFonnteDocument: semua token gagal kirim dokumen ke grup");
    return { success: false, error: lastError };
  }

  const token = resolveToken(to, fonnteDevice);
  if (!token) {
    logger.warn("FONNTE_TOKEN tidak disetel — pengiriman dokumen dilewati");
    return { success: false, error: "FONNTE_TOKEN not configured" };
  }

  const phone = normalizePhone(to);
  if (!phone) {
    return { success: false, error: `Nomor tidak valid: ${to}` };
  }

  return sendDocWithToken(phone, documentUrl, filename, token);
}

/**
 * Internal: kirim dokumen ke satu target menggunakan token tertentu.
 */
async function sendDocWithToken(
  phone: string,
  documentUrl: string,
  filename: string,
  token: string,
): Promise<FonnteResult> {
  const params = new URLSearchParams({
    target:   phone,
    url:      documentUrl,
    filename: filename,
  });

  // Log payload tanpa token untuk debugging
  logger.info(
    {
      fonntePayload: {
        target: phone,
        url: documentUrl,
        filename: filename,
        tokenPrefix: token.slice(0, 8) + "…",
      },
    },
    "sendDocWithToken: mengirim dokumen ke Fonnte",
  );

  let responseText: string | null = null;
  try {
    const res = await fetch(FONNTE_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    responseText = await res.text();

    logger.info(
      {
        target: phone,
        filename,
        httpStatus: res.status,
        fonnteResponse: responseText,
      },
      "sendDocWithToken: raw Fonnte response",
    );

    if (!res.ok) {
      logger.error(
        { target: phone, httpStatus: res.status, responseBody: responseText, filename, documentUrl },
        "sendDocWithToken: Fonnte HTTP error",
      );
      return { success: false, error: `Fonnte HTTP ${res.status}: ${responseText}` };
    }

    let data: { status?: boolean; id?: string; reason?: string };
    try {
      data = JSON.parse(responseText) as { status?: boolean; id?: string; reason?: string };
    } catch {
      logger.error({ responseText, filename }, "sendDocWithToken: Fonnte response bukan JSON valid");
      return { success: false, error: `Fonnte response tidak valid: ${responseText}` };
    }

    if (!data.status) {
      logger.warn(
        { target: phone, filename, documentUrl, fonnteData: data },
        "sendDocWithToken: Fonnte status=false (dokumen ditolak)",
      );
      return { success: false, error: data.reason ?? "Fonnte rejected document" };
    }

    logger.info(
      { target: phone, filename, messageId: data.id },
      "sendDocWithToken: dokumen berhasil dikirim via Fonnte",
    );
    return { success: true, messageId: data.id };
  } catch (err) {
    logger.error(
      { err, target: phone, filename, documentUrl, responseText },
      "sendDocWithToken: exception saat kirim dokumen",
    );
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

/**
 * Kirim pesan WhatsApp via Fonnte gateway.
 * Nomor tujuan harus format internasional tanpa "+" (cth: 6281234567890).
 * fonnteDevice — nomor device Fonnte yang menerima pesan asal (opsional).
 *   Kalau diisi, sistem akan balas via device yang sama.
 *   Self-send otomatis dihindari: jika target = nomor device pengirim,
 *   sistem akan pakai device lain secara otomatis.
 */
/**
 * Kirim pesan ke satu target menggunakan token tertentu.
 * Dipakai secara internal oleh sendFonnte dan sendFonnteGroup.
 */
async function sendWithToken(
  phone: string,
  message: string,
  token: string,
): Promise<FonnteResult> {
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
      return { success: false, error: `Fonnte HTTP ${res.status}: ${text}` };
    }

    const data = (await res.json()) as { status?: boolean; id?: string; reason?: string };
    if (!data.status) {
      return { success: false, error: data.reason ?? "Fonnte rejected message" };
    }

    return { success: true, messageId: data.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

/**
 * Untuk grup (@g.us), coba semua token yang tersedia sampai satu berhasil.
 * Ini diperlukan karena hanya device yang sudah bergabung ke grup yang bisa kirim.
 */
async function sendFonnteGroup(groupJid: string, message: string): Promise<FonnteResult> {
  const allTokens: string[] = [];

  // Kumpulkan semua token unik dari TOKEN_MAP
  for (const [, token] of TOKEN_MAP.entries()) {
    if (!allTokens.includes(token)) allTokens.push(token);
  }

  if (allTokens.length === 0) {
    return { success: false, error: "FONNTE_TOKEN tidak dikonfigurasi" };
  }

  let lastError = "Semua device gagal mengirim ke grup";
  for (const token of allTokens) {
    const result = await sendWithToken(groupJid, message, token);
    if (result.success) {
      const senderDevice = TOKEN_DEVICE_MAP.get(token) ?? "unknown";
      logger.info(
        { groupJid, messageId: result.messageId, via: senderDevice },
        "WhatsApp group sent via Fonnte",
      );
      return result;
    }
    lastError = result.error ?? lastError;
    logger.debug({ groupJid, error: result.error, token: token.slice(0, 8) + "…" }, "Fonnte group: token failed, trying next");
  }

  logger.warn({ groupJid, lastError }, "Fonnte: semua token gagal kirim ke grup");
  return { success: false, error: lastError };
}

export interface FonnteButton {
  id: string;
  title: string;
}

/**
 * Kirim pesan interaktif dengan tombol (maks 3 tombol) via Fonnte.
 * Saat user klik tombol, Fonnte mengirim webhook dengan
 *   type: "interactive", interactive.button_reply.id = id tombol.
 *
 * Jika Fonnte menolak (misalnya nomor tidak mendukung), otomatis fallback ke teks biasa.
 */
export async function sendFonnteButtons(
  to: string,
  message: string,
  buttons: FonnteButton[],
  opts?: { header?: string; footer?: string; fonnteDevice?: string | null },
): Promise<FonnteResult> {
  // Grup tidak mendukung interactive buttons — langsung plain text
  if (to.includes("@g.us")) {
    return sendFonnte(to, message);
  }

  const token = resolveToken(to, opts?.fonnteDevice);
  if (!token) {
    logger.warn("FONNTE_TOKEN tidak disetel — sendFonnteButtons dilewati");
    return { success: false, error: "FONNTE_TOKEN not configured" };
  }

  const phone = normalizePhone(to);
  if (!phone) return { success: false, error: `Nomor tidak valid: ${to}` };

  // Fonnte button format: [{ display, id, type }]
  const buttonParam = JSON.stringify(
    buttons.slice(0, 3).map((b) => ({ display: b.title, id: b.id, type: "reply" })),
  );

  const params: Record<string, string> = {
    target: phone,
    message,
    button: buttonParam,
  };
  if (opts?.header) params.header = opts.header;
  if (opts?.footer) params.footer = opts.footer;

  try {
    const res = await fetch(FONNTE_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, text }, "Fonnte interactive buttons: HTTP error — falling back to plain text");
      return { success: false, error: `Fonnte HTTP ${res.status}: ${text}` };
    }

    const data = (await res.json()) as { status?: boolean; id?: string; reason?: string };
    if (!data.status) {
      logger.warn({ data }, "Fonnte interactive buttons: status=false — falling back to plain text");
      return { success: false, error: data.reason ?? "Fonnte rejected buttons" };
    }

    const senderDevice = TOKEN_DEVICE_MAP.get(token);
    logger.info({ phone, messageId: data.id, via: senderDevice ?? "default" }, "Fonnte interactive buttons sent");
    return { success: true, messageId: data.id };
  } catch (err) {
    logger.error({ err }, "Gagal mengirim interactive buttons via Fonnte");
    return { success: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function sendFonnte(
  to: string,
  message: string,
  fonnteDevice?: string | null,
): Promise<FonnteResult> {
  // Untuk grup: coba semua token secara berurutan
  if (to.includes("@g.us")) {
    return sendFonnteGroup(to, message);
  }

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
