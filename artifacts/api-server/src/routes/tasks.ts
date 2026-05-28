import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, tasksTable, teamMembersTable, activityTable, taskAssignmentsTable } from "@workspace/db";
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
import { sendWhatsAppNotification } from "../lib/whatsapp-sender";
import { logger } from "../lib/logger";
import { openai } from "../lib/openai";

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

router.post("/tasks/:id/ai-summary", async (req, res): Promise<void> => {
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
  const assigneeName = task.assigneeId ? (memberMap.get(task.assigneeId) ?? "Tidak diketahui") : "Belum ditugaskan";

  const taskContext = [
    `Judul: ${task.title}`,
    `Deskripsi: ${task.description || "Tidak ada deskripsi"}`,
    `Status: ${task.status}`,
    `Prioritas: ${task.priority}`,
    `Ditugaskan ke: ${assigneeName}`,
    task.customerName ? `Nama pelanggan: ${task.customerName}` : null,
    task.assignedRole ? `Peran yang ditugaskan: ${task.assignedRole}` : null,
    task.assignedDivision ? `Divisi: ${task.assignedDivision}` : null,
    task.assignedVendor ? `Vendor: ${task.assignedVendor}` : null,
    task.dueDate ? `Tenggat waktu: ${task.dueDate}` : null,
    task.tags?.length ? `Tag: ${task.tags.join(", ")}` : null,
    task.sourceMessageId ? `Berasal dari pesan WhatsApp ID: ${task.sourceMessageId}` : null,
  ].filter(Boolean).join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Kamu adalah asisten admin operasional yang membantu tim logistik dan kepabeanan di Indonesia.
Diberikan data task dari sistem manajemen tugas, buatkan ringkasan operasional singkat dalam Bahasa Indonesia.

Kembalikan HANYA objek JSON valid tanpa markdown, dengan format:
{
  "summary": "narasi singkat 1-2 kalimat tentang apa yang diminta pelanggan dan kondisi task saat ini",
  "missingData": ["item data atau dokumen yang hilang/belum tersedia — kosongkan array jika semua sudah lengkap"],
  "recommendation": "rekomendasi tindakan selanjutnya yang konkret untuk admin"
}`,
        },
        {
          role: "user",
          content: `Berikut data task:\n\n${taskContext}`,
        },
      ],
      max_tokens: 500,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content?.trim() ?? "{}";
    const parsed = JSON.parse(content);

    res.json({
      summary: parsed.summary ?? "Ringkasan tidak tersedia.",
      missingData: Array.isArray(parsed.missingData) ? parsed.missingData : [],
      recommendation: parsed.recommendation ?? "Tidak ada rekomendasi.",
    });
  } catch (err) {
    logger.error({ err }, "Gagal generate AI summary untuk task");
    res.status(500).json({ error: "Gagal generate ringkasan AI" });
  }
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

  const { assigneeId, assignedRole, assignedDivision, assignedVendor, customerName, miniTaskUrl } = parsed.data;

  if (!assigneeId && !assignedRole && !assignedDivision && !assignedVendor) {
    res.status(400).json({ error: "Harus menentukan salah satu: assigneeId, assignedRole, assignedDivision, atau assignedVendor" });
    return;
  }

  let member: { id: number; name: string; phone: string | null } | undefined;
  if (assigneeId) {
    const [found] = await db.select().from(teamMembersTable).where(eq(teamMembersTable.id, assigneeId));
    if (!found) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }
    member = found;
  }

  const [existingTask] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (!existingTask) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const [task] = await db
    .update(tasksTable)
    .set({
      assigneeId: assigneeId ?? null,
      assignedRole: assignedRole ?? null,
      assignedDivision: assignedDivision ?? null,
      assignedVendor: assignedVendor ?? null,
      customerName: customerName ?? existingTask.customerName ?? null,
      status: "assigned",
    })
    .where(eq(tasksTable.id, params.data.id))
    .returning();

  const assignedToLabel =
    member?.name ??
    (assignedRole ? `role: ${assignedRole}` : null) ??
    (assignedDivision ? `divisi: ${assignedDivision}` : null) ??
    (assignedVendor ? `vendor: ${assignedVendor}` : null) ??
    "Tim";

  await db.insert(taskAssignmentsTable).values({
    taskId: task.id,
    assignedTo: member ? String(member.id) : null,
    assignedRole: assignedRole ?? null,
    assignedDivision: assignedDivision ?? null,
    assignedVendor: assignedVendor ?? null,
    status: "active",
  });

  await db.insert(activityTable).values({
    type: "task_assigned",
    description: `Task "${task.title}" ditugaskan ke ${assignedToLabel}`,
    entityId: task.id,
  });

  if (member?.phone) {
    try {
      await sendWhatsAppNotification({
        to: member.phone,
        recipientType: "team",
        templateName: "task_assignment",
        variables: {
          customerName: customerName ?? existingTask.customerName ?? "-",
          title: task.title,
          priority: task.priority,
          miniTaskUrl: miniTaskUrl ?? "",
        },
        taskId: task.id,
      });
    } catch (err) {
      logger.warn({ err, taskId: task.id }, "WhatsApp notification gagal saat assign task, melanjutkan");
    }
  } else {
    logger.info({ taskId: task.id, assignedToLabel }, "Tidak ada nomor HP — notifikasi WhatsApp dilewati");
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

export default router;
