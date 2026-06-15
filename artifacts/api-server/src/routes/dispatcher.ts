import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, isNull, ne, desc } from "drizzle-orm";
import { db, aiTasksTable, activityTable, dispatcherLogsTable, teamMembersTable } from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";
import { suggestAssignment, getTeamWorkload } from "../lib/dispatcher";
import { notifyTaskAssigned } from "../lib/notifications";

const router: IRouter = Router();

// GET /api/dispatcher/team-status — workload overview per anggota tim
router.get("/dispatcher/team-status", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const workload = await getTeamWorkload(companyId);
    res.json(workload);
  } catch (err) {
    logger.error({ err }, "GET /dispatcher/team-status failed");
    res.status(500).json({ error: "Gagal memuat status tim" });
  }
});

// GET /api/dispatcher/queue — task yang belum diassign
router.get("/dispatcher/queue", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const tasks = await db
      .select()
      .from(aiTasksTable)
      .where(and(
        eq(aiTasksTable.companyId, companyId),
        isNull(aiTasksTable.assignedTo),
        ne(aiTasksTable.status, "completed"),
        ne(aiTasksTable.status, "cancelled"),
      ))
      .orderBy(desc(aiTasksTable.createdAt))
      .limit(50);
    res.json(tasks);
  } catch (err) {
    logger.error({ err }, "GET /dispatcher/queue failed");
    res.status(500).json({ error: "Gagal memuat queue" });
  }
});

// POST /api/dispatcher/suggest — saran penugasan untuk satu task
router.post("/dispatcher/suggest", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { taskId } = req.body as { taskId?: number };
    if (!taskId) { res.status(400).json({ error: "taskId wajib diisi" }); return; }

    const suggestion = await suggestAssignment(taskId, companyId);
    if (!suggestion) { res.status(404).json({ error: "Task tidak ditemukan" }); return; }

    res.json(suggestion);
  } catch (err) {
    logger.error({ err }, "POST /dispatcher/suggest failed");
    res.status(500).json({ error: "Gagal membuat saran dispatcher" });
  }
});

// POST /api/dispatcher/assign — eksekusi penugasan (dari saran atau manual)
router.post("/dispatcher/assign", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const {
      taskId, memberName, suggestion,
      wasOverridden = false, overrideReason,
    } = req.body as {
      taskId: number;
      memberName: string;
      suggestion?: {
        topCandidate?: { memberName: string; memberRole?: string; memberDivision?: string; memberId?: number; totalScore?: number; workloadScore?: number; skillScore?: number; urgencyScore?: number; availabilityScore?: number };
        explanation?: string;
        taskCategory?: string;
        taskPriority?: string;
        taskSlaStatus?: string;
        candidates?: unknown[];
      };
      wasOverridden?: boolean;
      overrideReason?: string;
    };

    if (!taskId || !memberName) { res.status(400).json({ error: "taskId dan memberName wajib diisi" }); return; }

    const [task] = await db.select().from(aiTasksTable).where(eq(aiTasksTable.id, taskId)).limit(1);
    if (!task) { res.status(404).json({ error: "Task tidak ditemukan" }); return; }

    // Update task assignment
    const [updated] = await db
      .update(aiTasksTable)
      .set({ assignedTo: memberName, status: task.status === "new_inquiry" ? "in_progress" : task.status })
      .where(eq(aiTasksTable.id, taskId))
      .returning();

    // Catat dispatcher log
    const top = suggestion?.topCandidate;
    await db.insert(dispatcherLogsTable).values({
      companyId,
      taskId,
      taskNumber: task.taskNumber,
      taskTitle: task.title,
      taskCategory: task.category,
      taskPriority: task.priority,
      taskSlaStatus: task.slaStatus,
      suggestedMemberId: top?.memberId ?? null,
      suggestedMemberName: top?.memberName ?? null,
      suggestedMemberRole: top?.memberRole ?? null,
      suggestedMemberDivision: top?.memberDivision ?? null,
      assignedMemberName: memberName,
      wasOverridden,
      overrideReason: overrideReason ?? null,
      totalScore: top?.totalScore ?? null,
      workloadScore: top?.workloadScore ?? null,
      skillScore: top?.skillScore ?? null,
      urgencyScore: top?.urgencyScore ?? null,
      availabilityScore: top?.availabilityScore ?? null,
      explanation: suggestion?.explanation ?? null,
      allCandidatesJson: suggestion?.candidates ? JSON.stringify(suggestion.candidates) : null,
      dispatchedBy: req.user?.name ?? "system",
    }).catch((err) => logger.warn({ err }, "Failed to insert dispatcher log"));

    await db.insert(activityTable).values({
      type: "task_assigned",
      description: `${wasOverridden ? "⚡ Override" : "🤖 AI Dispatcher"}: Task "${task.title}" ditugaskan ke ${memberName}`,
      entityId: taskId,
    }).catch(() => {});

    // ── Notifikasi WhatsApp ke staff yang di-assign ────────────────────────────
    const [member] = await db
      .select()
      .from(teamMembersTable)
      .where(eq(teamMembersTable.name, memberName))
      .limit(1);

    if (!member) {
      logger.warn({ memberName }, "Dispatcher: notifikasi WA dilewati — anggota tim tidak ditemukan di team_members");
    } else if (!member.phone) {
      logger.warn({ memberName, memberId: member.id }, "Dispatcher: notifikasi WA dilewati — anggota tim tidak memiliki nomor HP");
    }

    notifyTaskAssigned(
      {
        taskId,
        taskNumber: task.taskNumber ?? `WA-${taskId}`,
        title:       updated.title,
        customerName: updated.customerName,
        customerPhone: updated.customerPhone,
        assignedTo:  memberName,
        status:      updated.status,
        priority:    updated.priority,
        companyId,
      },
      member?.phone ?? null,
    ).catch((err) => logger.error({ err }, "Dispatcher: notifikasi assign gagal"));

    res.json({ task: updated, assignedTo: memberName, wasOverridden });
  } catch (err) {
    logger.error({ err }, "POST /dispatcher/assign failed");
    res.status(500).json({ error: "Gagal menugaskan task" });
  }
});

// GET /api/dispatcher/logs — history keputusan dispatcher
router.get("/dispatcher/logs", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);
    const logs = await db
      .select()
      .from(dispatcherLogsTable)
      .where(eq(dispatcherLogsTable.companyId, companyId))
      .orderBy(desc(dispatcherLogsTable.dispatchedAt))
      .limit(limit);
    res.json(logs);
  } catch (err) {
    logger.error({ err }, "GET /dispatcher/logs failed");
    res.status(500).json({ error: "Gagal memuat dispatcher logs" });
  }
});

// POST /api/dispatcher/auto-dispatch — auto-dispatch semua unassigned tasks
router.post("/dispatcher/auto-dispatch", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { taskIds } = req.body as { taskIds?: number[] };

    const tasksToDispatch = taskIds
      ? await db.select().from(aiTasksTable).where(and(eq(aiTasksTable.companyId, companyId), ...taskIds.map((id) => eq(aiTasksTable.id, id))))
      : await db.select().from(aiTasksTable).where(and(eq(aiTasksTable.companyId, companyId), isNull(aiTasksTable.assignedTo), ne(aiTasksTable.status, "completed"), ne(aiTasksTable.status, "cancelled"))).limit(20);

    const results: { taskId: number; assignedTo: string | null; explanation: string }[] = [];

    for (const task of tasksToDispatch) {
      try {
        const suggestion = await suggestAssignment(task.id, companyId);
        if (!suggestion?.topCandidate) { results.push({ taskId: task.id, assignedTo: null, explanation: "Tidak ada kandidat tersedia" }); continue; }

        await db.update(aiTasksTable).set({ assignedTo: suggestion.topCandidate.memberName, status: task.status === "new_inquiry" ? "in_progress" : task.status }).where(eq(aiTasksTable.id, task.id));
        results.push({ taskId: task.id, assignedTo: suggestion.topCandidate.memberName, explanation: suggestion.explanation });
      } catch (err) {
        results.push({ taskId: task.id, assignedTo: null, explanation: "Error saat dispatch" });
      }
    }

    res.json({ dispatched: results.filter((r) => r.assignedTo).length, total: results.length, results });
  } catch (err) {
    logger.error({ err }, "POST /dispatcher/auto-dispatch failed");
    res.status(500).json({ error: "Auto-dispatch gagal" });
  }
});

export default router;
