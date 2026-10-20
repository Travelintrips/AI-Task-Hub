import { logger } from "./logger";

const DEFAULT_DEV_BASE_URL = "https://dev.cstlogistic.co.id/api";

function safeBaseUrl(): string | null {
  const raw = (process.env.AI_CORE_DEV_BASE_URL ?? DEFAULT_DEV_BASE_URL).trim().replace(/\/$/, "");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "dev.cstlogistic.co.id") return null;
    return url.origin + (url.pathname === "/" ? "/api" : url.pathname.replace(/\/$/, ""));
  } catch {
    return null;
  }
}

function bridgeToken(): string | null {
  const token = process.env.AI_TASK_BRIDGE_TOKEN?.trim();
  return token && token.length >= 32 ? token : null;
}

export function aiCoreBridgeConfigured(): boolean {
  return Boolean(safeBaseUrl() && bridgeToken());
}

export function buildAiTaskExternalCommandId(companyId: string, taskId: number): string {
  const company = companyId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "default";
  return `ai-task:${company}:${taskId}`;
}

async function bridgeFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = safeBaseUrl();
  const token = bridgeToken();
  if (!base || !token) throw new Error("AI_CORE_BRIDGE_NOT_CONFIGURED");
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(8_000),
  });
}

export async function submitAiTaskCommand(input: {
  externalCommandId: string;
  instruction: string;
  assignedClientId?: string | null;
  correlationId: string;
  companyId: string;
  taskId: number;
}) {
  const response = await bridgeFetch("/ai/coding/bridge/ai-task/commands", {
    method: "POST",
    body: JSON.stringify({
      externalCommandId: input.externalCommandId,
      instruction: input.instruction,
      commandType: "EXTERNAL_AGENT_WORK",
      ...(input.assignedClientId ? { assignedClientId: input.assignedClientId } : {}),
      authority: {
        environment: "development",
        productionAllowed: false,
        source: "ai-task-hub",
      },
      metadata: {
        correlationId: input.correlationId,
        companyId: input.companyId,
        aiTaskId: input.taskId,
      },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    logger.warn({ status: response.status, body: text.slice(0, 160) }, "AI Core bridge command rejected");
    throw new Error(`AI_CORE_COMMAND_HTTP_${response.status}`);
  }
  return response.json() as Promise<{
    created: boolean;
    command: {
      id: string;
      status: string;
      externalCommandId?: string;
      metadataJson?: Record<string, unknown>;
    };
  }>;
}

export async function fetchAiTaskCommandTimeline(externalCommandId: string) {
  const response = await bridgeFetch(
    `/ai/coding/bridge/ai-task/timeline?externalCommandId=${encodeURIComponent(externalCommandId)}`,
    { method: "GET" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`AI_CORE_TIMELINE_HTTP_${response.status}`);
  return response.json() as Promise<{
    commandId: string;
    status: string;
    responses: Array<{
      id: string;
      kind: "ACK" | "PROGRESS" | "CHECKPOINT" | "BLOCKER" | "COMPLETED" | "FAILED";
      message: string;
      checkpoint?: Record<string, unknown> | null;
      metadata?: Record<string, unknown> | null;
      createdAt: string;
    }>;
  }>;
}
