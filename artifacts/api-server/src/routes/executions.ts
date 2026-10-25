import { randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  aiExecutionEventsTable,
  aiExecutionJobsTable,
  aiTasksTable,
  db,
} from "@workspace/db";
import { getCompanyId, getCompanyIdForWrite, requireAuth } from "../middleware/auth";
import { emitSseEvent } from "../lib/sse";
import { safeSourceTimelineMetadata } from "../lib/safe-source-timeline-metadata";
import { logger } from "../lib/logger";
import {
  aiCoreBridgeConfigured,
  buildAiTaskExternalCommandId,
  fetchAiTaskChatGptTimeline,
  fetchAiTaskCommandTimeline,
  submitAiTaskChatGptCommand,
  submitAiTaskCommand,
} from "../lib/ai-core-execution-bridge";

const router: IRouter = Router();

function bridgeTokenAuthorized(req: Request): boolean {
  const configured = process.env.AI_TASK_BRIDGE_TOKEN?.trim() ?? "";
  const header = String(req.headers.authorization ?? "");
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (configured.length < 32 || !supplied) return false;
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireBridgeToken(req: Request, res: Response, next: NextFunction): void {
  if (!bridgeTokenAuthorized(req)) {
    res.status(401).json({ error: "Invalid bridge token" });
    return;
  }
  next();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function flag(...sources: Array<Record<string, unknown>>): (names: string[]) => boolean {
  return (names) => sources.some((source) =>
    names.some((name) => source[name] === true || source[name] === "true"));
}

function textValue(...sources: Array<Record<string, unknown>>): (names: string[]) => string | null {
  return (names) => {
    for (const source of sources) {
      for (const name of names) {
        const value = source[name];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
    return null;
  };
}

async function syncExecution(execution: typeof aiExecutionJobsTable.$inferSelect) {
  if (!aiCoreBridgeConfigured() || !execution.externalId.startsWith("ai-task:")) return execution;
  const executionMetadata = asRecord(execution.metadata);
  const verificationMode = executionMetadata["verificationMode"] === "chatgpt-attested"
    ? "chatgpt-attested"
    : "bounded-worker";
  const remoteCorrelationId = typeof executionMetadata["remoteCorrelationId"] === "string"
    ? executionMetadata["remoteCorrelationId"]
    : null;
  const timeline = verificationMode === "chatgpt-attested"
    ? execution.commandId && remoteCorrelationId
      ? await fetchAiTaskChatGptTimeline(execution.commandId, remoteCorrelationId)
      : null
    : await fetchAiTaskCommandTimeline(execution.externalId);
  if (!timeline) return execution;

  let status = execution.status;
  let progress = execution.progress;
  let resultSummary = execution.resultSummary;
  let errorMessage = execution.errorMessage;
  let callbackVerified = execution.callbackVerified;
  let attestationVerified = execution.attestationVerified;
  let finalAckVerified = execution.finalAckVerified;
  let workerId = execution.workerId;
  let startedAt = execution.startedAt;
  let completedAt = execution.completedAt;

  const requiresAttestedFinalAck = verificationMode === "chatgpt-attested";

  const commandMetadata = asRecord(timeline.commandMetadata);
  if (["MCP_ACK_VERIFIED", "E2E_VERIFIED"].includes(String(commandMetadata["e2eCode"] ?? ""))) {
    finalAckVerified = true;
  }
  if (commandMetadata["deliveryCode"] === "DELIVERY_CONFIRMED") {
    callbackVerified = true;
  }
  workerId ||= typeof commandMetadata["completedBy"] === "string"
    ? commandMetadata["completedBy"]
    : typeof commandMetadata["assignedClientId"] === "string"
      ? commandMetadata["assignedClientId"]
      : null;

  for (const response of timeline.responses) {
    const checkpoint = asRecord(response.checkpoint);
    const metadata = asRecord(response.metadata);
    const hasFlag = flag(checkpoint, metadata);
    const getText = textValue(checkpoint, metadata);

    callbackVerified ||= hasFlag(["callbackVerified", "verifiedCallback", "callback_verified"]) ||
      checkpoint["deliveryCode"] === "DELIVERY_CONFIRMED" ||
      metadata["deliveryCode"] === "DELIVERY_CONFIRMED";
    const attestation = asRecord(metadata["attestation"]);
    attestationVerified ||= hasFlag(["attestationVerified", "verifiedAttestation", "attestation_verified"]) ||
      (metadata["verified"] === true &&
       metadata["verifiedAssistantReply"] === true &&
       attestation["algorithm"] === "Ed25519" &&
       typeof attestation["signature"] === "string" &&
       String(attestation["signature"]).length > 80);
    finalAckVerified ||= hasFlag(["finalAckVerified", "ackVerified", "final_ack_verified"]) ||
      ["MCP_ACK_VERIFIED", "E2E_VERIFIED"].includes(String(checkpoint["e2eCode"] ?? "")) ||
      ["MCP_ACK_VERIFIED", "E2E_VERIFIED"].includes(String(metadata["e2eCode"] ?? ""));
    workerId ||= getText(["workerId", "worker_id", "assignedClientId"]);

    const [existingEvent] = await db
      .select({ id: aiExecutionEventsTable.id })
      .from(aiExecutionEventsTable)
      .where(eq(aiExecutionEventsTable.eventId, response.id))
      .limit(1);

    if (!existingEvent) {
      await db.insert(aiExecutionEventsTable).values({
        executionId: execution.id,
        taskId: execution.taskId,
        companyId: execution.companyId,
        eventId: response.id,
        eventType: response.kind,
        phase: response.kind === "ACK" ? "dispatch" : response.kind.toLowerCase(),
        status: timeline.status,
        message: response.message,
        workerId,
        signatureVerified: callbackVerified || attestationVerified,
        payload: { checkpoint, metadata, createdAt: response.createdAt },
      });
    }

    if (response.kind === "ACK") {
      status = status === "queued" ? "dispatched" : status;
      progress = Math.max(progress, 15);
    } else if (response.kind === "PROGRESS") {
      status = "running";
      progress = Math.max(progress, 60);
      startedAt ??= new Date(response.createdAt);
    } else if (response.kind === "CHECKPOINT") {
      status = "running";
      progress = Math.max(progress, 75);
      startedAt ??= new Date(response.createdAt);
    } else if (response.kind === "BLOCKER") {
      status = "blocked";
      progress = Math.max(progress, 75);
      errorMessage = response.message;
    } else if (response.kind === "FAILED") {
      status = "failed";
      progress = 100;
      errorMessage = response.message;
      callbackVerified = true;
      completedAt = new Date(response.createdAt);
    } else if (response.kind === "COMPLETED") {
      resultSummary = response.message;
      callbackVerified = true;
      completedAt = new Date(response.createdAt);
      if (!requiresAttestedFinalAck) {
        status = "completed";
        progress = 100;
      } else if (callbackVerified && attestationVerified && finalAckVerified) {
        status = "completed";
        progress = 100;
      } else {
        status = "verifying";
        progress = Math.max(progress, 90);
      }
    }
  }

  if (requiresAttestedFinalAck && callbackVerified && attestationVerified && finalAckVerified) {
    status = "completed";
    progress = 100;
    completedAt ??= new Date();
  }

  const [updated] = await db
    .update(aiExecutionJobsTable)
    .set({
      commandId: timeline.commandId,
      workerId,
      status,
      progress,
      resultSummary,
      errorMessage,
      callbackVerified,
      attestationVerified,
      finalAckVerified,
      startedAt,
      completedAt,
    })
    .where(eq(aiExecutionJobsTable.id, execution.id))
    .returning();

  emitSseEvent("execution_updated", {
    executionId: execution.id,
    taskId: execution.taskId,
    status,
    progress,
    callbackVerified,
    attestationVerified,
    finalAckVerified,
  }, execution.companyId);

  return updated ?? execution;
}

const TERMINAL_EXECUTION_STATUSES = new Set(["completed", "failed", "blocked", "cancelled"]);
const executionSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const executionSyncBackoff = new Map<string, number>();
const chatGptDispatchRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const chatGptDispatchRetryBackoff = new Map<string, number>();

function isRetryableChatGptDispatchError(message: string): boolean {
  return message.includes("AI_CORE_CHATGPT_COMMAND_HTTP_429") ||
    message.includes("AI_CORE_CHATGPT_COMMAND_HTTP_503");
}

function stopChatGptDispatchRetry(executionId: string): void {
  const timer = chatGptDispatchRetryTimers.get(executionId);
  if (timer) clearTimeout(timer);
  chatGptDispatchRetryTimers.delete(executionId);
  chatGptDispatchRetryBackoff.delete(executionId);
}

async function markWaitingForAccountSession(
  execution: typeof aiExecutionJobsTable.$inferSelect,
  reason: string,
): Promise<typeof aiExecutionJobsTable.$inferSelect> {
  const metadata = asRecord(execution.metadata);
  const progress = Math.max(5, Math.min(execution.progress, 10));
  const [updated] = await db.update(aiExecutionJobsTable).set({
    status: "waiting_for_session",
    progress,
    errorMessage: null,
    completedAt: null,
    metadata: {
      ...metadata,
      dispatchState: "waiting_for_verified_account_session",
      lastDispatchError: reason,
      lastDispatchAttemptAt: new Date().toISOString(),
    },
  }).where(eq(aiExecutionJobsTable.id, execution.id)).returning();

  emitSseEvent("execution_updated", {
    executionId: execution.id,
    taskId: execution.taskId,
    status: "waiting_for_session",
    progress,
    accountAlias: typeof metadata["accountAlias"] === "string" ? metadata["accountAlias"] : null,
  }, execution.companyId);

  return updated ?? execution;
}

async function retryChatGptDispatch(executionId: string): Promise<void> {
  const [execution] = await db.select().from(aiExecutionJobsTable)
    .where(eq(aiExecutionJobsTable.id, executionId)).limit(1);
  if (!execution || TERMINAL_EXECUTION_STATUSES.has(execution.status) || execution.commandId) {
    stopChatGptDispatchRetry(executionId);
    return;
  }

  const metadata = asRecord(execution.metadata);
  if (metadata["verificationMode"] !== "chatgpt-attested" || execution.taskId == null) {
    stopChatGptDispatchRetry(executionId);
    return;
  }

  const accountAlias = typeof metadata["accountAlias"] === "string" ? metadata["accountAlias"] : "";
  const remoteCorrelationId = typeof metadata["remoteCorrelationId"] === "string" ? metadata["remoteCorrelationId"] : "";
  if (!/^GPT[0-9]{2,4}$/.test(accountAlias) || !remoteCorrelationId || !execution.instruction) {
    stopChatGptDispatchRetry(executionId);
    return;
  }

  const [task] = await db.select().from(aiTasksTable)
    .where(and(eq(aiTasksTable.id, execution.taskId), eq(aiTasksTable.companyId, execution.companyId))).limit(1);
  if (!task) {
    stopChatGptDispatchRetry(executionId);
    return;
  }

  try {
    const remote = await submitAiTaskChatGptCommand({
      accountAlias,
      instruction: execution.instruction,
      jobAlias: task.taskNumber ?? `TASK${execution.taskId}`,
      correlationId: remoteCorrelationId,
    });

    const [updated] = await db.update(aiExecutionJobsTable).set({
      commandId: remote.commandId,
      status: "dispatched",
      progress: 15,
      assignedClientId: remote.clientId,
      workerId: remote.clientId,
      errorMessage: null,
      metadata: {
        ...metadata,
        remoteCreated: remote.created,
        remoteCorrelationId,
        dispatchState: "dispatched",
        dispatchedAt: new Date().toISOString(),
      },
    }).where(eq(aiExecutionJobsTable.id, execution.id)).returning();

    await db.insert(aiExecutionEventsTable).values({
      executionId: execution.id,
      taskId: execution.taskId,
      companyId: execution.companyId,
      eventId: `dispatch-retry:${remote.commandId}:${randomUUID()}`,
      eventType: remote.created ? "DISPATCHED" : "REDISPATCHED",
      phase: "dispatch",
      status: "dispatched",
      message: "Verified account session became available; command accepted by AI Core.",
      workerId: remote.clientId,
      payload: { commandId: remote.commandId, created: remote.created, clientId: remote.clientId, accountAlias },
    });

    stopChatGptDispatchRetry(executionId);
    emitSseEvent("execution_updated", {
      executionId,
      taskId: execution.taskId,
      status: "dispatched",
      progress: 15,
      accountAlias,
      workerId: remote.clientId,
    }, execution.companyId);
    if (updated) scheduleExecutionTracking(updated.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI_CORE_CHATGPT_DISPATCH_FAILED";
    if (!isRetryableChatGptDispatchError(message)) {
      const [failed] = await db.update(aiExecutionJobsTable).set({
        status: "failed",
        progress: 100,
        errorMessage: message,
        completedAt: new Date(),
      }).where(eq(aiExecutionJobsTable.id, execution.id)).returning();
      stopChatGptDispatchRetry(executionId);
      emitSseEvent("execution_updated", {
        executionId,
        taskId: execution.taskId,
        status: "failed",
        progress: 100,
      }, execution.companyId);
      if (failed) stopExecutionTracking(failed.id);
      return;
    }

    await markWaitingForAccountSession(execution, message);
    const attempt = (chatGptDispatchRetryBackoff.get(executionId) ?? 0) + 1;
    chatGptDispatchRetryBackoff.set(executionId, attempt);
    scheduleChatGptDispatchRetry(executionId, Math.min(10_000 * (2 ** (attempt - 1)), 60_000));
  }
}

function scheduleChatGptDispatchRetry(executionId: string, delayMs = 10_000): void {
  if (chatGptDispatchRetryTimers.has(executionId)) return;
  const timer = setTimeout(async () => {
    chatGptDispatchRetryTimers.delete(executionId);
    await retryChatGptDispatch(executionId);
  }, delayMs);
  timer.unref?.();
  chatGptDispatchRetryTimers.set(executionId, timer);
}

function stopExecutionTracking(executionId: string): void {
  const timer = executionSyncTimers.get(executionId);
  if (timer) clearTimeout(timer);
  executionSyncTimers.delete(executionId);
  executionSyncBackoff.delete(executionId);
}

function scheduleExecutionTracking(executionId: string, delayMs = 1_000): void {
  if (executionSyncTimers.has(executionId)) return;

  const timer = setTimeout(async () => {
    executionSyncTimers.delete(executionId);

    const [current] = await db.select().from(aiExecutionJobsTable)
      .where(eq(aiExecutionJobsTable.id, executionId)).limit(1);

    if (!current || TERMINAL_EXECUTION_STATUSES.has(current.status)) {
      stopExecutionTracking(executionId);
      return;
    }

    try {
      const synced = await syncExecution(current);
      executionSyncBackoff.set(executionId, 0);

      if (TERMINAL_EXECUTION_STATUSES.has(synced.status)) {
        stopExecutionTracking(executionId);
        return;
      }

      scheduleExecutionTracking(executionId, 5_000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("HTTP_429")) {
        const attempt = (executionSyncBackoff.get(executionId) ?? 0) + 1;
        executionSyncBackoff.set(executionId, attempt);
        const backoffMs = Math.min(10_000 * (2 ** (attempt - 1)), 60_000);
        logger.warn({ executionId, backoffMs, attempt }, "Execution sync rate-limited; backing off");
        scheduleExecutionTracking(executionId, backoffMs);
        return;
      }

      logger.warn({ err, executionId }, "Execution background sync deferred");
      scheduleExecutionTracking(executionId, 15_000);
    }
  }, delayMs);

  timer.unref?.();
  executionSyncTimers.set(executionId, timer);
}

// AI Core -> AI Task passive ledger registration.
router.post("/bridge/jobs", requireBridgeToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const source = body.source === "AI_CORE" ? "AI_CORE" : null;
    const externalId = typeof body.externalId === "string" ? body.externalId.trim() : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : null;
    const sourceMetadata = safeSourceTimelineMetadata(body["metadata"]);
    if (!source || !externalId || !idempotencyKey || !title || externalId.length > 128 || title.length > 300) {
      res.status(400).json({ error: "Invalid bridge job" });
      return;
    }

    const [existing] = await db.select().from(aiExecutionJobsTable)
      .where(and(eq(aiExecutionJobsTable.source, source), eq(aiExecutionJobsTable.externalId, externalId)))
      .limit(1);
    const row = existing ?? (await db.insert(aiExecutionJobsTable).values({
      companyId: "default",
      source,
      externalId,
      idempotencyKey,
      title,
      sessionId,
      status: "queued",
      progress: 0,
      metadata: { passiveLedger: true, ...sourceMetadata },
    }).returning())[0];

    res.status(existing ? 200 : 201).json({
      accepted: true,
      created: !existing,
      task: {
        id: row.id,
        source: row.source,
        external_id: row.externalId,
        status: row.status,
        correlation_id: row.correlationId,
      },
    });
  } catch (err) {
    logger.error({ err }, "POST /bridge/jobs failed");
    res.status(500).json({ error: "Bridge ledger unavailable" });
  }
});

router.post("/bridge/jobs/:id/source-event", requireBridgeToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const executionId = String(req.params.id ?? "");
    const body = req.body as Record<string, unknown>;
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const status = typeof body.status === "string" ? body.status.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(executionId) || !eventId || eventId.length > 180 || !status || status.length > 40) {
      res.status(400).json({ error: "Invalid source event" });
      return;
    }

    const [job] = await db.select().from(aiExecutionJobsTable)
      .where(eq(aiExecutionJobsTable.id, executionId)).limit(1);
    if (!job) { res.status(404).json({ error: "Bridge job not found" }); return; }
    if (job.source !== "AI_CORE" || !eventId.startsWith("ai-core:" + job.externalId + ":")) {
      res.status(403).json({ error: "Source authority mismatch" }); return;
    }

    const [existing] = await db.select({ id: aiExecutionEventsTable.id, executionId: aiExecutionEventsTable.executionId, status: aiExecutionEventsTable.status }).from(aiExecutionEventsTable)
      .where(eq(aiExecutionEventsTable.eventId, eventId)).limit(1);
    if (existing && (existing.executionId !== job.id || existing.status !== status)) {
      res.status(409).json({ error: "Source event identity conflict" }); return;
    }
    if (existing) {
      res.status(200).json({ accepted: true, duplicate: true, status: existing.status });
      return;
    }
    if (!existing) {
      await db.insert(aiExecutionEventsTable).values({
        executionId: job.id,
        taskId: job.taskId,
        companyId: job.companyId,
        eventId,
        eventType: "SOURCE_EVENT",
        phase: "source",
        status,
        message: `AI Core source state: ${status}`,
        payload: { status, ...safeSourceTimelineMetadata(body["metadata"]) },
      });
    }

    const normalized = status.toUpperCase();
    const terminal = ["COMPLETED", "FAILED", "BLOCKED", "DEPLOYED", "MERGED"].includes(normalized);
    await db.update(aiExecutionJobsTable).set({
      status: normalized === "FAILED" ? "failed" : normalized === "BLOCKED" ? "blocked" :
        normalized === "COMPLETED" ? "verifying" : normalized.toLowerCase(),
      progress: normalized === "COMPLETED" ? 90 : terminal ? 100 : Math.max(job.progress, 25),
      ...(terminal ? { completedAt: new Date() } : {}),
    }).where(eq(aiExecutionJobsTable.id, job.id));

    res.status(202).json({ accepted: true, duplicate: false, status: normalized });
  } catch (err) {
    logger.error({ err }, "POST /bridge/jobs/:id/source-event failed");
    res.status(500).json({ error: "Source event unavailable" });
  }
});

router.get("/ai-tasks/:id/execution", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = Number(req.params.id);
    if (!Number.isInteger(taskId) || taskId < 1) { res.status(400).json({ error: "Invalid task id" }); return; }
    const companyId = getCompanyId(req);
    const conditions = [eq(aiExecutionJobsTable.taskId, taskId)];
    if (companyId) conditions.push(eq(aiExecutionJobsTable.companyId, companyId));
    let [execution] = await db.select().from(aiExecutionJobsTable)
      .where(and(...conditions)).orderBy(desc(aiExecutionJobsTable.createdAt)).limit(1);
    if (!execution) { res.json({ execution: null, events: [], bridgeConfigured: aiCoreBridgeConfigured() }); return; }

    if (!TERMINAL_EXECUTION_STATUSES.has(execution.status)) {
      if (execution.status === "waiting_for_session" && !execution.commandId) {
        scheduleChatGptDispatchRetry(execution.id);
      } else {
        scheduleExecutionTracking(execution.id);
      }
    }

    const events = await db.select().from(aiExecutionEventsTable)
      .where(eq(aiExecutionEventsTable.executionId, execution.id))
      .orderBy(aiExecutionEventsTable.createdAt)
      .limit(200);
    res.json({ execution, events, bridgeConfigured: aiCoreBridgeConfigured() });
  } catch (err) {
    logger.error({ err }, "GET task execution failed");
    res.status(500).json({ error: "Failed to load execution" });
  }
});

router.post("/ai-tasks/:id/execution", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = Number(req.params.id);
    if (!Number.isInteger(taskId) || taskId < 1) { res.status(400).json({ error: "Invalid task id" }); return; }
    const companyId = getCompanyIdForWrite(req);
    const [task] = await db.select().from(aiTasksTable)
      .where(and(eq(aiTasksTable.id, taskId), eq(aiTasksTable.companyId, companyId))).limit(1);
    if (!task) { res.status(404).json({ error: "AI task not found" }); return; }
    if (!aiCoreBridgeConfigured()) {
      res.status(503).json({ error: "AI Core bridge is not configured" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const mode = body.mode === "chatgpt" ? "chatgpt" : "worker";
    const accountAlias = typeof body.accountAlias === "string" && /^GPT[0-9]{2,4}$/.test(body.accountAlias.trim().toUpperCase())
      ? body.accountAlias.trim().toUpperCase()
      : process.env.AI_TASK_DEFAULT_GPT_ALIAS?.trim().toUpperCase() || "GPT01";
    const requestedClientId = typeof body.assignedClientId === "string" ? body.assignedClientId.trim() : "";
    // No implicit worker forcing here. AI Core owns generic worker selection and
    // capability/availability policy. A client ID is forwarded only when the
    // operator explicitly selects one.
    const assignedClientId = requestedClientId || null;
    const instruction = typeof body.instruction === "string" && body.instruction.trim()
      ? body.instruction.trim()
      : [task.title, task.description].filter(Boolean).join("\n\n");
    const maxInstructionLength = mode === "chatgpt" ? 2_000 : 50_000;
    if (!instruction || instruction.length > maxInstructionLength) {
      res.status(400).json({ error: "Instruction required or too long" }); return;
    }

    const externalId = buildAiTaskExternalCommandId(companyId, taskId);
    const verificationMode = mode === "chatgpt" ? "chatgpt-attested" : "bounded-worker";
    const [existing] = await db.select().from(aiExecutionJobsTable)
      .where(and(eq(aiExecutionJobsTable.source, "AI_TASK"), eq(aiExecutionJobsTable.externalId, externalId)))
      .limit(1);

    let execution: typeof aiExecutionJobsTable.$inferSelect;
    let reused = false;

    if (existing && !["failed", "blocked", "cancelled"].includes(existing.status)) {
      scheduleExecutionTracking(existing.id);
      const events = await db.select().from(aiExecutionEventsTable)
        .where(eq(aiExecutionEventsTable.executionId, existing.id))
        .orderBy(aiExecutionEventsTable.createdAt);
      res.status(200).json({ execution: existing, events, reused: true });
      return;
    }

    if (existing) {
      reused = true;
      const nextCorrelationId = randomUUID();
      const remoteCorrelationId = `${externalId}:${nextCorrelationId}`;
      const [reset] = await db.update(aiExecutionJobsTable).set({
        instruction,
        correlationId: nextCorrelationId,
        assignedClientId: mode === "chatgpt" ? null : assignedClientId,
        status: "queued",
        progress: 5,
        errorMessage: null,
        resultSummary: null,
        completedAt: null,
        metadata: {
          ...asRecord(existing.metadata),
          createdByUserId: req.user?.id ?? null,
          environment: "development",
          verificationMode,
          remoteCorrelationId,
          ...(mode === "chatgpt" ? { accountAlias } : {}),
        },
      }).where(eq(aiExecutionJobsTable.id, existing.id)).returning();
      execution = reset ?? existing;
    } else {
      const correlationId = randomUUID();
      const idempotencyKey = `${externalId}:${correlationId}`;
      const [created] = await db.insert(aiExecutionJobsTable).values({
        companyId,
        taskId,
        source: "AI_TASK",
        externalId,
        idempotencyKey,
        title: task.title,
        instruction,
        correlationId,
        assignedClientId: mode === "chatgpt" ? null : assignedClientId,
        status: "queued",
        progress: 5,
        metadata: {
          createdByUserId: req.user?.id ?? null,
          environment: "development",
          verificationMode,
          remoteCorrelationId: `${externalId}:${correlationId}`,
          ...(mode === "chatgpt" ? { accountAlias } : {}),
        },
      }).returning();
      execution = created;
    }

    try {
      const executionMeta = asRecord(execution.metadata);
      const remoteCorrelationId = typeof executionMeta["remoteCorrelationId"] === "string"
        ? executionMeta["remoteCorrelationId"]
        : `${externalId}:${execution.correlationId}`;
      const remote = mode === "chatgpt"
        ? await submitAiTaskChatGptCommand({
            accountAlias,
            instruction,
            jobAlias: task.taskNumber ?? `TASK${taskId}`,
            correlationId: remoteCorrelationId,
          })
        : await submitAiTaskCommand({
            externalCommandId: externalId,
            instruction,
            assignedClientId,
            correlationId: execution.correlationId,
            companyId,
            taskId,
          });
      const remoteCommandId: string = "command" in remote ? remote.command.id : remote.commandId;
      const remoteClientId: string = remote.clientId;
      const [updated] = await db.update(aiExecutionJobsTable).set({
        commandId: remoteCommandId,
        status: "dispatched",
        progress: 15,
        assignedClientId: remoteClientId,
        workerId: remoteClientId,
        metadata: {
          ...executionMeta,
          remoteCreated: remote.created,
          remoteCorrelationId,
          ...(mode === "chatgpt" ? { accountAlias } : {}),
        },
      }).where(eq(aiExecutionJobsTable.id, execution.id)).returning();
      await db.insert(aiExecutionEventsTable).values({
        executionId: execution.id,
        taskId,
        companyId,
        eventId: `dispatch:${remoteCommandId}:${randomUUID()}`,
        eventType: remote.created ? "DISPATCHED" : "REDISPATCHED",
        phase: "dispatch",
        status: "dispatched",
        message: remote.created ? "Command accepted by AI Core bridge." : "Existing AI Core command re-dispatched to worker.",
        workerId: remoteClientId,
        payload: { commandId: remoteCommandId, created: remote.created, clientId: remoteClientId },
      });
      emitSseEvent("execution_updated", { executionId: execution.id, taskId, status: "dispatched", progress: 15 }, companyId);
      scheduleExecutionTracking(execution.id);
      res.status(remote.created ? 201 : 200).json({ execution: updated ?? execution, reused: reused || !remote.created });
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI_CORE_DISPATCH_FAILED";
      if (mode === "chatgpt" && isRetryableChatGptDispatchError(message)) {
        const waiting = await markWaitingForAccountSession(execution, message);
        await db.insert(aiExecutionEventsTable).values({
          executionId: execution.id,
          taskId,
          companyId,
          eventId: `waiting-session:${execution.correlationId}:${randomUUID()}`,
          eventType: "WAITING_FOR_SESSION",
          phase: "dispatch",
          status: "waiting_for_session",
          message: `Waiting for a verified ${accountAlias} session. AI Task will retry automatically.`,
          payload: { accountAlias, retryable: true },
        });
        scheduleChatGptDispatchRetry(execution.id);
        res.status(202).json({ execution: waiting, queued: true, waitingForSession: true });
        return;
      }

      const [failed] = await db.update(aiExecutionJobsTable).set({
        status: "failed",
        progress: 100,
        errorMessage: message,
        completedAt: new Date(),
      }).where(eq(aiExecutionJobsTable.id, execution.id)).returning();
      res.status(502).json({ error: "AI Core dispatch failed", execution: failed ?? execution });
    }
  } catch (err) {
    logger.error({ err }, "POST task execution failed");
    res.status(500).json({ error: "Failed to start execution" });
  }
});

router.get("/executions/active-map", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db.select().from(aiExecutionJobsTable)
      .where(companyId ? eq(aiExecutionJobsTable.companyId, companyId) : undefined)
      .orderBy(desc(aiExecutionJobsTable.createdAt)).limit(1000);
    const byTask: Record<string, typeof rows[number]> = {};
    for (const row of rows) {
      if (row.taskId != null && !byTask[String(row.taskId)]) byTask[String(row.taskId)] = row;
    }
    res.json({ byTask, bridgeConfigured: aiCoreBridgeConfigured() });
  } catch (err) {
    logger.error({ err }, "GET executions active-map failed");
    res.status(500).json({ error: "Failed to load execution map" });
  }
});

export default router;
