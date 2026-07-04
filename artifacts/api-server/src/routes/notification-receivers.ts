import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, notificationReceiversTable } from "@workspace/db";
import { requireAuth, requireRole, getCompanyIdForWrite } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /notification-receivers
router.get("/notification-receivers", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);
    const { category } = req.query as { category?: string };

    let query = db
      .select()
      .from(notificationReceiversTable)
      .where(eq(notificationReceiversTable.companyId, companyId));

    const rows = await query;

    const filtered = category
      ? rows.filter((r) => r.category === category)
      : rows;

    res.json(filtered);
  } catch (err) {
    logger.error({ err }, "GET /notification-receivers failed");
    res.status(500).json({ error: "Gagal memuat daftar penerima notifikasi" });
  }
});

// GET /notification-receivers/categories
router.get("/notification-receivers/categories", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyIdForWrite(req);

    const rows = await db
      .select({ category: notificationReceiversTable.category })
      .from(notificationReceiversTable)
      .where(eq(notificationReceiversTable.companyId, companyId));

    const unique = [...new Set(rows.map((r) => r.category))].sort();
    res.json(unique);
  } catch (err) {
    logger.error({ err }, "GET /notification-receivers/categories failed");
    res.status(500).json({ error: "Gagal memuat kategori" });
  }
});

// POST /notification-receivers
router.post(
  "/notification-receivers",
  requireAuth,
  requireRole("company_admin", "super_admin", "owner", "supervisor"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyIdForWrite(req);
      const { name, phone, category, description, isActive } = req.body as {
        name?: string;
        phone?: string;
        category?: string;
        description?: string;
        isActive?: boolean;
      };

      if (!name?.trim()) {
        res.status(400).json({ error: "Nama wajib diisi" });
        return;
      }
      if (!phone?.trim()) {
        res.status(400).json({ error: "Nomor HP wajib diisi" });
        return;
      }
      if (!category?.trim()) {
        res.status(400).json({ error: "Kategori wajib diisi" });
        return;
      }

      // Group JID (ends with @g.us) → simpan apa adanya; nomor biasa → normalisasi ke format 62xxx
      const trimmed = phone.trim();
      const normalizedPhone = trimmed.endsWith("@g.us")
        ? trimmed
        : trimmed.replace(/\D/g, "").replace(/^0/, "62");

      const [row] = await db
        .insert(notificationReceiversTable)
        .values({
          companyId,
          name: name.trim(),
          phone: normalizedPhone,
          category: category.trim(),
          description: description?.trim() ?? null,
          isActive: isActive ?? true,
        })
        .returning();

      logger.info({ companyId, id: row.id }, "Notification receiver created");
      res.status(201).json(row);
    } catch (err) {
      logger.error({ err }, "POST /notification-receivers failed");
      res.status(500).json({ error: "Gagal menambahkan penerima notifikasi" });
    }
  },
);

// PUT /notification-receivers/:id
router.put(
  "/notification-receivers/:id",
  requireAuth,
  requireRole("company_admin", "super_admin", "owner", "supervisor"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyIdForWrite(req);
      const id = Number(req.params["id"]);

      if (isNaN(id)) {
        res.status(400).json({ error: "ID tidak valid" });
        return;
      }

      const { name, phone, category, description, isActive } = req.body as {
        name?: string;
        phone?: string;
        category?: string;
        description?: string;
        isActive?: boolean;
      };

      const normalizedPhone = phone
        ? phone.trim().endsWith("@g.us")
          ? phone.trim()
          : phone.trim().replace(/\D/g, "").replace(/^0/, "62")
        : undefined;

      const [row] = await db
        .update(notificationReceiversTable)
        .set({
          ...(name !== undefined && { name: name.trim() }),
          ...(normalizedPhone !== undefined && { phone: normalizedPhone }),
          ...(category !== undefined && { category: category.trim() }),
          ...(description !== undefined && { description: description.trim() || null }),
          ...(isActive !== undefined && { isActive }),
        })
        .where(
          and(
            eq(notificationReceiversTable.id, id),
            eq(notificationReceiversTable.companyId, companyId),
          ),
        )
        .returning();

      if (!row) {
        res.status(404).json({ error: "Data tidak ditemukan" });
        return;
      }

      logger.info({ companyId, id }, "Notification receiver updated");
      res.json(row);
    } catch (err) {
      logger.error({ err }, "PUT /notification-receivers/:id failed");
      res.status(500).json({ error: "Gagal memperbarui penerima notifikasi" });
    }
  },
);

// DELETE /notification-receivers/:id
router.delete(
  "/notification-receivers/:id",
  requireAuth,
  requireRole("company_admin", "super_admin", "owner"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = getCompanyIdForWrite(req);
      const id = Number(req.params["id"]);

      if (isNaN(id)) {
        res.status(400).json({ error: "ID tidak valid" });
        return;
      }

      await db
        .delete(notificationReceiversTable)
        .where(
          and(
            eq(notificationReceiversTable.id, id),
            eq(notificationReceiversTable.companyId, companyId),
          ),
        );

      logger.info({ companyId, id }, "Notification receiver deleted");
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "DELETE /notification-receivers/:id failed");
      res.status(500).json({ error: "Gagal menghapus penerima notifikasi" });
    }
  },
);

export default router;
