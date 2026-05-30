import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, operationalChecklistsTable, CHECKLIST_TEMPLATES } from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/checklists/:taskType/:taskId
router.get("/checklists/:taskType/:taskId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const taskId = Number(req.params.taskId);
    const taskType = String(req.params.taskType);
    if (Number.isNaN(taskId)) { res.status(400).json({ error: "Invalid taskId" }); return; }

    const items = await db
      .select()
      .from(operationalChecklistsTable)
      .where(and(
        eq(operationalChecklistsTable.taskId, taskId),
        eq(operationalChecklistsTable.taskType, taskType),
        eq(operationalChecklistsTable.companyId, companyId),
      ))
      .orderBy(operationalChecklistsTable.sortOrder);

    res.json(items);
  } catch (err) {
    logger.error({ err }, "GET /checklists failed");
    res.status(500).json({ error: "Failed to load checklists" });
  }
});

// POST /api/checklists/:taskType/:taskId/init — inisialisasi dari template
router.post("/checklists/:taskType/:taskId/init", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const taskId = Number(req.params.taskId);
    const taskType = String(req.params.taskType);
    const { category } = req.body as { category?: string };
    if (Number.isNaN(taskId)) { res.status(400).json({ error: "Invalid taskId" }); return; }

    const existing = await db
      .select()
      .from(operationalChecklistsTable)
      .where(and(eq(operationalChecklistsTable.taskId, taskId), eq(operationalChecklistsTable.taskType, taskType)));

    if (existing.length > 0) { res.json(existing); return; }

    const templateKey = (category ?? "default").toLowerCase().replace(/\s+/g, "_");
    const items = CHECKLIST_TEMPLATES[templateKey] ?? CHECKLIST_TEMPLATES[category?.toLowerCase() ?? ""] ?? CHECKLIST_TEMPLATES.default;

    const rows = await db
      .insert(operationalChecklistsTable)
      .values(
        items.map((name, i) => ({ taskId, taskType, companyId, itemName: name, sortOrder: i }))
      )
      .returning();

    res.status(201).json(rows);
  } catch (err) {
    logger.error({ err }, "POST /checklists/init failed");
    res.status(500).json({ error: "Failed to init checklist" });
  }
});

// PATCH /api/checklists/:id — toggle done
router.patch("/checklists/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { isDone, notes } = req.body as { isDone?: boolean; notes?: string };

    const updates: Record<string, unknown> = {};
    if (isDone !== undefined) {
      updates.isDone = isDone;
      updates.doneAt = isDone ? new Date() : null;
      updates.doneBy = isDone ? req.user?.name ?? null : null;
    }
    if (notes !== undefined) updates.notes = notes;

    const [updated] = await db
      .update(operationalChecklistsTable)
      .set(updates)
      .where(eq(operationalChecklistsTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /checklists/:id failed");
    res.status(500).json({ error: "Failed to update checklist" });
  }
});

// POST /api/checklists/:taskType/:taskId/items — tambah item custom
router.post("/checklists/:taskType/:taskId/items", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const taskId = Number(req.params.taskId);
    const taskType = String(req.params.taskType);
    const { itemName } = req.body as { itemName?: string };
    if (!itemName) { res.status(400).json({ error: "itemName wajib diisi" }); return; }

    const existing = await db
      .select({ sortOrder: operationalChecklistsTable.sortOrder })
      .from(operationalChecklistsTable)
      .where(and(eq(operationalChecklistsTable.taskId, taskId), eq(operationalChecklistsTable.taskType, taskType)));
    const nextOrder = existing.length;

    const [item] = await db.insert(operationalChecklistsTable).values({ taskId, taskType, companyId, itemName, sortOrder: nextOrder }).returning();
    res.status(201).json(item);
  } catch (err) {
    logger.error({ err }, "POST /checklists items failed");
    res.status(500).json({ error: "Failed to add checklist item" });
  }
});

// DELETE /api/checklists/:id
router.delete("/checklists/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await db.delete(operationalChecklistsTable).where(eq(operationalChecklistsTable.id, id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "DELETE /checklists/:id failed");
    res.status(500).json({ error: "Failed to delete checklist item" });
  }
});

export default router;
