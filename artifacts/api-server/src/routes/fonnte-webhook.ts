/**
 * Fonnte WhatsApp Gateway — Incoming Message Webhook
 *
 * Endpoint: POST /webhook/fonnte
 * Setup di dashboard Fonnte: https://fonnte.com/account/webhook
 *
 * Payload Fonnte (inbound):
 * {
 *   device   : "6281xxx"       — nomor WA bisnis (device)
 *   sender   : "6289xxx"       — nomor WA pengirim
 *   message  : "Halo..."       — isi pesan (teks)
 *   member   : "6289xxx"       — sama dengan sender (grup: anggota)
 *   name     : "Budi"          — nama profil WhatsApp pengirim
 *   type     : "text" | "image" | "document" | "audio" | "video" | "sticker"
 *   file     : null | "https://..." — URL media jika ada
 *   url      : null | "https://..." — URL file alternatif
 *   caption  : null | "teks"   — caption media
 *   location : null | {...}    — data lokasi
 *   id       : "msg-id"        — ID pesan dari Fonnte
 * }
 */

import { Router, type IRouter } from "express";
import { db, companySettingsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { processIncomingMessage } from "./whatsapp";

const router: IRouter = Router();

// Cache: device phone → companyId (avoid DB hit on every message)
const deviceCompanyCache = new Map<string, { companyId: string; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function resolveCompanyIdFromDevice(devicePhone: string | null): Promise<string> {
  if (!devicePhone) return "default";

  // Check cache first
  const cached = deviceCompanyCache.get(devicePhone);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.companyId;

  // Normalise for comparison: strip non-digits, ensure 62 prefix
  const norm = normPhone(devicePhone) ?? devicePhone;

  try {
    // Look up all companies and match whatsappPhoneNumberId against the device
    const rows = await db
      .select({ companyId: companySettingsTable.companyId, waPhone: companySettingsTable.whatsappPhoneNumberId })
      .from(companySettingsTable);

    for (const row of rows) {
      if (!row.waPhone) continue;
      // waPhone may be comma-separated list of numbers
      const phones = row.waPhone.split(",").map((p) => normPhone(p.trim()) ?? p.trim());
      if (phones.includes(norm)) {
        deviceCompanyCache.set(devicePhone, { companyId: row.companyId, ts: Date.now() });
        logger.info({ device: norm, companyId: row.companyId }, "Fonnte: companyId resolved from device");
        return row.companyId;
      }
    }
  } catch (err) {
    logger.warn({ err, device: norm }, "Fonnte: failed to resolve companyId from device — using 'default'");
  }

  // Fallback: also check env variable for quick resolution
  const envPhones = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "")
    .split(",")
    .map((p) => normPhone(p.trim()) ?? p.trim());
  if (envPhones.includes(norm) && envPhones[0]) {
    // Env lists the phones but doesn't tell us companyId — return "default"
  }

  return "default";
}

// ─── GET /webhook/fonnte  ──────────────────────────────────────────────────
// Verifikasi webhook dari dashboard Fonnte (jika diperlukan)
router.get("/webhook/fonnte", (_req, res): void => {
  res.status(200).send("OK");
});

// ─── POST /webhook/fonnte  ────────────────────────────────────────────────
router.post("/webhook/fonnte", async (req, res): Promise<void> => {
  // Respond immediately — Fonnte requires fast ACK (< 5s)
  res.sendStatus(200);

  const rawPayload = req.body as Record<string, unknown>;

  // Determine companyId: prefer explicit header, then device-lookup, then "default"
  const headerCompanyId = req.headers["x-company-id"] as string | undefined;
  const devicePhone = normPhone(rawPayload.device) ?? null;
  const companyId = headerCompanyId ?? (await resolveCompanyIdFromDevice(devicePhone));

  try {
    // ── Normalize Fonnte payload ke format standar ─────────────────────────
    const sender  = normPhone(rawPayload.sender  ?? rawPayload.member);
    const device  = normPhone(rawPayload.device);  // nomor WA bisnis (perangkat kita)
    const name    = toString(rawPayload.name);
    const msgType = toMsgType(rawPayload.type);
    const text    = toString(rawPayload.message) ?? toString(rawPayload.caption);
    const fileUrl = toString(rawPayload.file) ?? toString(rawPayload.url);

    // ── DEBUG: Log raw payload selalu (untuk diagnosa) ────────────────────
    logger.info({
      raw_sender: rawPayload.sender,
      raw_device: rawPayload.device,
      raw_name: rawPayload.name,
      raw_type: rawPayload.type,
      raw_quick: rawPayload.quick,
      raw_message: String(rawPayload.message ?? "").substring(0, 80),
      normalized_sender: sender,
      normalized_device: device,
    }, "Fonnte webhook: raw payload received");

    if (!sender) {
      logger.warn({ rawPayload }, "Fonnte webhook: no sender phone — skipping");
      return;
    }

    // ── Filter pesan keluar (echo dari Fonnte) ─────────────────────────────
    const isOutgoingEcho = rawPayload.quick === true;
    if (isOutgoingEcho) {
      logger.info({ sender, device, quick: rawPayload.quick }, "Fonnte webhook: outgoing echo (quick=true) — skipping");
      return;
    }

    // Fallback: jika sender sama dengan device, juga skip
    if (device && sender === device) {
      logger.info({ sender, device }, "Fonnte webhook: sender=device echo — skipping");
      return;
    }

    // Build normalized message object matching what processIncomingMessage expects
    const normalizedMsg: Record<string, unknown> = {
      // Standard fields used by processIncomingMessage
      from: sender,
      sender_phone: sender,
      type: msgType,
      timestamp: Math.floor(Date.now() / 1000).toString(),
      // Embed content in the standard structure
      ...(msgType === "text"
        ? { text: { body: text ?? "" } }
        : {
            [msgType]: {
              link: fileUrl ?? undefined,
              caption: text ?? undefined,
              mime_type: guessMime(msgType, fileUrl),
              filename: guessFilename(msgType, fileUrl),
            },
          }),
    };

    logger.info(
      { sender, name, msgType, hasFile: !!fileUrl },
      "Fonnte inbound message received",
    );

    await processIncomingMessage({
      msg: normalizedMsg,
      senderName: name ?? undefined,
      companyId,
      rawPayload,
    });
  } catch (err) {
    logger.error({ err, companyId }, "Unhandled error in Fonnte webhook");
  }
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function toString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function normPhone(v: unknown): string | null {
  const s = toString(v);
  if (!s) return null;
  let num = s.replace(/\D/g, "");
  if (num.startsWith("0")) num = "62" + num.slice(1);
  if (num.startsWith("8") && num.length >= 9) num = "62" + num;
  return num.length >= 8 ? num : null;
}

type MsgType = "text" | "image" | "document" | "audio" | "video" | "sticker";

function toMsgType(v: unknown): MsgType {
  const s = toString(v)?.toLowerCase();
  const allowed: MsgType[] = ["text", "image", "document", "audio", "video", "sticker"];
  return (allowed.includes(s as MsgType) ? s : "text") as MsgType;
}

function guessMime(type: MsgType, url: string | null): string {
  if (url) {
    const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
    if (ext === "pdf") return "application/pdf";
    if (["jpg", "jpeg"].includes(ext ?? "")) return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "ogg") return "audio/ogg";
    if (ext === "mp3") return "audio/mpeg";
    if (["xlsx", "xls"].includes(ext ?? "")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (["docx", "doc"].includes(ext ?? "")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  const defaults: Record<MsgType, string> = {
    text: "text/plain",
    image: "image/jpeg",
    document: "application/octet-stream",
    audio: "audio/ogg",
    video: "video/mp4",
    sticker: "image/webp",
  };
  return defaults[type];
}

function guessFilename(type: MsgType, url: string | null): string {
  if (url) {
    const parts = url.split("?")[0].split("/");
    const last = parts[parts.length - 1];
    if (last && last.includes(".")) return last;
  }
  const exts: Record<MsgType, string> = {
    text: "txt",
    image: "jpg",
    document: "pdf",
    audio: "ogg",
    video: "mp4",
    sticker: "webp",
  };
  return `${type}_${Date.now()}.${exts[type]}`;
}

export default router;
