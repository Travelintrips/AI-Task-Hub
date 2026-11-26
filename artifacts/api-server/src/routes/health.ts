import { readFileSync } from "node:fs";
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

// The DEV build writes this file beside the bundled API entry point.
function readBuildSha(): string | undefined {
  try {
    const sha = readFileSync(new URL("./build-sha", import.meta.url), "utf8").trim();
    return /^[a-f0-9]{40}$/.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

const buildSha = readBuildSha();

router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  if (buildSha) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-CST-Commit-SHA", buildSha);
  }
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
  } catch {
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
});

export default router;
