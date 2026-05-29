import { Router, type IRouter } from "express";
import { db, teamMembersTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { requireAuth, requireRole, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /team ─────────────────────────────────────────────────────────────────

router.get("/team", requireAuth, async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(teamMembersTable)
      .orderBy(asc(teamMembersTable.name));

    res.json(
      rows.map((r, idx) => ({
        id:        r.id,
        name:      r.name,
        role:      r.role,
        email:     r.email ?? null,
        phone:     r.phone ?? null,
        division:  r.division ?? null,
        isVendor:  r.isVendor === "true",
        avatarUrl: r.avatarUrl ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.error({ err }, "GET /team failed");
    res.status(500).json({ error: "Failed to load team" });
  }
});

// ─── POST /team ────────────────────────────────────────────────────────────────

router.post("/team", requireAuth, requireRole("company_admin"), async (req, res): Promise<void> => {
  try {
    const { name, role, email, phone, division, isVendor, avatarUrl } = req.body as {
      name: string;
      role: string;
      email?: string;
      phone?: string;
      division?: string;
      isVendor?: boolean;
      avatarUrl?: string;
    };

    if (!name || !role) {
      res.status(400).json({ error: "name and role are required" });
      return;
    }

    const [created] = await db
      .insert(teamMembersTable)
      .values({
        name,
        role,
        email:     email ?? null,
        phone:     phone ?? null,
        division:  division ?? null,
        isVendor:  isVendor ? "true" : "false",
        avatarUrl: avatarUrl ?? null,
      })
      .returning();

    res.status(201).json({
      id:        created.id,
      name:      created.name,
      role:      created.role,
      email:     created.email ?? null,
      phone:     created.phone ?? null,
      division:  created.division ?? null,
      isVendor:  created.isVendor === "true",
      avatarUrl: created.avatarUrl ?? null,
      createdAt: created.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "POST /team failed");
    res.status(500).json({ error: "Failed to create team member" });
  }
});

// ─── PATCH /team/:id ───────────────────────────────────────────────────────────

router.patch("/team/:id", requireAuth, requireRole("company_admin"), async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { name, role, email, phone, division, isVendor, avatarUrl } = req.body as {
      name?: string;
      role?: string;
      email?: string;
      phone?: string;
      division?: string;
      isVendor?: boolean;
      avatarUrl?: string;
    };

    const updateData: Partial<typeof teamMembersTable.$inferInsert> = {};
    if (name      !== undefined) updateData.name      = name;
    if (role      !== undefined) updateData.role      = role;
    if (email     !== undefined) updateData.email     = email;
    if (phone     !== undefined) updateData.phone     = phone;
    if (division  !== undefined) updateData.division  = division;
    if (isVendor  !== undefined) updateData.isVendor  = isVendor ? "true" : "false";
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

    const [updated] = await db
      .update(teamMembersTable)
      .set(updateData)
      .where(eq(teamMembersTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }

    res.json({
      id:        updated.id,
      name:      updated.name,
      role:      updated.role,
      email:     updated.email ?? null,
      phone:     updated.phone ?? null,
      division:  updated.division ?? null,
      isVendor:  updated.isVendor === "true",
      avatarUrl: updated.avatarUrl ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "PATCH /team/:id failed");
    res.status(500).json({ error: "Failed to update team member" });
  }
});

// ─── DELETE /team/:id ──────────────────────────────────────────────────────────

router.delete("/team/:id", requireAuth, requireRole("company_admin"), async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    await db.delete(teamMembersTable).where(eq(teamMembersTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /team/:id failed");
    res.status(500).json({ error: "Failed to delete team member" });
  }
});

export default router;
