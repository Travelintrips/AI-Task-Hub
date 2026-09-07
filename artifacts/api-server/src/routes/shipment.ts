import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, shipmentTrackingsTable, shipmentEventsTable, taskCommentsTable, auditLogsTable } from "@workspace/db";
import { requireAuth, getCompanyId } from "../middleware/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/shipments/:taskId
router.get("/shipments/:taskId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = Number(req.params.taskId);
    if (Number.isNaN(taskId)) { res.status(400).json({ error: "Invalid taskId" }); return; }

    const trackings = await db.select().from(shipmentTrackingsTable).where(eq(shipmentTrackingsTable.taskId, taskId));
    const events = await db.select().from(shipmentEventsTable).where(eq(shipmentEventsTable.taskId, taskId)).orderBy(desc(shipmentEventsTable.eventTime));

    res.json({ trackings, events });
  } catch (err) {
    logger.error({ err }, "GET /shipments/:taskId failed");
    res.status(500).json({ error: "Failed to load shipment" });
  }
});

// POST /api/shipments
router.post("/shipments", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const companyId = getCompanyId(req) ?? req.user!.companyId;
    const { taskId, trackingType, trackingNumber, carrierName, vesselName, voyageNumber,
      portOfLoading, portOfDischarge, etd, eta } = req.body as Record<string, unknown>;

    if (!taskId) { res.status(400).json({ error: "taskId wajib diisi" }); return; }

    const [tracking] = await db.insert(shipmentTrackingsTable).values({
      taskId: Number(taskId),
      companyId,
      trackingType: String(trackingType ?? "container"),
      trackingNumber: trackingNumber ? String(trackingNumber) : null,
      carrierName: carrierName ? String(carrierName) : null,
      vesselName: vesselName ? String(vesselName) : null,
      voyageNumber: voyageNumber ? String(voyageNumber) : null,
      portOfLoading: portOfLoading ? String(portOfLoading) : null,
      portOfDischarge: portOfDischarge ? String(portOfDischarge) : null,
      etd: etd ? new Date(String(etd)) : null,
      eta: eta ? new Date(String(eta)) : null,
      currentStatus: "Informasi tracking ditambahkan",
      lastUpdatedAt: new Date(),
    }).returning();

    await db.insert(auditLogsTable).values({ action: "shipment_added", module: "shipments", before: `Tracking ${trackingNumber ?? ""} ditambahkan ke task #${taskId}`, entityId: Number(taskId) });

    res.status(201).json(tracking);
  } catch (err) {
    logger.error({ err }, "POST /shipments failed");
    res.status(500).json({ error: "Failed to create shipment" });
  }
});

// PATCH /api/shipments/:id
router.patch("/shipments/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const body = req.body as Record<string, unknown>;

    const fields = ["trackingNumber", "carrierName", "vesselName", "voyageNumber", "portOfLoading", "portOfDischarge", "etd", "eta", "atd", "ata", "currentStatus", "currentLocation"];
    const updates: Record<string, unknown> = { lastUpdatedAt: new Date() };
    for (const f of fields) {
      if (body[f] !== undefined) {
        if (["etd", "eta", "atd", "ata"].includes(f)) updates[f] = body[f] ? new Date(String(body[f])) : null;
        else updates[f] = body[f];
      }
    }

    const [updated] = await db.update(shipmentTrackingsTable).set(updates).where(eq(shipmentTrackingsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Shipment tracking not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /shipments/:id failed");
    res.status(500).json({ error: "Failed to update shipment" });
  }
});

// POST /api/shipments/:trackingId/events — tambah event manual
router.post("/shipments/:trackingId/events", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const trackingId = Number(req.params.trackingId);
    const { taskId, eventTime, eventCode, eventDescription, location } = req.body as Record<string, unknown>;
    if (!taskId || !eventDescription) { res.status(400).json({ error: "taskId dan eventDescription wajib" }); return; }

    const [event] = await db.insert(shipmentEventsTable).values({
      trackingId,
      taskId: Number(taskId),
      eventTime: eventTime ? new Date(String(eventTime)) : new Date(),
      eventCode: eventCode ? String(eventCode) : null,
      eventDescription: String(eventDescription),
      location: location ? String(location) : null,
    }).returning();

    await db.insert(taskCommentsTable).values({
      taskId: Number(taskId),
      senderName: "Shipment Tracking",
      comment: `🚢 ${event.eventDescription}${event.location ? ` — ${event.location}` : ""}`,
      senderType: "system",
    });

    res.status(201).json(event);
  } catch (err) {
    logger.error({ err }, "POST /shipments events failed");
    res.status(500).json({ error: "Failed to add shipment event" });
  }
});

export default router;
