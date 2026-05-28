import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, customerContextsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/customers/:phone
router.get("/customers/:phone", async (req, res): Promise<void> => {
  const { phone } = req.params;
  const companyId = (req.headers["x-company-id"] as string | undefined) ?? "default";

  try {
    const [ctx] = await db
      .select()
      .from(customerContextsTable)
      .where(and(eq(customerContextsTable.phone, phone), eq(customerContextsTable.companyId, companyId)))
      .limit(1);

    if (!ctx) {
      res.status(404).json({ error: "Customer context not found" });
      return;
    }

    res.json(ctx);
  } catch (err) {
    logger.error({ err, phone }, "Failed to get customer context");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/customers/:phone
router.patch("/customers/:phone", async (req, res): Promise<void> => {
  const { phone } = req.params;
  const companyId = (req.headers["x-company-id"] as string | undefined) ?? "default";
  const { name, companyName, frequentService, specialNotes } = req.body as {
    name?: string;
    companyName?: string;
    frequentService?: string;
    specialNotes?: string;
  };

  try {
    const [existing] = await db
      .select()
      .from(customerContextsTable)
      .where(and(eq(customerContextsTable.phone, phone), eq(customerContextsTable.companyId, companyId)))
      .limit(1);

    if (!existing) {
      // Create new
      const [created] = await db
        .insert(customerContextsTable)
        .values({ phone, companyId, name, companyName, frequentService, specialNotes, totalTasks: 0 })
        .returning();
      res.json(created);
      return;
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (companyName !== undefined) updates.companyName = companyName;
    if (frequentService !== undefined) updates.frequentService = frequentService;
    if (specialNotes !== undefined) updates.specialNotes = specialNotes;

    const [updated] = await db
      .update(customerContextsTable)
      .set(updates)
      .where(eq(customerContextsTable.id, existing.id))
      .returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err, phone }, "Failed to update customer context");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
