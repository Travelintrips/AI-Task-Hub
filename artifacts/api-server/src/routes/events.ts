import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { registerSseClient } from "../lib/sse";

const router: IRouter = Router();

router.get("/events", requireAuth, (req: Request, res: Response): void => {
  const companyId = req.user?.companyId ?? "default";

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  res.write(`event: connected\ndata: ${JSON.stringify({ companyId, connectedAt: new Date().toISOString() })}\n\n`);

  const cleanup = registerSseClient(res, companyId);
  req.on("close", cleanup);
  req.on("aborted", cleanup);
});

export default router;
