import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable, type UserRole, USER_ROLES } from "@workspace/db";
import { signToken, requireAuth, requireRole, type AuthUser } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── POST /auth/setup ──────────────────────────────────────────────────────────
// Creates first super_admin when no users exist. Use only on initial setup.

router.post("/auth/setup", async (req: Request, res: Response): Promise<void> => {
  const { name, email, password, companyId } = req.body as {
    name?: string; email?: string; password?: string; companyId?: string;
  };

  if (!name || !email || !password) {
    res.status(400).json({ error: "name, email, and password are required" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const existingCount = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (existingCount.length > 0) {
    res.status(409).json({ error: "Setup already completed. Use /auth/login to sign in." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(usersTable).values({
    name,
    email: email.toLowerCase().trim(),
    passwordHash,
    role: "super_admin",
    companyId: companyId ?? "default",
    isActive: true,
  }).returning();

  logger.info({ userId: user.id, email: user.email }, "Super admin created via /auth/setup");

  const token = signToken({
    id: user.id,
    email: user.email,
    role: user.role as UserRole,
    companyId: user.companyId,
    name: user.name,
  });

  res.status(201).json({
    message: "Super admin created successfully",
    token,
    user: safeUser(user),
  });
});

// ─── POST /auth/login ──────────────────────────────────────────────────────────

router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(usersTable.id, user.id));

  const token = signToken({
    id: user.id,
    email: user.email,
    role: user.role as UserRole,
    companyId: user.companyId,
    name: user.name,
  });

  logger.info({ userId: user.id, role: user.role, companyId: user.companyId }, "User logged in");

  res.json({ token, user: safeUser(user) });
});

// ─── POST /auth/logout ─────────────────────────────────────────────────────────

router.post("/auth/logout", (_req: Request, res: Response): void => {
  res.json({ message: "Logged out. Please clear your token on the client." });
});

// ─── GET /auth/me ──────────────────────────────────────────────────────────────

router.get("/auth/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.id))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(safeUser(user));
});

// ─── PATCH /auth/password ──────────────────────────────────────────────────────

router.patch("/auth/password", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string; newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.id))
    .limit(1);

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) { res.status(401).json({ error: "Current password is incorrect" }); return; }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));

  res.json({ message: "Password updated successfully" });
});

// ─── GET /auth/users ───────────────────────────────────────────────────────────

router.get(
  "/auth/users",
  requireAuth,
  requireRole("company_admin", "super_admin"),
  async (_req: Request, res: Response): Promise<void> => {
    const { supabaseQuery } = await import("../lib/supabase-db");
    const rows = await supabaseQuery<{
      rn: string;
      id: string;
      name: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      role: string | null;
      division: string | null;
      department: string | null;
      phone: string | null;
      company_id: number | null;
      is_active: boolean | null;
      last_login_at: Date | null;
      created_at: Date | null;
      updated_at: Date | null;
    }>(
      `SELECT ROW_NUMBER() OVER (ORDER BY name NULLS LAST, email)::text AS rn,
              id, name, first_name, last_name, email, role::text AS role,
              division, department, phone, company_id, is_active,
              last_login_at, created_at, updated_at
       FROM users ORDER BY name NULLS LAST, email`,
    );
    res.json(
      rows.map((r) => ({
        id: Number(r.rn),
        companyId: r.company_id ? String(r.company_id) : "",
        name: r.name ?? [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ?? r.email ?? "(no name)",
        email: r.email ?? "",
        role: r.role ?? "staff",
        division: r.division ?? r.department ?? null,
        phone: r.phone ?? null,
        isActive: r.is_active ?? true,
        lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
        createdAt: (r.created_at ?? new Date()).toISOString(),
        updatedAt: (r.updated_at ?? r.created_at ?? new Date()).toISOString(),
      })),
    );
  },
);

// ─── POST /auth/users ──────────────────────────────────────────────────────────

router.post(
  "/auth/users",
  requireAuth,
  requireRole("company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const { name, email, password, role, division, phone, companyId } = req.body as {
      name?: string; email?: string; password?: string; role?: string;
      division?: string; phone?: string; companyId?: string;
    };

    if (!name || !email || !password) {
      res.status(400).json({ error: "name, email, and password are required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const validRole = role && USER_ROLES.includes(role as UserRole) ? role as UserRole : "staff";

    // company_admin cannot create super_admin or another company_admin
    if (req.user!.role === "company_admin" && (validRole === "super_admin" || validRole === "company_admin")) {
      res.status(403).json({ error: "company_admin cannot create super_admin or company_admin roles" });
      return;
    }

    const assignedCompanyId = req.user!.role === "super_admin"
      ? (companyId ?? req.user!.companyId)
      : req.user!.companyId;

    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase().trim()))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "Email already in use" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db.insert(usersTable).values({
      name, email: email.toLowerCase().trim(), passwordHash,
      role: validRole, division, phone, companyId: assignedCompanyId, isActive: true,
    }).returning();

    logger.info({ createdBy: req.user!.id, newUserId: user.id, role: validRole }, "User created");
    res.status(201).json(safeUser(user));
  },
);

// ─── PATCH /auth/users/:id ─────────────────────────────────────────────────────

router.patch(
  "/auth/users/:id",
  requireAuth,
  requireRole("company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }

    const { name, role, division, phone, isActive } = req.body as {
      name?: string; role?: string; division?: string; phone?: string; isActive?: boolean;
    };

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "User not found" }); return; }

    // Non-super_admin can only manage users in their company
    if (req.user!.role !== "super_admin" && existing.companyId !== req.user!.companyId) {
      res.status(403).json({ error: "Cannot modify users from another company" });
      return;
    }

    const validRole = role && USER_ROLES.includes(role as UserRole) ? role as UserRole : undefined;
    if (req.user!.role === "company_admin" && validRole && ["super_admin", "company_admin"].includes(validRole)) {
      res.status(403).json({ error: "company_admin cannot assign super_admin or company_admin roles" });
      return;
    }

    const updates: Partial<typeof existing> = {};
    if (name) updates.name = name;
    if (validRole) updates.role = validRole;
    if (division !== undefined) updates.division = division;
    if (phone !== undefined) updates.phone = phone;
    if (typeof isActive === "boolean") updates.isActive = isActive;

    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
    res.json(safeUser(updated));
  },
);

// ─── DELETE /auth/users/:id ────────────────────────────────────────────────────

router.delete(
  "/auth/users/:id",
  requireAuth,
  requireRole("super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid user ID" }); return; }
    if (id === req.user!.id) { res.status(400).json({ error: "Cannot delete your own account" }); return; }

    const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "User not found" }); return; }

    logger.info({ deletedBy: req.user!.id, deletedUserId: id }, "User deleted");
    res.sendStatus(204);
  },
);

// ─── Helper ────────────────────────────────────────────────────────────────────

function safeUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash: _pw, ...safe } = user;
  return {
    ...safe,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export default router;
