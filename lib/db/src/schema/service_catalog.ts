import { pgTable, text, serial, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const serviceCatalogTable = pgTable("service_catalog", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  serviceCode: text("service_code"),
  serviceName: text("service_name").notNull(),
  category: text("category"),
  description: text("description"),
  basePrice: text("base_price"),
  currency: text("currency").default("IDR"),
  estimatedDays: text("estimated_days"),
  slaHours: text("sla_hours"),
  suggestedTeam: text("suggested_team"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("service_catalog_company_idx").on(t.companyId),
  index("service_catalog_category_idx").on(t.category),
]);

export const insertServiceCatalogSchema = createInsertSchema(serviceCatalogTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertServiceCatalog = z.infer<typeof insertServiceCatalogSchema>;
export type ServiceCatalog = typeof serviceCatalogTable.$inferSelect;
