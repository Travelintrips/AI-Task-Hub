import app from "./app";
import { logger } from "./lib/logger";
import { startAiCoreSourceReconciliationRuntime } from "./lib/ai-core-source-reconciliation";
import { startAiJobWhatsAppDeliveryReconciliation } from "./lib/ai-job-wa-delivery";

const rawPort = process.env["PORT"] ?? "8080";
const host = process.env["HOST"]?.trim() || "127.0.0.1";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err, host, port }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ host, port }, "Server listening");
  // Blue/green DEV previews must not start a second reconciler/WA worker.
  // Normal DEV keeps both workers whenever the opt-out flag is absent.
  if (process.env.DISABLE_BACKGROUND_SCHEDULERS !== "true") {
    startAiCoreSourceReconciliationRuntime();
    startAiJobWhatsAppDeliveryReconciliation();
  }
});
