import { Router, type IRouter, type Request, type Response } from "express";
import { eq, asc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { db, pool, usersTable, type UserRole, USER_ROLES } from "@workspace/db";
import { signToken, requireAuth, requireRole, type AuthUser } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type ProductionAuthUserRow = {
  id: string;
  company_id: number | null;
  name: string;
  email: string | null;
  role: string;
  division: string | null;
  phone: string | null;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

async function findProductionAuthUserByEmail(email: string): Promise<ProductionAuthUserRow | null> {
  const result = await pool.query<ProductionAuthUserRow>(
    `select id, company_id, name, email, role, division, phone, is_active,
            last_login_at, created_at, updated_at
       from public.users
      where lower(email) = lower($1)
      limit 1`,
    [email],
  );
  return result.rows[0] ?? null;
}

async function findProductionAuthUserById(id: string): Promise<ProductionAuthUserRow | null> {
  const result = await pool.query<ProductionAuthUserRow>(
    `select id, company_id, name, email, role, division, phone, is_active,
            last_login_at, created_at, updated_at
       from public.users
      where id = $1
      limit 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

function normalizeCompanyId(value: number | null): string {
  return value == null ? "default" : String(value);
}

function safeProductionUser(user: ProductionAuthUserRow) {
  return {
    id: user.id,
    companyId: normalizeCompanyId(user.company_id),
    name: user.name,
    email: user.email ?? "",
    role: user.role,
    division: user.division,
    phone: user.phone,
    isActive: user.is_active,
    lastLoginAt: user.last_login_at?.toISOString() ?? null,
    createdAt: user.created_at.toISOString(),
    updatedAt: user.updated_at.toISOString(),
  };
}

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

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase().trim()))
      .limit(1);

    if (!user || !user.isActive || !user.passwordHash) {
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
  } catch (err) {
    logger.error({ err }, "POST /auth/login failed — database unavailable");
    res.status(503).json({ error: "Login service temporarily unavailable" });
  }
});

// ─── Google Sign-In via Supabase OAuth ─────────────────────────────────────────

router.get("/auth/google/start", (_req: Request, res: Response): void => {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const appBaseUrl = process.env.PUBLIC_APP_BASE_URL?.trim();

  if (!supabaseUrl || !appBaseUrl) {
    res.status(503).json({ error: "Google login is not configured" });
    return;
  }

  const authorizeUrl = new URL("/auth/v1/authorize", supabaseUrl);
  authorizeUrl.searchParams.set("provider", "google");
  authorizeUrl.searchParams.set("redirect_to", appBaseUrl.replace(/\/$/, "") + "/");
  res.redirect(302, authorizeUrl.toString());
});

router.post("/auth/google", async (req: Request, res: Response): Promise<void> => {
  const { accessToken } = req.body as { accessToken?: string };
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const publishableKey = process.env.SUPABASE_ANON_KEY?.trim();

  if (!accessToken) {
    res.status(400).json({ error: "Supabase access token is required" });
    return;
  }
  if (!supabaseUrl || !publishableKey) {
    res.status(503).json({ error: "Google login is not configured" });
    return;
  }

  try {
    const supabase = createClient(supabaseUrl, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) {
      res.status(401).json({ error: "Invalid Supabase session" });
      return;
    }

    const authUser = data.user;
    const email = authUser.email?.toLowerCase().trim();
    const primaryProvider = authUser.app_metadata?.provider;
    const linkedProviders = Array.isArray(authUser.app_metadata?.providers)
      ? authUser.app_metadata.providers
      : [];
    const hasGoogleIdentity =
      primaryProvider === "google" ||
      linkedProviders.includes("google") ||
      (authUser.identities ?? []).some((identity) => identity.provider === "google");

    if (!email || !authUser.email_confirmed_at || !hasGoogleIdentity) {
      res.status(401).json({ error: "Verified Google account required" });
      return;
    }

    const user = await findProductionAuthUserByEmail(email);

    if (!user || !user.is_active) {
      res.status(403).json({ error: "Google account is not registered or is inactive" });
      return;
    }

    try {
      await pool.query(
        "update public.users set last_login_at = now(), updated_at = now() where id = $1",
        [user.id],
      );
      user.last_login_at = new Date();
      user.updated_at = new Date();
    } catch (err) {
      logger.warn(
        { err, userId: user.id },
        "Failed to update Google login timestamp; continuing login",
      );
    }

    const token = signToken({
      // AuthUser is still typed as number for legacy modules, but production user IDs
      // are TEXT. A TypeScript assertion preserves the real runtime string in the JWT.
      id: user.id as unknown as number,
      email: user.email ?? email,
      role: user.role as UserRole,
      companyId: normalizeCompanyId(user.company_id),
      name: user.name,
    });

    logger.info(
      { userId: user.id, email: user.email, role: user.role },
      "User logged in with Google via Supabase OAuth",
    );

    res.json({ token, user: safeProductionUser(user) });
  } catch (err) {
    logger.warn({ err }, "Supabase Google login verification failed");
    res.status(401).json({ error: "Google login verification failed" });
  }
});

// ─── POST /auth/logout ─────────────────────────────────────────────────────────

router.post("/auth/logout", (_req: Request, res: Response): void => {
  res.json({ message: "Logged out. Please clear your token on the client." });
});

// ─── GET /auth/me ──────────────────────────────────────────────────────────────

router.get("/auth/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV === "production") {
    const productionUser = await findProductionAuthUserById(String(req.user!.id));
    if (!productionUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(safeProductionUser(productionUser));
    return;
  }

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
    const rows = await db
      .select()
      .from(usersTable)
      .orderBy(asc(usersTable.name));
    res.json(rows.map(safeUser));
  },
);

// ─── POST /auth/users/:id/reset-password ──────────────────────────────────────

router.post(
  "/auth/users/:id/reset-password",
  requireAuth,
  requireRole("company_admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const rawId = req.params.id as string;
    const [target] = await db.select().from(usersTable)
      .where(eq(usersTable.id, rawId as unknown as number)).limit(1);

    const { newPassword } = req.body as { newPassword?: string };
    if (!target) { res.status(404).json({ error: "User not found" }); return; }

    // Non-super_admin can only reset passwords within their company
    if (req.user!.role !== "super_admin" && target.companyId !== req.user!.companyId) {
      res.status(403).json({ error: "Cannot reset password for users from another company" });
      return;
    }

    // If no password provided, auto-generate a memorable temp password
    const tempPassword = newPassword && newPassword.length >= 8
      ? newPassword
      : crypto.randomBytes(3).toString("hex").toUpperCase() + "-" + crypto.randomBytes(3).toString("hex");

    if (tempPassword.length < 8) {
      res.status(400).json({ error: "Password baru minimal 8 karakter" });
      return;
    }

    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await db.update(usersTable).set({ passwordHash, updatedAt: new Date() }).where(eq(usersTable.id, rawId as unknown as number));

    logger.info({ resetBy: req.user!.id, targetUserId: rawId }, "Password reset by admin");

    res.json({
      message: "Password berhasil direset",
      tempPassword: newPassword ? undefined : tempPassword,
    });
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
