import { Router, type IRouter } from "express";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { hasRecentGoogleVerifiedVpsSession } from "../lib/vps-storage-google-session";
import { GetVpsStorageInventoryResponse } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middleware/auth";

const router: IRouter = Router();
const safeText = (input: unknown, limit = 160): string =>
  typeof input === "string" ? input.slice(0, limit) : "";

router.get("/system/vps-storage", requireAuth, requireRole("super_admin"), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.NODE_ENV !== "development" || process.env.APP_ENV !== "development") {
    res.sendStatus(404); return;
  }
  if (process.env.VPS_STORAGE_INVENTORY_READONLY_ENABLED !== "true") {
    res.status(503).json({ error: "Inventaris read-only DEV belum diaktifkan" }); return;
  }
  // Passwordless DEV dashboard access cannot authorize infrastructure inventory.
  // Require an independently Supabase-verified Google-linked identity minted
  // by /auth/google within ten minutes; re-check live account status in DEV DB.
  if (!hasRecentGoogleVerifiedVpsSession(req.user)) {
    res.status(403).json({ error: "Recent Google-verified Super Admin identity required" });
    return;
  }
  try {
    const [activeAdmin] = await db.select({
      id: usersTable.id, email: usersTable.email, companyId: usersTable.companyId,
      role: usersTable.role, isActive: usersTable.isActive,
    }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    if (!activeAdmin || !activeAdmin.isActive || activeAdmin.role !== "super_admin" ||
        String(activeAdmin.id) !== String(req.user!.id) ||
        activeAdmin.email.trim().toLowerCase() !== req.user!.email.trim().toLowerCase() ||
        String(activeAdmin.companyId) !== String(req.user!.companyId)) {
      res.status(403).json({ error: "Active Super Admin account mismatch" });
      return;
    }
  } catch {
    res.status(503).json({ error: "Super Admin identity read-back unavailable" });
    return;
  }
  const source = process.env.VPS_STORAGE_INVENTORY_PATH;
  if (!source || !isAbsolute(source)) {
    res.status(503).json({ error: "Inventaris host belum dihubungkan" }); return;
  }
  try {
    const meta = await stat(source);
    if (!meta.isFile() || meta.size > 2_000_000 || meta.size === 0) throw Error("Invalid source");
    const raw: unknown = JSON.parse(await readFile(source, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("Invalid inventory");
    const inventory = raw as Record<string, unknown>;
    if (inventory.readOnly !== true || typeof inventory.generatedAt !== "string" ||
        !Number.isFinite(Date.parse(inventory.generatedAt)) ||
        !Array.isArray(inventory.categories) || inventory.categories.length > 20)
      throw Error("Invalid inventory");
    const categories = inventory.categories.map((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw Error("Invalid category");
      const category = entry as Record<string, unknown>;
      if (!Array.isArray(category.items) || category.items.length > 3000) throw Error("Invalid items");
      return {
        id: safeText(category.id, 80),
        title: safeText(category.title, 160),
        items: category.items.map((item: unknown) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) throw Error("Invalid item");
          const value = item as Record<string, unknown>;
          return {
            id: safeText(value.id, 160),
            name: safeText(value.name, 240),
            sizeDisplay: safeText(value.sizeDisplay, 60),
            created: safeText(value.created, 100),
            protected: value.protected !== false,
            reason: safeText(value.reason, 240),
          };
        }),
      };
    });
    res.status(200).json(GetVpsStorageInventoryResponse.parse({
      generatedAt: inventory.generatedAt, readOnly: true, categories,
    }));
  } catch {
    res.status(503).json({ error: "Inventaris tidak tersedia atau tidak valid" });
  }
});
export default router;
