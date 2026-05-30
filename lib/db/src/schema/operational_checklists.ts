import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const CHECKLIST_TEMPLATES: Record<string, string[]> = {
  import: ["Invoice", "Packing List", "Bill of Lading (BL)", "HS Code", "Customs Declaration", "Delivery Order"],
  export: ["Invoice", "Packing List", "PEB (Pemberitahuan Ekspor Barang)", "Booking Confirmation", "Stuffing Report", "Vessel Departure"],
  trucking: ["Surat Jalan", "DO (Delivery Order)", "Tanda Terima", "Foto Barang", "Konfirmasi Penerima"],
  customs_clearance: ["PIB/PEB", "Invoice", "Packing List", "BL/AWB", "HS Code", "SPPB"],
  default: ["Dokumen Utama", "Verifikasi Data", "Konfirmasi Customer", "Proses Selesai"],
};

export const operationalChecklistsTable = pgTable("operational_checklists", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull(),
  taskType: text("task_type").notNull().default("ai_task"),
  companyId: text("company_id").notNull().default("default"),
  itemName: text("item_name").notNull(),
  isDone: boolean("is_done").notNull().default(false),
  doneAt: timestamp("done_at", { withTimezone: true }),
  doneBy: text("done_by"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("checklists_task_idx").on(t.taskId, t.taskType),
  index("checklists_company_idx").on(t.companyId),
]);

export const insertChecklistSchema = createInsertSchema(operationalChecklistsTable).omit({ id: true, createdAt: true });
export type InsertChecklist = z.infer<typeof insertChecklistSchema>;
export type OperationalChecklist = typeof operationalChecklistsTable.$inferSelect;
