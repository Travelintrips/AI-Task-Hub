import { randomUUID, createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, aiExecutionJobsTable as jobs, aiExecutionEventsTable as events } from "@workspace/db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { canReadDevTeam, canRunDevTeam, canaryVerdict, projectCanaryStatus, TEAM_SOURCE, TEAM_ROLES, type TeamRole } from "../lib/cst-ai-team-contract";
import { fetchCstTeamAgentReadiness } from "../lib/cst-ai-team-agent-readiness";

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
  const confirmed = canaryVerdict(steps.filter(s => s.evidence).map(s => ({
    role: s.role ?? "", status: s.status ?? "",
    ok: (s.evidence as Record<string, unknown>)?.ok === true,
  })));
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
router.get("/cst-ai-team/monitor", requireAuth, async (req: Request, res: Response) => {
  const company = allow(req, res); if (!company) return;
  try {
    const rows = await db.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.companyId, company), eq(jobs.source, TEAM_SOURCE)))
      .orderBy(desc(jobs.createdAt)).limit(12);
    const [runs, agentReadiness] = await Promise.all([
      Promise.all(rows.map(r => fetchRun(r.id, company))),
      fetchCstTeamAgentReadiness(),
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.json({ companyId: company, roles: TEAM_ROLES, runs: runs.filter(Boolean),
      agentReadiness, canRunCanary: canRunDevTeam(),
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
export default router;
