import { logger } from "./logger";
import { employeeKasbonGatewayConfigured, readRecentEmployeeKasbonInbound } from "./employee-kasbon-wa-gateway";
import { tryHandleEmployeeKasbonOwnerApproval } from "./employee-kasbon-owner-flow";
import { handleEmployeeKasbonConversationInbound } from "./employee-kasbon-conversation";

const POLL_MS = 3_000;
const SEEN_MAX = 1_000;
const seen = new Set<string>();
let timer: NodeJS.Timeout | null = null;
let cursorMs = Date.now() - 30_000;

function remember(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > SEEN_MAX) {
    const first = seen.values().next().value as string | undefined;
    if (first) seen.delete(first);
  }
  return true;
}

async function poll(): Promise<void> {
  const since = new Date(Math.max(0, cursorMs - 2_000)).toISOString();
  const items = await readRecentEmployeeKasbonInbound(since, 100);
  for (const item of [...items].reverse()) {
    const createdMs = Date.parse(item.createdAt);
    if (Number.isFinite(createdMs)) cursorMs = Math.max(cursorMs, createdMs);
    const identity = item.providerMessageId || item.messageId;
    if (!identity || !remember(identity)) continue;
    const text = String(item.body ?? "").trim();
    if (!text) continue;
    if (text.toLowerCase() === "ok") {
      await tryHandleEmployeeKasbonOwnerApproval({
        phone: item.peer,
        text,
        companyId: "default",
      });
      continue;
    }
    await handleEmployeeKasbonConversationInbound({
      phone: item.peer,
      text,
      inboundId: identity,
      companyId: "default",
    });
  }
}

export function startEmployeeKasbonOwnerWaPoller(): void {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.EMPLOYEE_KASBON_WA_POLL_ENABLED !== "true") return;
  if (!employeeKasbonGatewayConfigured()) {
    logger.warn("employee-kasbon WA poller not started: gateway config missing");
    return;
  }
  if (timer) return;
  const run = () => {
    void poll().catch((error) => logger.warn({
      err: error,
      message: error instanceof Error ? error.message : String(error),
    }, "employee-kasbon WA poll failed"));
  };
  run();
  timer = setInterval(run, POLL_MS);
  timer.unref();
  logger.info({ intervalMs: POLL_MS }, "employee-kasbon owner WA poller started");
}
