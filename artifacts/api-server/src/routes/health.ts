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
    await pool.query("select 1");
    res.json({ status: "ready", database: "ok" });
  } catch {
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
});

export default router;
