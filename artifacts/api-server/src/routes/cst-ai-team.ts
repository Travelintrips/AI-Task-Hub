import { randomUUID, createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db, aiExecutionJobsTable as jobs, aiExecutionEventsTable as events, aiTasksTable as tasks } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { canReadDevTeam, canRunDevTeam, canaryVerdict, canaryLedgerVerdict, projectCstOperationalTaskBinding, projectCanaryStatus, projectIndependentTeamGate, TEAM_SOURCE, TEAM_ROLES, type TeamRole } from "../lib/cst-ai-team-contract";
import { fetchCstTeamAgentReadiness } from "../lib/cst-ai-team-agent-readiness";
import { EXTERNAL_REVIEW_SOURCE, EXTERNAL_REVIEW_PROOF, EXTERNAL_REVIEW_SCENARIO, EXTERNAL_TEAM_AGENTS, canRunExternalReview, isExternalReviewStart, parseExternalObservation, checkExternalObservation, projectExternalObservations, validatePriorReviewEvidence, projectExternalReviewStatus, parseExternalReviewFailure, EXTERNAL_QA_LOCAL_FALLBACK, externalObservationWorkerId } from "../lib/cst-ai-team-external-review";

const router: IRouter = Router();
const active = new Set<string>();
function allow(req: Request, res: Response, requireCanary = false): string | null {
  if (!canReadDevTeam() || (requireCanary && !canRunDevTeam())) { res.sendStatus(404); return null; }
  if (req.user?.role !== "super_admin") { res.status(403).json({ error: "SUPER_ADMIN_REQUIRED" }); return null; }
  const company = req.query.companyId;
  if (company !== "1") {
    res.status(403).json({ error: "CST_COMPANY_1_ONLY" }); return null;
  }
  return company;
}
async function fetchRun(runId: string, company: string) {
  const [run] = await db.select().from(jobs)
    .where(and(eq(jobs.id, runId), eq(jobs.companyId, company), eq(jobs.source, TEAM_SOURCE))).limit(1);
  if (!run) return null;
  const history = await db.select().from(events)
    .where(and(eq(events.executionId, runId), eq(events.companyId, company)))
    .orderBy(events.createdAt);
  const steps = history.filter(e => TEAM_ROLES.includes(e.phase as TeamRole)).map(e => ({
    id: e.id, role: e.phase, status: e.status, at: e.createdAt,
    message: e.message, evidence: e.eventType === "team.completed" || e.eventType === "team.failed" ? e.payload : null,
  }));
  const confirmed = canaryLedgerVerdict(history);
  const projected = projectCanaryStatus(run.status, run.createdAt);
  return {
    id: run.id, companyId: run.companyId, title: run.title,
    status: projected.status, progress: run.progress,
    createdAt: run.createdAt, completedAt: run.completedAt,
    resultSummary: run.resultSummary,
    errorMessage: projected.stale ? "CANARY_INTERRUPTED_OR_STALE" : run.errorMessage, steps,
    verifiedComplete: !projected.stale && run.status === "completed" && confirmed,
    proofLevel: "DEV_LOCAL_CANARY_NOT_SIGNED",
    callbackVerified: run.callbackVerified, attestationVerified: run.attestationVerified,
    finalAckVerified: run.finalAckVerified,
  };
}
/** Global Core coding capacity only; no task details, tenant data, or DB writes.
 * Independent execution remains BLOCKED without four external worker receipts
 * and an independent QA Final ACK, regardless of raw capacity counts.
 */
async function fetchIndependentTeamGate() {
  if (!canReadDevTeam()) return projectIndependentTeamGate(null);
  try {
    const result = await db.execute(sql<{
      registered_coding_workers: number;
      active_leased_coding_workers: number;
      recorded_ai_handoffs: number;
      available_ollama_coding_slots: number;
    }>`
      SELECT
        (SELECT count(*)::int FROM ai_platform.ai_workers
          WHERE worker_type='coding_worker') AS registered_coding_workers,
        (SELECT count(*)::int FROM ai_platform.ai_workers
          WHERE worker_type='coding_worker'
            AND lease_expires_at > now()
            AND status IN ('online','idle','busy')) AS active_leased_coding_workers,
        (SELECT count(*)::int
          FROM ai_platform.ai_coding_workstream_ai_handoffs) AS recorded_ai_handoffs,
        (SELECT coalesce(sum(greatest(1 - running_jobs, 0)), 0)::int
          FROM ai_platform.ai_workers
          WHERE provider_slug = 'ollama'
            AND status IN ('online', 'idle', 'busy')
            AND lease_expires_at > now()
            AND (
              (runtime_kind = 'ollama_worker'
                AND endpoint_url IS NOT NULL
                AND capabilities @> '["ollama_inference","coding_ai_execution"]'::jsonb)
              OR
              (runtime_kind = 'ollama_remote_pull'
                AND endpoint_url IS NULL
                AND capabilities @> '["ollama_inference"]'::jsonb)
            )
        ) AS available_ollama_coding_slots
    `);
    const row = result.rows[0];
    if (!row) return projectIndependentTeamGate(null);
    return projectIndependentTeamGate({
      registeredCodingWorkers: Number(row.registered_coding_workers),
      activeLeasedCodingWorkers: Number(row.active_leased_coding_workers),
      recordedAiHandoffs: Number(row.recorded_ai_handoffs),
      availableOllamaCodingSlots: Number(row.available_ollama_coding_slots),
    });
  } catch {
    return projectIndependentTeamGate(null);
  }
}

router.get("/cst-ai-team/monitor", requireAuth, async (req: Request, res: Response) => {
  const company = allow(req, res); if (!company) return;
  try {
    const rows = await db.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.companyId, company), eq(jobs.source, TEAM_SOURCE)))
      .orderBy(desc(jobs.createdAt)).limit(12);
    const [runs, agentReadiness, operationalProbes, independentTeamGate] = await Promise.all([
      Promise.all(rows.map(r => fetchRun(r.id, company))),
      fetchCstTeamAgentReadiness(),
      // Existing Company-1 execution ledger only. Internal E2E records stay
      // separate from local canaries and never gain completion by projection.
      db.select({
        id: jobs.id, taskId: jobs.taskId, title: jobs.title, status: jobs.status,
        companyId: jobs.companyId, taskCompanyId: tasks.companyId,
        source: jobs.source, externalId: jobs.externalId,
        progress: jobs.progress, commandId: jobs.commandId,
        resultSummary: jobs.resultSummary, completedAt: jobs.completedAt,
        assignedClientId: jobs.assignedClientId, workerId: jobs.workerId,
        errorMessage: jobs.errorMessage, callbackVerified: jobs.callbackVerified,
        attestationVerified: jobs.attestationVerified, finalAckVerified: jobs.finalAckVerified,
        createdAt: jobs.createdAt,
      }).from(jobs).innerJoin(tasks, and(
        eq(jobs.taskId, tasks.id), eq(tasks.companyId, company),
      )).where(and(
        eq(jobs.companyId, company),
        eq(jobs.source, "AI_TASK"),
        like(jobs.title, "[INTERNAL-E2E]%"),
      )).orderBy(desc(jobs.createdAt)).limit(8),
      fetchIndependentTeamGate(),
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.json({ companyId: company, roles: TEAM_ROLES, runs: runs.filter(Boolean),
      agentReadiness, operationalProbes, independentTeamGate, canRunCanary: canRunDevTeam(),
      operationalTaskBinding: projectCstOperationalTaskBinding(company, operationalProbes),
      mode: "DEV_PRESENCE_AND_LOCAL_CANARY_ONLY", authority: "NO_GPT02_DISPATCH_NO_PROD" });
  } catch (err) {
    logger.error({ err }, "CST team monitor read failed");
    res.status(500).json({ error: "TEAM_MONITOR_READ_FAILED" });
  }
});
async function runCoordinatedCanary(id: string, company: string): Promise<void> {
  const record = async (role: TeamRole, status: "started" | "completed" | "failed", message: string,
    proof: Record<string, unknown> = {}) => {
    await db.insert(events).values({
      executionId: id, companyId: company, eventId: randomUUID(), eventType: "team." + status,
      phase: role, status, message, workerId: "cst-team-dev-" + role,
      signatureVerified: false, payload: { ...proof, proofLevel: "DEV_LOCAL_CANARY_NOT_SIGNED" },
    });
  };
  async function step(role: TeamRole, check: () => Promise<Record<string, unknown>>) {
    await record(role, "started", role + " started");
    try {
      const proof = await check();
      if (proof.ok !== true) throw Error("CHECK_FAILED");
      await record(role, "completed", role + " PASS", proof);
      return { role, status: "completed", ok: true };
    } catch (e) {
      await record(role, "failed", role + " FAIL", {
        ok: false, reason: e instanceof Error ? e.message : "UNKNOWN" });
      return { role, status: "failed", ok: false };
    }
  }
  try {
    // Each role runs an actual bounded check, not an invented model response.
    const first = await Promise.all([
      step("coding", async () => {
        const [found] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, id)).limit(1);
        return { ok: found?.id === id, check: "real_ledger_contract_read",
          digest: createHash("sha256").update("cst-team-canary-v1").digest("hex") };
      }),
      step("infrastructure", async () => {
        const port = Number(process.env.PORT || 8080);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("INVALID_PORT");
        const response = await fetch("http://127.0.0.1:" + port + "/api/healthz",
          { signal: AbortSignal.timeout(4000) });
        const body: unknown = await response.json();
        if (!response.ok || !body || typeof body !== "object" ||
          (body as {status?: unknown}).status !== "ok") throw Error("HEALTH_CHECK_FAILED");
        return { ok: true, check: "real_local_http_health", statusCode: response.status };
      }),
      step("security", async () => {
        if (!canRunDevTeam() || (process.env.SESSION_SECRET ?? "").length < 32 ||
          process.env.SESSION_SECRET === "fallback-secret-change-in-production") {
          throw Error("DEV_AUTH_POLICY_NOT_SATISFIED");
        }
        return { ok: true, check: "dev_only_existing_session_guard", companyId: company };
      }),
    ]);
    const qa = await step("qa", async () => {
      const history = await db.select().from(events)
        .where(and(eq(events.executionId, id), eq(events.companyId, company)));
      const saved = history.filter(e => e.eventType === "team.completed")
        .map(e => ({ role: e.phase, status: e.status, ok: (e.payload as Record<string, unknown>).ok === true }));
      const ok = first.every(e => e.ok) &&
        ["coding", "infrastructure", "security"].every(role => saved.some(e => e.role === role && e.ok));
      if (!ok) throw Error("PERSISTED_EVIDENCE_INCOMPLETE");
      return { ok: true, check: "persisted_evidence_reconciliation", savedChecks: 3 };
    });
    const passed = canaryVerdict([...first, qa]);
    await db.update(jobs).set({
      status: passed ? "completed" : "failed", progress: passed ? 100 : 0,
      resultSummary: passed ? "Four independent DEV checks persisted; no GPT02 signing/dispatch" : null,
      errorMessage: passed ? null : "ROLE_EVIDENCE_INCOMPLETE",
      completedAt: new Date(), updatedAt: new Date(),
      // Never fake callbackVerified, attestationVerified, or finalAckVerified.
    }).where(and(eq(jobs.id, id), eq(jobs.companyId, company)));
  } catch (err) {
    logger.error({ err, id }, "CST canary coordinator error");
    await db.update(jobs).set({ status: "failed", errorMessage: "COORDINATOR_ERROR",
      completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.companyId, company)))
      .catch(e => logger.error({ err: e, id }, "CST canary error persistence failed"));
  } finally { active.delete(company); }
}
router.post("/cst-ai-team/runs", requireAuth, async (req: Request, res: Response) => {
  const company = allow(req, res, true); if (!company) return;
  if (req.body?.scenario !== "dev_read_only_canary" || Object.keys(req.body ?? {}).length !== 1) {
    res.status(400).json({ error: "ONLY_PREDEFINED_READ_ONLY_CANARY_SUPPORTED" }); return;
  }
  if (active.has(company)) { res.status(409).json({ error: "CANARY_ALREADY_RUNNING" }); return; }
  active.add(company);
  try {
    const id = randomUUID();
    const [run] = await db.insert(jobs).values({
      id, companyId: company, source: TEAM_SOURCE, externalId: "team-canary:" + id,
      idempotencyKey: "team-canary:" + id,
      title: "CST AI Team — coordinated four-role DEV canary",
      instruction: "Bounded read-only coding, infrastructure, security and QA checks",
      workerType: "local-dev-role-coordinator", status: "processing",
      startedAt: new Date(),
      metadata: { scenario: "dev_read_only_canary", noProd: true, noSigning: true,
        noDispatch: true, actor: req.user?.id },
    }).returning();
    void runCoordinatedCanary(id, company);
    res.status(202).json({ id: run.id, status: run.status, proofLevel: "DEV_LOCAL_CANARY_NOT_SIGNED" });
  } catch (err) {
    active.delete(company); logger.error({ err }, "CST canary admission failed");
    res.status(500).json({ error: "CANARY_ADMISSION_FAILED" });
  }
});
/** Explicit operator-collected review only; not native OpenClaw handoff. */
async function fetchExternalReview(runId: string, company: string) {
  const [run] = await db.select().from(jobs).where(and(
    eq(jobs.id, runId), eq(jobs.companyId, company), eq(jobs.source, EXTERNAL_REVIEW_SOURCE),
  )).limit(1);
  if (!run) return null;
  const challenge = typeof run.metadata.reviewChallenge === "string" ? run.metadata.reviewChallenge : "";
  const history = await db.select().from(events).where(and(
    eq(events.executionId, runId), eq(events.companyId, company),
  )).orderBy(events.createdAt);
  const integrity = projectExternalObservations(history, challenge);
  const projected = projectExternalReviewStatus(run.status, run.createdAt);
  return { id: run.id, createdAt: run.createdAt, status: projected.status,
    expired: projected.expired, failureReason: projected.failureReason ?? run.errorMessage,
    ...integrity,
    observations: history.filter(e => e.eventType === "team.external.observed")
      .map(e => ({ role: e.phase, host: (e.workerId ?? "").split(":")[1] ?? null,
        agentId: (e.workerId ?? "").split(":")[2] ?? null,
        sourceKind: (e.workerId ?? "").split(":")[0] ?? null,
        result: e.payload.result ?? null, summaryCode: e.payload.summaryCode ?? null,
        at: e.createdAt, signatureVerified: false })),
  };
}

router.get("/cst-ai-team/external-reviews", requireAuth, async (req: Request, res: Response) => {
  const company = allow(req, res); if (!company) return;
  try {
    const rows = await db.select({id: jobs.id}).from(jobs)
      .where(and(eq(jobs.companyId,company), eq(jobs.source,EXTERNAL_REVIEW_SOURCE)))
      .orderBy(desc(jobs.createdAt)).limit(8);
    const reviews = (await Promise.all(rows.map(r => fetchExternalReview(r.id,company)))).filter(Boolean);
    res.setHeader("Cache-Control","no-store");
    res.json({companyId:company, mode:EXTERNAL_REVIEW_PROOF, reviews,
      operationalVerified:false, independentFinalAckVerified:false,
      admissionEnabled:canRunExternalReview()});
  } catch (err) { logger.warn({err},"External review read failed");
    res.status(500).json({error:"EXTERNAL_REVIEW_READ_FAILED"}); }
});

router.post("/cst-ai-team/external-reviews", requireAuth, async (req: Request, res: Response) => {
  const company = allow(req,res,true); if (!company) return;
  if (!canRunExternalReview()) { res.status(404).json({error:"EXTERNAL_REVIEW_DISABLED"}); return; }
  if (!isExternalReviewStart(req.body)) { res.status(400).json({error:"REVIEW_SCENARIO_INVALID"}); return; }
  try {
    const id = randomUUID(), challenge = randomUUID();
    const [run] = await db.insert(jobs).values({ id, companyId:company,
      source:EXTERNAL_REVIEW_SOURCE, externalId:`external-review:${id}`,
      idempotencyKey:`external-review:${id}`,
      title:"CST AI Team — operator-collected external review DEV",
      instruction:"Read-only observations only; no runtime dispatch or signing",
      workerType:"operator-collected-text-observations",status:"processing",startedAt:new Date(),
      metadata:{scenario:EXTERNAL_REVIEW_SCENARIO, reviewChallenge:challenge,
        proofLevel:EXTERNAL_REVIEW_PROOF, operatorId:req.user?.id,
        noDispatch:true,noSigning:true,noProd:true},
    }).returning({id:jobs.id});
    res.status(201).json({id:run.id,companyId:company,challenge,
      expectedAgents:EXTERNAL_TEAM_AGENTS,qaLocalFallback:EXTERNAL_QA_LOCAL_FALLBACK,
      proofLevel:EXTERNAL_REVIEW_PROOF,
      operationalVerified:false,independentFinalAckVerified:false});
  } catch(err) { logger.error({err},"External review admission failed");
    res.status(500).json({error:"EXTERNAL_REVIEW_ADMISSION_FAILED"}); }
});

router.post("/cst-ai-team/external-reviews/:id/observations",requireAuth,async(req:Request,res:Response)=>{
  const company=allow(req,res,true); if(!company)return;
  if(!canRunExternalReview()){res.sendStatus(404);return;}
  const id=String(req.params.id??"");
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)){
    res.status(400).json({error:"INVALID_REVIEW_ID"});return;
  }
  const observation=parseExternalObservation(req.body);
  if(!observation){res.status(400).json({error:"INVALID_UNATTESTED_OBSERVATION"});return;}
  try{
    const [run]=await db.select().from(jobs).where(and(
      eq(jobs.id,id),eq(jobs.companyId,company),eq(jobs.source,EXTERNAL_REVIEW_SOURCE),
    )).limit(1);
    if(!run){res.sendStatus(404);return;}
    if(run.status!=="processing" || projectExternalReviewStatus(run.status,run.createdAt).expired){
      res.status(409).json({error:"REVIEW_TERMINAL_OR_EXPIRED"});return;
    }
    const challenge=typeof run.metadata.reviewChallenge==="string"?run.metadata.reviewChallenge:"";
    if(!checkExternalObservation(observation,challenge)){
      res.status(403).json({error:"REVIEW_CHALLENGE_OR_AGENT_MISMATCH"});return;
    }
    const existing=await db.select().from(events).where(and(
      eq(events.executionId,id),eq(events.companyId,company),
    )).orderBy(events.createdAt);
    if(observation.role==="qa" && !validatePriorReviewEvidence(existing,challenge)){
      res.status(409).json({error:"QA_REQUIRES_THREE_PRIOR_OBSERVATIONS"});return;
    }
    const [inserted]=await db.insert(events).values({
      executionId:id,companyId:company,eventId:`cst-external:${id}:${observation.role}`,
      eventType:"team.external.observed",phase:observation.role,status:"observed",
      workerId:externalObservationWorkerId(observation),
      signatureVerified:false,message:"Operator-collected text observation — not agent attestation",
      payload:{operatorCollected:true,proofLevel:EXTERNAL_REVIEW_PROOF,
        challenge, result:observation.result,summaryCode:observation.summaryCode,
        responseSha256:observation.responseSha256,sessionSha256:observation.sessionSha256},
    }).onConflictDoNothing({target:events.eventId}).returning({id:events.id});
    if(!inserted){res.status(409).json({error:"ROLE_OBSERVATION_ALREADY_RECORDED"});return;}
    if(observation.role==="qa"){
      await db.update(jobs).set({status:"blocked",progress:0,completedAt:new Date(),
        resultSummary:"Four operator-collected observations recorded; no signed or autonomous Final ACK",
        updatedAt:new Date(),
      }).where(and(eq(jobs.id,id),eq(jobs.companyId,company),
        eq(jobs.source,EXTERNAL_REVIEW_SOURCE)));
    }
    res.status(201).json({id,role:observation.role,recorded:true,
      proofLevel:EXTERNAL_REVIEW_PROOF,operationalVerified:false,independentFinalAckVerified:false});
  }catch(err){logger.error({err},"External review observation failed");
    res.status(500).json({error:"EXTERNAL_REVIEW_WRITE_FAILED"});}
});

/** Record a provider failure without inventing a missing QA receipt. */
router.post("/cst-ai-team/external-reviews/:id/close",requireAuth,async(req:Request,res:Response)=>{
  const company=allow(req,res,true); if(!company)return;
  if(!canRunExternalReview()){res.sendStatus(404);return;}
  const id=String(req.params.id??"");
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)){
    res.status(400).json({error:"INVALID_REVIEW_ID"});return;
  }
  const reason=parseExternalReviewFailure(req.body);
  if(!reason){res.status(400).json({error:"INVALID_REVIEW_FAILURE_REASON"});return;}
  try{
    const [closed]=await db.update(jobs).set({status:"blocked",progress:0,
      errorMessage:reason,completedAt:new Date(),updatedAt:new Date(),
    }).where(and(eq(jobs.id,id),eq(jobs.companyId,company),
      eq(jobs.source,EXTERNAL_REVIEW_SOURCE),eq(jobs.status,"processing")))
      .returning({id:jobs.id});
    if(!closed){res.status(409).json({error:"REVIEW_NOT_ACTIVE_OR_NOT_FOUND"});return;}
    res.setHeader("Cache-Control","no-store");
    res.json({id:closed.id,status:"blocked",reason,qaReviewRecorded:false,
      proofLevel:EXTERNAL_REVIEW_PROOF,operationalVerified:false,
      independentFinalAckVerified:false});
  }catch(err){logger.error({err},"External review abort failed");
    res.status(500).json({error:"EXTERNAL_REVIEW_ABORT_FAILED"});}
});

export default router;
