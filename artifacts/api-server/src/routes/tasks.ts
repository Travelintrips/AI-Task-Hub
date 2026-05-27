import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, tasksTable, teamMembersTable, activityTable } from "@workspace/db";
import {
  ListTasksQueryParams,
  CreateTaskBody,
  GetTaskParams,
  UpdateTaskParams,
  UpdateTaskBody,
  DeleteTaskParams,
  AssignTaskParams,
  AssignTaskBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/tasks", async (req, res): Promise<void> => {
  const parsed = ListTasksQueryParams.safeParse(req.query);
  const filters = parsed.success ? parsed.data : {};

  const tasks = await db.select().from(tasksTable).orderBy(desc(tasksTable.createdAt));

  const filtered = tasks.filter((t) => {
    if (filters.status && t.status !== filters.status) return false;
    if (filters.assigneeId && t.assigneeId !== filters.assigneeId) return false;
    return true;
  });

  const members = await db.select().from(teamMembersTable);
  const memberMap = new Map(members.map((m) => [m.id, m.name]));

  const result = filtered.map((t) => ({
    ...t,
    assigneeName: t.assigneeId ? (memberMap.get(t.assigneeId) ?? null) : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    dueDate: t.dueDate ?? null,
    tags: t.tags ?? [],
  }));

  res.json(result);
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { tags, ...rest } = parsed.data;
  const [task] = await db
    .insert(tasksTable)
    .values({ ...rest, tags: tags ?? [] })
    .returning();

  await db.insert(activityTable).values({
    type: "task_created",
    description: `Task "${task.title}" was created`,
    entityId: task.id,
  });

  const members = await db.select().from(teamMembersTable);
  const memberMap = new Map(members.map((m) => [m.id, m.name]));

  res.status(201).json({
    ...task,
    assigneeName: task.assigneeId ? (memberMap.get(task.assigneeId) ?? null) : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    dueDate: task.dueDate ?? null,
    tags: task.tags ?? [],
  });
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const members = await db.select().from(teamMembersTable);
  const memberMap = new Map(members.map((m) => [m.id, m.name]));

  res.json({
    ...task,
    assigneeName: task.assigneeId ? (memberMap.get(task.assigneeId) ?? null) : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    dueDate: task.dueDate ?? null,
    tags: task.tags ?? [],
  });
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [task] = await db
    .update(tasksTable)
    .set(parsed.data)
    .where(eq(tasksTable.id, params.data.id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  await db.insert(activityTable).values({
    type: "task_updated",
    description: `Task "${task.title}" was updated`,
    entityId: task.id,
  });

  const members = await db.select().from(teamMembersTable);
  const memberMap = new Map(members.map((m) => [m.id, m.name]));

  res.json({
    ...task,
    assigneeName: task.assigneeId ? (memberMap.get(task.assigneeId) ?? null) : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    dueDate: task.dueDate ?? null,
    tags: task.tags ?? [],
  });
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [task] = await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id)).returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.sendStatus(204);
});

router.patch("/tasks/:id/assign", async (req, res): Promise<void> => {
  const params = AssignTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AssignTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [member] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.id, parsed.data.assigneeId));
  if (!member) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }

  const [task] = await db
    .update(tasksTable)
    .set({ assigneeId: parsed.data.assigneeId })
    .where(eq(tasksTable.id, params.data.id))
    .returning();

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  await db.insert(activityTable).values({
    type: "task_assigned",
    description: `Task "${task.title}" was assigned to ${member.name}`,
    entityId: task.id,
  });

  const members = await db.select().from(teamMembersTable);
  const memberMap = new Map(members.map((m) => [m.id, m.name]));

  res.json({
    ...task,
    assigneeName: task.assigneeId ? (memberMap.get(task.assigneeId) ?? null) : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    dueDate: task.dueDate ?? null,
    tags: task.tags ?? [],
  });
});

export default router;
