import app from "./app";
import { logger } from "./lib/logger";

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
});
