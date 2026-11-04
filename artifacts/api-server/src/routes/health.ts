import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res): Promise<void> => {
  try {
    await Promise.all([
      pool.query("select 1"),
      pool.query("select 1 from public.conversation_intake_sessions limit 0"),
      pool.query("select 1 from public.admin_notifications limit 0"),
    ]);
    res.json({ status: "ready", database: "ok" });
  } catch (error: unknown) {
    // Log only bounded, non-sensitive diagnostics. Never log the connection URL,
    // query text, error message, stack, or arbitrary database error details.
    const diagnostic = error && typeof error === "object"
      ? error as { code?: unknown; severity?: unknown }
      : {};
    const safeCode = typeof diagnostic.code === "string" && /^[A-Z0-9_]{1,12}$/.test(diagnostic.code)
      ? diagnostic.code
      : "UNKNOWN";
    const safeSeverity = typeof diagnostic.severity === "string" && /^(ERROR|FATAL|PANIC)$/.test(diagnostic.severity)
      ? diagnostic.severity
      : "UNKNOWN";
    console.error("[readiness] database check failed", { code: safeCode, severity: safeSeverity });
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
});

export default router;
