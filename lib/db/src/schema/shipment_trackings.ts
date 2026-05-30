import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const shipmentTrackingsTable = pgTable("shipment_trackings", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  companyId: text("company_id").notNull().default("default"),
  trackingType: text("tracking_type").notNull().default("container"),
  trackingNumber: text("tracking_number"),
  carrierName: text("carrier_name"),
  vesselName: text("vessel_name"),
  voyageNumber: text("voyage_number"),
  portOfLoading: text("port_of_loading"),
  portOfDischarge: text("port_of_discharge"),
  etd: timestamp("etd", { withTimezone: true }),
  eta: timestamp("eta", { withTimezone: true }),
  atd: timestamp("atd", { withTimezone: true }),
  ata: timestamp("ata", { withTimezone: true }),
  currentStatus: text("current_status"),
  currentLocation: text("current_location"),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }),
  rawData: text("raw_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("shipment_task_idx").on(t.taskId),
  index("shipment_tracking_number_idx").on(t.trackingNumber),
]);

export const insertShipmentTrackingSchema = createInsertSchema(shipmentTrackingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertShipmentTracking = z.infer<typeof insertShipmentTrackingSchema>;
export type ShipmentTracking = typeof shipmentTrackingsTable.$inferSelect;

export const shipmentEventsTable = pgTable("shipment_events", {
  id: serial("id").primaryKey(),
  trackingId: integer("tracking_id").notNull(),
  taskId: integer("task_id").notNull(),
  eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
  eventCode: text("event_code"),
  eventDescription: text("event_description").notNull(),
  location: text("location"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("shipment_events_tracking_idx").on(t.trackingId),
  index("shipment_events_task_idx").on(t.taskId),
]);

export const insertShipmentEventSchema = createInsertSchema(shipmentEventsTable).omit({ id: true, createdAt: true });
export type InsertShipmentEvent = z.infer<typeof insertShipmentEventSchema>;
export type ShipmentEvent = typeof shipmentEventsTable.$inferSelect;
