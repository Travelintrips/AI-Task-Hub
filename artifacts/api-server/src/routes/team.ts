import { Router, type IRouter } from "express";
import { supabaseQuery } from "../lib/supabase-db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface UserRow {
  rn: number;
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  division: string | null;
  department: string | null;
  is_active: boolean | null;
  created_at: Date | null;
}

function mapMember(r: UserRow) {
  const created = r.created_at ?? new Date();
  const fullName =
    r.name ??
    [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ??
    r.email ??
    "(no name)";
  return {
    id: r.rn,
    name: fullName || "(no name)",
    role: r.role ?? "staff",
    email: r.email ?? null,
    phone: r.phone ?? null,
    division: r.division ?? r.department ?? null,
    isActive: r.is_active ?? true,
    createdAt: created.toISOString(),
  };
}

router.get("/team", async (_req, res): Promise<void> => {
  try {
    const rows = await supabaseQuery<UserRow>(
      `SELECT ROW_NUMBER() OVER (ORDER BY name NULLS LAST, email) AS rn,
              id, name, first_name, last_name, email, phone,
              role::text AS role, division, department, is_active, created_at
       FROM users
       WHERE is_active IS NOT FALSE
       ORDER BY name NULLS LAST, email`,
    );
    res.json(rows.map(mapMember));
  } catch (err) {
    logger.error({ err }, "GET /team failed");
    res.status(500).json({ error: "Failed to load team" });
  }
});

router.post("/team", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode: team sourced from Supabase users" });
});
router.patch("/team/:id", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});
router.delete("/team/:id", (_req, res): void => {
  res.status(501).json({ error: "Read-only mode" });
});

export default router;
