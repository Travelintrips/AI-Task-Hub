import { evaluateGpt02ExecutionOutcome } from "../lib/gpt02-execution-outcome";
import { createSingleFlightGuard } from "../lib/single-flight";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  aiExecutionEventsTable,
  aiExecutionJobsTable,
  aiTasksTable,
  teamMembersTable,
  auditLogsTable,
  db,
} from "@workspace/db";
import { getCompanyId, getCompanyIdForWrite, requireAuth } from "../middleware/auth";
import { emitSseEvent } from "../lib/sse";
import { safeSourceTimelineMetadata } from "../lib/safe-source-timeline-metadata";
import { bridgeLedgerReadbackAllowed } from "../lib/bridge-ledger-readback-policy";
import { passiveBridgeSourceProgress } from "../lib/bridge-ledger-source-progress";
import { summarizeBridgeLedgerEvents } from "../lib/bridge-ledger-event-summary";
import { isAttestedCheckpointResponse, verifiedContinuation } from "../lib/verified-continuation";
import { hasVerifiedSourceFinalAck } from "../lib/verified-source-final-ack";
import { evaluateGpt02LineageEvidence } from "../lib/gpt02-lineage-gate";
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
  // This is a pre-dispatch reservation, NOT an in-flight Core command. Even a
  // stale or tampered verificationMode must not associate an unrelated generic
  // command timeline with a prepared Hub/Core job.
  if (execution.status === "prepared") return execution;
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
  // These errors cannot prove whether a network request was accepted remotely.
  return /AI_CORE_CHATGPT_COMMAND_HTTP_(?:429|5\d\d)\b/.test(message) ||
    /(?:TimeoutError|AbortError|timeout|fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up)/i.test(message);
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
  // Fail closed: a waiting GPT02 session cannot automatically wake an older
  // command even if the account session later becomes available.
  if (accountAlias === "GPT02") {
    stopChatGptDispatchRetry(executionId);
    logger.warn({executionId}, "GPT02 automatic retry withheld pending operator recovery");
    return;
  }
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
      // Dispatch failure is terminal for this attempt, not task completion.
      // Keep previously observed progress bounded until independently verified ACK.
      const [failed] = await db.update(aiExecutionJobsTable).set({
        status: "failed",
        progress: Math.max(0, Math.min(90, execution.progress)),
        errorMessage: message,
        completedAt: new Date(),
      }).where(eq(aiExecutionJobsTable.id, execution.id)).returning();
      stopChatGptDispatchRetry(executionId);
      emitSseEvent("execution_updated", {
        executionId,
        taskId: execution.taskId,
        status: "failed",
        progress: Math.max(0, Math.min(90, execution.progress)),
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
      // A signed checkpoint is not a new operator grant. Never autonomously
      // create another GPT02 attempt from a historic/source execution.
      if (alias === "GPT02") continue;
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
      // Continuation is an initial dispatch too: commit a durable claim first.
      const [claimedContinuation] = await db.update(aiExecutionJobsTable)
        .set({ status: "dispatching", metadata: { ...asRecord(created.metadata), dispatchState: "dispatching_unconfirmed" } })
        .where(and(eq(aiExecutionJobsTable.id, created.id), eq(aiExecutionJobsTable.status, "queued"), isNull(aiExecutionJobsTable.commandId)))
        .returning();
      if (!claimedContinuation) continue;
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
          await db.update(aiExecutionJobsTable).set({ status: "dispatching", errorMessage: "AI_CORE_DISPATCH_OUTCOME_UNCONFIRMED", metadata: { ...asRecord(created.metadata), dispatchState: "dispatching_unconfirmed", lastDispatchError: message } }).where(eq(aiExecutionJobsTable.id, created.id));
        } else {
          await db.update(aiExecutionJobsTable).set({
            status: "failed", progress: Math.max(0, Math.min(90, created.progress)), errorMessage: message, completedAt: new Date(),
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

    if (!current || TERMINAL_EXECUTION_STATUSES.has(current.status) || current.status === "prepared") {
      // A dormant pre-dispatch row is not an unfinished worker command.
      // Stop an old timer rather than polling forever or syncing by external ID.
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

// Read-only, exact external ID readback for the existing AI Core bridge.
// The receiver remains passive and never authorizes GPT02 execution.
router.get("/bridge/jobs/by-external-id/:externalId", requireBridgeToken,
 async (req: Request, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  // Deployment activation is explicit. Endpoint stays absent by default.
  // The DEV container identifies itself with NODE_ENV=development; APP_ENV
  // may be absent there. Explicit APP_ENV=production still denies access.
  if (!bridgeLedgerReadbackAllowed(process.env)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const externalId = String(req.params.externalId ?? "");
  if (!/^bridge-command:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(externalId)) {
    res.status(400).json({ error: "Invalid bridge external ID" });
    return;
  }
  try {
    const [job] = await db.select({
      id: aiExecutionJobsTable.id,
      source: aiExecutionJobsTable.source,
      externalId: aiExecutionJobsTable.externalId,
      status: aiExecutionJobsTable.status,
      progress: aiExecutionJobsTable.progress,
      metadata: aiExecutionJobsTable.metadata,
      taskId: aiExecutionJobsTable.taskId,
    }).from(aiExecutionJobsTable)
      .where(and(eq(aiExecutionJobsTable.source, "AI_CORE"),
        eq(aiExecutionJobsTable.companyId, "default"),
        eq(aiExecutionJobsTable.externalId, externalId),
        // This private readback is reserved for the passive AI Core ledger.
        // A non-ledger execution with a matching external ID is not evidence.
        sql`${aiExecutionJobsTable.metadata}->>'passiveLedger' = 'true'`))
      .limit(1);
    if (!job) { res.status(404).json({ error: "Bridge job not found" }); return; }
    // Only safe columns, no event payload, instructions, messages or credentials.
    // Limit 101 allows an explicit truncation marker for >100 events.
    const events = await db.select({
      eventType:aiExecutionEventsTable.eventType,
      status:aiExecutionEventsTable.status,
      signatureVerified:aiExecutionEventsTable.signatureVerified,
    }).from(aiExecutionEventsTable)
      .where(eq(aiExecutionEventsTable.executionId,job.id))
      .orderBy(aiExecutionEventsTable.createdAt,aiExecutionEventsTable.id)
      .limit(101);
    const eventEvidence=summarizeBridgeLedgerEvents(events,job.status,job.progress);
    const meta = safeSourceTimelineMetadata(job.metadata);
    // Do not copy arbitrary job metadata, conversation text or credentials.
    res.status(200).json({ found: true, source: "AI_CORE",
      external_id: job.externalId, id: job.id, task_id: job.taskId ?? null,
      status: job.status, progress: job.progress,
      timeline: meta, eventEvidence,
      readOnly: true, passiveLedger: true, mayIssueGrant: false, mayDispatchWorker: false,
      verifiedExecution: false,
      taskLinkageVerified: false, attemptBindingVerified: false,
      accountableOwnerVerified: false,
    });
  } catch (err) {
    logger.error({ err }, "GET /bridge/jobs/by-external-id failed");
    res.status(503).json({ error: "Bridge ledger readback unavailable" });
  }
});

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
        task_linkage_verified: false,
        attempt_binding_verified: false,
        accountable_owner_verified: false,
        passive_ledger_only: true,
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
    const [updated] = await db.update(aiExecutionJobsTable).set({
      // Latest DEV Final ACK verification is authoritative; a source-only
      // COMPLETED event must remain "verifying" until Final ACK is verified.
      status: verifiedFinal ? "completed" : normalized === "FAILED" ? "failed" : normalized === "BLOCKED" ? "blocked" :
        normalized === "COMPLETED" ? "verifying" : normalized.toLowerCase(),
      progress: passiveBridgeSourceProgress(normalized, job.progress, verifiedFinal),
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

// Diagnostic-only reconciliation: never dispatch, retry or mutate a job.
// A unique correlation match is evidence of acceptance, NOT verified completion.
router.get("/ai-tasks/:id/gpt02-reconciliation", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not available" }); return;
  }
  const taskId = Number(req.params.id);
  const companyId = getCompanyId(req);
  if (!Number.isSafeInteger(taskId) || taskId < 1 || !companyId) {
    res.status(400).json({ error: "Task and company scope required" }); return;
  }
  try {
    const [job] = await db.select().from(aiExecutionJobsTable)
      .where(and(eq(aiExecutionJobsTable.taskId, taskId), eq(aiExecutionJobsTable.companyId, companyId)))
      .orderBy(desc(aiExecutionJobsTable.createdAt)).limit(1);
    if (!job) { res.status(404).json({ error: "Execution not found" }); return; }
    const metadata = asRecord(job.metadata);
    const correlation = metadata["remoteCorrelationId"];
    if (metadata["environment"] !== "development" || metadata["verificationMode"] !== "chatgpt-attested" ||
        typeof correlation !== "string" || correlation.length < 8 || correlation.length > 250) {
      res.status(422).json({ error: "Not a correlated DEV GPT02 execution" }); return;
    }
    // Archive is optional; its absence must not break active-command reconciliation.
    const archivePresent = await db.execute(sql`SELECT to_regclass('ai_platform.gpt02_dev_command_archive_20261030') IS NOT NULL AS available`);
    const hasArchive = archivePresent.rows[0]?.available === true;
    const matches = hasArchive
      ? await db.execute(sql`
          SELECT DISTINCT command_id, source FROM (
            SELECT id::text AS command_id, 'active' AS source FROM ai_platform.ai_coding_bridge_commands
            WHERE metadata_json->>'correlationId' = ${correlation}
            UNION ALL
            SELECT command_id::text, 'archive' AS source FROM ai_platform.gpt02_dev_command_archive_20261030
            WHERE command_record->'metadata_json'->>'correlationId' = ${correlation}
          ) matched LIMIT 100
        `)
      : await db.execute(sql`
          SELECT DISTINCT id::text AS command_id, 'active' AS source FROM ai_platform.ai_coding_bridge_commands
          WHERE metadata_json->>'correlationId' = ${correlation} LIMIT 100
        `);
    const found = matches.rows as Array<{ command_id: string; source: string }>;
    const uniqueIds = [...new Set(found.map(row => row.command_id))];
    const unique = uniqueIds.length === 1 && found.length < 100;
    res.json({ taskId, executionId: job.id, status: job.status, correlationId: correlation,
      matchCount: found.length, uniqueCommandMatch: unique, archiveAvailable: hasArchive,
      commandId: unique ? uniqueIds[0] : null,
      sources: [...new Set(found.map(row => row.source))],
      callbackVerified: job.callbackVerified === true,
      attestationVerified: job.attestationVerified === true,
      finalAckVerified: job.finalAckVerified === true,
      automaticDispatch: false, statusChanged: false,
    });
  } catch (err) {
    logger.warn({ err, taskId }, "DEV GPT02 read-only reconciliation failed");
    res.status(503).json({ error: "Reconciliation unavailable" });
  }
});

// DEV-only, fail-closed recovery: adopt a uniquely correlated existing command, never resend.
router.post("/ai-tasks/:id/gpt02-adopt-existing", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not available" }); return;
  }
  if (req.user?.role !== "super_admin") {
    res.status(403).json({ error: "SUPER_ADMIN_REQUIRED" }); return;
  }
  const taskId = Number(req.params.id);
  const companyId = getCompanyIdForWrite(req);
  if (!Number.isSafeInteger(taskId) || taskId < 1) {
    res.status(400).json({ error: "INVALID_TASK_ID" }); return;
  }
  try {
    const [job] = await db.select().from(aiExecutionJobsTable)
      .where(and(eq(aiExecutionJobsTable.taskId, taskId), eq(aiExecutionJobsTable.companyId, companyId)))
      .orderBy(desc(aiExecutionJobsTable.createdAt)).limit(1);
    if (!job) { res.status(404).json({ error: "EXECUTION_NOT_FOUND" }); return; }
    const metadata = asRecord(job.metadata);
    const correlation = metadata["remoteCorrelationId"];
    if (job.status !== "dispatching" || job.commandId ||
        metadata["dispatchState"] !== "dispatching_unconfirmed" ||
        metadata["environment"] !== "development" || metadata["verificationMode"] !== "chatgpt-attested" ||
        typeof correlation !== "string" || correlation.length < 8 || correlation.length > 250) {
      res.status(409).json({ error: "EXECUTION_NOT_ELIGIBLE" }); return;
    }
    const archivePresent = await db.execute(sql`SELECT to_regclass('ai_platform.gpt02_dev_command_archive_20261030') IS NOT NULL AS available`);
    const hasArchive = archivePresent.rows[0]?.available === true;
    const matches = hasArchive
      ? await db.execute(sql`
          SELECT DISTINCT command_id FROM (
            SELECT id::text AS command_id FROM ai_platform.ai_coding_bridge_commands
            WHERE metadata_json->>'correlationId' = ${correlation}
            UNION ALL
            SELECT command_id::text FROM ai_platform.gpt02_dev_command_archive_20261030
            WHERE command_record->'metadata_json'->>'correlationId' = ${correlation}
          ) matched LIMIT 2`)
      : await db.execute(sql`
          SELECT DISTINCT id::text AS command_id FROM ai_platform.ai_coding_bridge_commands
          WHERE metadata_json->>'correlationId' = ${correlation} LIMIT 2`);
    const ids = matches.rows.map(row => String(row.command_id));
    if (ids.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(ids[0])) {
      res.status(409).json({ error: "UNIQUE_REMOTE_COMMAND_NOT_PROVEN", matchCount: ids.length }); return;
    }
    const [claimed] = await db.update(aiExecutionJobsTable)
      .set({ commandId: ids[0], status: "dispatched", errorMessage: null,
        metadata: { ...metadata, dispatchState: "adopted_existing", adoptedAt: new Date().toISOString() } })
      .where(and(eq(aiExecutionJobsTable.id, job.id), eq(aiExecutionJobsTable.companyId, companyId),
        eq(aiExecutionJobsTable.status, "dispatching"), isNull(aiExecutionJobsTable.commandId),
        sql`metadata->>'dispatchState' = 'dispatching_unconfirmed'`,
        sql`metadata->>'remoteCorrelationId' = ${correlation}`))
      .returning();
    if (!claimed) { res.status(409).json({ error: "RECOVERY_CLAIM_LOST" }); return; }
    scheduleExecutionTracking(claimed.id);
    res.json({ adopted: true, dispatchedNewCommand: false, executionId: claimed.id,
      commandId: ids[0], callbackVerified: claimed.callbackVerified,
      attestationVerified: claimed.attestationVerified, finalAckVerified: claimed.finalAckVerified });
  } catch (err) {
    logger.warn({ err, taskId }, "DEV GPT02 adopt-existing reconciliation failed");
    res.status(503).json({ error: "RECOVERY_UNAVAILABLE" });
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

    if (!TERMINAL_EXECUTION_STATUSES.has(execution.status) && execution.status !== "prepared") {
      // A GET from the dashboard must never schedule background polling or
      // change the reserved, still-unauthorized Hub/Core execution.
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

// DEV-only Human review handoff for a terminal GPT02 failure with no verified checkpoint.
// This never resumes, redispatches, assigns an invented PIC, or marks the AI task PASS.
router.get("/ai-tasks/:id/recovery-review", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV !== "development" || process.env.APP_ENV === "production") {res.sendStatus(404);return;}
  const taskId=Number(req.params.id);
  if (!Number.isSafeInteger(taskId)||taskId<1) {res.status(400).json({error:"INVALID_TASK_ID"});return;}
  try {
    const companyId=getCompanyIdForWrite(req);
    const [task]=await db.select().from(aiTasksTable).where(and(eq(aiTasksTable.id,taskId),eq(aiTasksTable.companyId,companyId))).limit(1);
    if (!task) {res.sendStatus(404);return;}
    const [execution]=await db.select().from(aiExecutionJobsTable)
      .where(and(eq(aiExecutionJobsTable.taskId,taskId),eq(aiExecutionJobsTable.companyId,companyId),eq(aiExecutionJobsTable.source,"AI_TASK")))
      .orderBy(desc(aiExecutionJobsTable.createdAt)).limit(1);
    const sourceId=execution ? `execution:${execution.id}` : "";
    const [human]=sourceId ? (await db.execute(sql`
      SELECT id,task_code,status,assigned_user,assigned_role,created_at,
        payload_json->'recoveryEvidence'->>'failureCode' AS failure_code,
        payload_json->'recoveryEvidence'->>'nativeSendAttemptRecorded' AS send_attempt_recorded,
        payload_json->'recoveryEvidence'->>'assistantAckVerified' AS assistant_ack_verified,
        payload_json->'recoveryEvidence'->>'openClawAttemptVerified' AS openclaw_attempt_verified,
        payload_json->'recoveryEvidence'->>'signedCheckpointCount' AS signed_checkpoint_count
      FROM ai_platform.ai_human_tasks WHERE source_module='ai_core_lifecycle' AND source_type='job'
        AND source_id=${sourceId} LIMIT 1`)).rows : [];
    const events=execution ? await db.select().from(aiExecutionEventsTable).where(eq(aiExecutionEventsTable.executionId,execution.id)).orderBy(desc(aiExecutionEventsTable.createdAt)).limit(100) : [];
    const checkpoint=verifiedContinuation(events);
    const eligible=execution?.status==="failed" && !execution.finalAckVerified && !checkpoint;
    res.setHeader("Cache-Control","no-store");
    res.json({executionId:execution?.id??null,executionStatus:execution?.status??null,
      eligibleForHumanReview:eligible,verifiedContinuationCheckpoint:!!checkpoint,
      resumeAuthorized:false,originalError:execution?.errorMessage??null,
      picName:task.assignedTo??null,picAccountVerified:false,
      humanTask:human??null,
      nextAction:checkpoint?"OFFICIAL_CHECKPOINT_AUTHORIZATION_REQUIRED":eligible?"HUMAN_REVIEW_REQUIRED":"AUDIT_EXECUTION_FIRST"});
  } catch (error) {logger.error({error,taskId},"DEV human recovery read failed");res.status(503).json({error:"RECOVERY_REVIEW_UNAVAILABLE"});}
});

router.post("/ai-tasks/:id/human-review", requireAuth, async(req:Request,res:Response):Promise<void>=>{
  if(process.env.NODE_ENV!=="development"||process.env.APP_ENV==="production"){res.sendStatus(404);return;}
  const taskId=Number(req.params.id);
  if(!Number.isSafeInteger(taskId)||taskId<1){res.status(400).json({error:"INVALID_TASK_ID"});return;}
  const origin=req.get("origin");
  if(origin){try{if(new URL(origin).host!==req.get("host")){res.status(403).json({error:"CROSS_ORIGIN_DENIED"});return;}}catch{res.status(403).json({error:"CROSS_ORIGIN_DENIED"});return;}}
  try{
    const companyId=getCompanyIdForWrite(req);
    const outcome=await db.transaction(async tx=>{
      // Serialize all concurrent human-review requests for the same tenant and task.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`recovery:${companyId}:${taskId}`}))`);
      const [task]=await tx.select().from(aiTasksTable).where(and(eq(aiTasksTable.id,taskId),eq(aiTasksTable.companyId,companyId))).limit(1);
      if(!task)return {kind:"not_found" as const};
      const [execution]=await tx.select().from(aiExecutionJobsTable)
        .where(and(eq(aiExecutionJobsTable.taskId,taskId),eq(aiExecutionJobsTable.companyId,companyId),eq(aiExecutionJobsTable.source,"AI_TASK")))
        .orderBy(desc(aiExecutionJobsTable.createdAt)).limit(1);
      if(!execution)return {kind:"not_ready" as const};
      const sourceId=`execution:${execution.id}`;
      const existing=await tx.execute(sql`SELECT id,task_code,status FROM ai_platform.ai_human_tasks
        WHERE source_module='ai_core_lifecycle' AND source_type='job' AND source_id=${sourceId} LIMIT 1`);
      if(existing.rows.length)return {kind:"existing" as const,task:existing.rows[0]};
      if(execution.status!=="failed"||execution.finalAckVerified||!execution.commandId)return {kind:"not_ready" as const};
      const events=await tx.select().from(aiExecutionEventsTable).where(eq(aiExecutionEventsTable.executionId,execution.id)).orderBy(desc(aiExecutionEventsTable.createdAt)).limit(100);
      if(verifiedContinuation(events))return {kind:"verified_checkpoint" as const};
      const actor=`ai-task-user:${req.user?.id??"unknown"}`;
      const code=`HT-RECOVERY-${randomUUID().slice(0,12).toUpperCase()}`;
      const reason=`GPT02 failed without verified checkpoint: ${(execution.errorMessage??"Unknown failure").slice(0,500)}`;
      const context=JSON.stringify({taskId,companyId,executionId:execution.id,commandId:execution.commandId,
        picName:task.assignedTo??null,picIdentityVerified:false,openClawAttemptVerified:false,
        verifiedCheckpoint:false,resumeAllowed:false,requestedBy:actor});
      const inserted=await tx.execute(sql`INSERT INTO ai_platform.ai_human_tasks
        (task_code,source_module,source_type,source_id,assigned_role,priority,status,reason,instructions,payload_json)
        VALUES(${code},'ai_core_lifecycle','job',${sourceId},'Administrator',80,'pending',${reason},
        'Tinjau kegagalan GPT02. Verifikasi browser dan instruksi asli, checkpoint, OpenClaw, serta identitas PIC sebelum penugasan. Tidak boleh resend command, bypass ACK atau resume tanpa otorisasi.',${context}::jsonb)
        ON CONFLICT DO NOTHING RETURNING id,task_code,status`);
      const created=inserted.rows[0];
      if(!created){const duplicate=await tx.execute(sql`SELECT id,task_code,status FROM ai_platform.ai_human_tasks WHERE source_module='ai_core_lifecycle' AND source_id=${sourceId} LIMIT 1`);return {kind:"existing" as const,task:duplicate.rows[0]};}
      await tx.execute(sql`INSERT INTO ai_platform.ai_human_task_history(task_id,action,performed_by,notes,new_status)
        VALUES(${created["id"]},'created',${actor},'Unassigned DEV human recovery review; OpenClaw not independently verified; resume locked','pending')`);
      return {kind:"created" as const,task:created};
    });
    if(outcome.kind==="not_found"){res.sendStatus(404);return;}
    if(outcome.kind==="not_ready"||outcome.kind==="verified_checkpoint"){
      res.status(409).json({error:outcome.kind==="verified_checkpoint"?"VERIFIED_CHECKPOINT_REQUIRES_AUTHORIZATION":"SOURCE_NOT_ELIGIBLE_FOR_HUMAN_REVIEW"});return;
    }
    res.setHeader("Cache-Control","no-store");
    res.status(outcome.kind==="created"?201:200).json({humanTask:outcome.task,reused:outcome.kind==="existing",resumeAllowed:false,picAssigned:false});
  }catch(error){logger.error({error,taskId},"DEV human review create failed");res.status(503).json({error:"HUMAN_REVIEW_UNAVAILABLE"});}
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
    if (accountAlias === "GPT02") {
      res.status(409).json({error:"GPT02_CONTINUATION_REQUIRES_NEW_AUTHORIZED_ADMISSION",
        dispatchNotStarted:true, sourceExecutionId:source.id});
      return;
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
    const [claimedContinuation] = await db.update(aiExecutionJobsTable)
      .set({ status: "dispatching", metadata: { ...asRecord(created.metadata), dispatchState: "dispatching_unconfirmed" } })
      .where(and(eq(aiExecutionJobsTable.id, created.id), eq(aiExecutionJobsTable.status, "queued"), isNull(aiExecutionJobsTable.commandId)))
      .returning();
    if (!claimedContinuation) { res.status(200).json({ reused: true }); return; }
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
        const [uncertain] = await db.update(aiExecutionJobsTable).set({ status: "dispatching", errorMessage: "AI_CORE_DISPATCH_OUTCOME_UNCONFIRMED", metadata: { ...asRecord(created.metadata), dispatchState: "dispatching_unconfirmed", lastDispatchError: message } }).where(eq(aiExecutionJobsTable.id, created.id)).returning();
        res.status(202).json({ execution: uncertain ?? created, outcomeUnconfirmed: true }); return;
      }
      const [failed] = await db.update(aiExecutionJobsTable).set({
        status: "failed", progress: Math.max(0, Math.min(90, created.progress)), errorMessage: message, completedAt: new Date(),
      }).where(eq(aiExecutionJobsTable.id, created.id)).returning();
      res.status(502).json({ error: "CONTINUATION_DISPATCH_REJECTED", execution: failed ?? created });
    }
  } catch (err) {
    logger.error({ err }, "POST task continuation failed");
    res.status(500).json({ error: "CONTINUATION_UNAVAILABLE" });
  }
});

// Read-only picker data. This is not a directory of authenticated approvers:
// team_members records establish assignment eligibility only.
router.get("/ai-tasks/:id/gpt02-pic-options", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV !== "development" || process.env.APP_ENV === "production") {
    res.sendStatus(404); return;
  }
  if (req.user?.role !== "super_admin") {
    res.status(403).json({error:"SUPER_ADMIN_REQUIRED"}); return;
  }
  const taskId=Number(req.params.id);
  if (!Number.isSafeInteger(taskId) || taskId<=0) {
    res.status(400).json({error:"INVALID_TASK_ID"}); return;
  }
  try {
    const companyId=getCompanyIdForWrite(req);
    const [task]=await db.select({id:aiTasksTable.id,status:aiTasksTable.status,
      assignedToId:aiTasksTable.assignedToId,assignedTo:aiTasksTable.assignedTo})
      .from(aiTasksTable)
      .where(and(eq(aiTasksTable.id,taskId),eq(aiTasksTable.companyId,companyId)))
      .limit(1);
    if (!task) { res.sendStatus(404); return; }
    const members=await db.select({id:teamMembersTable.id,name:teamMembersTable.name})
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.companyId,companyId),eq(teamMembersTable.isActive,true)))
      .orderBy(teamMembersTable.name).limit(100);
    const selected=members.find(m=>m.id===task.assignedToId && m.name===task.assignedTo);
    res.setHeader("Cache-Control","no-store");
    res.json({taskId:task.id,taskStatus:task.status,
      taskAssignmentPresent:!!selected,
      assignmentReady:!!selected && !["completed","cancelled"].includes(task.status),
      selectedMemberId:selected?.id??null,
      members:members.map(m=>({id:m.id,name:m.name})),
      choicesTruncated:members.length===100,
      taskOwnerAuthenticated:false,operatorApprovalGranted:false,
      commandDispatched:false});
  } catch (err) {
    logger.warn({err,taskId},"DEV GPT02 PIC options unavailable");
    res.status(503).json({error:"GPT02_PIC_OPTIONS_UNAVAILABLE"});
  }
});

// DEV-only audited PIC readback for a single company-scoped task.
// This deliberately never reports operator approval or native execution proof.
router.get("/ai-tasks/:id/gpt02-pic-audit", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV !== "development" || process.env.APP_ENV === "production") {
    res.sendStatus(404); return;
  }
  if (req.user?.role !== "super_admin") {
    res.status(403).json({error:"SUPER_ADMIN_REQUIRED"}); return;
  }
  const taskId=Number(req.params.id);
  if (!Number.isSafeInteger(taskId) || taskId<=0) {
    res.status(400).json({error:"INVALID_TASK_ID"}); return;
  }
  try {
    const companyId=getCompanyIdForWrite(req);
    const [task]=await db.select({
      id:aiTasksTable.id,assignedToId:aiTasksTable.assignedToId,
      assignedTo:aiTasksTable.assignedTo,
    }).from(aiTasksTable)
      .where(and(eq(aiTasksTable.id,taskId),eq(aiTasksTable.companyId,companyId))).limit(1);
    if (!task) { res.sendStatus(404); return; }
    const [audit]=await db.select({
      id:auditLogsTable.id,actorName:auditLogsTable.userName,
      actorEmail:auditLogsTable.userEmail,at:auditLogsTable.createdAt,
      after:auditLogsTable.after,
    }).from(auditLogsTable)
      .where(and(eq(auditLogsTable.companyId,companyId),
        eq(auditLogsTable.entityId,taskId),eq(auditLogsTable.action,"gpt02_pic_assigned")))
      .orderBy(desc(auditLogsTable.createdAt),desc(auditLogsTable.id)).limit(1);
    const payload=(()=>{
      try {return JSON.parse(audit?.after??"null") as unknown;}catch{return null;}
    })();
    const recorded=asRecord(payload);
    const actorIdentity=asRecord(recorded["actorIdentity"]);
    const actorId=typeof actorIdentity["id"]==="string" ? actorIdentity["id"] : null;
    const actorEmail=typeof actorIdentity["email"]==="string" ?
      actorIdentity["email"].trim().toLowerCase() : null;
    const auditMatchesCurrent=!!audit && actorId != null &&
      actorIdentity["role"]==="super_admin" &&
      (actorIdentity["version"]===1 || actorIdentity["version"]==="1") &&
      actorEmail===audit.actorEmail?.trim().toLowerCase() &&
      typeof recorded["memberId"]==="number" &&
      recorded["memberId"]===task.assignedToId &&
      recorded["memberName"]===task.assignedTo &&
      recorded["taskId"]===taskId && recorded["companyId"]===companyId;
    res.setHeader("Cache-Control","no-store");
    res.json({taskId,assignedMemberId:task.assignedToId,
      assignedTo:task.assignedTo,auditPresent:!!audit,
      auditMatchesCurrent,assignmentAudited:auditMatchesCurrent,
      auditId:audit?.id??null,actorId,
      actorName:audit?.actorName??null,assignedAt:audit?.at??null,
      operatorApprovalGranted:false,commandDispatched:false,
      nativeAckVerified:false});
  } catch (err) {
    logger.warn({err,taskId},"DEV GPT02 PIC audit readback unavailable");
    res.status(503).json({error:"GPT02_PIC_AUDIT_UNAVAILABLE"});
  }
});

// Explicit DEV-only PIC assignment for GPT02. No command or worker dispatch.
// Do not infer a team-member ID from a display name or supplied JWT claims.
router.post("/ai-tasks/:id/gpt02-assign-pic", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV !== "development" || process.env.APP_ENV === "production") {
    res.sendStatus(404); return;
  }
  if (req.user?.role !== "super_admin") {
    res.status(403).json({error:"SUPER_ADMIN_REQUIRED"}); return;
  }
  const taskId=Number(req.params.id);
  const memberId=(req.body as Record<string,unknown>)?.["memberId"];
  if (!Number.isSafeInteger(taskId) || taskId<=0 ||
      typeof memberId!=="number" || !Number.isSafeInteger(memberId) || memberId<=0) {
    res.status(400).json({error:"INVALID_TASK_OR_MEMBER_ID"}); return;
  }
  try {
    const companyId=getCompanyIdForWrite(req);
    const [member]=await db.select({id:teamMembersTable.id,name:teamMembersTable.name,
      isActive:teamMembersTable.isActive})
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.id,memberId),
        eq(teamMembersTable.companyId,companyId),eq(teamMembersTable.isActive,true)))
      .limit(1);
    if (!member || !member.name.trim()) {
      res.status(409).json({error:"ACTIVE_COMPANY_MEMBER_NOT_FOUND"}); return;
    }
    // The assignment and audit row must commit or roll back together. Never
    // claim that a PIC changed when the audit insert failed.
    const assigned=await db.transaction(async (tx) => {
      // Serialize the assignment check and write with new execution admission.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${companyId} || ':' || ${taskId}::text, 0))`);
      const [updated]=await tx.update(aiTasksTable)
        .set({assignedToId:member.id,assignedTo:member.name})
        .where(and(eq(aiTasksTable.id,taskId),eq(aiTasksTable.companyId,companyId),
          sql`${aiTasksTable.status} NOT IN ('completed','cancelled')`,
          // This guards already-committed executions; a separate serialization
          // mechanism is still required to close the concurrent intake race.
          sql`NOT EXISTS (
            SELECT 1 FROM ai_execution_jobs e
            WHERE e.task_id = ${taskId} AND e.company_id = ${companyId}
          )`))
        .returning({id:aiTasksTable.id,assignedToId:aiTasksTable.assignedToId,
          assignedTo:aiTasksTable.assignedTo});
      if (!updated) return null;
      await tx.insert(auditLogsTable).values({
        action:"gpt02_pic_assigned",
        module:"ai_tasks",
        entityType:"ai_task",
        entityId:taskId,
        companyId,
        // public.audit_logs.user_id is an integer legacy FK. Authenticated
        // Super Admin identities use a stable string subject (for example
        // google_*), so do not coerce that subject into the integer column.
        // Preserve the authoritative identity in the signed/read-back payload,
        // matching the already verified Task136 audit shape.
        userId:null,
        userEmail:req.user!.email,
        userName:req.user!.name,
        after:JSON.stringify({
          actorIdentity:{version:1,id:String(req.user!.id),
            email:req.user!.email.trim().toLowerCase(),role:"super_admin"},
          memberId:member.id,memberName:member.name,taskId,companyId,
          operatorApprovalGranted:false,commandDispatched:false}),
      });
      return updated;
    });
    if (!assigned) {
      res.status(409).json({error:"TASK_NOT_FOUND_TERMINAL_OR_ALREADY_EXECUTING"}); return;
    }
    res.setHeader("Cache-Control","no-store");
    res.status(200).json({taskId:assigned.id,memberId:assigned.assignedToId,
      assignedTo:assigned.assignedTo,memberRecordObserved:true,
      accountIdentityAttested:false,operatorApprovalGranted:false,
      commandDispatched:false});
  } catch (err) {
    logger.warn({err,taskId},"DEV GPT02 PIC assignment unavailable");
    res.status(503).json({error:"GPT02_PIC_ASSIGNMENT_UNAVAILABLE"});
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
    // Resolve GPT alias ONCE, before all lifecycle policy gates. This must
    // match the exact canonical alias used for dispatch and persisted records.
    const normalizedAccountAlias = typeof body.accountAlias === "string" &&
        /^GPT[0-9]{2,4}$/.test(body.accountAlias.trim().toUpperCase())
      ? body.accountAlias.trim().toUpperCase()
      : process.env.AI_TASK_DEFAULT_GPT_ALIAS?.trim().toUpperCase() || "GPT01";
    // Lifecycle-specific guard: never turn a new inquiry into an unowned AI command.
    // Keep the existing idempotent dispatch and reconciliation code below unchanged.
    if (body.lifecycleStart === true &&
        (body.mode !== "chatgpt" || normalizedAccountAlias !== "GPT02")) {
      res.status(409).json({error: "LIFECYCLE_ASSIGNMENT_OR_MODE_NOT_READY", message: "Lifecycle requires GPT02 ChatGPT mode."});
      return;
    }
    // DEV GPT02 full lifecycle is a different contract from the already proven
    // one-shot text transport (lifecycleStart=false). Its future pre-dispatch
    // authority must be minted by a separate trusted issuer after a Core task,
    // immutable attempt claim and independently consumed signed operator nonce
    // exist. None can be supplied as trustworthy request-body flags.
    // Stop BEFORE creating/reusing an execution or submitting a Core command.
    if (process.env.NODE_ENV === "development" && process.env.APP_ENV !== "production" &&
        body.lifecycleStart === true && body.mode === "chatgpt" && normalizedAccountAlias === "GPT02") {
      res.setHeader("Cache-Control", "no-store");
      res.status(409).json({
        error: "GPT02_LIFECYCLE_PRE_DISPATCH_PROOF_REQUIRED",
        blockers: ["CORE_TASK_NOT_PREPARED", "SIGNED_OPERATOR_APPROVAL_MISSING",
          "IMMUTABLE_PRE_DISPATCH_BINDING_MISSING", "OPERATOR_NONCE_NOT_CONSUMED",
          "ISSUER_LEASE_FENCING_NOT_VERIFIED"],
        dispatchNotStarted: true,
        continuationScheduled: false,
        message: "Lifecycle GPT02 DEV ditahan sampai seluruh bukti sebelum pengiriman tersedia. Uji teks satu kali tidak berubah.",
      });
      return;
    }
    let mode: "chatgpt" | "worker" = body.mode === "chatgpt" ? "chatgpt" : "worker";
    let accountAlias = normalizedAccountAlias;
    // Neither an omitted lifecycleStart flag nor the server default alias may
    // bypass the DEV GPT02 PIC gate. A recorded PIC is not identity attestation.
    if (mode === "chatgpt" && accountAlias === "GPT02") {
      // A display name alone is never a trusted PIC. Resolve the persisted
      // assignee FK within this exact company and recheck active membership
      // at dispatch time, rather than accepting caller-supplied metadata.
      if (!task.assignedToId || !task.assignedTo?.trim() ||
          ["completed", "cancelled"].includes(task.status)) {
        res.status(409).json({error: "GPT02_TASK_ASSIGNMENT_NOT_READY", message: "An active task with an assigned member ID is required."});
        return;
      }
      const [member] = await db.select({id:teamMembersTable.id,
        name:teamMembersTable.name,isActive:teamMembersTable.isActive})
        .from(teamMembersTable)
        .where(and(eq(teamMembersTable.id,task.assignedToId),
          eq(teamMembersTable.companyId,companyId)))
        .limit(1);
      if (!member || member.isActive !== true || member.name !== task.assignedTo) {
        res.status(409).json({error: "GPT02_PIC_IDENTITY_NOT_VERIFIED", message: "PIC must match an active team member in this company."});
        return;
      }
      // A matching team-member record establishes assignment integrity only;
      // it is not operator consent or independent worker authority.
    }
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

    // A new Hub/Core lifecycle reservation is inert until a separate trusted
    // issuer signs, stores and consumes the command-specific grant. A caller
    // must not reach the normal tracking/worker path by omitting lifecycleStart,
    // switching to worker mode, or substituting GPT01 for the persisted GPT02.
    // This is a permanent no-dispatch gate for the `prepared` phase, separate
    // from the user-authorized one-shot text path already proven by Task136.
    if (existing?.status === "prepared") {
      res.setHeader("Cache-Control", "no-store");
      res.status(409).json({
        error: "GPT02_PREPARED_HUB_CORE_REQUIRES_AUTHORIZED_ISSUER",
        reservedExecutionId: existing.id,
        dispatchNotStarted: true,
        continuationScheduled: false,
        message: "Reservasi Hub/Core belum memiliki persetujuan dan nonce sah; tidak ada command dikirim.",
      });
      return;
    }

    if (existing && !["failed", "blocked", "cancelled"].includes(existing.status)) {
      scheduleExecutionTracking(existing.id);
      const events = await db.select().from(aiExecutionEventsTable)
        .where(eq(aiExecutionEventsTable.executionId, existing.id))
        .orderBy(aiExecutionEventsTable.createdAt);
      res.status(200).json({ execution: existing, events, reused: true });
      return;
    }

    if (existing) {
      // A GPT02 retry is not a fresh authorized admission. The original
      // execution may predate PIC/audit binding, and a retry cannot assume
      // that its old command identity is safe to wake again.
      if ((mode === "chatgpt" && accountAlias === "GPT02") ||
          asRecord(existing.metadata)["accountAlias"] === "GPT02") {
        res.status(409).json({
          error: "GPT02_EXISTING_ATTEMPT_REQUIRES_AUTHORIZED_RECOVERY",
          executionId: existing.id,
          dispatchNotStarted: true,
          message: "Use supervised existing-attempt reconciliation; automatic GPT02 retry is disabled.",
        });
        return;
      }
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
          autoContinue: mode === "chatgpt" && accountAlias !== "GPT02" &&
            (body.lifecycleStart === true || task.category === "ai_chat"),
          ...(mode === "chatgpt" ? { accountAlias } : {}),
        },
      }).where(and(
        eq(aiExecutionJobsTable.id, existing.id),
        inArray(aiExecutionJobsTable.status, ["failed", "blocked", "cancelled"]),
        ...(mode === "chatgpt" ? [isNull(aiExecutionJobsTable.commandId)] : []),
      )).returning();
      if (!reset) {
        const [current] = await db.select().from(aiExecutionJobsTable)
          .where(eq(aiExecutionJobsTable.id, existing.id)).limit(1);
        res.status(200).json({ execution: current ?? existing, reused: true, dispatchNotStarted: true });
        return;
      }
      execution = reset;
    } else {
      const correlationId = randomUUID();
      const idempotencyKey = `${externalId}:${correlationId}`;
      const created = await db.transaction(async (tx) => {
        // Cross-instance fence shared with the PIC assignment transaction.
        // The lock lasts through task readback and the new execution insert.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${companyId} || ':' || ${taskId}::text, 0))`);
        const [currentTask] = await tx.select({
          assignedToId:aiTasksTable.assignedToId,
          assignedTo:aiTasksTable.assignedTo,
          status:aiTasksTable.status,
        }).from(aiTasksTable)
          .where(and(eq(aiTasksTable.id,taskId),eq(aiTasksTable.companyId,companyId))).limit(1);
        if (!currentTask || (mode === "chatgpt" && accountAlias === "GPT02" &&
            ["completed","cancelled"].includes(currentTask.status))) {
          throw new Error("GPT02_TASK_CHANGED_DURING_ADMISSION");
        }
        if (mode === "chatgpt" && accountAlias === "GPT02" &&
            (currentTask.assignedToId !== task.assignedToId ||
             currentTask.assignedTo !== task.assignedTo)) {
          throw new Error("GPT02_PIC_CHANGED_DURING_ADMISSION");
        }
        // The caller must not bypass the dashboard's audit gate by invoking
        // the dispatch API directly. Read the audit inside the admission lock.
        let verifiedPicAuditId: number | null = null;
        if (mode === "chatgpt" && accountAlias === "GPT02") {
          const [latestAudit]=await tx.select({
            id:auditLogsTable.id,after:auditLogsTable.after,
            actorEmail:auditLogsTable.userEmail,
          }).from(auditLogsTable)
            .where(and(eq(auditLogsTable.companyId,companyId),
              eq(auditLogsTable.entityId,taskId),
              eq(auditLogsTable.action,"gpt02_pic_assigned")))
            .orderBy(desc(auditLogsTable.createdAt),desc(auditLogsTable.id)).limit(1);
          let auditPayload: Record<string, unknown> = {};
          try { auditPayload=asRecord(JSON.parse(latestAudit?.after??"null")); }
          catch { auditPayload={}; }
          const actorIdentity=asRecord(auditPayload["actorIdentity"]);
          const actorEmail=typeof actorIdentity["email"]==="string" ?
            actorIdentity["email"].trim().toLowerCase() : null;
          if (!latestAudit ||
              actorIdentity["role"]!=="super_admin" ||
              (actorIdentity["version"]!==1 && actorIdentity["version"]!=="1") ||
              typeof actorIdentity["id"]!=="string" ||
              actorEmail!==latestAudit.actorEmail?.trim().toLowerCase() ||
              auditPayload["memberId"]!==currentTask.assignedToId ||
              auditPayload["memberName"]!==currentTask.assignedTo ||
              auditPayload["companyId"]!==companyId ||
              auditPayload["taskId"]!==taskId) {
            throw new Error("GPT02_PIC_AUDIT_NOT_VERIFIED");
          }
          verifiedPicAuditId=latestAudit.id;
        }
        return tx.insert(aiExecutionJobsTable).values({
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
          autoContinue: mode === "chatgpt" && accountAlias !== "GPT02" &&
            (body.lifecycleStart === true || task.category === "ai_chat"),
          continuationDepth: 0,
          ...(mode === "chatgpt" ? { accountAlias } : {}),
          ...(verifiedPicAuditId !== null ?
            { picAssignmentAuditId:verifiedPicAuditId, picAssignedMemberId:currentTask.assignedToId } : {}),
        },
        }).onConflictDoNothing().returning().then(rows => rows[0] ?? null);
      });
      if (!created) {
        const [collision] = await db.select().from(aiExecutionJobsTable)
          .where(and(eq(aiExecutionJobsTable.source, "AI_TASK"), eq(aiExecutionJobsTable.externalId, externalId))).limit(1);
        if (!collision) throw new Error("EXECUTION_IDEMPOTENCY_CONFLICT");
        res.status(200).json({ execution: collision, reused: true });
        return;
      }
      execution = created;
    }

    // Cross-instance first-dispatch claim. A committed claim survives a crash,
    // keeping uncertain work out of the automatic retry queue.
    if (mode === "chatgpt") {
      const [claimed] = await db.update(aiExecutionJobsTable).set({
        status: "dispatching",
        metadata: { ...asRecord(execution.metadata), dispatchState: "dispatching_unconfirmed" },
      }).where(and(
        eq(aiExecutionJobsTable.id, execution.id),
        eq(aiExecutionJobsTable.status, "queued"),
        isNull(aiExecutionJobsTable.commandId),
      )).returning();
      if (!claimed) {
        const [current] = await db.select().from(aiExecutionJobsTable)
          .where(eq(aiExecutionJobsTable.id, execution.id)).limit(1);
        res.status(200).json({ execution: current ?? execution, reused: true });
        return;
      }
      execution = claimed;
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
          // An ordinary worker's 422 reasoning route is not an independently
          // approved GPT02 task attempt. Never promote it to GPT02 without
          // the locked and audited GPT02 admission workflow.
          if (accountAlias === "GPT02") {
            throw new Error("GPT02_REASONING_HANDOFF_REQUIRES_AUTHORIZED_ADMISSION");
          }
          mode = "chatgpt";
          const handoffMetadata = {
            ...executionMeta,
            verificationMode: "chatgpt-attested",
            reasoningHandoff: true,
            accountAlias,
            autoContinue: accountAlias !== "GPT02" && task.category === "ai_chat",
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
      // Once a dispatch was attempted, 429/503 does not prove that AI Core
      // rejected it before enqueueing. Preserve the existing identity and
      // require reconciliation instead of an automatic second dispatch.
      if (mode === "chatgpt" && isRetryableChatGptDispatchError(message)) {
        const [uncertain] = await db.update(aiExecutionJobsTable).set({
          status: "dispatching",
          errorMessage: "AI_CORE_DISPATCH_OUTCOME_UNCONFIRMED",
          metadata: {
            ...asRecord(execution.metadata),
            dispatchState: "dispatching_unconfirmed",
            lastDispatchError: message,
            lastDispatchAttemptAt: new Date().toISOString(),
          },
        }).where(eq(aiExecutionJobsTable.id, execution.id)).returning();
        res.status(202).json({ execution: uncertain ?? execution, outcomeUnconfirmed: true });
        return;
      }

      const [failed] = await db.update(aiExecutionJobsTable).set({
        status: "failed",
        progress: Math.max(0, Math.min(90, execution.progress)),
        errorMessage: message,
        completedAt: new Date(),
      }).where(eq(aiExecutionJobsTable.id, execution.id)).returning();
      if (failed) void notifyAiJobTransition(failed).catch((err) => logger.warn({ err, executionId: failed.id }, "Failed job WhatsApp notification deferred"));
      res.status(502).json({ error: "AI Core dispatch failed", execution: failed ?? execution });
    }
  } catch (err) {
    if (err instanceof Error && ["GPT02_TASK_CHANGED_DURING_ADMISSION",
        "GPT02_PIC_CHANGED_DURING_ADMISSION",
        "GPT02_PIC_AUDIT_NOT_VERIFIED"].includes(err.message)) {
      res.status(409).json({error:err.message,dispatchNotStarted:true});
      return;
    }
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


// DEV-only, exact task/execution/Core/claim/nonce/final-ACK readback.
// A diagnostic is NEVER a permit to dispatch, resume, or complete work.
router.get("/ai-tasks/:id/gpt02-lineage", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV !== "development" || process.env.APP_ENV === "production") {
    res.sendStatus(404); return;
  }
  if (req.user?.role !== "super_admin") {
    res.status(403).json({ error: "SUPER_ADMIN_REQUIRED" }); return;
  }
  const taskId = Number(req.params.id);
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    res.status(400).json({ error: "INVALID_TASK_ID" }); return;
  }
  try {
    const companyId = getCompanyIdForWrite(req);
    // Every subrecord belongs to this exact tenant/task/latest DEV execution.
    // A different GPT02 command's completed ACK never grants completion here.
    const result = await db.execute(sql`
      SELECT t.id AS task_id, t.status AS task_status,
        t.assigned_to AS pic_name, t.assigned_to_id,
        pic.id AS verified_pic_id,
        j.id::text AS execution_id, j.status AS execution_status,
        j.command_id::text AS command_id, j.correlation_id::text AS correlation_id,
        COALESCE(j.callback_verified,false) AS callback_verified,
        COALESCE(j.attestation_verified,false) AS attestation_verified,
        COALESCE(j.final_ack_verified,false) AS final_ack_verified,
        (c.id IS NOT NULL) AS core_command_found,
        c.task_id::text AS core_task_id, (ct.id IS NOT NULL) AS core_task_found,
        c.status AS core_status,
        bc.id::text AS claim_id, bc.binding_verified,
        bc.attempt_id::text AS claim_attempt_id,
        bc.core_coding_task_id::text AS claim_core_task_id,
        bc.assignee_id AS claim_assignee_id,
        bc.operator_user_id AS claim_operator_id,
        n.nonce::text AS nonce, n.may_issue_grant AS nonce_grant_allowed,
        n.may_dispatch_worker AS nonce_dispatch_allowed,
        bc.may_dispatch_worker AS claim_dispatch_allowed,
        bc.may_close_job AS claim_close_allowed,
        (SELECT COUNT(*)::integer
         FROM ai_platform.ai_coding_bridge_responses r
         WHERE r.command_id=j.command_id AND r.kind='COMPLETED'
           AND r.acknowledged_at IS NOT NULL
           AND r.metadata_json->>'e2eCode'='E2E_VERIFIED'
           AND r.metadata_json->>'deliveryCode'='DELIVERY_CONFIRMED'
           AND r.metadata_json->>'verifiedAssistantReply'='true'
           AND r.metadata_json->>'browserPairingVerified'='true')
          AS verified_completed_responses,
        COALESCE(j.metadata->>'verificationMode'='chatgpt-attested'
          AND c.command_type='EXTERNAL_AGENT_WORK' AND c.source='ai-core'
          AND c.metadata_json->>'source'='authorized-dev-browser-wake'
          AND c.metadata_json->>'capability'='chatgpt:wake',false) AS direct_wake_route,
        COALESCE(j.metadata->>'environment'='development'
          AND j.metadata->>'accountAlias'='GPT02'
          AND j.external_id='ai-task:' || COALESCE(NULLIF(LEFT(regexp_replace(t.company_id,'[^a-zA-Z0-9_-]','_','g'),100),''),'default') || ':' || t.id::text
          AND j.metadata->>'remoteCorrelationId'=j.external_id || ':' || j.correlation_id::text
          AND c.metadata_json->>'correlationId'=j.metadata->>'remoteCorrelationId'
          AND c.metadata_json->>'devOnly'='true'
          AND j.worker_id='openclaw-dell-chatgpt-wake-dev'
          AND c.metadata_json->>'assignedClientId'=j.worker_id
          AND c.metadata_json->'wakeBinding'->>'workerId'=j.worker_id
          AND c.metadata_json->'wakeBinding'->>'accountAlias'='GPT02'
          AND c.metadata_json->'wakeBinding'->>'browserProfile'='gpt02-dell-dev'
          AND c.metadata_json->'wakeBinding'->>'targetConversationId'=c.metadata_json->>'targetConversationId'
          AND c.metadata_json->'wakeBinding'->>'bindingFingerprint' ~ '^[a-f0-9]{64}$'
          AND c.metadata_json->>'eventId' ~ '^[a-f0-9]{64}$'
          AND c.metadata_json->>'assistantAttestationChallenge' ~ '^[a-f0-9]{64}$',false) AS transport_context_matched,
        receipt_proof.total_count AS completed_response_count,
        receipt_proof.exact_count AS exact_native_response_count,
        receipt_proof.response_id AS completion_response_id,
        receipt_proof.acknowledged_at AS completion_acknowledged_at
      FROM public.ai_tasks t
      LEFT JOIN LATERAL (
        SELECT id,task_id,company_id,source,status,command_id,correlation_id,
          callback_verified,attestation_verified,final_ack_verified,metadata,external_id,worker_id
        FROM public.ai_execution_jobs
        WHERE task_id=t.id AND company_id=t.company_id
          AND source='AI_TASK' AND metadata->>'environment'='development'
        ORDER BY created_at DESC,id DESC LIMIT 1
      ) j ON true
      LEFT JOIN public.team_members pic
        ON pic.id=t.assigned_to_id AND pic.company_id=t.company_id
       AND pic.name=t.assigned_to AND pic.is_active IS TRUE
      LEFT JOIN ai_platform.ai_coding_bridge_commands c ON c.id=j.command_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::integer AS total_count,
          COUNT(*) FILTER(WHERE exact_match)::integer AS exact_count,
          MAX(receipt.id::text) FILTER(WHERE exact_match) AS response_id,
          (MAX(receipt.acknowledged_at) FILTER(WHERE exact_match))::text AS acknowledged_at
        FROM (
          SELECT r.id,r.acknowledged_at,
            COALESCE(r.acknowledged_at IS NOT NULL
              AND r.metadata_json->>'e2eCode'='E2E_VERIFIED'
              AND r.metadata_json->>'deliveryCode'='DELIVERY_CONFIRMED'
              AND r.metadata_json->>'verifiedAssistantReply'='true'
              AND r.metadata_json->>'browserPairingVerified'='true'
              AND r.metadata_json->>'workerId'=c.metadata_json->>'assignedClientId'
              AND r.metadata_json->>'eventId'=c.metadata_json->>'eventId'
              AND r.metadata_json->>'challenge'=c.metadata_json->>'assistantAttestationChallenge'
              AND r.metadata_json->>'bindingFingerprint'=c.metadata_json->'wakeBinding'->>'bindingFingerprint'
              AND r.metadata_json->>'browserProfile'=c.metadata_json->'wakeBinding'->>'browserProfile'
              AND r.metadata_json->>'conversationId'=c.metadata_json->>'targetConversationId'
              AND r.metadata_json->'attestation'->>'version'='2'
              AND r.metadata_json->'attestation'->>'algorithm'='Ed25519'
              AND r.metadata_json->'attestation'->>'workerId'=c.metadata_json->>'assignedClientId'
              AND r.metadata_json->'attestation'->>'eventId'=c.metadata_json->>'eventId'
              AND r.metadata_json->'attestation'->>'challenge'=c.metadata_json->>'assistantAttestationChallenge'
              AND r.metadata_json->'attestation'->>'bindingFingerprint'=c.metadata_json->'wakeBinding'->>'bindingFingerprint'
              AND r.metadata_json->'attestation'->>'browserProfile'=c.metadata_json->'wakeBinding'->>'browserProfile'
              AND r.metadata_json->'attestation'->>'conversationId'=c.metadata_json->>'targetConversationId'
              AND r.message=r.metadata_json->>'assistantResponseText'
              AND r.message=r.metadata_json->'attestation'->>'assistantResponseText'
              AND r.metadata_json->'attestation'->>'assistantResponseHash' ~ '^[a-f0-9]{64}$'
              AND length(r.metadata_json->'attestation'->>'signature')>0,false) AS exact_match
          FROM ai_platform.ai_coding_bridge_responses r
          WHERE r.command_id=c.id AND r.kind='COMPLETED'
        ) receipt
      ) receipt_proof ON true
      LEFT JOIN ai_platform.ai_coding_tasks ct ON ct.id=c.task_id
      LEFT JOIN ai_platform.dev_gpt02_task_attempt_binding_claims bc
        ON bc.tenant_id=t.company_id AND bc.hub_ai_task_id=t.id
       AND bc.hub_execution_job_id=j.id AND bc.core_command_id=c.id
       AND bc.core_coding_task_id=c.task_id AND bc.assignee_id=pic.id
      LEFT JOIN ai_platform.dev_gpt02_binding_attestation_nonces n
        ON n.tenant_id=t.company_id AND n.hub_execution_job_id=j.id
       AND n.core_command_id=c.id AND n.attempt_id=bc.attempt_id
       AND n.evidence_sha256=bc.evidence_sha256
       AND n.operator_user_id=bc.operator_user_id
       AND n.expires_at>clock_timestamp()
      WHERE t.id=${taskId} AND t.company_id=${companyId}
      LIMIT 2
    `);
    if (result.rows.length === 0) { res.sendStatus(404); return; }
    if (result.rows.length !== 1) {
      res.status(409).json({ error: "AMBIGUOUS_GPT02_LINEAGE", readOnly: true,
        dispatchPermitted: false }); return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...evaluateGpt02LineageEvidence(result.rows[0] as never),
      executionOutcome: evaluateGpt02ExecutionOutcome(result.rows[0] as never) });
  } catch (err) {
    logger.warn({ err, taskId }, "DEV GPT02 exact lineage diagnostic unavailable");
    res.status(503).json({ error: "GPT02_LINEAGE_DIAGNOSTIC_UNAVAILABLE",
      dispatchPermitted: false, completionPermitted: false });
  }
});

export default router;
