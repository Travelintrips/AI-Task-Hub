import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, aiTasksTable } from "@workspace/db";
import { requireAuth, requireRole, getCompanyId } from "../middleware/auth";

const router: IRouter = Router();
const MAX_TIMEOUT_MS = 8000;

function engineConfig() {
  const baseUrl = (process.env["AI_ENGINE_BASE_URL"] ?? "").trim();
  const token = (process.env["AI_ENGINE_SERVICE_TOKEN"] ?? "").trim();
  if (!baseUrl || !token) return null;
  let url: URL;
  try { url = new URL(baseUrl); } catch { return null; }
  if (url.protocol !== "https:" && !(process.env["NODE_ENV"] !== "production" && url.hostname === "127.0.0.1" && url.protocol === "http:")) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return { url: url.origin, token };
}

async function engineRequest(path: string, method: "GET" | "POST", payload?: unknown) {
  const config = engineConfig();
  if (!config) throw new Error("AI_ENGINE_NOT_CONFIGURED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAX_TIMEOUT_MS);
  try {
    const response = await fetch(config.url + path, {
      method,
      headers: {
        Authorization: "Bearer " + config.token,
        Accept: "application/json",
        ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error("AI_ENGINE_HTTP_" + response.status);
    return await response.json() as unknown;
  } finally { clearTimeout(timeout); }
}

// Explicit opt-in only: never dispatch customer tasks automatically.
router.get("/integrations/ai-engine/status", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  if (!engineConfig()) { res.status(503).json({ connected: false, reason: "not_configured" }); return; }
  try {
    await engineRequest("/api/ai/coding/bridge/runtime-status", "GET");
    res.json({ connected: true });
  } catch (error) {
    res.status(503).json({ connected: false, reason: error instanceof Error ? error.message : "unavailable" });
  }
});

router.post("/integrations/ai-engine/dispatch/:taskId", requireAuth, requireRole("company_admin"), async (req: Request, res: Response): Promise<void> => {
  const taskId = Number(req.params.taskId);
  if (!Number.isSafeInteger(taskId) || taskId <= 0) { res.status(400).json({ error: "INVALID_TASK_ID" }); return; }
  const companyId = getCompanyId(req);
  // Never permit cross-tenant lookup or dispatch without a resolved tenant.
  if (!companyId) { res.status(403).json({ error: "TENANT_REQUIRED" }); return; }
  const [task] = await db.select().from(aiTasksTable)
    .where(and(eq(aiTasksTable.id, taskId), eq(aiTasksTable.companyId, companyId))).limit(1);
  if (!task) { res.status(404).json({ error: "TASK_NOT_FOUND" }); return; }
  if (task.category !== "coding" || ["completed", "cancelled"].includes(task.status)) {
    res.status(409).json({ error: "TASK_NOT_DISPATCHABLE" }); return;
  }
  if (!engineConfig()) { res.status(503).json({ error: "AI_ENGINE_NOT_CONFIGURED" }); return; }
  try {
    const result = await engineRequest("/api/ai/coding/bridge/commands", "POST", {
      externalCommandId: "ai-task:" + companyId + ":" + task.id,
      source: "ai-task-hub",
      instruction: task.title + (task.description ? "\n\n" + task.description : ""),
      metadata: { sourceTaskId: task.id, sourceTaskNumber: task.taskNumber, companyId },
    });
    res.status(202).json({ acceptedByBridge: true, result });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "AI_ENGINE_UNAVAILABLE" });
  }
});

export default router;
