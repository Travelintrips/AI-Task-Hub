import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, customersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/customers/:phone — lookup customer by WhatsApp phone number
router.get("/customers/:phone", async (req, res): Promise<void> => {
  const { phone } = req.params;
  const companyId = (req.headers["x-company-id"] as string | undefined) ?? "default";

  try {
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(and(eq(customersTable.whatsapp, phone), eq(customersTable.companyId, companyId)))
      .limit(1);

    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    res.json(customer);
  } catch (err) {
    logger.error({ err, phone }, "Failed to get customer by phone");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/customers/:phone — update or create customer by WhatsApp phone
router.patch("/customers/:phone", async (req, res): Promise<void> => {
  const { phone } = req.params;
  const companyId = (req.headers["x-company-id"] as string | undefined) ?? "default";
  const { name, companyName, notes } = req.body as {
    name?: string;
    companyName?: string;
    notes?: string;
  };

  try {
    const [existing] = await db
      .select()
      .from(customersTable)
      .where(and(eq(customersTable.whatsapp, phone), eq(customersTable.companyId, companyId)))
      .limit(1);

    if (!existing) {
      const [created] = await db
        .insert(customersTable)
        .values({
          companyId,
          companyName: companyName ?? name ?? phone,
          picName: name ?? null,
          whatsapp: phone,
          notes: notes ?? null,
          totalTasks: 0,
        })
        .returning();
      res.json(created);
      return;
    }

    const updates: Record<string, unknown> = {};
    if (name        !== undefined) updates.picName     = name;
    if (companyName !== undefined) updates.companyName = companyName;
    if (notes       !== undefined) updates.notes       = notes;

    const [updated] = await db
      .update(customersTable)
      .set(updates)
      .where(eq(customersTable.id, existing.id))
      .returning();

    res.json(updated);
  } catch (err) {
    logger.error({ err, phone }, "Failed to update customer by phone");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
