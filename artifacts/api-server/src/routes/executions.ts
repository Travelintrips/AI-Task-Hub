import { createSingleFlightGuard } from "../lib/single-flight";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  aiExecutionEventsTable,
  aiExecutionJobsTable,
  aiTasksTable,
  db,
} from "@workspace/db";
import { getCompanyId, getCompanyIdForWrite, requireAuth } from "../middleware/auth";
import { emitSseEvent } from "../lib/sse";
import { safeSourceTimelineMetadata } from "../lib/safe-source-timeline-metadata";
import { isAttestedCheckpointResponse, verifiedContinuation } from "../lib/verified-continuation";
import { hasVerifiedSourceFinalAck } from "../lib/verified-source-final-ack";
import { hasExplicitSopFailure } from "../lib/verified-sop-outcome";
import { logger } from "../lib/logger";
import { formatAiJobWhatsApp, jobWaConfig, notifyAiJobTransition } from "../lib/ai-job-whatsapp";
import { probeJobWaDevGateway } from "../lib/ai-job-wa-gateway";
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
        // Verify this response itself, never inherit proof from a previous callback.
        signatureVerified: isAttestedCheckpointResponse(response.kind, metadata, {
          commandId: timeline.commandId, correlationId: remoteCorrelationId ?? "",
          publicKeyDerBase64: process.env.AI_CORE_DEV_CHECKPOINT_PUBLIC_KEY_DER_B64,
        }, checkpoint),
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
      if (verificationMode === "chatgpt-attested" && hasExplicitSopFailure(response.message)) {
        status = "blocked";
        errorMessage = "AI_CORE_SOP_BLOCKER_IN_COMPLETED_REPLY";
        completedAt = new Date(response.createdAt);
        break;
      }
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

  if (status !== "blocked" && status !== "failed" && requiresAttestedFinalAck && callbackVerified && attestationVerified && finalAckVerified) {
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

  if (updated && updated.status !== execution.status) {
    void notifyAiJobTransition(updated).catch((err) => logger.warn({ err, executionId: updated.id }, "AI job WhatsApp notification deferred"));
  }
  return updated ?? execution;
}

const TERMINAL_EXECUTION_STATUSES = new Set(["completed", "failed", "blocked", "cancelled"]);
const executionSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const executionSyncBackoff = new Map<string, number>();
const chatGptDispatchRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const chatGptDispatchRetryBackoff = new Map<string, number>();
const chatGptDispatchInFlight = createSingleFlightGuard();

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
  if (!chatGptDispatchInFlight.enter(executionId)) return;
  try {
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

  // Atomic cross-instance claim. On an uncertain crash the dispatching state
  // deliberately remains for manual reconciliation; never blindly resend.
  const [claimed] = await db.update(aiExecutionJobsTable)
    .set({ status: "dispatching", metadata: {
      ...metadata, dispatchState: "dispatching_unconfirmed",
    } })
    .where(and(
      eq(aiExecutionJobsTable.id, executionId),
      eq(aiExecutionJobsTable.status, "waiting_for_session"),
      isNull(aiExecutionJobsTable.commandId),
    ))
    .returning();
  if (!claimed) return;

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

    // The command may have reached AI Core before an HTTP 429/503 was observed.
    // Never release the durable claim or schedule a new dispatch automatically.
    await db.update(aiExecutionJobsTable).set({
      status: "dispatching",
      errorMessage: "AI_CORE_DISPATCH_OUTCOME_UNCONFIRMED",
      metadata: {
        ...metadata,
        dispatchState: "dispatching_unconfirmed",
        lastDispatchError: message,
        lastDispatchAttemptAt: new Date().toISOString(),
      },
    }).where(and(
      eq(aiExecutionJobsTable.id, execution.id),
      eq(aiExecutionJobsTable.status, "dispatching"),
    ));
    stopChatGptDispatchRetry(executionId);
    logger.warn({ executionId, message }, "DEV GPT02 retry outcome uncertain; reconciliation required");
  }
  } finally {
    chatGptDispatchInFlight.leave(executionId);
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

// Recover eligible DEV dispatch retries after an API restart even when no browser polls the job.
// This scheduler never creates commands itself: AI Core remains the sole dispatcher.
async function recoverWaitingChatGptDispatches(): Promise<void> {
  if (!aiCoreBridgeConfigured()) return;
  try {
    const pending = await db.select().from(aiExecutionJobsTable)
      .where(eq(aiExecutionJobsTable.status, "waiting_for_session"))
      .orderBy(desc(aiExecutionJobsTable.updatedAt)).limit(30);
    for (const job of pending) {
      const metadata = asRecord(job.metadata);
      if (metadata["environment"] !== "development" ||
          metadata["verificationMode"] !== "chatgpt-attested" ||
          job.commandId || !job.taskId) continue;
      scheduleChatGptDispatchRetry(job.id);
    }
  } catch (err) {
    logger.warn({ err }, "DEV pending ChatGPT dispatch recovery deferred");
  }
}
const waitingRecoveryTimer = setInterval(() => {
  void recoverWaitingChatGptDispatches();
}, 60_000);
waitingRecoveryTimer.unref?.();
const initialRecoveryTimer = setTimeout(() => {
  void recoverWaitingChatGptDispatches();
}, 15_000);
initialRecoveryTimer.unref?.();


/** DEV-only continuation runner: never invents SOP checkpoints or executes a step itself. */
let automaticContinuationScanRunning = false;
async function recoverVerifiedSopContinuations(): Promise<void> {
  if (automaticContinuationScanRunning || !aiCoreBridgeConfigured()) return;
  automaticContinuationScanRunning = true;
  try {
    const candidates = await db.select().from(aiExecutionJobsTable)
      .where(and(eq(aiExecutionJobsTable.source, "AI_TASK"), inArray(aiExecutionJobsTable.status, ["failed", "running", "blocked"])))
      .orderBy(desc(aiExecutionJobsTable.updatedAt)).limit(100);
    for (const source of candidates) {
      const meta = asRecord(source.metadata);
      if (meta["environment"] !== "development" || meta["autoContinue"] !== true ||
          meta["verificationMode"] !== "chatgpt-attested" || !source.taskId ||
          !source.commandId || source.finalAckVerified) continue;
      const depth = typeof meta["continuationDepth"] === "number" ? meta["continuationDepth"] : 0;
      if (depth >= 100) {
        logger.warn({ sourceExecutionId: source.id }, "Automatic SOP continuation depth limit reached");
        continue;
      }
      const alias = meta["accountAlias"];
      if (typeof alias !== "string" || !/^GPT[0-9]{2,4}$/.test(alias)) continue;
      const events = await db.select().from(aiExecutionEventsTable)
        .where(eq(aiExecutionEventsTable.executionId, source.id))
        .orderBy(desc(aiExecutionEventsTable.createdAt)).limit(100);
      const proof = verifiedContinuation(events);
      if (!proof) continue;
      // Never run two commands at once: AI Core must confirm the parent stopped.
      if (source.status !== "failed") {
        const remoteCorrelationId = typeof meta["remoteCorrelationId"] === "string"
          ? meta["remoteCorrelationId"] : null;
        if (!remoteCorrelationId) continue;
        const original = await fetchAiTaskChatGptTimeline(source.commandId, remoteCorrelationId);
        if (!original || !["failed", "blocked"].includes(original.status.toLowerCase()) ||
            !original.responses.some((response) => response.kind === "FAILED" || response.kind === "BLOCKER")) continue;
      }
      const [task] = await db.select().from(aiTasksTable)
        .where(and(eq(aiTasksTable.id, source.taskId), eq(aiTasksTable.companyId, source.companyId))).limit(1);
      if (!task) continue;
      const fingerprint = createHash("sha256")
        .update([source.commandId, proof.jobId, proof.checkpointId, proof.stepId, proof.sopVersion].join("|"))
        .digest("hex").slice(0, 24);
      const parentId = buildAiTaskExternalCommandId(source.companyId, source.taskId);
      const externalId = `${parentId}:next:${fingerprint}`;
      const remoteCorrelationId = `${parentId}:${fingerprint}`;
      const instruction = [
        "AI CORE — CONTINUE_JOB", `jobId: ${proof.jobId}`,
        `parentCommandId: ${source.commandId}`, `correlationId: ${source.correlationId}`,
        `sopVersion: ${proof.sopVersion}`, `checkpointId: ${proof.checkpointId}`,
        `stepId: ${proof.stepId}`, `idempotencyKey: ${externalId}`,
        "AI Core is the only dispatcher. Reverify signed checkpoint, active lease and next step before executing.",
        "Do not repeat passed steps. Return audited checkpoint and final ACK through the official bridge.",
      ].join("\n");
      const [created] = await db.insert(aiExecutionJobsTable).values({
        companyId: source.companyId, taskId: source.taskId, source: "AI_TASK",
        externalId, idempotencyKey: externalId, title: task.title, instruction,
        correlationId: source.correlationId, status: "queued", progress: 5,
        metadata: {
          createdByUserId: meta["createdByUserId"] ?? null, environment: "development",
          verificationMode: "chatgpt-attested", accountAlias: alias,
          remoteCorrelationId, autoContinue: true, continuationDepth: depth + 1,
          resumeOfExecutionId: source.id, parentCommandId: source.commandId,
          verifiedCheckpointId: proof.checkpointId, sopVersion: proof.sopVersion,
          nextStepId: proof.stepId, jobId: proof.jobId,
        },
      }).onConflictDoNothing().returning();
      if (!created) continue;
      await db.insert(aiExecutionEventsTable).values({
        executionId: created.id, taskId: source.taskId, companyId: source.companyId,
        eventId: `auto-continuation:${fingerprint}:${created.id}`,
        eventType: "CONTINUATION_REQUESTED", phase: "dispatch", status: "queued",
        message: "Automatically resumed from verified AI Core checkpoint.",
        payload: { sourceExecutionId: source.id, parentCommandId: source.commandId,
          checkpointId: proof.checkpointId, stepId: proof.stepId, sopVersion: proof.sopVersion },
      });
      try {
        const remote = await submitAiTaskChatGptCommand({
          accountAlias: alias, instruction, jobAlias: task.taskNumber ?? `TASK${source.taskId}`,
          correlationId: remoteCorrelationId,
        });
        await db.update(aiExecutionJobsTable).set({
          commandId: remote.commandId, status: "dispatched", progress: 15,
          assignedClientId: remote.clientId, workerId: remote.clientId,
          metadata: { ...asRecord(created.metadata), remoteCreated: remote.created },
        }).where(eq(aiExecutionJobsTable.id, created.id));
        emitSseEvent("execution_updated", { executionId: created.id,
          taskId: source.taskId, status: "dispatched" }, source.companyId);
        scheduleExecutionTracking(created.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "AI_CORE_CONTINUATION_FAILED";
        if (isRetryableChatGptDispatchError(message)) {
          await markWaitingForAccountSession(created, message);
          scheduleChatGptDispatchRetry(created.id);
        } else {
          await db.update(aiExecutionJobsTable).set({
            status: "failed", progress: 100, errorMessage: message, completedAt: new Date(),
          }).where(eq(aiExecutionJobsTable.id, created.id));
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "Automatic verified SOP continuation scan deferred");
  } finally {
    automaticContinuationScanRunning = false;
  }
}
const automaticContinuationTimer = setInterval(() => {
  void recoverVerifiedSopContinuations();
}, 60_000);
automaticContinuationTimer.unref?.();
const automaticContinuationStartup = setTimeout(() => {
  void recoverVerifiedSopContinuations();
}, 20_000);
automaticContinuationStartup.unref?.();

// Rehydrate read-only timeline polling for in-flight DEV commands after a restart.
async function recoverInFlightExecutionTracking(): Promise<void> {
  if (!aiCoreBridgeConfigured()) return;
  try {
    const inFlight = await db.select().from(aiExecutionJobsTable)
      .where(inArray(aiExecutionJobsTable.status, ["queued", "dispatched", "running", "verifying"]))
      .orderBy(desc(aiExecutionJobsTable.updatedAt)).limit(100);
    for (const execution of inFlight) {
      const metadata = asRecord(execution.metadata);
      if (metadata["environment"] !== "development" || !execution.commandId) continue;
      scheduleExecutionTracking(execution.id);
    }
  } catch (err) {
    logger.warn({ err }, "DEV execution tracking recovery deferred");
  }
}
const activeRecoveryTimer = setInterval(() => {
  void recoverInFlightExecutionTracking();
}, 60_000);
activeRecoveryTimer.unref?.();
const activeRecoveryStartup = setTimeout(() => {
  void recoverInFlightExecutionTracking();
}, 25_000);
activeRecoveryStartup.unref?.();

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

// Read-only signed bridge preview for AI Core DEV monitoring tests.
router.get("/bridge/jobs/whatsapp-preview", requireBridgeToken, async (_req: Request, res: Response): Promise<void> => {
  try {
    const jobs = await db.select().from(aiExecutionJobsTable)
      .where(eq(aiExecutionJobsTable.companyId, "default"))
      .orderBy(desc(aiExecutionJobsTable.createdAt)).limit(30);
    const gateway = await probeJobWaDevGateway();
    res.json({ message: formatAiJobWhatsApp(jobs), shown: Math.min(jobs.length, 12), ...jobWaConfig(), gateway });
  } catch (err) {
    logger.error({ err }, "GET bridge WhatsApp job digest preview failed");
    res.status(500).json({ error: "Unable to preview bridge job digest" });
  }
});

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
      workerId: typeof sourceMetadata["workerId"] === "string" ? sourceMetadata["workerId"] : null,
      metadata: { passiveLedger: true, ...sourceMetadata },
    }).returning())[0];

    if (!existing) {
      void notifyAiJobTransition(row).catch((err) => logger.warn({ err, executionId: row.id }, "Bridge job WhatsApp notification deferred"));
    }
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
    // Cancelled executions are immutable: reject delayed/replayed source events.
    if (job.status === "cancelled") {
      res.status(409).json({ error: "Execution cancelled; source event rejected" });
      return;
    }
    if (job.source !== "AI_CORE" || !eventId.startsWith("ai-core:" + job.externalId + ":")) {
      res.status(403).json({ error: "Source authority mismatch" }); return;
    }

    const sourceEvidence = safeSourceTimelineMetadata(body["metadata"]);
    const verifiedFinal = hasVerifiedSourceFinalAck({
      source: job.source, externalId: job.externalId, status,
      metadata: sourceEvidence,
    }) && eventId === "ai-core:" + job.externalId + ":COMPLETED:terminal";
    if (asRecord(body["metadata"])["finalE2eVerified"] === true && !verifiedFinal) {
      res.status(409).json({ error: "Final ACK evidence mismatch" });
      return;
    }

    if (job.finalAckVerified && !verifiedFinal) {
      if (status === "COMPLETED") {
        res.status(200).json({ accepted: true, duplicate: true, status: "COMPLETED" });
      } else {
        res.status(409).json({ error: "Cannot downgrade source-verified final ACK" });
      }
      return;
    }
    const [existing] = await db.select({ id: aiExecutionEventsTable.id, executionId: aiExecutionEventsTable.executionId, status: aiExecutionEventsTable.status, payload: aiExecutionEventsTable.payload }).from(aiExecutionEventsTable)
      .where(eq(aiExecutionEventsTable.eventId, eventId)).limit(1);
    if (existing && (existing.executionId !== job.id || existing.status !== status)) {
      res.status(409).json({ error: "Source event identity conflict" }); return;
    }
    if (existing) {
      const incoming = sourceEvidence;
      const previous = existing.payload ?? {};
      const additions = Object.fromEntries(Object.entries(incoming).filter(([key]) => !(key in previous)));
      if (Object.keys(additions).length) {
        await db.update(aiExecutionEventsTable).set({ payload: { ...previous, ...additions } })
          .where(eq(aiExecutionEventsTable.id, existing.id));
      }
      if (verifiedFinal && !job.finalAckVerified) {
        await db.update(aiExecutionJobsTable).set({
          status: "completed", progress: 100,
          callbackVerified: true, attestationVerified: true, finalAckVerified: true,
          completedAt: job.completedAt ?? new Date(),
        }).where(eq(aiExecutionJobsTable.id, job.id));
      }
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
        payload: { status, ...sourceEvidence },
      });
    }

    const normalized = status.toUpperCase();
    const observation = safeSourceTimelineMetadata(body["metadata"]);
    const terminal = ["COMPLETED", "FAILED", "BLOCKED", "DEPLOYED", "MERGED"].includes(normalized);
    const [updated] = await db.update(aiExecutionJobsTable).set({
      // Latest DEV Final ACK verification is authoritative; a source-only
      // COMPLETED event must remain "verifying" until Final ACK is verified.
      status: verifiedFinal ? "completed" : normalized === "FAILED" ? "failed" : normalized === "BLOCKED" ? "blocked" :
        normalized === "COMPLETED" ? "verifying" : normalized.toLowerCase(),
      progress: verifiedFinal ? 100 : normalized === "COMPLETED" ? 90 : terminal ? 100 : Math.max(job.progress, 25),
      workerId: typeof observation["workerId"] === "string" ? observation["workerId"] : job.workerId,
      startedAt: ["RUNNING", "IN_PROGRESS"].includes(normalized) ? job.startedAt ?? new Date() : job.startedAt,
      ...(verifiedFinal ? {
        callbackVerified: true,
        attestationVerified: true,
        finalAckVerified: true,
      } : {}),
      // Source COMPLETED is provisional until a verified Final ACK arrives.
      // Do not expose a terminal completion timestamp for a verifying job.
      ...((verifiedFinal || normalized === "FAILED" || normalized === "BLOCKED")
        ? { completedAt: job.completedAt ?? new Date() } : { completedAt: null }),
    }).where(eq(aiExecutionJobsTable.id, job.id)).returning();
    if (updated && updated.status !== job.status) {
      void notifyAiJobTransition(updated).catch((err) => logger.warn({ err, executionId: updated.id }, "Source event WhatsApp notification deferred"));
    }

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

// Resume only from a signed, AI Core-verified checkpoint on the selected source job.
// AI Task requests continuation; AI Core remains the sole command dispatcher.
router.post("/ai-tasks/:id/continue", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = Number(req.params.id);
    if (!Number.isSafeInteger(taskId) || taskId < 1) { res.status(400).json({ error: "INVALID_TASK_ID" }); return; }
    const companyId = getCompanyIdForWrite(req);
    const [task] = await db.select().from(aiTasksTable)
      .where(and(eq(aiTasksTable.id, taskId), eq(aiTasksTable.companyId, companyId))).limit(1);
    if (!task) { res.status(404).json({ error: "TASK_NOT_FOUND" }); return; }
    if (!aiCoreBridgeConfigured()) { res.status(503).json({ error: "AI_CORE_BRIDGE_NOT_READY" }); return; }

    const sourceExecutionId = typeof req.body?.sourceExecutionId === "string" ? req.body.sourceExecutionId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(sourceExecutionId)) {
      res.status(422).json({ error: "SOURCE_EXECUTION_REQUIRED", message: "Pilih job asal untuk melanjutkan SOP." }); return;
    }
    const [source] = await db.select().from(aiExecutionJobsTable)
      .where(and(eq(aiExecutionJobsTable.id, sourceExecutionId),
        eq(aiExecutionJobsTable.taskId, taskId),
        eq(aiExecutionJobsTable.companyId, companyId),
        eq(aiExecutionJobsTable.source, "AI_TASK"))).limit(1);
    if (!source) { res.status(404).json({ error: "SOURCE_EXECUTION_NOT_FOUND" }); return; }
    if (source.status !== "failed" || source.finalAckVerified || !source.commandId) {
      res.status(409).json({ error: "SOURCE_NOT_RESUMABLE", message: "Job asal harus terhenti, belum final PASS, dan memiliki command AI Core." }); return;
    }
    const sourceEvents = await db.select().from(aiExecutionEventsTable)
      .where(eq(aiExecutionEventsTable.executionId, source.id))
      .orderBy(desc(aiExecutionEventsTable.createdAt)).limit(100);
    const proof = verifiedContinuation(sourceEvents);
    if (!proof) {
      res.status(409).json({ error: "NO_VERIFIED_CONTINUATION_CHECKPOINT",
        message: "AI Core belum mengirim checkpoint dan nextStepId yang ditandatangani dan terverifikasi untuk job ini." }); return;
    }
    const sourceMeta = asRecord(source.metadata);
    const accountAlias = sourceMeta["accountAlias"];
    if (typeof accountAlias !== "string" || !/^GPT[0-9]{2,4}$/.test(accountAlias)) {
      res.status(409).json({ error: "SOURCE_ACCOUNT_NOT_VERIFIED" }); return;
    }
    const fingerprint = createHash("sha256")
      .update([source.commandId, proof.jobId, proof.checkpointId, proof.stepId, proof.sopVersion].join("|"))
      .digest("hex").slice(0, 24);
    const externalId = `${buildAiTaskExternalCommandId(companyId, taskId)}:next:${fingerprint}`;
    // AI Core requires the canonical ai-task:<company>:<task>:<stable-id> correlation shape.
    // Preserve the parent correlation in the signed instruction and ledger instead.
    const remoteCorrelationId = `${buildAiTaskExternalCommandId(companyId, taskId)}:${fingerprint}`;
    const instruction = [
      "AI CORE — CONTINUE_JOB", `jobId: ${proof.jobId}`,
      `parentCommandId: ${source.commandId}`, `correlationId: ${source.correlationId}`,
      `sopVersion: ${proof.sopVersion}`, `checkpointId: ${proof.checkpointId}`,
      `stepId: ${proof.stepId}`, `idempotencyKey: ${externalId}`,
      "AI Core is the only dispatcher. Reverify checkpoint, authorization, active lease and next step before executing.",
      "Do not repeat a passed step. Return verified checkpoint, worker receipt and final ACK through the official bridge."
    ].join("\n");
    const [created] = await db.insert(aiExecutionJobsTable).values({
      companyId, taskId, source: "AI_TASK", externalId, idempotencyKey: externalId,
      title: task.title, instruction, correlationId: source.correlationId,
      status: "queued", progress: 5,
      metadata: {
        createdByUserId: req.user?.id ?? null, environment: "development",
        verificationMode: "chatgpt-attested", accountAlias, remoteCorrelationId,
        autoContinue: true, continuationDepth: (typeof asRecord(source.metadata)["continuationDepth"] === "number" ? Number(asRecord(source.metadata)["continuationDepth"]) : 0) + 1,
        resumeOfExecutionId: source.id, parentCommandId: source.commandId,
        verifiedCheckpointId: proof.checkpointId, sopVersion: proof.sopVersion,
        nextStepId: proof.stepId, jobId: proof.jobId,
      },
    }).onConflictDoNothing().returning();
    if (!created) {
      const [existing] = await db.select().from(aiExecutionJobsTable)
        .where(and(eq(aiExecutionJobsTable.source, "AI_TASK"), eq(aiExecutionJobsTable.externalId, externalId))).limit(1);
      res.status(200).json({ execution: existing ?? null, reused: true, message: "Continuation already registered" });
      return;
    }
    await db.insert(aiExecutionEventsTable).values({
      executionId: created.id, companyId, taskId,
      eventId: `continuation:${fingerprint}:${created.id}`, eventType: "CONTINUATION_REQUESTED",
      phase: "dispatch", status: "queued", message: "Resume requested from verified AI Core checkpoint.",
      payload: { sourceExecutionId: source.id, parentCommandId: source.commandId,
        checkpointId: proof.checkpointId, stepId: proof.stepId, sopVersion: proof.sopVersion },
    });
    try {
      const remote = await submitAiTaskChatGptCommand({
        accountAlias, instruction, jobAlias: task.taskNumber ?? `TASK${taskId}`,
        correlationId: remoteCorrelationId,
      });
      const [updated] = await db.update(aiExecutionJobsTable).set({
        commandId: remote.commandId, status: "dispatched", progress: 15,
        assignedClientId: remote.clientId, workerId: remote.clientId,
        metadata: { ...asRecord(created.metadata), remoteCreated: remote.created },
      }).where(eq(aiExecutionJobsTable.id, created.id)).returning();
      await db.insert(aiExecutionEventsTable).values({
        executionId: created.id, taskId, companyId,
        eventId: `dispatch:${remote.commandId}:${created.id}`, eventType: "DISPATCHED",
        phase: "dispatch", status: "dispatched", message: "Continuation accepted by AI Core.",
        workerId: remote.clientId, payload: { commandId: remote.commandId, created: remote.created },
      });
      emitSseEvent("execution_updated", { executionId: created.id, taskId, status: "dispatched" }, companyId);
      scheduleExecutionTracking(created.id);
      res.status(202).json({ execution: updated ?? created, reused: !remote.created });
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI_CORE_CONTINUATION_FAILED";
      if (isRetryableChatGptDispatchError(message)) {
        const waiting = await markWaitingForAccountSession(created, message);
        scheduleChatGptDispatchRetry(created.id);
        res.status(202).json({ execution: waiting, waitingForSession: true }); return;
      }
      const [failed] = await db.update(aiExecutionJobsTable).set({
        status: "failed", progress: 100, errorMessage: message, completedAt: new Date(),
      }).where(eq(aiExecutionJobsTable.id, created.id)).returning();
      res.status(502).json({ error: "CONTINUATION_DISPATCH_REJECTED", execution: failed ?? created });
    }
  } catch (err) {
    logger.error({ err }, "POST task continuation failed");
    res.status(500).json({ error: "CONTINUATION_UNAVAILABLE" });
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
    let mode: "chatgpt" | "worker" = body.mode === "chatgpt" ? "chatgpt" : "worker";
    let accountAlias = typeof body.accountAlias === "string" && /^GPT[0-9]{2,4}$/.test(body.accountAlias.trim().toUpperCase())
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
    // A generic SOP template is not a resumable command. Require concrete checkpoint identity.
    if (mode === "chatgpt" && instruction.includes("AI CORE — CONTINUE_JOB") &&
      (/`(?:jobId|commandId|checkpointId|stepId|idempotencyKey)`:\s*(?:ID |Checkpoint |Langkah |Kunci )/i.test(instruction) ||
       !/checkpointId\s*:\s*[^\s]+/.test(instruction) ||
       !/stepId\s*:\s*[^\s]+/.test(instruction))) {
      res.status(422).json({ error: "CONTINUE_JOB_REQUIRES_VERIFIED_CHECKPOINT", message: "Ambil identitas job dan checkpoint yang benar dari SOP AI Core sebelum dispatch." });
      return;
    }
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
      // A retry after an uncertain ChatGPT handoff is the SAME logical command.
      // Reuse its correlation: a new random value could wake a second worker.
      const nextCorrelationId = (mode === "chatgpt" || asRecord(existing.metadata)["reasoningHandoff"] === true)
        ? existing.correlationId : randomUUID();
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
          autoContinue: mode === "chatgpt" && task.category === "ai_chat",
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
          autoContinue: mode === "chatgpt" && task.category === "ai_chat",
          continuationDepth: 0,
          ...(mode === "chatgpt" ? { accountAlias } : {}),
        },
      }).onConflictDoNothing().returning();
      if (!created) {
        const [collision] = await db.select().from(aiExecutionJobsTable)
          .where(and(eq(aiExecutionJobsTable.source, "AI_TASK"), eq(aiExecutionJobsTable.externalId, externalId))).limit(1);
        if (!collision) throw new Error("EXECUTION_IDEMPOTENCY_CONFLICT");
        res.status(200).json({ execution: collision, reused: true });
        return;
      }
      execution = created;
    }

    void notifyAiJobTransition(execution).catch((err) => logger.warn({ err, executionId: execution.id }, "Execution WhatsApp notification deferred"));

    try {
      const executionMeta = asRecord(execution.metadata);
      // An existing reasoning handoff retains its original verified account
      // identity even if a later retry supplies a different/default alias.
      const pinnedAlias = executionMeta["accountAlias"];
      if (executionMeta["reasoningHandoff"] === true &&
          typeof pinnedAlias === "string" && /^GPT[0-9]{2,4}$/.test(pinnedAlias)) {
        accountAlias = pinnedAlias;
      }
      const remoteCorrelationId = typeof executionMeta["remoteCorrelationId"] === "string"
        ? executionMeta["remoteCorrelationId"]
        : `${externalId}:${execution.correlationId}`;
      // Only the exact AI Core 422 classification permits a reasoning handoff.
      // A named PC/worker is never silently replaced. The same AI Task execution,
      // external command identity and stable correlation are retained.
      let remote: Awaited<ReturnType<typeof submitAiTaskCommand>> | Awaited<ReturnType<typeof submitAiTaskChatGptCommand>>;
      if (mode === "chatgpt") {
        remote = await submitAiTaskChatGptCommand({
          accountAlias, instruction,
          jobAlias: task.taskNumber ?? `TASK${taskId}`,
          correlationId: remoteCorrelationId,
        });
      } else {
        try {
          remote = await submitAiTaskCommand({
            externalCommandId: externalId, instruction, assignedClientId,
            correlationId: execution.correlationId, companyId, taskId,
          });
        } catch (dispatchError) {
          if (!(dispatchError instanceof Error && dispatchError.message === "AI_CORE_REASONING_ROUTE_REQUIRED") || assignedClientId) {
            throw dispatchError;
          }
          // 422 classification is emitted before a new bounded dispatch, but
          // an older command with this stable identity might already exist.
          // Fail closed rather than create a second dispatcher for it.
          if (await fetchAiTaskCommandTimeline(externalId)) {
            throw new Error("AI_CORE_EXISTING_WORKER_COMMAND_PREVENTS_HANDOFF");
          }
          mode = "chatgpt";
          const handoffMetadata = {
            ...executionMeta,
            verificationMode: "chatgpt-attested",
            reasoningHandoff: true,
            accountAlias,
            autoContinue: task.category === "ai_chat",
            remoteCorrelationId,
          };
          // Persist the route before external dispatch. A retry or recovery must
          // use the ChatGPT-attested timeline, never the bounded-worker timeline.
          await db.update(aiExecutionJobsTable).set({
            metadata: handoffMetadata, assignedClientId: null,
          }).where(eq(aiExecutionJobsTable.id, execution.id));
          Object.assign(executionMeta, handoffMetadata);
          remote = await submitAiTaskChatGptCommand({
            accountAlias, instruction,
            jobAlias: task.taskNumber ?? `TASK${taskId}`,
            correlationId: remoteCorrelationId,
          });
        }
      }
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
      if (failed) void notifyAiJobTransition(failed).catch((err) => logger.warn({ err, executionId: failed.id }, "Failed job WhatsApp notification deferred"));
      res.status(502).json({ error: "AI Core dispatch failed", execution: failed ?? execution });
    }
  } catch (err) {
    logger.error({ err }, "POST task execution failed");
    res.status(500).json({ error: "Failed to start execution" });
  }
});

// Read-only preview and readiness check. No WhatsApp message is sent from this route.
router.get("/executions/whatsapp-digest/preview", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req);
    const jobs = await db.select().from(aiExecutionJobsTable)
      .where(companyId ? eq(aiExecutionJobsTable.companyId, companyId) : undefined)
      .orderBy(desc(aiExecutionJobsTable.createdAt)).limit(30);
    const gateway = await probeJobWaDevGateway();
    res.json({ message: formatAiJobWhatsApp(jobs), shown: Math.min(jobs.length, 12), ...jobWaConfig(), gateway });
  } catch (err) {
    logger.error({ err }, "GET WhatsApp job digest preview failed");
    res.status(500).json({ error: "Failed to create job digest preview" });
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