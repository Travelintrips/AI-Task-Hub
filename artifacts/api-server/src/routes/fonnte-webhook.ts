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
import { logger } from "../lib/logger";
import { processIncomingMessage } from "./whatsapp";

const router: IRouter = Router();

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
  const companyId = (req.headers["x-company-id"] as string | undefined) ?? "default";

  try {
    // ── Normalize Fonnte payload ke format standar ─────────────────────────
    const sender  = normPhone(rawPayload.sender  ?? rawPayload.member);
    const device  = normPhone(rawPayload.device);  // nomor WA bisnis (perangkat kita)
    const name    = toString(rawPayload.name);
    const msgType = toMsgType(rawPayload.type);
    const text    = toString(rawPayload.message) ?? toString(rawPayload.caption);
    const fileUrl = toString(rawPayload.file) ?? toString(rawPayload.url);

    if (!sender) {
      logger.warn({ rawPayload }, "Fonnte webhook: no sender phone — skipping");
      return;
    }

    // ── Filter pesan keluar (echo dari Fonnte) ─────────────────────────────
    // Fonnte men-trigger webhook untuk SEMUA pesan di device, termasuk pesan
    // yang kita kirim keluar (outgoing). Pesan outgoing ditandai dengan:
    //   - quick: true  → pesan yang dikirim via API (bukan dari pengguna WA)
    //   - name: null   → tidak ada nama pengirim (bukan kontak masuk)
    // Kedua kondisi ini cukup untuk membedakan echo dari pesan customer asli.
    const isOutgoingEcho = rawPayload.quick === true;
    if (isOutgoingEcho) {
      logger.debug({ sender, device }, "Fonnte webhook: outgoing echo (quick=true) — skipping");
      return;
    }

    // Fallback: jika sender sama dengan device, juga skip
    if (device && sender === device) {
      logger.debug({ sender, device }, "Fonnte webhook: sender=device echo — skipping");
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
