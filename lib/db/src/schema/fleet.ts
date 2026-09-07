/**
 * Sprint 7B — Fleet Foundation
 *
 * Tables:
 *   fleet_units               — master data kendaraan
 *   fleet_documents           — dokumen legal kendaraan (STNK, KIR, asuransi)
 *   fleet_drivers             — master data pengemudi
 *   fleet_driver_performance  — skor performa pengemudi per bulan
 *   fleet_maintenance_records — record servis/perbaikan
 *   fleet_maintenance_schedules — jadwal servis berkala
 *   fleet_gps_logs            — log posisi GPS kendaraan
 *   fleet_driver_incidents    — insiden/kecelakaan yang melibatkan pengemudi
 */

import {
  pgTable, text, serial, timestamp, integer, real,
  boolean, date, index, jsonb, uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Status & Type constants ────────────────────────────────────────────────────

export const FLEET_UNIT_STATUSES = ["available", "on_route", "maintenance", "inactive"] as const;
export type FleetUnitStatus = (typeof FLEET_UNIT_STATUSES)[number];

export const FLEET_VEHICLE_TYPES = ["truck", "pickup", "van", "motorcycle", "other"] as const;
export type FleetVehicleType = (typeof FLEET_VEHICLE_TYPES)[number];

export const FLEET_FUEL_TYPES = ["solar", "pertamax", "pertalite", "gas"] as const;
export type FleetFuelType = (typeof FLEET_FUEL_TYPES)[number];

export const FLEET_OWNERSHIP_TYPES = ["own", "leased", "rented"] as const;
export type FleetOwnershipType = (typeof FLEET_OWNERSHIP_TYPES)[number];

export const FLEET_DOC_TYPES = ["stnk", "kir", "insurance", "tax", "mutation", "other"] as const;
export type FleetDocType = (typeof FLEET_DOC_TYPES)[number];

export const FLEET_DOC_STATUSES = ["active", "expiring_soon", "expired"] as const;
export type FleetDocStatus = (typeof FLEET_DOC_STATUSES)[number];

export const FLEET_DRIVER_STATUSES = ["active", "off", "suspended", "resigned"] as const;
export type FleetDriverStatus = (typeof FLEET_DRIVER_STATUSES)[number];

export const FLEET_LICENSE_TYPES = ["SIM A", "SIM B1", "SIM B2", "SIM C"] as const;
export type FleetLicenseType = (typeof FLEET_LICENSE_TYPES)[number];

export const FLEET_MAINTENANCE_TYPES = ["routine", "corrective", "preventive", "emergency"] as const;
export type FleetMaintenanceType = (typeof FLEET_MAINTENANCE_TYPES)[number];

export const FLEET_MAINTENANCE_STATUSES = ["pending", "in_progress", "completed", "cancelled", "rejected"] as const;
export type FleetMaintenanceStatus = (typeof FLEET_MAINTENANCE_STATUSES)[number];

export const FLEET_MAINTENANCE_CATEGORIES = [
  "engine", "transmission", "brake", "electrical", "body", "ac", "tire", "other",
] as const;
export type FleetMaintenanceCategory = (typeof FLEET_MAINTENANCE_CATEGORIES)[number];

export const FLEET_TRIGGER_TYPES = ["km_interval", "date_interval", "both"] as const;
export type FleetTriggerType = (typeof FLEET_TRIGGER_TYPES)[number];

export const FLEET_INCIDENT_TYPES = [
  "accident", "traffic_violation", "breakdown", "cargo_damage", "near_miss", "other",
] as const;
export type FleetIncidentType = (typeof FLEET_INCIDENT_TYPES)[number];

// ── 1. fleet_units ─────────────────────────────────────────────────────────────

export const fleetUnitsTable = pgTable("fleet_units", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),

  unitNumber: text("unit_number").notNull(),
  plateNumber: text("plate_number").notNull(),
  vehicleType: text("vehicle_type").notNull().default("truck"),
  brand: text("brand"),
  model: text("model"),
  year: integer("year"),
  engineNumber: text("engine_number"),
  chassisNumber: text("chassis_number"),
  color: text("color"),
  capacityKg: real("capacity_kg"),
  capacityM3: real("capacity_m3"),
  fuelType: text("fuel_type").default("solar"),
  ownershipType: text("ownership_type").default("own"),

  status: text("status").notNull().default("available"),
  currentOdometerKm: real("current_odometer_km").default(0),
  baseLocation: text("base_location"),
  assignedDriverId: integer("assigned_driver_id"),

  photoUrl: text("photo_url"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("fleet_units_company_idx").on(t.companyId),
  index("fleet_units_plate_idx").on(t.plateNumber),
  index("fleet_units_status_idx").on(t.status),
  index("fleet_units_company_status_idx").on(t.companyId, t.status),
]);

export const insertFleetUnitSchema = createInsertSchema(fleetUnitsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFleetUnit = z.infer<typeof insertFleetUnitSchema>;
export type FleetUnit = typeof fleetUnitsTable.$inferSelect;

// ── 2. fleet_documents ────────────────────────────────────────────────────────

export const fleetDocumentsTable = pgTable("fleet_documents", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  fleetUnitId: integer("fleet_unit_id").notNull(),

  docType: text("doc_type").notNull(),
  docNumber: text("doc_number"),
  issuedDate: date("issued_date"),
  expiredDate: date("expired_date"),
  issuingAuthority: text("issuing_authority"),
  fileUrl: text("file_url"),

  status: text("status").notNull().default("active"),
  reminderDays: integer("reminder_days").default(30),

  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("fleet_documents_unit_idx").on(t.fleetUnitId),
  index("fleet_documents_company_idx").on(t.companyId),
  index("fleet_documents_type_idx").on(t.docType),
  index("fleet_documents_status_idx").on(t.status),
  index("fleet_documents_expired_idx").on(t.expiredDate),
]);

export const insertFleetDocumentSchema = createInsertSchema(fleetDocumentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFleetDocument = z.infer<typeof insertFleetDocumentSchema>;
export type FleetDocument = typeof fleetDocumentsTable.$inferSelect;

// ── 3. fleet_drivers ──────────────────────────────────────────────────────────

export const fleetDriversTable = pgTable("fleet_drivers", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),

  employeeId: text("employee_id"),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  licenseNumber: text("license_number").notNull(),
  licenseType: text("license_type").default("SIM B2"),
  licenseExpired: date("license_expired"),

  joinDate: date("join_date"),
  status: text("status").notNull().default("active"),
  primaryVehicleId: integer("primary_vehicle_id"),
  baseLocation: text("base_location"),
  emergencyContact: text("emergency_contact"),
  emergencyPhone: text("emergency_phone"),
  photoUrl: text("photo_url"),
  notes: text("notes"),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("fleet_drivers_company_idx").on(t.companyId),
  index("fleet_drivers_status_idx").on(t.status),
  index("fleet_drivers_license_idx").on(t.licenseNumber),
  index("fleet_drivers_company_status_idx").on(t.companyId, t.status),
]);

export const insertFleetDriverSchema = createInsertSchema(fleetDriversTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFleetDriver = z.infer<typeof insertFleetDriverSchema>;
export type FleetDriver = typeof fleetDriversTable.$inferSelect;

// ── 4. fleet_driver_performance ───────────────────────────────────────────────

export const fleetDriverPerformanceTable = pgTable("fleet_driver_performance", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  driverId: integer("driver_id").notNull(),

  periodMonth: text("period_month").notNull(),
  totalTrips: integer("total_trips").default(0),
  totalKm: real("total_km").default(0),
  onTimeDeliveries: integer("on_time_deliveries").default(0),
  lateDeliveries: integer("late_deliveries").default(0),
  fuelConsumedLtr: real("fuel_consumed_ltr").default(0),
  incidents: integer("incidents").default(0),
  customerComplaints: integer("customer_complaints").default(0),
  avgSpeedKmh: real("avg_speed_kmh"),
  performanceScore: real("performance_score"),
  aiNotes: text("ai_notes"),
  computedAt: timestamp("computed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("fleet_drv_perf_driver_idx").on(t.driverId),
  index("fleet_drv_perf_company_idx").on(t.companyId),
  index("fleet_drv_perf_period_idx").on(t.periodMonth),
]);

export const insertFleetDriverPerformanceSchema = createInsertSchema(fleetDriverPerformanceTable).omit({ id: true, createdAt: true });
export type InsertFleetDriverPerformance = z.infer<typeof insertFleetDriverPerformanceSchema>;
export type FleetDriverPerformance = typeof fleetDriverPerformanceTable.$inferSelect;

// ── 5. fleet_maintenance_records ──────────────────────────────────────────────

export const fleetMaintenanceRecordsTable = pgTable("fleet_maintenance_records", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  fleetUnitId: integer("fleet_unit_id").notNull(),

  maintenanceType: text("maintenance_type").notNull().default("routine"),
  category: text("category").default("other"),
  description: text("description").notNull(),
  odometerAtService: real("odometer_at_service"),
  serviceDate: date("service_date").notNull(),
  workshopName: text("workshop_name"),
  workshopVendorId: integer("workshop_vendor_id"),

  costEstimate: real("cost_estimate"),
  costActual: real("cost_actual"),
  purchaseRequestId: integer("purchase_request_id"),

  status: text("status").notNull().default("pending"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedBy: text("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  completionDate: date("completion_date"),

  nextServiceKm: real("next_service_km"),
  nextServiceDate: date("next_service_date"),
  partsUsed: jsonb("parts_used"),
  invoiceUrl: text("invoice_url"),
  notes: text("notes"),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("fleet_maint_unit_idx").on(t.fleetUnitId),
  index("fleet_maint_company_idx").on(t.companyId),
  index("fleet_maint_status_idx").on(t.status),
  index("fleet_maint_date_idx").on(t.serviceDate),
  index("fleet_maint_company_status_idx").on(t.companyId, t.status),
]);

export const insertFleetMaintenanceRecordSchema = createInsertSchema(fleetMaintenanceRecordsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFleetMaintenanceRecord = z.infer<typeof insertFleetMaintenanceRecordSchema>;
export type FleetMaintenanceRecord = typeof fleetMaintenanceRecordsTable.$inferSelect;

// ── 6. fleet_maintenance_schedules ────────────────────────────────────────────

export const fleetMaintenanceSchedulesTable = pgTable("fleet_maintenance_schedules", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  fleetUnitId: integer("fleet_unit_id").notNull(),

  scheduleName: text("schedule_name").notNull(),
  triggerType: text("trigger_type").notNull().default("km_interval"),
  kmInterval: real("km_interval"),
  dateIntervalDays: integer("date_interval_days"),

  lastDoneKm: real("last_done_km"),
  lastDoneDate: date("last_done_date"),
  nextDueKm: real("next_due_km"),
  nextDueDate: date("next_due_date"),

  status: text("status").notNull().default("active"),
  autoCreateTask: boolean("auto_create_task").default(false),
  notifyRoles: jsonb("notify_roles"),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("fleet_maint_sched_unit_idx").on(t.fleetUnitId),
  index("fleet_maint_sched_company_idx").on(t.companyId),
  index("fleet_maint_sched_due_idx").on(t.nextDueDate),
]);

export const insertFleetMaintenanceScheduleSchema = createInsertSchema(fleetMaintenanceSchedulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFleetMaintenanceSchedule = z.infer<typeof insertFleetMaintenanceScheduleSchema>;
export type FleetMaintenanceSchedule = typeof fleetMaintenanceSchedulesTable.$inferSelect;

// ── 7. fleet_gps_logs ─────────────────────────────────────────────────────────

export const fleetGpsLogsTable = pgTable("fleet_gps_logs", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  fleetUnitId: integer("fleet_unit_id").notNull(),

  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  speedKmh: real("speed_kmh"),
  headingDeg: real("heading_deg"),
  odometerKm: real("odometer_km"),
  engineOn: boolean("engine_on").default(true),
  source: text("source").default("manual"),
  rawPayload: jsonb("raw_payload"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("fleet_gps_unit_idx").on(t.fleetUnitId),
  index("fleet_gps_recorded_idx").on(t.recordedAt),
  index("fleet_gps_company_idx").on(t.companyId),
]);

export const insertFleetGpsLogSchema = createInsertSchema(fleetGpsLogsTable).omit({ id: true, createdAt: true });
export type InsertFleetGpsLog = z.infer<typeof insertFleetGpsLogSchema>;
export type FleetGpsLog = typeof fleetGpsLogsTable.$inferSelect;

// ── 8. fleet_driver_incidents ─────────────────────────────────────────────────

export const fleetDriverIncidentsTable = pgTable("fleet_driver_incidents", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  driverId: integer("driver_id").notNull(),
  fleetUnitId: integer("fleet_unit_id"),

  incidentType: text("incident_type").notNull().default("other"),
  incidentDate: date("incident_date").notNull(),
  location: text("location"),
  description: text("description").notNull(),
  severity: text("severity").notNull().default("low"),
  faultPercentage: integer("fault_percentage").default(0),
  injuriesReported: boolean("injuries_reported").default(false),
  propertyDamage: boolean("property_damage").default(false),
  estimatedDamage: real("estimated_damage"),
  policeReportNumber: text("police_report_number"),
  insuranceClaimNumber: text("insurance_claim_number"),
  actionTaken: text("action_taken"),
  status: text("status").notNull().default("open"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  attachments: jsonb("attachments"),
  notes: text("notes"),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("fleet_incidents_driver_idx").on(t.driverId),
  index("fleet_incidents_company_idx").on(t.companyId),
  index("fleet_incidents_date_idx").on(t.incidentDate),
  index("fleet_incidents_status_idx").on(t.status),
]);

export const insertFleetDriverIncidentSchema = createInsertSchema(fleetDriverIncidentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFleetDriverIncident = z.infer<typeof insertFleetDriverIncidentSchema>;
export type FleetDriverIncident = typeof fleetDriverIncidentsTable.$inferSelect;

// ── Sprint 7C — Fuel Intelligence, Tire Lifecycle, Utilization ────────────────

export const FLEET_UTILIZATION_STATUSES = ["planned", "on_route", "completed", "cancelled"] as const;
export type FleetUtilizationStatus = (typeof FLEET_UTILIZATION_STATUSES)[number];

export const FLEET_TIRE_POSITIONS = [
  "front_left", "front_right", "rear_left_outer", "rear_left_inner",
  "rear_right_outer", "rear_right_inner", "spare",
] as const;
export type FleetTirePosition = (typeof FLEET_TIRE_POSITIONS)[number];

export const FLEET_TIRE_STATUSES = ["good", "worn", "replaced", "scrapped"] as const;
export type FleetTireStatus = (typeof FLEET_TIRE_STATUSES)[number];

// ── 9. fleet_fuel_benchmarks ──────────────────────────────────────────────────

export const fleetFuelBenchmarksTable = pgTable("fleet_fuel_benchmarks", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),

  vehicleType: text("vehicle_type").notNull(),
  fuelType: text("fuel_type").notNull().default("solar"),
  benchmarkKmPerLiter: real("benchmark_km_per_liter").notNull(),
  tolerancePct: real("tolerance_pct").notNull().default(20),
  minLitersAlert: real("min_liters_alert"),
  maxLitersAlert: real("max_liters_alert"),
  notes: text("notes"),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("fleet_fuel_bench_company_idx").on(t.companyId),
  index("fleet_fuel_bench_type_idx").on(t.vehicleType, t.fuelType),
]);

export const insertFleetFuelBenchmarkSchema = createInsertSchema(fleetFuelBenchmarksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFleetFuelBenchmark = z.infer<typeof insertFleetFuelBenchmarkSchema>;
export type FleetFuelBenchmark = typeof fleetFuelBenchmarksTable.$inferSelect;

// ── 10. fleet_fuel_logs ───────────────────────────────────────────────────────

export const fleetFuelLogsTable = pgTable("fleet_fuel_logs", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  fleetUnitId: integer("fleet_unit_id").notNull(),
  driverId: integer("driver_id"),

  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  odometerKm: real("odometer_km").notNull(),
  litersFilled: real("liters_filled").notNull(),
  fuelType: text("fuel_type").default("solar"),
  pricePerLiter: real("price_per_liter"),
  totalCost: real("total_cost"),
  stationName: text("station_name"),

  kmSinceLastFill: real("km_since_last_fill"),
  kmPerLiter: real("km_per_liter"),

  isAnomaly: boolean("is_anomaly").default(false),
  anomalyReason: text("anomaly_reason"),
  anomalyScore: real("anomaly_score"),

  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("fleet_fuel_unit_idx").on(t.fleetUnitId),
  index("fleet_fuel_company_idx").on(t.companyId),
  index("fleet_fuel_logged_idx").on(t.loggedAt),
  index("fleet_fuel_anomaly_idx").on(t.isAnomaly),
]);

export const insertFleetFuelLogSchema = createInsertSchema(fleetFuelLogsTable).omit({ id: true, createdAt: true });
export type InsertFleetFuelLog = z.infer<typeof insertFleetFuelLogSchema>;
export type FleetFuelLog = typeof fleetFuelLogsTable.$inferSelect;

// ── 11. fleet_tires ───────────────────────────────────────────────────────────

export const fleetTiresTable = pgTable("fleet_tires", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  fleetUnitId: integer("fleet_unit_id").notNull(),

  serialNumber: text("serial_number"),
  brand: text("brand"),
  model: text("model"),
  sizeName: text("size_name"),
  position: text("position").notNull(),

  installDate: date("install_date"),
  installOdometerKm: real("install_odometer_km"),
  expectedLifeKm: real("expected_life_km").default(80000),

  currentOdometerKm: real("current_odometer_km"),
  usedKm: real("used_km"),
  remainingKm: real("remaining_km"),
  wearPct: real("wear_pct"),

  status: text("status").notNull().default("good"),
  replacedAt: timestamp("replaced_at", { withTimezone: true }),
  replacedReason: text("replaced_reason"),

  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("fleet_tires_unit_idx").on(t.fleetUnitId),
  index("fleet_tires_company_idx").on(t.companyId),
  index("fleet_tires_status_idx").on(t.status),
  index("fleet_tires_active_idx").on(t.isActive),
]);

export const insertFleetTireSchema = createInsertSchema(fleetTiresTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFleetTire = z.infer<typeof insertFleetTireSchema>;
export type FleetTire = typeof fleetTiresTable.$inferSelect;

// ── 12. fleet_tire_rotations ──────────────────────────────────────────────────

export const fleetTireRotationsTable = pgTable("fleet_tire_rotations", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  fleetUnitId: integer("fleet_unit_id").notNull(),

  rotationDate: date("rotation_date").notNull(),
  odometerAtRotation: real("odometer_at_rotation"),
  positionsChanged: jsonb("positions_changed"),
  performedBy: text("performed_by"),
  workshopName: text("workshop_name"),
  notes: text("notes"),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("fleet_tire_rot_unit_idx").on(t.fleetUnitId),
  index("fleet_tire_rot_company_idx").on(t.companyId),
  index("fleet_tire_rot_date_idx").on(t.rotationDate),
]);

export const insertFleetTireRotationSchema = createInsertSchema(fleetTireRotationsTable).omit({ id: true, createdAt: true });
export type InsertFleetTireRotation = z.infer<typeof insertFleetTireRotationSchema>;
export type FleetTireRotation = typeof fleetTireRotationsTable.$inferSelect;

// ── 13. fleet_utilization_logs ────────────────────────────────────────────────

export const fleetUtilizationLogsTable = pgTable("fleet_utilization_logs", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull().default("default"),
  fleetUnitId: integer("fleet_unit_id").notNull(),
  driverId: integer("driver_id"),
  aiTaskId: integer("ai_task_id"),

  origin: text("origin"),
  destination: text("destination"),
  tripPurpose: text("trip_purpose"),

  plannedKm: real("planned_km"),
  actualKm: real("actual_km"),

  plannedDeparture: timestamp("planned_departure", { withTimezone: true }),
  actualDeparture: timestamp("actual_departure", { withTimezone: true }),
  plannedArrival: timestamp("planned_arrival", { withTimezone: true }),
  actualArrival: timestamp("actual_arrival", { withTimezone: true }),
  delayMinutes: integer("delay_minutes"),

  capacityUsedPct: real("capacity_used_pct"),
  cargoWeightKg: real("cargo_weight_kg"),

  status: text("status").notNull().default("planned"),
  cancelReason: text("cancel_reason"),
  notes: text("notes"),

  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("fleet_util_unit_idx").on(t.fleetUnitId),
  index("fleet_util_company_idx").on(t.companyId),
  index("fleet_util_status_idx").on(t.status),
  index("fleet_util_departure_idx").on(t.plannedDeparture),
]);

export const insertFleetUtilizationLogSchema = createInsertSchema(fleetUtilizationLogsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFleetUtilizationLog = z.infer<typeof insertFleetUtilizationLogSchema>;
export type FleetUtilizationLog = typeof fleetUtilizationLogsTable.$inferSelect;
