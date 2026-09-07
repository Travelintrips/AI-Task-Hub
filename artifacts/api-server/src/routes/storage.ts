import { Router, type IRouter, type Request, type Response } from "express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ensureBucket, getUploadUrl, supabase } from "../lib/supabase";

const router: IRouter = Router();

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/tiff",
  "image/bmp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/csv",
]);

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * POST /storage/uploads/request-url
 *
 * Request a Supabase presigned upload URL.
 * Client sends JSON metadata (name, size, contentType), gets back uploadURL + objectPath.
 * Then uploads directly to Supabase via PUT on the returned uploadURL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { name, size, contentType } = parsed.data;

  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    res.status(400).json({
      error: `Tipe file tidak diizinkan: ${contentType}. Format yang didukung: PDF, gambar (JPG/PNG/GIF/WebP), Excel, Word.`,
    });
    return;
  }

  if (size > MAX_FILE_SIZE_BYTES) {
    res.status(400).json({
      error: `Ukuran file terlalu besar (${(size / 1024 / 1024).toFixed(1)} MB). Maksimal 50 MB.`,
    });
    return;
  }

  try {
    await ensureBucket();
    const { uploadUrl, path } = await getUploadUrl(name, contentType);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL: uploadUrl,
        objectPath: path,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*filePath
 *
 * Redirect to Supabase public URL for stored files.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;

    if (!supabase) {
      res.status(503).json({ error: "Storage not configured" });
      return;
    }

    const { data } = supabase.storage
      .from("ai-task-center-documents")
      .getPublicUrl(filePath);

    res.redirect(302, data.publicUrl);
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*path
 *
 * Generate a signed download URL and redirect to it.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const objectPath = Array.isArray(raw) ? raw.join("/") : raw;

    if (!supabase) {
      res.status(503).json({ error: "Storage not configured" });
      return;
    }

    const { data, error } = await supabase.storage
      .from("ai-task-center-documents")
      .createSignedUrl(objectPath, 3600);

    if (error || !data) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    res.redirect(302, data.signedUrl);
  } catch (error) {
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
