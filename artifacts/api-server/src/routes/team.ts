import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import { db, teamMembersTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function mapMember(r: typeof teamMembersTable.$inferSelect) {
  return {
    id:        r.id,
    name:      r.name,
    role:      r.role,
    email:     r.email,
    phone:     r.phone,
    division:  r.division,
    isVendor:  r.isVendor === "true",
    avatarUrl: r.avatarUrl,
    isActive:  true,
    createdAt: r.createdAt.toISOString(),
  };
}

// ─── GET /team ────────────────────────────────────────────────────────────────

router.get("/team", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(teamMembersTable)
      .orderBy(teamMembersTable.name);

    res.json(rows.map(mapMember));
  } catch (err) {
    logger.error({ err }, "GET /team failed");
    res.status(500).json({ error: "Failed to load team" });
  }
});

// ─── POST /team ───────────────────────────────────────────────────────────────

router.post("/team", requireAuth, requireRole("company_admin", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, role, division, phone, email, isVendor, avatarUrl } = req.body as {
      name?: string; role?: string; division?: string; phone?: string;
      email?: string; isVendor?: boolean; avatarUrl?: string;
    };

    if (!name || !role) {
      res.status(400).json({ error: "name and role are required" });
      return;
    }

    const [member] = await db.insert(teamMembersTable).values({
      name,
      role,
      division: division ?? null,
      phone: phone ?? null,
      email: email ?? null,
      isVendor: isVendor ? "true" : "false",
      avatarUrl: avatarUrl ?? null,
    }).returning();

    res.status(201).json(mapMember(member));
  } catch (err) {
    logger.error({ err }, "POST /team failed");
    res.status(500).json({ error: "Failed to create team member" });
  }
});

// ─── PATCH /team/:id ──────────────────────────────────────────────────────────

router.patch("/team/:id", requireAuth, requireRole("company_admin", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const body = req.body as Record<string, unknown>;
    const updates: Partial<typeof teamMembersTable.$inferInsert> = {};

    if (body.name != null)      updates.name = String(body.name);
    if (body.role != null)      updates.role = String(body.role);
    if (body.division != null)  updates.division = String(body.division);
    if (body.phone != null)     updates.phone = String(body.phone);
    if (body.email != null)     updates.email = String(body.email);
    if (body.isVendor != null)  updates.isVendor = body.isVendor ? "true" : "false";
    if (body.avatarUrl != null) updates.avatarUrl = String(body.avatarUrl);

    const [updated] = await db
      .update(teamMembersTable)
      .set(updates)
      .where(eq(teamMembersTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Team member not found" }); return; }

    res.json(mapMember(updated));
  } catch (err) {
    logger.error({ err }, "PATCH /team/:id failed");
    res.status(500).json({ error: "Failed to update team member" });
  }
});

// ─── DELETE /team/:id ─────────────────────────────────────────────────────────

router.delete("/team/:id", requireAuth, requireRole("company_admin", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [deleted] = await db
      .delete(teamMembersTable)
      .where(eq(teamMembersTable.id, id))
      .returning();

    if (!deleted) { res.status(404).json({ error: "Team member not found" }); return; }

    res.sendStatus(204);
  } catch (err) {
    logger.error({ err }, "DELETE /team/:id failed");
    res.status(500).json({ error: "Failed to delete team member" });
  }
});

export default router;
