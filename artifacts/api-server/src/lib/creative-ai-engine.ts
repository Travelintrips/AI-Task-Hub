/**
 * Creative AI Engine — generate logo / brand assets via Together.ai (FLUX.1)
 *
 * Flow:
 * 1. Terima brief fields dari intake session (brand_name, industry, style, dll)
 * 2. Build prompt FLUX.1
 * 3. Panggil Together.ai Images API
 * 4. Simpan job ke ai_platform.ai_jobs + ai_platform.ai_service_requests
 * 5. Update ai_tasks status → "Completed" (atau "Failed")
 * 6. Kirim WA notifikasi ke customer dengan link dashboard
 */

import { eq } from "drizzle-orm";
import { db, aiTasksTable } from "@workspace/db";
import { supabaseQuery, supabaseQueryStrict } from "./supabase-db";
import { sendFonnte } from "./fonnte";
import { logger as rootLogger } from "./logger";

const logger = rootLogger.child({ module: "creative-ai-engine" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreativeAiJobInput {
  taskId: number;
  taskNumber: string;
  customerName: string;
  customerPhone: string;
  companyId: string;
  collectedFields: Record<string, unknown>;
}

interface TogetherImageResponse {
  id: string;
  model: string;
  data: { url: string; index: number }[];
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildLogoPrompt(fields: Record<string, unknown>): string {
  const brand       = String(fields.brand_name        ?? "Brand").trim();
  const industry    = String(fields.industry           ?? "bisnis").trim();
  const style       = String(fields.style_preference   ?? "modern minimalis").trim();
  const color       = String(fields.color_preference   ?? "").trim();
  const tagline     = String(fields.tagline            ?? "").trim();
  const notes       = String(fields.additional_notes   ?? "").trim();

  const colorPart  = color && color !== "bebas"     ? `, color palette: ${color}`          : "";
  const taglinePart= tagline && tagline !== "tidak ada" ? `, with tagline text "${tagline}"` : "";
  const notesPart  = notes ? `. Additional notes: ${notes}`                                 : "";

  return (
    `Professional logo design for "${brand}", a ${industry} company. ` +
    `Style: ${style}${colorPart}${taglinePart}. ` +
    `Clean white background, high-resolution vector-style logo, ` +
    `professional brand identity, crisp edges, no gradients${notesPart}. ` +
    `Minimalist typographic and symbolic composition, suitable for business branding.`
  );
}

// ─── Together.ai API call ─────────────────────────────────────────────────────

async function callTogetherAI(prompt: string): Promise<string> {
  const apiKey = process.env.TOGETHER_AI_API_KEY;
  if (!apiKey) throw new Error("TOGETHER_AI_API_KEY not set");

  const res = await fetch("https://api.together.xyz/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "black-forest-labs/FLUX.1-schnell-Free",
      prompt,
      width: 1024,
      height: 1024,
      steps: 4,
      n: 1,
      response_format: "url",
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown error");
    throw new Error(`Together.ai API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as TogetherImageResponse;
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error("Together.ai returned no image URL");
  return url;
}

// ─── Fetch fonnte device for company ─────────────────────────────────────────

async function getFonnteDevice(companyId: string): Promise<string | null> {
  try {
    const rows = await supabaseQuery<{ fonnte_device: string | null }>(
      `SELECT fonnte_device FROM company_settings WHERE company_id = $1 LIMIT 1`,
      [companyId],
    );
    return rows[0]?.fonnte_device ?? null;
  } catch {
    return null;
  }
}

// ─── Save to ai_platform ──────────────────────────────────────────────────────

async function saveServiceRequest(params: {
  taskId: number;
  taskNumber: string;
  customerName: string;
  customerPhone: string;
  brandName: string;
  prompt: string;
  imageUrl: string | null;
  status: "pending" | "completed" | "failed";
  errorMessage?: string;
}): Promise<number | null> {
  try {
    const rows = await supabaseQueryStrict<{ id: number }>(
      `INSERT INTO ai_platform.ai_service_requests
         (request_id, service_id, customer_name, customer_phone, status,
          brief_json, completion_links, notes, created_at, updated_at)
       VALUES ($1, 1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW(), NOW())
       RETURNING id`,
      [
        params.taskNumber,
        params.customerName,
        params.customerPhone,
        params.status,
        JSON.stringify({
          task_id:    params.taskId,
          task_number: params.taskNumber,
          prompt:     params.prompt,
        }),
        params.imageUrl ? JSON.stringify({ logo_url: params.imageUrl }) : JSON.stringify({}),
        params.errorMessage ?? null,
      ],
    );
    return rows[0]?.id ?? null;
  } catch (e) {
    logger.warn({ e }, "creative-ai: failed to save ai_service_requests — non-fatal");
    return null;
  }
}

async function saveAiJob(params: {
  serviceRequestId: number | null;
  prompt: string;
  imageUrl: string | null;
  status: "queued" | "completed" | "failed";
  durationMs: number;
  errorMessage?: string;
}): Promise<void> {
  try {
    await supabaseQuery(
      `INSERT INTO ai_platform.ai_jobs
         (job_type, priority, status, payload_json, result_json,
          started_at, completed_at, actual_duration, error_message,
          retry_count, max_retry, retry_strategy, created_at, updated_at)
       VALUES ('image_generation', 50, $1, $2::jsonb, $3::jsonb,
               NOW() - ($4 || ' milliseconds')::interval, NOW(),
               $4, $5,
               0, 3, 'exponential', NOW(), NOW())`,
      [
        params.status,
        JSON.stringify({ prompt: params.prompt, model: "FLUX.1-schnell-Free", service_request_id: params.serviceRequestId }),
        params.imageUrl ? JSON.stringify({ image_url: params.imageUrl }) : JSON.stringify({}),
        params.durationMs,
        params.errorMessage ?? null,
      ],
    );
  } catch (e) {
    logger.warn({ e }, "creative-ai: failed to save ai_jobs — non-fatal");
  }
}

// ─── Update ai_tasks status ───────────────────────────────────────────────────

async function updateTaskStatus(taskId: number, status: string): Promise<void> {
  await db
    .update(aiTasksTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(aiTasksTable.id, taskId));
}

// ─── WA notification to customer ─────────────────────────────────────────────

function buildDashboardLink(taskId: number): string {
  const base = process.env.SC_DOMAIN
    ? `https://${process.env.SC_DOMAIN}`
    : process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "";
  return `${base}/creative-ai/${taskId}`;
}

async function notifyCustomerReady(params: {
  customerPhone: string;
  customerName: string;
  brandName: string;
  taskNumber: string;
  taskId: number;
  imageUrl: string;
  fonnteDevice: string | null;
}): Promise<void> {
  const link = buildDashboardLink(params.taskId);
  const msg =
    `🎨 *Logo Anda Sudah Selesai!*\n\n` +
    `Halo ${params.customerName}, logo untuk brand *${params.brandName}* sudah berhasil dibuat oleh AI kami.\n\n` +
    `🔗 Lihat & download hasilnya di:\n${link}\n\n` +
    `📋 Nomor request: *${params.taskNumber}*\n\n` +
    `_Jika ingin revisi atau format berbeda, silakan hubungi tim kami._`;

  await sendFonnte(params.customerPhone, msg, params.fonnteDevice ?? undefined);
}

async function notifyCustomerFailed(params: {
  customerPhone: string;
  customerName: string;
  taskNumber: string;
  fonnteDevice: string | null;
}): Promise<void> {
  const msg =
    `⚠️ *Maaf, ada kendala teknis*\n\n` +
    `Halo ${params.customerName}, proses pembuatan logo untuk request *${params.taskNumber}* mengalami kendala sementara.\n\n` +
    `Tim kami akan segera menindaklanjuti secara manual. Terima kasih atas kesabarannya! 🙏`;
  await sendFonnte(params.customerPhone, msg, params.fonnteDevice ?? undefined);
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Trigger logo generation asynchronously (fire-and-forget dari task-service).
 * Mengelola seluruh lifecycle: build prompt → call API → save → notify.
 */
export async function triggerCreativeAiJob(input: CreativeAiJobInput): Promise<void> {
  const { taskId, taskNumber, customerName, customerPhone, companyId, collectedFields } = input;
  const brandName = String(collectedFields.brand_name ?? "Brand").trim();

  logger.info({ taskId, taskNumber, brandName }, "creative-ai: starting logo generation");

  // 1. Update task status ke "In Progress"
  await updateTaskStatus(taskId, "In Progress").catch((e) =>
    logger.warn({ e }, "creative-ai: failed to update status to In Progress"),
  );

  const fonnteDevice = await getFonnteDevice(companyId);
  const prompt = buildLogoPrompt(collectedFields);
  const startedAt = Date.now();

  try {
    // 2. Call Together.ai
    const imageUrl = await callTogetherAI(prompt);
    const durationMs = Date.now() - startedAt;

    logger.info({ taskId, taskNumber, imageUrl, durationMs }, "creative-ai: image generated OK");

    // 3. Save ke ai_platform
    const srId = await saveServiceRequest({
      taskId, taskNumber, customerName, customerPhone, brandName,
      prompt, imageUrl, status: "completed",
    });
    await saveAiJob({ serviceRequestId: srId, prompt, imageUrl, status: "completed", durationMs });

    // 4. Update task status ke "Completed"
    await updateTaskStatus(taskId, "Completed");

    // 5. Kirim WA ke customer
    await notifyCustomerReady({
      customerPhone, customerName, brandName, taskNumber, taskId, imageUrl, fonnteDevice,
    }).catch((e) => logger.warn({ e }, "creative-ai: WA notify failed — non-fatal"));

    logger.info({ taskId, taskNumber }, "creative-ai: job completed successfully");
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ taskId, taskNumber, err: errorMessage }, "creative-ai: generation FAILED");

    // Save failed job record
    const srId = await saveServiceRequest({
      taskId, taskNumber, customerName, customerPhone, brandName,
      prompt, imageUrl: null, status: "failed", errorMessage,
    });
    await saveAiJob({
      serviceRequestId: srId, prompt, imageUrl: null,
      status: "failed", durationMs, errorMessage,
    });

    // Update task status ke "Ready for Review" (bisa di-handle manual)
    await updateTaskStatus(taskId, "Ready for Review").catch(() => {});

    // Notify customer tentang kendala
    await notifyCustomerFailed({ customerPhone, customerName, taskNumber, fonnteDevice })
      .catch((e) => logger.warn({ e }, "creative-ai: failed WA notify — non-fatal"));
  }
}
