import type { Response } from "express";
import { logger } from "./logger";

// ─── SSE Client Registry ──────────────────────────────────────────────────────

interface SseClient {
  res: Response;
  companyId: string;
  connectedAt: number;
}

const clients = new Set<SseClient>();

/** Register a new SSE client. Returns a cleanup function. */
export function registerSseClient(res: Response, companyId: string): () => void {
  const client: SseClient = { res, companyId, connectedAt: Date.now() };
  clients.add(client);
  logger.debug({ companyId, total: clients.size }, "SSE client connected");

  const cleanup = () => {
    clients.delete(client);
    logger.debug({ companyId, total: clients.size }, "SSE client disconnected");
  };

  return cleanup;
}

/** Push an SSE event to all clients in a given company (or all if companyId = "*"). */
export function emitSseEvent(
  eventName: string,
  data: Record<string, unknown>,
  companyId = "default",
): void {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent = 0;

  for (const client of clients) {
    if (companyId !== "*" && client.companyId !== companyId) continue;
    try {
      client.res.write(payload);
      sent++;
    } catch {
      clients.delete(client);
    }
  }

  if (sent > 0) {
    logger.debug({ eventName, companyId, sent }, "SSE event emitted");
  }
}

/** Send a keepalive comment to all clients to prevent proxy timeouts. */
export function sendSseKeepalive(): void {
  const ping = ": keepalive\n\n";
  for (const client of clients) {
    try {
      client.res.write(ping);
    } catch {
      clients.delete(client);
    }
  }
}

// Keepalive every 25 seconds (most proxies timeout at 30s)
setInterval(sendSseKeepalive, 25_000);
