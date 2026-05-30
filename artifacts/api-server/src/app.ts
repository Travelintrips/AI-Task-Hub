import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startFollowUpScheduler } from "./lib/follow-up-scheduler";
import { refreshSlaStatuses } from "./lib/sla";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const allowedOrigins = (() => {
  const domains = process.env.REPLIT_DOMAINS ?? "";
  if (!domains) return true; // dev: allow all
  return domains
    .split(",")
    .map((d) => `https://${d.trim()}`)
    .filter(Boolean);
})();

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

// Start background services
startFollowUpScheduler();

// Refresh SLA statuses every 15 minutes
setInterval(() => { refreshSlaStatuses().catch(() => {}); }, 15 * 60 * 1000);

export default app;
